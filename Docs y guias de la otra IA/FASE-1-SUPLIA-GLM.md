# Fase 1 de SUPL.IA — cambios listos (100% GLM)

> Continúa la Fase 0. **Todo sigue en GLM** (el cliente es OpenAI-compatible; genkit está vacío, no hay Gemini — lo verifiqué). Cuatro cambios, en orden de impacto.

| # | Archivo | Qué cambia |
|---|---|---|
| 1 | `src/ai/flows/generate-campaign.ts` | Prompt **experto** para la secuencia de campaña + temp 0.6 |
| 2 | `src/lib/server/suplia-tools.ts` | `scoreCompanies` y `scorePeople` con **rúbrica transparente** (fit/intent/reach) + señal de research |
| 3 | `src/lib/server/suplia-context.ts` | **Context brief** curado (oferta + desempeño) que usan todos los agentes |
| 4 | `src/lib/server/suplia-intent-llm.ts` (nuevo) + `suplia-orchestrator.ts` | **Intent híbrido**: regex + GLM con extracción de slots |

---

## Cambio 1 — Copy experto en secuencias (`src/ai/flows/generate-campaign.ts`)

En la rama `else` (campaña estándar), **busca** el prompt actual:
```
              Act as an expert email marketing copywriter.
              Create a drip campaign sequence (3-5 emails) for the following scenario:
```
…y reemplaza **todo ese template** por uno experto en español:
```ts
            prompt = `
Eres un estratega de email marketing B2B y copywriter senior. Disena una secuencia de 3 a 5 correos que abra conversaciones (no que "venda" de golpe).

Escenario:
- Objetivo: ${goal || 'Generar reuniones'}
- Mi empresa / oferta: ${companyName || 'Desconocida'}
- Audiencia objetivo: ${targetAudience || 'General'}
- Idioma: ${language || 'es'}

Reglas de la cadencia:
- Cada correo: UNA sola idea y UN solo CTA. Maximo ~90 palabras.
- Correo 1: gancho con una senal o dolor real de la audiencia, no presentacion de la empresa.
- Correo 2 (a 2-3 dias): aporta una prueba o angulo nuevo (caso, dato, beneficio concreto).
- Correo 3+ (a 3-4 dias): re-encuadre corto o "breakup" amable. Espacia los offsetDays de forma realista.
- Asuntos de 4-7 palabras, especificos, con curiosidad o beneficio. Nada de mayusculas gritonas ni clickbait.
- Tono cercano y profesional, espanol de Chile. No prometas resultados que no puedas respaldar.

Para cada paso entrega:
- name: nombre interno descriptivo (ej. "Gancho por senal", "Prueba/caso", "Breakup").
- offsetDays: dias desde el correo anterior.
- subject: asunto.
- bodyHtml: cuerpo en HTML (usa <p>, <br>, <strong>). Usa {{lead.name}}, {{company}} y {{sender.name}} donde ayuden, pero que la estructura funcione incluso sin personalizar.
`;
```
Y sube la creatividad: cambia `temperature: 0.4` → `temperature: 0.6` en el `generateStructured` de este archivo.

> Aplica el mismo criterio a la rama `if` (reconnection) si quieres. El modelo lo resuelve `generateStructured` → GLM (por env/base URL), así que no se toca el proveedor.

---

## Cambio 2 — Scoring transparente (`src/lib/server/suplia-tools.ts`)

Hoy el scoring es heurístico y opaco (suma puntos sueltos). Lo reorganizamos en una **rúbrica con sub-puntajes** (sin IA, sin costo) y, si hay señal de `research.*`, la usamos. Reemplaza **ambas funciones completas**:

