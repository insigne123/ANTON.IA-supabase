// src/app/api/leads/search/route.ts
import { NextRequest, NextResponse } from "next/server";
import {
  N8NRequestBodySchema,
  LeadsResponseSchema,
} from "@/lib/schemas/leads";
import { normalizeFromN8N } from "@/lib/normalizers/n8n";

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';

const USE_APIFY = String(process.env.USE_APIFY || "false") === "true";
const N8N_URL = process.env.N8N_LEADS_WEBHOOK_URL || "";
const TIMEOUT_MS = Number(process.env.LEADS_N8N_TIMEOUT_MS ?? 60000);
const MAX_RETRIES = Number(process.env.LEADS_N8N_MAX_RETRIES ?? 0);

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

async function callN8N(body: unknown) {
  const parsed = N8NRequestBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "INVALID_REQUEST_BODY", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  if (!N8N_URL) {
    return NextResponse.json(
      { error: "SERVER_MISCONFIGURED", message: "N8N_LEADS_WEBHOOK_URL no está configurado" },
      { status: 500 }
    );
  }

  let attempt = 0;
  let lastErr: unknown = null;

  while (attempt <= MAX_RETRIES) {
    try {
      const res = await fetchWithTimeout(
        N8N_URL,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Accept": "application/json",
          },
          body: JSON.stringify(parsed.data),
        },
        TIMEOUT_MS
      );
      
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`N8N_HTTP_${res.status}:${text}`);
      }
      
      const raw = await res.text();
      if (!raw || !raw.trim()) {
        throw new Error("N8N_EMPTY_BODY");
      }
      
      let json: unknown;
      try {
        json = JSON.parse(raw);
      } catch {
        throw new Error(`N8N_BAD_JSON:${raw.slice(0, 300)}`);
      }

      const normalized = normalizeFromN8N(json);
      LeadsResponseSchema.parse(normalized);

      return NextResponse.json(normalized, { status: 200 });
    } catch (e) {
      lastErr = e;
      if (attempt === MAX_RETRIES) break;
      await new Promise(r => setTimeout(r, Math.min(1000 * 2 ** attempt, 6000)));
      attempt++;
    }
  }

  return NextResponse.json(
    { error: "N8N_ERROR", message: lastErr instanceof Error ? lastErr.message : "Unknown" },
    { status: 502 }
  );
}

// Punto único de entrada (hoy n8n; si USE_APIFY=true podríamos redirigir al viejo flujo)
export async function POST(req: NextRequest) {
  if (USE_APIFY) {
    // Back-compat: derive a 307 al endpoint antiguo si feature flag activo
    const url = new URL(req.url);
    url.pathname = "/api/leads/apify"; // tu endpoint legacy
    return NextResponse.redirect(url, 307);
  }
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "BAD_JSON" }, { status: 400 });
  }
  return callN8N(body);
}
