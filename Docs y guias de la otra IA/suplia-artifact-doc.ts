/* =====================================================================
   suplia-research-tools.ts  —  Tools de INVESTIGACIÓN para SUPL.IA
   (SUPERSEDE la versión de Fase 0: ahora incluye las 3)

   SIN KEY, SIN COSTO (pueden correr sin aprobación):
     - research.similarweb   tráfico estimado del dominio
     - research.whois        registrar / antigüedad / disponibilidad

   CON KEY y CONSUMEN CRÉDITOS  ->  llamarlas SIEMPRE detrás de una aprobación
   (patrón lead.enrich_batch). No las pongas en la allow-list auto-ejecutable.
     - research.brand            info de marca + logos (Brand.dev)

   Handler signature: (input: Record<string, unknown>, context: SupliaToolContext)
   `fetch` es global en el runtime nodejs de Next.js.
   ===================================================================== */
import type { SupliaToolContext } from '@/lib/server/suplia-tool-runner';

const RESEARCH_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function normResearchDomain(value: unknown): string {
  return String(value || '').trim().replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/.*$/, '').toLowerCase();
}
function needEnv(name: string): string {
  const v = String(process.env[name] || '').trim();
  if (!v) throw new Error(`Falta la variable de entorno ${name} para esta tool de research.`);
  return v;
}

/* ---------- SIN KEY ---------- */
export async function researchSimilarweb(input: Record<string, unknown>, _context: SupliaToolContext) {
  const domain = normResearchDomain(input.domain || (input as any).company || (input as any).url);
  if (!domain) throw new Error('Falta "domain" para research.similarweb');
  const res = await fetch(`https://data.similarweb.com/api/v1/data?domain=${encodeURIComponent(domain)}`, {
    headers: { accept: 'application/json,text/plain,*/*', 'user-agent': RESEARCH_UA },
  });
  if (!res.ok) throw new Error(`SimilarWeb HTTP ${res.status} para ${domain}${res.status === 404 ? ' (sin datos)' : ''}`);
  const d: any = await res.json();
  const e = d.Engagments || {}, ts = d.TrafficSources || {};
  return {
    domain, globalRank: d.GlobalRank?.Rank ?? null, category: d.CategoryRank?.Category ?? null,
    visitsMonthly: Number.isFinite(Number(e.Visits)) ? Number(e.Visits) : null,
    bounceRate: e.BounceRate ?? null, pagesPerVisit: e.PagePerVisit ?? null,
    trafficSources: { direct: ts.Direct ?? null, searchOrganic: ts.SearchOrganic ?? null, referrals: ts.Referrals ?? null, social: ts.SocialOrganic ?? null },
    topCountries: (d.TopCountryShares || []).slice(0, 5).map((c: any) => ({ country: c.CountryCode, share: c.Value })),
    source: 'similarweb_public', note: 'Tráfico estimado (endpoint público). Sin costo.',
  };
}
export async function researchWhois(input: Record<string, unknown>, _context: SupliaToolContext) {
  const domain = normResearchDomain(input.domain || (input as any).url);
  if (!domain) throw new Error('Falta "domain" para research.whois');
  const res = await fetch(`https://mcp.domaindetails.com/lookup/${encodeURIComponent(domain)}`, { headers: { accept: 'application/json', 'user-agent': RESEARCH_UA } });
  if (!res.ok) throw new Error(`WHOIS HTTP ${res.status} para ${domain}`);
  const d: any = await res.json();
  return { domain, registrar: d.registrar ?? null, created: d.creationDate || d.created || null, expires: d.expiryDate || d.expires || null, available: typeof d.available === 'boolean' ? d.available : null, source: 'domaindetails' };
}

/* ---------- CON KEY (consumen créditos → aprobación) ---------- */
export async function researchBrand(input: Record<string, unknown>, _context: SupliaToolContext) {
  const key = needEnv('BRANDDEV_API_KEY');
  const domain = normResearchDomain(input.domain || (input as any).url);
  if (!domain) throw new Error('Falta "domain" para research.brand');
  const res = await fetch(`https://api.brand.dev/v1/brand/retrieve?domain=${encodeURIComponent(domain)}`, { headers: { Authorization: `Bearer ${key}` } });
  if (!res.ok) throw new Error(`Brand.dev HTTP ${res.status}`);
  const d: any = await res.json();
  const b = d.brand || d;
  return { domain, name: b.name ?? null, description: b.description ?? null, industry: b.industry || (b.industries && b.industries[0]) || null, logos: (b.logos || []).slice(0, 3), source: 'brand.dev' };
}
/* ---------------------------------------------------------------------
   REGISTRO en SUPLIA_TOOLS (src/lib/server/suplia-tools.ts):

  'research.similarweb':    { name: 'research.similarweb',    description: 'Trafico estimado (SimilarWeb publico). Sin costo. Solo lectura.', inputSchema: '{ "domain": string }', handler: researchSimilarweb },
  'research.whois':         { name: 'research.whois',         description: 'WHOIS del dominio. Sin costo. Solo lectura.',                    inputSchema: '{ "domain": string }', handler: researchWhois },
  // CON KEY — gatear por aprobacion (consumen creditos):
  'research.brand':         { name: 'research.brand',         description: 'Info de marca y logos (Brand.dev). Consume creditos.',           inputSchema: '{ "domain": string }', handler: researchBrand },

   La tool con key debe prepararse como pendingAction (patron lead.enrich_batch)
   y NO incluirse en la allow-list de tools auto-ejecutables sin aprobacion.
   --------------------------------------------------------------------- */
