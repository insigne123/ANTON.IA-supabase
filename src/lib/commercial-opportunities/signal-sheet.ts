// The commercial sheet of a signal (a company that is hiring, a LinkedIn post) as one document: what the radar saw, how it fits the
// company's offer, who to contact and what to say, and what is still missing. This is the one model the page and the PDF draw from, so
// the download is the screen: the same sections, in the same order, with the same figures. Pure.
import { isSignalKind, type OpportunityReport } from './expedient';
import { humanDate, opportunityReportWarnings, reportDecision, reportNextSteps } from './report-view';
import { starsFor, starsText, PRIORITY_STEPS } from './priority';
import { CHANNEL_LABELS, type CommercialBrief } from './signal-brief';
import { RELATION_LABELS, agoText, daysSince, signalFacts, type Bar, type HiringFacts, type PostFacts, type SignalRelation } from './signal-facts';

export type SheetKpi = { label: string; value: string; note?: string };
export type SheetService = { service: string; why: string; strength: 'strong' | 'medium' | 'weak' };
export type SheetBuyer = { title: string; why: string; priority: 'primary' | 'secondary'; searchUrl: string };
export type SheetMessage = { channel: 'linkedin' | 'email' | 'call'; channelLabel: string; subject: string; body: string };
export type SheetStep = { day: number; channel: 'linkedin' | 'email' | 'call' | 'research'; channelLabel: string; action: string };
export type CompletenessItem = { key: string; label: string; done: boolean; /** What to do when it is missing. */ action: string };

export type Pulse =
  | { kind: 'hiring'; kpis: SheetKpi[]; roles: Bar[]; regions: Bar[]; pace: { lastWeek: number; priorWeekly: number; times: number | null } | null; window: string; publishers: string[] }
  | { kind: 'post'; kpis: SheetKpi[]; post: { author: string; authorType: string; when: string; ago: string; text: string; summary: string | null; truncated: boolean; verified: boolean; url: string | null } };

export type SignalSheet = {
  kind: 'hiring' | 'linkedin_post';
  title: string; kindLabel: string;
  relation: { code: SignalRelation; label: string } | null;
  stars: { count: number; text: string; score: number };
  decision: { label: string; tone: 'go' | 'evaluate' | 'no' | 'pending' } | null;
  preparedAt: string | null;
  links: Array<{ label: string; url: string }>;
  headline: string;
  executive: string | null;
  whyNow: string[];
  nextSteps: string[];
  warnings: string[];
  pulse: Pulse;
  fit: { score: number; meaning: string; matchedService: string | null; services: SheetService[]; gaps: string[] };
  company: { summary: string | null; facts: Array<{ label: string; value: string }> };
  buyers: SheetBuyer[];
  approach: { angle: string; hooks: string[]; avoid: string[] } | null;
  messages: SheetMessage[];
  cadence: SheetStep[];
  objections: Array<{ objection: string; answer: string }>;
  validate: Array<{ title: string; action: string; owner: string }>;
  plan: Array<{ title: string; owner: string; due: string; result: string }>;
  risks: Array<{ title: string; impact: 'high' | 'medium' | 'low'; mitigation: string }>;
  questions: string[];
  sample: Array<{ title: string; where: string; when: string; publisher: string; url: string | null }>;
  completeness: { items: CompletenessItem[]; done: number; total: number; percent: number };
  /** Whether the AI has written the plan (a report exists) or the sheet is only what the radar saw. */
  written: boolean;
};

export type SheetInput = {
  item: { kind: string; title?: string | null; company_name?: string | null; company_domain?: string | null; company_linkedin_url?: string | null; url?: string | null; score?: number | null; reasons?: string[] | null; data?: Record<string, unknown> | null };
  report?: OpportunityReport | null;
  /** The titles the company usually contacts (its search criteria), offered as buyers while the AI has not written its own. */
  decisionMakerTitles?: string[];
  /** Contacts already found and linked to the opportunity. */
  contactsCount?: number;
  now?: number;
};