### 2a. `scoreCompanies`
```ts
async function scoreCompanies(input: Record<string, unknown>, context: SupliaToolContext) {
  const companies = asObjectArray(input.companies || input.candidates);
  const strategy = input.strategy && typeof input.strategy === 'object' ? input.strategy as any : {};
  const segments = Array.isArray(strategy.segments) ? strategy.segments : [];
  const industries = segments.flatMap((s: any) => Array.isArray(s.industries) ? s.industries : []);
  const buyingSignals = segments.flatMap((s: any) => Array.isArray(s.buyingSignals) ? s.buyingSignals : []);

  const scored = companies.map((company) => {
    const name = asText(company.name || company.companyName) || 'Empresa';
    const domain = getCompanyDomain(company);
    const reasons: string[] = [];
    const risks: string[] = [];

    // Rúbrica: fit (0-45) + intent/señales (0-35) + reach (0-20)
    let fit = 8, intent = 0, reach = 0;
    if (textIncludesAny(`${name} ${company.industry || ''}`, industries)) { fit += 22; reasons.push('Fit: coincide con industria/segmento del ICP.'); }
    if (typeof company.score === 'number' && company.score >= 0.65) { fit += 15; reasons.push('Fit: buen match con el criterio de busqueda.'); }

    if (textIncludesAny(JSON.stringify(company), buyingSignals)) { intent += 22; reasons.push('Intent: senales compatibles con la hipotesis de compra.'); }
    const research = (company as any).research || (company as any).similarweb;
    if (research && Number(research.visitsMonthly) > 0) { intent += 8; reasons.push('Intent: presencia digital con trafico medible.'); }
    if (research && (research.created || research.registrar)) { intent += 5; reasons.push('Intent: dominio con antiguedad (madurez).'); }

    if (domain) { reach += 20; reasons.push('Reach: dominio identificable para buscar decisores.'); }
    else { risks.push('Sin dominio claro para buscar decisores.'); }
    if (String(name).length < 3) risks.push('Nombre de empresa poco confiable.');

    const breakdown = { fit: Math.round(Math.min(45, fit)), intent: Math.round(Math.min(35, intent)), reach: Math.round(Math.min(20, reach)) };
    const score = Math.max(0, Math.min(100, breakdown.fit + breakdown.intent + breakdown.reach));
    return {
      companyKey: String(company.id || domain || name),
      companyName: name, domain, score, scoreLabel: scoreLabel(score),
      breakdown,
      reasons: reasons.length ? reasons : ['Match inicial por criterio de busqueda.'],
      risks,
      matchedSegments: segments.map((s: any) => s.name).filter(Boolean).slice(0, 3),
      sourcePayload: company,
    };
  }).sort((a, b) => b.score - a.score);

  if (context.jobId && scored.length > 0) {
    const admin = getSupabaseAdminClient();
    await admin.from('suplia_company_scores').insert(scored.map((item) => ({
      organization_id: context.auth.organizationId,
      job_id: context.jobId,
      company_key: item.companyKey,
      company_name: item.companyName,
      domain: item.domain || null,
      score: item.score,
      score_label: item.scoreLabel,
      reasons: item.reasons,
      risks: item.risks,
      matched_segments: item.matchedSegments,
      source_payload: { ...(item.sourcePayload as any), breakdown: item.breakdown },
    })));
  }

  return { items: scored, count: scored.length, topCompanies: scored.slice(0, asLimit(input.limit, 8, 25)) };
}
```

