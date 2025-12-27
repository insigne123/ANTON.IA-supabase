// src/app/api/leads/search/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { cookies } from "next/headers";
import {
  N8NRequestBodySchema,
  LeadsResponseSchema,
  type LeadsSearchParams
} from "@/lib/schemas/leads";
import { normalizeFromN8N } from "@/lib/normalizers/n8n";

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';

const USE_APIFY = String(process.env.USE_APIFY || "false") === "true";
// New Endpoint URL
const LEAD_SEARCH_URL = "https://studio--studio-6624658482-61b7b.us-central1.hosted.app/api/lead-search";
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

async function callLeadSearchService(payload: any) {
  let attempt = 0;
  let lastErr: unknown = null;

  while (attempt <= MAX_RETRIES) {
    try {
      const res = await fetchWithTimeout(
        LEAD_SEARCH_URL,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Accept": "application/json",
          },
          body: JSON.stringify(payload),
        },
        TIMEOUT_MS
      );

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`SERVICE_HTTP_${res.status}:${text}`);
      }

      const raw = await res.text();
      console.log("Raw Response from Service:", raw);

      if (!raw || !raw.trim()) {
        throw new Error("SERVICE_EMPTY_BODY");
      }

      let json: unknown;
      try {
        json = JSON.parse(raw);
      } catch {
        throw new Error(`SERVICE_BAD_JSON:${raw.slice(0, 300)}`);
      }

      // Assume response format is compatible or needs normalization.
      // Trying to use existing normalizer to be safe, assuming the new service returns something similar to existing n8n/apify structure
      // If it fails validation, we might need to adjust.
      // For now, let's normalize it.
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
    { error: "SERVICE_ERROR", message: lastErr instanceof Error ? lastErr.message : "Unknown" },
    { status: 502 }
  );
}

export async function POST(req: NextRequest) {
  if (USE_APIFY) {
    const url = new URL(req.url);
    url.pathname = "/api/leads/apify";
    return NextResponse.redirect(url, 307);
  }

  // 1. Authenticate: Support both session cookies and x-user-id header (for Cloud Functions)
  const userIdFromHeader = req.headers.get('x-user-id')?.trim() || '';

  let userId: string;

  if (userIdFromHeader) {
    // Server-to-server call from Cloud Functions
    userId = userIdFromHeader;
  } else {
    // Regular user session
    const supabase = createRouteHandlerClient({ cookies });
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "UNAUTHORIZED", message: "User must be logged in" }, { status: 401 });
    }

    userId = user.id;
  }

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "BAD_JSON" }, { status: 400 });
  }

  // 2. Parse existing schema (array)
  const parsed = N8NRequestBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "INVALID_REQUEST_BODY", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const currentParams = parsed.data[0]; // Take the first item

  // 3. Construct new payload
  console.log("Current Params from request:", currentParams);
  console.log("Authenticated User ID:", userId);

  const newPayload = {
    // Strict payload based on specific service requirements
    user_id: userId || undefined,

    industry_keywords: currentParams.industry_keywords,
    company_location: currentParams.company_location,

    // API requires 'titles' as array. Schema default is empty string, we convert to empty array or single-item array.
    titles: Array.isArray(currentParams.titles)
      ? currentParams.titles
      : (typeof currentParams.titles === 'string' && currentParams.titles.length > 0 ? [currentParams.titles] : []),

    // Service uses "employee_range" (singular) but accepts the array values from "employee_ranges"
    employee_range: currentParams.employee_ranges,

    max_results: 100,
  };

  if (!newPayload.titles) newPayload.titles = [];

  console.log("Outgoing Payload to Service:", JSON.stringify(newPayload, null, 2));

  return callLeadSearchService(newPayload);
}
