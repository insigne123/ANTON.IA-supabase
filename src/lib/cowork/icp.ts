import { titleContainsTerm } from './commercial-facts';

/**
 * «¿Cuál es mi cliente ideal?» (plan 8, phase 2): what the person declared in «Perfil» next to what their own sends show,
 * segment by segment, and how much of their saved base fits it. Pure arithmetic: the model explains it, never computes it.
 * A segment with few sends says so instead of a conclusion: on 2 Oct 2026 the organization with most sends had 600 of them,
 * 5 replies and 2 positive ones.
 */

export type IcpDeclared = {
  roles: string[]; industries: string[]; companySize: string | null; locations: string[];
  painPoints: string[]; differentiators: string[]; referenceClients: string[];
};
export type IcpTouch = {
  id: string; leadId: string | null; email: string | null; role: string | null; industry: string | null;
  country: string | null; city: string | null; sentAt: string | null; repliedAt: string | null;
  replyIntent: string | null; bouncedAt: string | null;
};
export type IcpLead = { id: string; title: string | null; industry: string | null; country: string | null; city: string | null };
/** CRM stages by record id, as unified_crm_data keeps them: `lead_saved|<id>`, `lead_enriched|<id>` or `enriched_lead|<id>`. */
export type IcpStages = Map<string, string>;

/** Fewer sends than this and a segment is a lead to test, not a conclusion. */
export const ICP_SMALL_SAMPLE = 30;
const ICP_ENOUGH_SAMPLE = 100;
const SEGMENTS_SHOWN = 6;
const POSITIVE = new Set(['positive', 'interested', 'meeting_request']);
/** Not an answer from a person: an out-of-office or a delivery failure. */
const NOT_A_REPLY = new Set(['auto_reply', 'delivery_failure']);
const MEETING_OR_LATER = new Set(['meeting', 'negotiation', 'closed_won']);
/** The three ways the app names a contact's CRM record (crm-service.ts writes `enriched_lead|`). */
const CRM_PREFIXES = ['lead_saved', 'lead_enriched', 'enriched_lead'];

/** Functional areas first: «Gerente de Operaciones» is Operations, only what is left is general management. */
const AREAS: Array<{ area: string; terms: string[] }> = [
  { area: 'Personas y RR. HH.', terms: ['rrhh', 'rr.hh', 'rr. hh.', 'recursos humanos', 'personas', 'people', 'talento', 'talent', 'human resources', 'hr', 'chro',
    'seleccion', 'reclutamiento', 'reclutador', 'reclutadora', 'recruiter', 'remuneraciones', 'nomina', 'payroll', 'bienestar', 'relaciones laborales', 'capital humano'] },
  { area: 'Operaciones y logística', terms: ['operaciones', 'operacion', 'operations', 'coo', 'planta', 'produccion', 'logistica', 'logistics', 'bodega', 'supply chain',
    'abastecimiento', 'mantencion', 'mantenimiento', 'faena', 'prevencion de riesgos', 'seguridad'] },
  { area: 'Finanzas y administración', terms: ['finanzas', 'finance', 'cfo', 'contabilidad', 'contador', 'contadora', 'tesoreria', 'contralor', 'controller', 'administracion'] },
  { area: 'Comercial y marketing', terms: ['comercial', 'ventas', 'sales', 'marketing', 'negocios', 'business development', 'kam', 'key account', 'cuentas'] },
  { area: 'Legal y cumplimiento', terms: ['legal', 'abogado', 'abogada', 'fiscal', 'compliance', 'cumplimiento'] },
  { area: 'Tecnología', terms: ['ti', 'tecnologia', 'it', 'sistemas', 'cto', 'cio', 'software', 'digital', 'datos', 'data'] },
  { area: 'Gerencia general', terms: ['gerente general', 'gerenta general', 'ceo', 'country manager', 'director ejecutivo', 'directora ejecutiva', 'managing director',
    'fundador', 'fundadora', 'founder', 'cofundador', 'cofundadora', 'dueño', 'dueña', 'owner', 'socio', 'socia', 'presidente', 'presidenta'] },
];
const LEVELS: Array<{ level: string; terms: string[] }> = [
  { level: 'Dirección', terms: ['gerente', 'gerenta', 'director', 'directora', 'ceo', 'cfo', 'coo', 'cto', 'cio', 'chro', 'vp', 'vicepresidente', 'vicepresidenta',
    'head', 'socio', 'socia', 'fundador', 'fundadora', 'founder', 'dueño', 'dueña', 'owner', 'presidente', 'presidenta', 'country manager'] },
  { level: 'Jefatura', terms: ['subgerente', 'subgerenta', 'jefe', 'jefa', 'manager', 'encargado', 'encargada', 'lider', 'lead', 'supervisor', 'supervisora'] },
  { level: 'Profesional', terms: ['analista', 'analyst', 'ejecutivo', 'ejecutiva', 'especialista', 'specialist', 'coordinador', 'coordinadora', 'asistente', 'assistant',
    'consultor', 'consultora', 'ingeniero', 'ingeniera', 'administrativo', 'administrativa', 'generalista', 'business partner'] },
];