### 2b. `scorePeople`
```ts
async function scorePeople(input: Record<string, unknown>, context: SupliaToolContext) {
  const leads = asObjectArray(input.leads || input.people || input.contacts);
  const strategy = input.strategy && typeof input.strategy === 'object' ? input.strategy as any : {};
  const segments = Array.isArray(strategy.segments) ? strategy.segments : [];
  const decisionRoles = segments.flatMap((s: any) => Array.isArray(s.decisionRoles) ? s.decisionRoles : []);
  const influencerRoles = segments.flatMap((s: any) => Array.isArray(s.influencerRoles) ? s.influencerRoles : []);
  const targetRoles = [...decisionRoles, ...influencerRoles];

  const scored = await Promise.all(leads.map(async (lead) => {
    const email = getLeadEmail(lead);
    const fullName = getLeadName(lead) || 'Contacto';
    const title = asText(lead.title || lead.job_title || lead.role);
    const companyName = asText(lead.companyName || lead.company || lead.organization_name);
    const reasons: string[] = [];
    const risks: string[] = [];

    // Rúbrica: fit/rol (0-40) + reach/contactabilidad (0-45) + intent (0-15)
    let fit = 6, reach = 0, intent = 0;
    if (textIncludesAny(title, decisionRoles)) { fit += 34; reasons.push('Fit: rol decisor compatible con ICP.'); }
    else if (textIncludesAny(title, influencerRoles)) { fit += 22; reasons.push('Fit: rol influenciador compatible con ICP.'); }
    else if (textIncludesAny(title, targetRoles)) { fit += 12; reasons.push('Fit: rol relacionado con el ICP.'); }

    if (email && email.includes('@')) { reach += 28; reasons.push('Reach: email disponible.'); }
    else risks.push('Sin email util para contactar.');
    if ((lead as any).lockedEmail) { reach -= 12; risks.push('Email bloqueado o no desbloqueado.'); }
    if (lead.linkedinUrl || lead.linkedin_url) { reach += 6; reasons.push('Reach: perfil de LinkedIn disponible.'); }

    if (companyName) { intent += 8; reasons.push('Intent: empresa identificable.'); }
    if ((lead as any).signal || (lead as any).buyingSignal) { intent += 7; reasons.push('Intent: senal de compra asociada.'); }

    let contactability: any = null;
    if (email) {
      contactability = await checkContactability({ email }, context);
      if (contactability.status === 'blocked') { reach = 0; risks.push('Bloqueado por privacidad/contactabilidad.'); }
      if (contactability.status === 'warning') { reach -= 8; risks.push('Tiene warning de contactabilidad.'); }
    }

    const breakdown = { fit: Math.round(Math.min(40, fit)), reach: Math.round(Math.max(0, Math.min(45, reach))), intent: Math.round(Math.min(15, intent)) };
    const score = Math.max(0, Math.min(100, breakdown.fit + breakdown.reach + breakdown.intent));
    return {
      leadKey: String(lead.id || email || `${fullName}-${companyName}`),
      leadId: asText(lead.leadId || lead.lead_id) || null,
      email, fullName, title, companyName, score, scoreLabel: scoreLabel(score),
      breakdown,
      reasons: reasons.length ? reasons : ['Lead compatible con la busqueda inicial.'],
      risks,
      recommendedAction: score >= 60 && email ? 'approve_for_enrichment_or_preview' : 'review_before_using',
      contactability,
      sourcePayload: lead,
    };
  }));

  const sorted = scored.sort((a, b) => b.score - a.score);
  if (context.jobId && sorted.length > 0) {
    const admin = getSupabaseAdminClient();
    await admin.from('suplia_lead_scores').insert(sorted.map((item) => ({
      organization_id: context.auth.organizationId,
      job_id: context.jobId,
      lead_key: item.leadKey,
      lead_id: item.leadId || null,
      email: item.email || null,
      full_name: item.fullName,
      company_name: item.companyName || null,
      score: item.score,
      score_label: item.scoreLabel,
      reasons: item.reasons,
      risks: item.risks,
      recommended_action: item.recommendedAction,
      source_payload: { ...(item.sourcePayload as any), breakdown: item.breakdown },
    })));
  }

  return { items: sorted, count: sorted.length, topLeads: sorted.slice(0, asLimit(input.limit, 12, 50)) };
}
```

> El `breakdown` viaja dentro de `source_payload` → **sin migración**. Ahora cada score es explicable (fit/intent/reach) y se puede mostrar en la UI o en el artifact.

---

## Cambio 3 — Context brief curado (`src/lib/server/suplia-context.ts`)

Hoy el contexto trae perfil + conteos. Le sumamos **oferta** y **desempeño** (reply rate) y exponemos `formatContextBrief` para los prompts. Reemplaza el tipo, la función y agrega el helper:

