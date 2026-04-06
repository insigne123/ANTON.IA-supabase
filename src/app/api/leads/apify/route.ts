import { NextRequest, NextResponse } from 'next/server';
import { getIndustryIdByName } from "@/lib/data";
import { mapSenioritiesToApollo, mapDepartmentsToApollo } from "@/lib/apollo-taxonomies";

function sanitizeString(s?: string | null): string {
  if (!s) return '';
  return String(s).normalize('NFKC').trim();
}
function sanitizeCSV(s?: string | null): string[] {
  if (!s) return [];
  return String(s)
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}
function sanitizeKeywordsToTagsArray(input?: string | null): string[] {
  const items = sanitizeCSV(input).map((x) => x.toLowerCase());
  const seen = new Set<string>();
  const out: string[] = [];
  for (const it of items) if (!seen.has(it)) { seen.add(it); out.push(it); }
  return out;
}

/** Construye "#/people?..." con [] literales en CLAVES; codifica solo VALORES */
function buildHashPeopleQuery(params: Array<[key: string, value: string]>): string {
  const parts: string[] = [];
  for (const [k, v] of params) parts.push(`${k}=${encodeURIComponent(v)}`);
  return `#/people?${parts.join('&')}`;
}

type SearchBody = {
  industry: string;                 // requerido
  location?: string;                // person location
  title?: string;                   // person title
  sizeRange?: { min?: number; max?: number };
  companySize?: string;             // alternativa "min,max"
  name?: string;
  seniorities?: string[];
  departments?: string[];
  keywords?: string;                // "outsourcing, it staffing"
  keywordTags?: string[];           // si ya viene tokenizado
  /** overrides del actor */
  cleanOutput?: boolean;
  totalRecords?: number;
  fileName?: string;
};

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as SearchBody;

    // --- Validación mínima ---
    const industry = sanitizeString(body.industry);
    if (!industry) {
      return NextResponse.json({ error: 'industry_required' }, { status: 400 });
    }

    // ===== Apollo URL SOLO como hash =====
    // Base sin query; todo va en el fragmento "#/people?..."
    const apolloUrl = new URL('https://app.apollo.io/');

    // --- Armar parámetros del hash en el orden de tu ejemplo correcto ---
    const hashParams: Array<[string, string]> = [];
    hashParams.push(['page', '1']);

    // ===== INDUSTRIA → organizationIndustryTagIds[] =====
    // La UI envía "industry" como nombre legible. Lo convertimos a ID de Apollo.
    const industryName = sanitizeString(body.industry);
    if (industryName) {
      const industryId = getIndustryIdByName(industryName);
      if (!industryId) {
        console.error("[search] industry_not_mapped", { industryName });
        return NextResponse.json(
          {
            error: "industry_not_mapped",
            message:
              "La industria seleccionada no tiene ID mapeado a Apollo. Revisa src/lib/data.ts (industryMapping).",
            industry: industryName,
          },
          { status: 400 }
        );
      }
      hashParams.push(["organizationIndustryTagIds[]", industryId]);
    }

    // Keywords → Organization Keyword Tags
    const keywordTags =
      (Array.isArray(body.keywordTags) && body.keywordTags.length > 0
        ? body.keywordTags
        : sanitizeKeywordsToTagsArray(body.keywords)) ?? [];
    if (keywordTags.length > 0) {
      for (const tag of keywordTags) hashParams.push(['qOrganizationKeywordTags[]', tag]);
      hashParams.push(['includedOrganizationKeywordFields[]', 'tags']);
      hashParams.push(['includedOrganizationKeywordFields[]', 'name']);
    }

    // Email verificado (V2 + legacy como en tu ejemplo)
    hashParams.push(['contactEmailStatusV2[]', 'verified']);
    hashParams.push(['contactEmailStatus', 'verified']);

    // Location de la persona
    const location = sanitizeString(body.location);
    if (location) hashParams.push(['personLocations[]', location]);

    // Título de la persona
    const title = sanitizeString(body.title);
    if (title) hashParams.push(['personTitles[]', title]);

    // Tamaño de empresa → "min,max"
    if (body.sizeRange?.min != null && body.sizeRange?.max != null) {
      hashParams.push(['organizationNumEmployeesRanges[]', `${body.sizeRange.min},${body.sizeRange.max}`]);
    } else if (body.companySize) {
      hashParams.push(['organizationNumEmployeesRanges[]', body.companySize]);
    }
    
    // === NUEVO: Nombre → qKeywords ===
    if (typeof body.name === "string") {
        const q = body.name.trim();
        if (q.length > 0) {
        hashParams.push(["qKeywords", q]);
        }
    }

    // === NUEVO: Management level → personSeniorities[] ===
    if (Array.isArray(body.seniorities) && body.seniorities.length > 0) {
        const mapped = mapSenioritiesToApollo(body.seniorities);
        for (const s of mapped) {
        hashParams.push(["personSeniorities[]", s]);
        }
    }

    // === NUEVO: Departamentos → personDepartmentOrSubdepartments[] ===
    if (Array.isArray(body.departments) && body.departments.length > 0) {
        const mapped = mapDepartmentsToApollo(body.departments);
        for (const d of mapped) {
        hashParams.push(["personDepartmentOrSubdepartments[]", d]);
        }
    }

    // Orden y flags (mantén tu lógica actual)
    hashParams.push(["sortAscending", "false"]);
    hashParams.push(["sortByField", "[none]"]);


    apolloUrl.hash = buildHashPeopleQuery(hashParams);

    // URL final (sin query antes de #)
    const searchUrl = `https://app.apollo.io/${apolloUrl.hash}`;

    // ===== Ejecutar Actor en Apify =====
    const token = process.env.APIFY_TOKEN;
    const actorId = process.env.APIFY_APOLLO_ACTOR_ID; // p.ej., "plush_zinnia~apollo-scraper---scrape-upto-50k-leads"
    const taskId  = process.env.APIFY_APOLLO_TASK_ID;  // ej: "user~task-name"  o "HG7ML7..."
    if (!token || (!actorId && !taskId)) {
      const msg = !token
        ? 'missing_env.APIFY_TOKEN'
        : 'missing_env.APIFY_APOLLO_ACTOR_ID_or_TASK_ID';
      return NextResponse.json({ error: msg }, { status: 500 });
    }

    // Selección de endpoint correcto (¡ojo al dominio!)
    // Task:  POST https://api.apify.com/v2/actor-tasks/:taskId/runs
    // Actor: POST https://api.apify.com/v2/acts/:actorId/runs
    const apifyEndpoint = taskId
      ? `https://api.apify.com/v2/actor-tasks/${encodeURIComponent(taskId)}/runs?token=${encodeURIComponent(token)}`
      : `https://api.apify.com/v2/acts/${encodeURIComponent(actorId!)}/runs?token=${encodeURIComponent(token)}`;

    // Input EXACTO requerido por el actor (según tu ejemplo)
    const actorInput = {
      cleanOutput: body.cleanOutput ?? true,
      totalRecords: body.totalRecords ?? 500,
      url: searchUrl,
      fileName: body.fileName ?? 'Apollo Prospects',
    };

    const runRes = await fetch(apifyEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(actorInput),
    });

    if (!runRes.ok) {
      const text = await runRes.text();
      console.error('[apify:start] failed', {
        status: runRes.status,
        text: text?.slice(0, 1024),
        apifyEndpoint,
      });
      if (runRes.status === 401) {
        return NextResponse.json(
          { error: 'apify_auth_failed', details: 'User was not found or authentication token is not valid' },
          { status: 401 }
        );
      }
      if (runRes.status === 404) {
        return NextResponse.json(
          { error: taskId ? 'apify_task_not_found' : 'apify_actor_not_found', details: 'ID inválido o sin acceso con este token' },
          { status: 404 }
        );
      }
      return NextResponse.json(
        {
          error: 'apify_start_failed',
          status: runRes.status,
          details: text?.slice(0, 1024),
          debug:
            process.env.NODE_ENV !== 'production'
              ? { apifyEndpoint, actorInput, apolloUrlPreview: searchUrl }
              : undefined,
        },
        { status: runRes.status },
      );
    }

    const runJson = await runRes.json().catch(() => ({} as any));
    const runId = runJson?.data?.id ?? runJson?.id ?? null;
    const datasetId = runJson?.data?.defaultDatasetId ?? runJson?.defaultDatasetId ?? null;

    const payload: any = { ok: true, runId, datasetId };
    if (process.env.NODE_ENV !== 'production') {
      payload.debug = { runUrl: apifyEndpoint, actorInput, apolloUrlPreview: searchUrl };
    }
    return NextResponse.json(payload, { status: 200 });
  } catch (err: any) {
    console.error('[apify:start] unexpected', err);
    return NextResponse.json({ error: 'unexpected', details: String(err?.message ?? err) }, { status: 500 });
  }
}