const matches = (title: string, terms: string[]) => terms.some(term => titleContainsTerm(title, term));
export function icpRoleArea(title: string | null | undefined) {
  if (!title?.trim()) return 'Sin cargo';
  return AREAS.find(item => matches(title, item.terms))?.area ?? 'Otra área';
}
export function icpRoleLevel(title: string | null | undefined) {
  if (!title?.trim()) return 'Sin cargo';
  return LEVELS.find(item => matches(title, item.terms))?.level ?? 'Otro nivel';
}

/** Wilson score interval at 95 %: honest bounds for small samples, in percent with one decimal. */
export function icpRate(successes: number, trials: number) {
  if (!trials) return null;
  const z = 1.96;
  const p = successes / trials;
  const denominator = 1 + z * z / trials;
  const center = (p + z * z / (2 * trials)) / denominator;
  const margin = z * Math.sqrt(p * (1 - p) / trials + z * z / (4 * trials * trials)) / denominator;
  const pct = (value: number) => Math.round(Math.max(0, Math.min(1, value)) * 1000) / 10;
  return { pct: pct(p), low: pct(center - margin), high: pct(center + margin) };
}
export function icpConfidence(sent: number) {
  return sent < ICP_SMALL_SAMPLE ? 'muestra chica: no concluyas' : sent < ICP_ENOUGH_SAMPLE ? 'indicio' : 'suficiente';
}

type Person = { area: string; level: string; industry: string; location: string; replied: boolean; positive: boolean; meeting: boolean; won: boolean; bounced: boolean };
const label = (value: string | null | undefined, empty: string) => {
  const text = (value || '').replace(/\s+/g, ' ').trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : empty;
};

function segments(people: Person[], key: keyof Pick<Person, 'area' | 'level' | 'industry' | 'location'>) {
  const groups = new Map<string, Person[]>();
  for (const person of people) {
    // Industries and places come as typed by people or providers: «Retail» and «retail» are one group.
    const id = person[key].toLowerCase();
    groups.set(id, [...(groups.get(id) || []), person]);
  }
  const all = [...groups.values()].map(group => {
    const count = (test: (person: Person) => boolean) => group.filter(test).length;
    const sent = group.length, replied = count(person => person.replied), positive = count(person => person.positive);
    return { value: group[0][key], sent, replied, positive, meetings: count(person => person.meeting), won: count(person => person.won),
      bounced: count(person => person.bounced), replyRate: icpRate(replied, sent), positiveRate: icpRate(positive, sent), confidence: icpConfidence(sent) };
  }).sort((a, b) => b.sent - a.sent || b.positive - a.positive || a.value.localeCompare(b.value));
  const shown = all.slice(0, SEGMENTS_SHOWN);
  const rest = all.slice(SEGMENTS_SHOWN);
  return { groups: shown, otherGroups: rest.length, otherSent: rest.reduce((sum, item) => sum + item.sent, 0) };
}

/** A saved contact fits the declared customer when its title has one of the roles and its industry one of the industries (each only if declared). */
function fitsDeclared(lead: IcpLead, declared: IcpDeclared) {
  const role = !declared.roles.length || (lead.title ? matches(lead.title, declared.roles) : false);
  const industry = !declared.industries.length || (lead.industry ? declared.industries.some(term => titleContainsTerm(lead.industry!, term)) : false);
  return role && industry;
}