```ts
export type SupliaAppContext = {
  user: { id: string; email?: string | null };
  organizationId: string;
  profile: Record<string, unknown> | null;
  offer: string | null;                                   // NUEVO
  emailConnections: { google: boolean; outlook: boolean };
  counts: { leads: number; contacted: number; campaigns: number; activeMissions: number; openExceptions: number };
  performance: { contacted: number; replied: number; replyRate: number } | null;  // NUEVO
};

export async function buildSupliaContext(auth: AuthContext): Promise<SupliaAppContext> {
  const admin = getSupabaseAdminClient();
  const userId = auth.user.id;
  const organizationId = auth.organizationId;

  const [profileRes, tokenRes, leadsRes, contactedRes, campaignsRes, missionsRes, exceptionsRes, repliedRes] = await Promise.all([
    admin.from('profiles').select('*').eq('id', userId).maybeSingle(),
    admin.from('provider_tokens').select('provider').eq('user_id', userId),
    admin.from('leads').select('*', { count: 'exact', head: true }).eq('organization_id', organizationId),
    admin.from('contacted_leads').select('*', { count: 'exact', head: true }).eq('organization_id', organizationId),
    admin.from('campaigns').select('*', { count: 'exact', head: true }).eq('organization_id', organizationId),
    admin.from('antonia_missions').select('*', { count: 'exact', head: true }).eq('organization_id', organizationId).eq('status', 'active'),
    admin.from('antonia_exceptions').select('*', { count: 'exact', head: true }).eq('organization_id', organizationId).eq('status', 'open'),
    admin.from('contacted_leads').select('*', { count: 'exact', head: true }).eq('organization_id', organizationId).not('replied_at', 'is', null),
  ]);

  const providers = new Set((tokenRes.data || []).map((row: any) => String(row.provider || '').toLowerCase()));
  const profile = (profileRes.data as Record<string, unknown> | null) || null;
  const offer = profile
    ? (String((profile as any).company_profile || (profile as any).value_proposition || (profile as any).offer || (profile as any).company || '').trim() || null)
    : null;

  const contacted = Number(contactedRes?.count || 0);
  const replied = Number(repliedRes?.count || 0);
  const performance = contacted > 0 ? { contacted, replied, replyRate: Math.round((replied / contacted) * 100) } : null;

  return {
    user: { id: userId, email: auth.user.email || null },
    organizationId,
    profile,
    offer,
    emailConnections: { google: providers.has('google'), outlook: providers.has('outlook') },
    counts: {
      leads: Number(leadsRes?.count || 0),
      contacted,
      campaigns: Number(campaignsRes?.count || 0),
      activeMissions: Number(missionsRes?.count || 0),
      openExceptions: Number(exceptionsRes?.count || 0),
    },
    performance,
  };
}

/** Brief compacto y legible para inyectar en prompts (en vez de JSON crudo). */
export function formatContextBrief(ctx: SupliaAppContext): string {
  const mail = [ctx.emailConnections.google ? 'Gmail' : '', ctx.emailConnections.outlook ? 'Outlook' : ''].filter(Boolean).join(' + ') || 'sin email conectado';
  const lines = [
    `Oferta del usuario: ${ctx.offer || 'sin descripcion de oferta configurada'}.`,
    `Canales de correo: ${mail}.`,
    `Volumen: ${ctx.counts.leads} leads, ${ctx.counts.contacted} contactados, ${ctx.counts.campaigns} campanas.`,
    ctx.performance ? `Desempeno historico: ${ctx.performance.replied}/${ctx.performance.contacted} respondieron (${ctx.performance.replyRate}% reply rate).` : 'Sin historico de respuestas aun.',
  ];
  return lines.join('\n');
}
```

**Úsalo** en los prompts de los agentes: donde hoy dice `${JSON.stringify(context).slice(0, 5000)}` (en `suplia-agent-registry.ts`, p. ej. `icp-strategist` y `planner`), cámbialo por `${formatContextBrief(context)}` e importa `formatContextBrief` desde `@/lib/server/suplia-context`. Menos ruido, más señal.

---

## Cambio 4 — Intent híbrido (`suplia-intent-llm.ts` + `suplia-orchestrator.ts`)

Agrega el archivo nuevo **`src/lib/server/suplia-intent-llm.ts`** (incluido). Deja el regex como prefiltro barato y solo usa GLM `fast` cuando hay duda, extrayendo slots (objetivo, sector, ciudad, tamaño, rol).

En `suplia-orchestrator.ts`, importa y reemplaza:
```ts
// import
import { classifySupliaIntentHybrid } from '@/lib/server/suplia-intent-llm';

// dentro de processSupliaMessage, donde hoy dice:
//   const intent = classifySupliaIntent(message);
const intentResult = await classifySupliaIntentHybrid(message);
const intent = { intent: intentResult.intent, confidence: intentResult.confidence, reason: intentResult.reason };
const intentSlots = intentResult.slots; // disponibles para prellenar el workflow/ICP (sector, ciudad, tamano, rol)
```
(Quita el `import { classifySupliaIntent } ...` del orchestrator si ya no se usa directo.) `intentSlots` te sirve para pasar `sector/ciudad/tamano` al `icp-strategist`/`buildSearchPlan` y **evitar preguntar lo que el usuario ya dijo**.

---

## Aplicar y validar

1. Rama nueva sobre `suplia/github-upload` (ej. `suplia/fase-1-marketing`).
2. `npm run typecheck` y `npm test`.
3. Genera una secuencia (`campaign.generate_sequence`) y compara: cadencia y copy claramente mejores.
4. Corre un scoring y confirma que cada item trae `breakdown` (fit/intent/reach).
5. Manda un mensaje ambiguo y confirma en logs que el intent cae a GLM y extrae slots.
6. Telemetría: todos los `modelName` deben ser GLM.

> Igual que en Fase 0: no puedo pushear por ti. Queda listo para aplicar y abrir el PR.

## Qué sigue (Fase 2)
Scoring/copy con research con key (Brand.dev/SerpAPI), memoria controlable (UI), preflight de compliance formal, bulk send con dry-run, y evals por agente para medir la calidad del copy y de los replies.