export const SECTION_TITLES = {
  summary: 'Resumen', pulse: 'La señal', fit: 'Calce con tu oferta', company: 'La empresa', buyers: 'A quién contactar', approach: 'Cómo abordarlos',
  messages: 'Mensajes listos', cadence: 'Secuencia de seguimiento', objections: 'Objeciones y cómo responderlas', validate: 'Qué validar antes de invertir tiempo',
  plan: 'Pasos comerciales', risks: 'Riesgos', questions: 'Preguntas para la primera conversación', sample: 'Avisos de muestra', pending: 'Qué falta en esta ficha',
} as const;
export type SectionId = keyof typeof SECTION_TITLES;
/** What is on the sheet, in the order the page and the PDF show it; a section with nothing to say is left out. */
export function sheetSections(sheet: SignalSheet): SectionId[] {
  const present: Record<SectionId, boolean> = {
    summary: true, pulse: true, fit: true, company: Boolean(sheet.company.summary || sheet.company.facts.length), buyers: sheet.buyers.length > 0, approach: Boolean(sheet.approach),
    messages: sheet.messages.length > 0, cadence: sheet.cadence.length > 0, objections: sheet.objections.length > 0, validate: sheet.validate.length > 0, plan: sheet.plan.length > 0,
    risks: sheet.risks.length > 0, questions: sheet.questions.length > 0, sample: sheet.sample.length > 0, pending: sheet.completeness.done < sheet.completeness.total,
  };
  return (Object.keys(SECTION_TITLES) as SectionId[]).filter(id => present[id]);
}

const clip = (value: string, max: number) => (value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value);
const firstSentence = (value: string) => (value.match(/^.{20,}?[.!?](?=\s|$)/)?.[0] ?? value).trim();
const number = (value: number, digits = 0) => new Intl.NumberFormat('es-CL', { maximumFractionDigits: digits }).format(value);
const plural = (count: number, one: string, many: string) => `${number(count)} ${count === 1 ? one : many}`;
/** The first `max - 1` bars and the rest together as «Otros (n)», so a chart never needs more room than it has. */
export function groupRest(list: Bar[], max: number, total: number | null = null): Bar[] {
  if (list.length <= max) return list;
  const head = list.slice(0, max - 1), rest = list.slice(max - 1);
  const value = rest.reduce((sum, bar) => sum + bar.value, 0);
  const top = Math.max(head[0]?.value ?? 0, value) || 1;
  return [...head, { label: `Otros (${rest.length})`, value, share: 0, percent: total && total > 0 ? Math.min(1, value / total) : null }].map(bar => ({ ...bar, share: bar.value / top }));
}
export const linkedinSearchUrl = (title: string, company: string) => `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(`${title} ${company}`.trim())}`;

/** For a report written before the structured plan existed: the angle and the message are in the prose of «Cómo abordarlos». */
function legacyApproach(report: OpportunityReport | null | undefined) {
  const section = report?.sections.find(item => /abordar|mensaje/i.test(item.title));
  const paragraphs = section?.paragraphs ?? [];
  const angle = paragraphs.map(p => p.match(/^[ÁA]ngulo:\s*([\s\S]+)$/i)?.[1]?.trim()).find(Boolean) ?? '';
  const quoted = paragraphs.map(p => p.match(/«([^»]{30,900})»/)?.[1]?.trim()).find(Boolean) ?? '';
  return { angle: clip(angle.charAt(0).toUpperCase() + angle.slice(1), 420), message: quoted };
}