export function analyzeIcp(input: { declared: IcpDeclared | null; touches: IcpTouch[]; leads: IcpLead[]; stages: IcpStages; now: string }) {
  const leadsById = new Map(input.leads.map(lead => [lead.id, lead]));
  // One person counts once, whatever the number of sends: by contact, else by address.
  const people = new Map<string, Person>();
  const sentDates: number[] = [];
  for (const touch of input.touches) {
    if (!touch.sentAt) continue;
    const time = Date.parse(touch.sentAt);
    if (Number.isFinite(time)) sentDates.push(time);
    const key = touch.leadId || (touch.email ? touch.email.trim().toLowerCase() : `row:${touch.id}`);
    const lead = touch.leadId ? leadsById.get(touch.leadId) : undefined;
    const title = touch.role || lead?.title || null;
    const stages = touch.leadId ? CRM_PREFIXES.flatMap(prefix => input.stages.get(`${prefix}|${touch.leadId}`) ?? []) : [];
    const intent = (touch.replyIntent || '').toLowerCase();
    const replied = Boolean(touch.repliedAt) && !NOT_A_REPLY.has(intent);
    const current = people.get(key);
    const person: Person = current ? { ...current } : {
      area: icpRoleArea(title), level: icpRoleLevel(title),
      industry: label(touch.industry || lead?.industry, 'Sin industria'),
      location: label(lead?.city || touch.city || lead?.country || touch.country, 'Sin ubicación'),
      replied: false, positive: false, meeting: false, won: false, bounced: false,
    };
    person.replied ||= replied;
    person.positive ||= replied && POSITIVE.has(intent);
    person.meeting ||= stages.some(stage => MEETING_OR_LATER.has(stage));
    person.won ||= stages.includes('closed_won');
    person.bounced ||= Boolean(touch.bouncedAt);
    people.set(key, person);
  }
  const everyone = [...people.values()];
  const count = (test: (person: Person) => boolean) => everyone.filter(test).length;
  const totals = {
    people: everyone.length, replied: count(person => person.replied), positive: count(person => person.positive),
    meetings: count(person => person.meeting), won: count(person => person.won), bounced: count(person => person.bounced),
    firstSend: sentDates.length ? new Date(Math.min(...sentDates)).toISOString().slice(0, 10) : null,
    lastSend: sentDates.length ? new Date(Math.max(...sentDates)).toISOString().slice(0, 10) : null,
  };
  const contacted = new Set(input.touches.filter(touch => touch.sentAt && touch.leadId).map(touch => touch.leadId!));
  const declaredSomething = Boolean(input.declared && (input.declared.roles.length || input.declared.industries.length));
  const fitting = declaredSomething ? input.leads.filter(lead => fitsDeclared(lead, input.declared!)) : [];
  const fittingAreas = new Map<string, number>();
  for (const lead of fitting.filter(item => !contacted.has(item.id))) {
    const area = icpRoleArea(lead.title);
    fittingAreas.set(area, (fittingAreas.get(area) || 0) + 1);
  }
  const gaps: string[] = [];
  if (!input.declared || (!input.declared.roles.length && !input.declared.industries.length)) {
    gaps.push('En «Perfil» no están los cargos ni las industrias de tu cliente ideal: el análisis parte de tus resultados y de tu oferta.');
  }
  if (input.declared && !input.declared.companySize) gaps.push('En «Perfil» falta el tamaño de empresa de tu cliente ideal.');
  if (input.declared?.companySize) gaps.push('Tus contactos guardados no traen el tamaño de su empresa: no se puede medir por tamaño.');
  if (totals.people < ICP_SMALL_SAMPLE) gaps.push(`Hay ${totals.people} personas con envíos registrados: muy pocas para concluir qué segmento responde mejor.`);
  else if (totals.positive < 5) gaps.push(`Solo ${totals.positive} respuestas positivas en total: los segmentos son indicios, no conclusiones.`);
  const withoutIndustry = count(person => person.industry === 'Sin industria');
  if (everyone.length && withoutIndustry / everyone.length > 0.3) gaps.push(`${withoutIndustry} de ${everyone.length} personas contactadas no tienen industria registrada.`);
  return {
    declared: input.declared,
    totals: { ...totals, replyRate: icpRate(totals.replied, totals.people), positiveRate: icpRate(totals.positive, totals.people), confidence: icpConfidence(totals.people) },
    segments: {
      area: segments(everyone, 'area'), level: segments(everyone, 'level'),
      industry: segments(everyone, 'industry'), location: segments(everyone, 'location'),
    },
    coverage: declaredSomething ? {
      savedContacts: input.leads.length, fitDeclared: fitting.length,
      fitNotContacted: fitting.filter(lead => !contacted.has(lead.id)).length,
      notContactedByArea: [...fittingAreas].sort((a, b) => b[1] - a[1]).slice(0, SEGMENTS_SHOWN).map(([area, people]) => ({ area, people })),
    } : null,
    gaps,
    method: 'Personas distintas con al menos un envío registrado en ANTON.IA. Respuesta: sin automáticas ni fallas de entrega. Positiva: interés o pedido de reunión. Reunión y ganado: según la etapa del pipeline. Entre paréntesis, el rango probable de cada tasa (intervalo de Wilson, 95 %).',
    asOf: input.now,
  };
}