export function buildSignalSheet(input: SheetInput): SignalSheet | null {
  const { item, report } = input;
  const facts = signalFacts(item);
  if (!facts || !isSignalKind(item.kind)) return null;
  const now = input.now ?? Date.now();
  const brief: CommercialBrief | undefined = report?.commercial;
  const hiring = facts.kind === 'hiring' ? facts : null;
  const post = facts.kind === 'linkedin_post' ? facts : null;
  const title = hiring ? hiring.company : post!.author;
  const score = Math.max(0, Math.min(100, Math.round(Number(item.score) || 0)));
  const data = (item.data ?? {}) as Record<string, unknown>;
  const matchedService = typeof data.matchedService === 'string' && data.matchedService.trim() ? data.matchedService.trim() : null;
  const observed = observedReasons(facts, now);
  const radarReasons = (item.reasons ?? []).filter(Boolean).slice(0, 4);

  const pulse: Pulse = hiring ? hiringPulse(hiring, now) : postPulse(post!, now);
  const legacy = legacyApproach(report);
  const buyers: SheetBuyer[] = brief?.buyers.length
    ? brief.buyers.map(buyer => ({ ...buyer, searchUrl: linkedinSearchUrl(buyer.title, title) }))
    : (input.decisionMakerTitles ?? []).slice(0, 5).map((name, index) => ({ title: name, why: 'Cargo que tu empresa suele contactar.', priority: index === 0 ? 'primary' as const : 'secondary' as const, searchUrl: linkedinSearchUrl(name, title) }));
  const approach = brief?.approach.angle || brief?.approach.hooks.length ? { angle: brief.approach.angle, hooks: brief.approach.hooks, avoid: brief.approach.avoid }
    : legacy.angle ? { angle: legacy.angle, hooks: [], avoid: [] } : null;
  const messages: SheetMessage[] = brief?.messages.length
    ? brief.messages.map(message => ({ channel: message.channel, channelLabel: CHANNEL_LABELS[message.channel], subject: message.subject, body: message.body }))
    : legacy.message ? [{ channel: legacy.message.length <= 300 ? 'linkedin' : 'email', channelLabel: CHANNEL_LABELS[legacy.message.length <= 300 ? 'linkedin' : 'email'], subject: '', body: legacy.message }] : [];
  const cadence: SheetStep[] = (brief?.cadence ?? []).map(step => ({ ...step, channelLabel: CHANNEL_LABELS[step.channel] }));
  const services: SheetService[] = brief?.fit.services.length ? brief.fit.services
    : matchedService ? [{ service: matchedService, why: 'Es el servicio con el que el radar relacionó esta señal.', strength: score >= 65 ? 'strong' : score >= 45 ? 'medium' : 'weak' }] : [];
  const deterministicFacts = hiring ? [
    ['Relación', RELATION_LABELS[hiring.relation]], ['Rubro', hiring.industry ?? 'No informado'], ['Tamaño', hiring.size ?? 'No informado'],
    ['Presencia', hiring.regions.length ? hiring.regions.slice(0, 3).map(region => region.label).join(', ') : 'No informada'],
  ] as Array<[string, string]> : [['Autor', post!.authorType === 'company' ? 'Una empresa' : post!.authorType === 'person' ? 'Una persona' : 'No informado'], ['Identidad', post!.verified ? 'Verificada' : 'Sin verificar']];
  const used = new Set(deterministicFacts.map(([label]) => label.toLowerCase()));
  const companyFacts = [...deterministicFacts.map(([label, value]) => ({ label, value })), ...(brief?.company.facts ?? []).filter(fact => !used.has(fact.label.toLowerCase()))];
  const summaryText = brief?.company.summary || (data.summary && typeof data.summary === 'object' ? String((data.summary as Record<string, unknown>).text ?? '') : '') || null;
  const executive = report?.executive?.trim() || null;
  const headline = brief?.headline || (executive ? firstSentence(executive) : hiring
    ? `${hiring.company} está contratando: ${plural(hiring.ads, 'aviso', 'avisos')} en ${hiring.windowDays} días.` : `${post!.author} publicó algo que calza con tu oferta.`);
  const warnings = report ? opportunityReportWarnings(report.warnings, [], false) : [];
  const questions = report?.questions ?? [];
  const validate = (report?.requirements ?? []).map(req => ({ title: req.title, action: req.action, owner: req.role }));
  const sheet: SignalSheet = {
    kind: hiring ? 'hiring' : 'linkedin_post', title, kindLabel: hiring ? 'Avisos de empleo' : 'Publicación de LinkedIn',
    relation: hiring ? { code: hiring.relation, label: RELATION_LABELS[hiring.relation] } : null,
    stars: { count: starsFor(score), text: starsText(score), score },
    decision: report ? reportDecision(report) : null, preparedAt: report ? humanDate(report.generatedAt) : null,
    links: [
      ...(hiring?.linkedinUrl ? [{ label: 'LinkedIn de la empresa', url: hiring.linkedinUrl }] : []),
      ...(hiring?.domain ? [{ label: hiring.domain, url: `https://${hiring.domain}` }] : []),
      ...(post?.url ? [{ label: 'Ver la publicación', url: post.url }] : []), ...(post?.authorUrl ? [{ label: 'Perfil del autor', url: post.authorUrl }] : []),
    ],
    headline, executive, whyNow: brief?.whyNow.length ? brief.whyNow : report?.reasons.length ? report.reasons : observed.length ? observed : radarReasons,
    nextSteps: report ? reportNextSteps(report) : [], warnings, pulse,
    fit: { score, meaning: PRIORITY_STEPS.find(step => step.stars === starsFor(score))!.label, matchedService, services, gaps: brief?.fit.gaps ?? [] },
    company: { summary: summaryText, facts: companyFacts }, buyers, approach, messages, cadence, objections: brief?.objections ?? [],
    validate, plan: (report?.tasks ?? []).map(task => ({ title: task.title, owner: [task.role, task.due].filter(Boolean).join(' · '), due: task.due, result: task.evidence })),
    risks: (report?.risks ?? []).map(risk => ({ title: risk.title, impact: risk.impact, mitigation: risk.mitigation })), questions,
    sample: hiring ? hiring.sample.map(ad => ({ title: ad.title, where: ad.where ?? '', when: ad.when ? agoText(daysSince(ad.when, now)) : '', publisher: ad.publisher ?? '', url: ad.url })) : [],
    completeness: { items: [], done: 0, total: 0, percent: 0 }, written: Boolean(report),
  };
  sheet.completeness = completeness(sheet, input.contactsCount ?? 0);
  return sheet;
}

/** Why now, in whole sentences, from what the radar saw: the sheet reads well before anyone asks for the written report. */
function observedReasons(facts: HiringFacts | PostFacts, now: number): string[] {
  if (facts.kind === 'linkedin_post') {
    const days = daysSince(facts.postedAt, now);
    return [
      ...(facts.postedAt ? [`Publicó el ${humanDate(facts.postedAt) ?? 'día indicado'}${days !== null ? ` (${agoText(days)})` : ''}: una necesidad abierta hoy se atiende mejor si la respuesta es rápida.`] : []),
      ...(facts.summary ? [clip(facts.summary, 200)] : []),
    ];
  }
  const { ads, adsLastWeek, windowDays, pace: rhythm } = facts;
  const top = facts.roles.slice(0, 3);
  const region = facts.regions[0];
  return [
    ...(ads > 0 ? [`${plural(ads, 'aviso', 'avisos')} en ${windowDays} días${adsLastWeek > 0 ? `, ${number(adsLastWeek)} de ellos en la última semana${rhythm?.times && rhythm.times >= 1.5 ? ` (${number(rhythm.times, 1)} veces su ritmo anterior)` : ''}` : ''}.`] : []),
    ...(top.length ? [`Los cargos más pedidos son ${top.map(role => `${role.label} (${number(role.value)})`).join(', ')}.`] : []),
    ...(region ? [`Concentra sus avisos en ${region.label}: ${number(region.value)} de ${number(ads)}.`] : []),
    ...(facts.relation === 'client' ? ['Ya es tu cliente: la conversación parte con ventaja.'] : facts.relation === 'contact' ? ['Ya tienes contactos ahí: pide que te presenten con quien decide.'] : []),
  ].slice(0, 4);
}

function hiringPulse(facts: HiringFacts, now: number): Pulse {
  const { ads, adsLastWeek, windowDays, pace } = facts;
  const last = daysSince(facts.lastPostedAt, now);
  const lastWeekNote = pace?.times && pace.times >= 1.5 ? `${number(pace.times, 1)} veces su ritmo anterior` : pace && pace.priorWeekly > 0 ? 'ritmo parecido al anterior' : undefined;
  return {
    kind: 'hiring',
    kpis: [
      { label: `Avisos en ${windowDays} días`, value: number(ads) },
      { label: 'En la última semana', value: number(adsLastWeek), ...(lastWeekNote ? { note: lastWeekNote } : {}) },
      { label: 'Cargos distintos', value: number(facts.roles.length) },
      { label: 'Regiones', value: number(facts.regions.length), ...(facts.regions[0] ? { note: `sobre todo ${facts.regions[0].label}` } : {}) },
    ],
    roles: groupRest(facts.roles, 7, ads), regions: groupRest(facts.regions, 6, ads), pace,
    window: last === null ? `Últimos ${windowDays} días` : `Últimos ${windowDays} días · el aviso más reciente es de ${agoText(last)}`, publishers: facts.publishers,
  };
}
function postPulse(facts: PostFacts, now: number): Pulse {
  const days = daysSince(facts.postedAt, now);
  return {
    kind: 'post',
    kpis: [
      { label: 'Publicada', value: facts.postedAt ? (humanDate(facts.postedAt) ?? '') : 'Sin fecha', ...(days !== null ? { note: agoText(days) } : {}) },
      { label: 'Quién publica', value: facts.authorType === 'company' ? 'Una empresa' : facts.authorType === 'person' ? 'Una persona' : 'No informado', note: facts.verified ? 'identidad verificada' : 'identidad sin verificar' },
    ],
    post: { author: facts.author, authorType: facts.authorType ?? '', when: facts.postedAt ? (humanDate(facts.postedAt) ?? '') : '', ago: agoText(days), text: facts.text, summary: facts.summary, truncated: facts.truncated, verified: facts.verified, url: facts.url },
  };
}

/** What a complete sheet has, and what to do about what it lacks: the page shows it as a checklist, the PDF as the pending box. */
function completeness(sheet: SignalSheet, contacts: number) {
  const items: CompletenessItem[] = [
    { key: 'signal', label: 'La señal', done: true, action: '' },
    { key: 'fit', label: 'Calce con tu oferta', done: sheet.fit.services.length > 0, action: 'Actualiza la ficha para que la IA lo explique.' },
    { key: 'company', label: 'La empresa', done: Boolean(sheet.company.summary), action: 'Actualiza la ficha para resumir lo que se sabe de ella.' },
    { key: 'buyers', label: 'A quién contactar', done: sheet.buyers.length > 0, action: 'Actualiza la ficha para proponer cargos.' },
    { key: 'contacts', label: 'Contactos encontrados', done: contacts > 0, action: 'Busca a las personas en «Contactos».' },
    { key: 'message', label: 'Primer mensaje', done: sheet.messages.length > 0, action: 'Actualiza la ficha para escribirlo.' },
    { key: 'cadence', label: 'Secuencia de seguimiento', done: sheet.cadence.length > 0, action: 'Actualiza la ficha para planificar los pasos.' },
    { key: 'discovery', label: 'Preguntas para la conversación', done: sheet.questions.length >= 3, action: 'Actualiza la ficha para prepararlas.' },
    { key: 'objections', label: 'Objeciones y respuestas', done: sheet.objections.length > 0, action: 'Actualiza la ficha para anticiparlas.' },
    { key: 'validate', label: 'Qué validar', done: sheet.validate.length > 0, action: 'Actualiza la ficha para listarlo.' },
  ];
  const done = items.filter(item => item.done).length;
  return { items, done, total: items.length, percent: Math.round((done / items.length) * 100) };
}
