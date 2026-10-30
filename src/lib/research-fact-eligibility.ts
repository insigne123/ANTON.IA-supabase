import type {
  ResearchClaimV1,
  ResearchEvidenceV1,
  ResearchSnapshotV1,
  ResearchSourceV1,
} from '@/lib/research-contracts';

function text(value: unknown) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export function researchTextKey(value: unknown) {
  return text(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function isHardRejectedResearchText(value: unknown) {
  const raw = String(value || '');
  if (
    /<\s*(?:!doctype\b|\/?\s*[a-z])[^>]*(?:>|$)/i.test(raw)
    || /\bdoctype\s+html\s*>/i.test(raw)
    || /\b(?:elementor(?:-[a-z0-9_-]+)+|hummingbird-assets)\b/i.test(raw)
    || /\b(?:wp-content|wp-includes)\//i.test(raw)
    // A form dumped as text: «Nombre(*) Telefono(*) Correo(*) Mensaje(*) Para comprobar que no es un bot, resuelva la adición: 2 + 7».
    || (raw.match(/\(\*\)/g) || []).length >= 3
  ) return true;

  const normalized = researchTextKey(value);
  if (!normalized) return false;

  return [
    /\b(?:cf chl|cf challenge|challenge platform|cloudflare ray id)\b/,
    /\battention required cloudflare\b/,
    /\b(?:one moment(?: please)?|just a moment(?: please)?)\b/,
    /\b(?:loader|loading)\b.{0,80}\bplease wait\b/,
    /\bplease wait while (?:your|the) request is being verified\b/,
    /\b(?:checking|verifying) (?:your )?(?:browser|connection|request)\b/,
    /\b(?:verify|confirm) (?:that )?you are (?:a )?human\b/,
    /\b(?:complete|solve|enter) (?:the |this )?(?:captcha|recaptcha|hcaptcha|security challenge)\b/,
    /\b(?:captcha|recaptcha|hcaptcha) (?:verification|challenge|required|failed)\b/,
    /\benable javascript and cookies to continue\b/,
    /\b(?:verifica|confirma) que eres (?:un )?humano\b/,
    /\b(?:comprobando|verificando) (?:tu )?(?:navegador|conexion|solicitud)\b/,
    /\bpor favor espera mientras (?:tu solicitud |se )?(?:es )?verific(?:a|ada|amos)\b/,
    // A sum or a «not a robot» box to prove the reader is a person, and the login or contact forms around it.
    /\b(?:no es un bot|no soy un robot|not a robot)\b/,
    /\bresuelv[ae] la (?:adicion|suma|operacion)\b/,
    /\busuario(?: usuario)? (?:password|contrasena)\b|\b(?:password|contrasena) usuario\b/,
    // Template text of a theme or a placeholder, never about the company.
    /\blorem ipsum\b/,
    /\b(?:admin|dashboard|wordpress|bootstrap) (?:theme|template)\b/,
  ].some((pattern) => pattern.test(normalized)) || isBlogIndexText(normalized);
}

/** The index of a blog (dates, tags, «Leer más» after each teaser) is a list of titles, not a fact about the company. */
function isBlogIndexText(normalized: string) {
  const readMore = (normalized.match(/\b(?:leer mas|read more)\b/g) || []).length;
  return readMore >= 2 || (readMore === 1 && /\b\d{1,2} de [a-z]+ de \d{4}\b/.test(normalized));
}

/**
 * A death, an accident or a disaster at the company is context for the person who sells (it should know it, and be careful),
 * never the reason for a cold email. Spanish and English; it names events, not the safety services a company sells.
 */
export function isSensitiveEventText(value: unknown) {
  const normalized = researchTextKey(value);
  if (!normalized) return false;
  return [
    /\b(?:fallec(?:imiento|io|ieron|ido|idos|idas)|deceso|fallecimientos)\b/,
    /\b(?:murio|murieron|muerte|muertes|muertos|muertas|mortal|mortales|fatal|fatales|victimas? fatales?)\b/,
    /\b(?:tragedia|tragico|tragica|luto|condolencias?|lamentamos|profundo pesar|sentido pesar)\b/,
    /\b(?:desaparecid[oa]s?|atrapad[oa]s?)\b/,
    /\b(?:accidente|accidentes) (?:fatal|fatales|grave|graves|laboral grave|mortal|mortales)\b/,
    /\b(?:alud|aluvion|derrumbe|terremoto|sismo|tsunami|inundacion|incendio forestal|incendios forestales|catastrofe)\b/,
    /\b(?:died|deaths?|killed|fatalit(?:y|ies)|tragedy|tragic|condolences|passed away|mourning)\b/,
  ].some((pattern) => pattern.test(normalized));
}

/**
 * A text an opening should not be built on (DRAFT_HOOK_FILTER_ENABLED), as a death is not: a gloss written for a newsletter reader («Who is who»,
 * «conocido en el mercado como») and the debate on the competition of the company's market (the FNE, the TDLC, collusion). In a real run of eight
 * companies one email opened with «La FNE recomendó restringir la participación de Gasco…» and bridged it with «En ese contexto, el trabajo de
 * Personas…», and another said that Renca and Talagante are communes. A fine, an inspection or a labour reform stay: for some seller they are the
 * reason to write.
 */
export function isUnsuitableHookText(value: unknown) {
  const normalized = researchTextKey(value);
  if (!normalized) return false;
  return isDocumentChromeText(value) || [
    /\bwho is who\b/,
    /\b(?:glosario|se define como|conocid[oa]s? en el mercado como|se conoce en el mercado como|known in the market as)\b/,
    /\b(?:are|son) (?:the |las |los )?(?:communes|comunas|districts|municipalities)\b/,
    /\b(?:fne|fiscalia nacional economica|tribunal de defensa de la libre competencia|tdlc|libre competencia|colusion)\b/,
    ...SELF_DESCRIPTION_HOOKS,
  ].some((pattern) => pattern.test(normalized));
}

/**
 * What a company says of itself to anyone, which an email cannot open with («Vi que su misión es maximizar el valor…»): its mission,
 * its culture, its policies and the law it works under. In the research of 29 Oct 2026 for two customers, the writer opened with «el
 * período de cobertura está vinculado a la naturaleza de la causal» (a definition of the law, copied from the company's site), and the
 * other facts on offer were a policy of information security and a mission statement.
 */
const SELF_DESCRIPTION_HOOKS = [
  /\b(?:nuestra mision|nuestra vision|nuestros valores|our mission|our vision|our values)\b/,
  /\b(?:nos moviliza|parte de nuestra cultura|uno de los activos mas valiosos|compromiso con la proteccion de)\b/,
  // The call to action of a web page: «Conoce cómo gestionamos este compromiso…».
  /^(?:conoce|descubre|revisa) (?:como|nuestr[oa]s?|mas)\b/,
  /\b(?:politica (?:general )?(?:del sistema de gestion )?de seguridad de la informacion|sistema de gestion de seguridad de la informacion)\b/,
  /\b(?:politica de privacidad|proteccion de datos personales|terminos y condiciones|privacy policy|terms and conditions)\b/,
  /\bregulad[oa]s? por la ley\b|\bnaturaleza de la causal\b/,
  // A content-marketing title: «La importancia de los descriptores de cargo para el éxito organizacional».
  /^(?:la importancia de|(?:\d+ )?(?:claves|tips|consejos|pasos) para|guia (?:para|de)|what is|que es (?:un|una|el|la))\b/,
];

/**
 * The chrome of a document or a listing, not a fact: a page header («Página 1 de 66»), the title of a manual or of the terms of a
 * tender («MANUAL CORPORATIVO - Código de Ética», «TÉRMINOS DE REFERENCIA»), a jobs aggregator («11472+ otras ocupaciones… jobs
 * in Chile… Apply with free AI resume review»), a figure that lost its first digits («000 metros sobre el nivel del mar», PR 508) and
 * text in sustained capitals, a question (a blog title or a FAQ) and someone else's LinkedIn profile as a search shows it.
 */
function isDocumentChromeText(value: unknown) {
  const raw = text(value);
  const normalized = researchTextKey(value);
  const letters = raw.match(/\p{L}/gu) || [];
  const capitals = raw.match(/\p{Lu}/gu) || [];
  return /^0{3}\b/.test(normalized)
    || (letters.length >= 25 && capitals.length / letters.length >= 0.6)
    // A question is a blog title, a FAQ or a call to action («¿Por qué trabajar en minería?», «¿Cómo postular?»), never a fact.
    || /^[«"'“\s]*¿/.test(raw)
    // Someone else's LinkedIn profile, as a search shows it: «… · Educación: Universidad…», «Experiencia: …», «4 perfiles de…».
    || /(?:^|[\s·:])(?:Educación|Experiencia|Ubicación)\s*[:·]/u.test(raw)
    || [
      /\bpagina \d+ de \d+\b|\bpage \d+ of \d+\b/,
      /\b(?:manual corporativo|codigo de etica|terminos de referencia|oferta tecnica|bases (?:administrativas|tecnicas)|reglamento interno|memoria anual)\b/,
      /\b\d+ otras ocupaciones\b|\bjobs in (?:chile|santiago|peru|colombia)\b|\bopenings at top companies\b|\bapply with free\b/,
      // A listing of the site's posts or videos («Sigue leyendo → VIDEOS | 4 julio, 2024 …»): its headlines, not a fact.
      /\b(?:sigue leyendo|seguir leyendo|leer mas|read more)\b/,
      /\b\d+ perfiles de\b/,
    ].some((pattern) => pattern.test(normalized));
}

/**
 * A fact without the sentences of it that an opening should not be built on (isUnsuitableHookText): a news paragraph that says «16 contratos nuevos»
 * and then explains what a backlog is keeps the first and loses the gloss. A full stop closes a sentence only before a space or the end, so a figure
 * («5.400») or a name («S.A.») is not cut in the middle. Empty when nothing of substance is left (fewer than four words).
 */
export function withoutUnsuitableSentences(value: unknown) {
  const whole = text(value);
  const sentences = whole.match(/.+?(?:[.!?]+(?=\s|$)|$)\s*/g) || [];
  const kept = sentences.filter((sentence) => !isUnsuitableHookText(sentence));
  if (kept.length === sentences.length) return whole;
  const rest = kept.join('').replace(/\s+/g, ' ').trim();
  return (rest.match(/[\p{L}\p{N}]{2,}/gu) || []).length >= 4 ? rest : '';
}

export function isHardRejectedResearchUrl(value: unknown) {
  const url = safeResearchUrl(value);
  if (!url) return false;
  const parsed = new URL(url);
  return /(?:^|\/)cdn-cgi\/(?:challenge-platform|challenge)(?:\/|$)/i.test(parsed.pathname)
    || /(?:^|[.-])captcha(?:[.-]|$)/i.test(parsed.hostname);
}

export function isGenericResearchText(value: unknown) {
  const normalized = researchTextKey(value);
  if (!normalized) return true;
  if (isHardRejectedResearchText(value)) return true;
  const hasBoilerplateOnly = [
    /\b(?:selecciona|elige|escoge) (?:tu |el |un )?(?:pais|region|idioma|ubicacion)\b/,
    /\b(?:select|choose) (?:(?:a|your) )?(?:country|region|language|location)\b/,
    /\b(?:aceptar|configurar|administrar|gestionar) (?:las )?cookies\b/,
    /\b(?:accept|manage|customize) (?:all )?cookies\b/,
    /\b(?:saltar al contenido|skip to (?:main )?content|menu principal|main menu)\b/,
    /\b(?:habilita|activa|enable) javascript\b/,
    /\b(?:pagina no encontrada|page not found|acceso denegado|access denied)\b/,
    /\b(?:todos los derechos reservados|all rights reserved)\b/,
  ].some((pattern) => pattern.test(normalized));

  // Navigation can coexist with useful text on an otherwise substantive page.
  return hasBoilerplateOnly && normalized.length < 320;
}

export function safeResearchUrl(value: unknown): string | null {
  try {
    const url = new URL(text(value));
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function hostFor(value: unknown) {
  const url = safeResearchUrl(value);
  return url ? new URL(url).hostname.toLowerCase().replace(/^www\./, '') : '';
}

export function normalizeResearchCompanyDomain(value: unknown) {
  const raw = text(value).toLowerCase();
  if (!raw) return '';
  try {
    return new URL(raw.includes('://') ? raw : `https://${raw}`)
      .hostname
      .replace(/^www\./, '')
      .replace(/^m\./, '');
  } catch {
    return raw
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .replace(/^m\./, '')
      .split('/')[0]
      .split(':')[0]
      .trim();
  }
}

export function isSameResearchCompanyDomain(url: unknown, companyDomain: unknown) {
  const host = hostFor(url);
  const domain = normalizeResearchCompanyDomain(companyDomain);
  return Boolean(host && domain && (host === domain || host.endsWith(`.${domain}`)));
}

const COMPANY_NAME_NOISE = new Set([
  'company', 'compania', 'corp', 'corporation', 'inc', 'limitada', 'limited',
  'llc', 'ltd', 'ltda', 'sociedad', 'spa',
]);

function companyTerms(value: unknown) {
  return researchTextKey(value)
    .split(' ')
    .filter((term) => term.length >= 3 && !COMPANY_NAME_NOISE.has(term));
}

function includesTermSequence(candidate: string, query: string) {
  const candidateTerms = candidate.split(' ').filter(Boolean);
  const queryTerms = query.split(' ').filter(Boolean);
  if (queryTerms.length === 0 || queryTerms.length > candidateTerms.length) return false;

  return candidateTerms.some((_, start) =>
    queryTerms.every((term, offset) => candidateTerms[start + offset] === term),
  );
}

export function mentionsResearchCompany(value: unknown, input: { companyName?: unknown; companyDomain?: unknown }) {
  const candidate = researchTextKey(value);
  if (!candidate) return false;

  const domain = normalizeResearchCompanyDomain(input.companyDomain);
  const domainName = researchTextKey(domain.replace(/\.[a-z]{2,}$/i, ''));
  if (domainName && includesTermSequence(candidate, domainName)) return true;

  const name = researchTextKey(input.companyName);
  if (name && includesTermSequence(candidate, name)) return true;

  const terms = companyTerms(input.companyName);
  return terms.length > 1 && includesTermSequence(companyTerms(candidate).join(' '), terms.join(' '));
}

function sourceDescribesCompany(source: ResearchSourceV1, input: { companyName?: unknown; companyDomain?: unknown }) {
  return mentionsResearchCompany(
    [source.title, source.publisher, source.url].filter(Boolean).join(' '),
    input,
  );
}

function personTerms(value: unknown) {
  return researchTextKey(value).split(' ').filter((term) => term.length >= 2);
}

export function mentionsResearchPerson(value: unknown, personName?: unknown) {
  const candidate = researchTextKey(value);
  const name = researchTextKey(personName);
  if (!candidate || !name) return false;
  if (candidate.includes(name)) return true;
  const terms = personTerms(personName);
  return terms.length >= 2 && terms.every((term) => candidate.includes(term));
}

function sourceDescribesPerson(source: ResearchSourceV1, personName?: unknown) {
  return mentionsResearchPerson(
    [source.title, source.publisher, source.url].filter(Boolean).join(' '),
    personName,
  );
}

export function isQualifiedResearchFactEvidence(input: {
  evidence: ResearchEvidenceV1;
  source: ResearchSourceV1 | undefined;
  companyName?: unknown;
  companyDomain?: unknown;
}) {
  const { evidence, source } = input;
  if (!source || !safeResearchUrl(source.url) || isHardRejectedResearchUrl(source.url)) return false;
  if (
    !['fact', 'quote'].includes(evidence.kind)
    || evidence.extraction.method === 'model'
    || isGenericResearchText(evidence.statement)
  ) return false;

  const sourceOnCompanyDomain = isSameResearchCompanyDomain(source.url, input.companyDomain);
  if (source.type === 'official_site') {
    return sourceOnCompanyDomain || sourceDescribesCompany(source, input);
  }
  if (source.provider === 'brand.dev') {
    return mentionsResearchCompany(evidence.statement, input) && evidence.statement.length >= 40;
  }
  if (source.type === 'registry') return false;

  return sourceOnCompanyDomain
    || (sourceDescribesCompany(source, input) && mentionsResearchCompany(evidence.statement, input));
}

/** A public, directly sourced person fact. Imported lead fields are intentionally excluded. */
export function isQualifiedResearchPersonFactEvidence(input: {
  evidence: ResearchEvidenceV1;
  source: ResearchSourceV1 | undefined;
  personName?: unknown;
}) {
  const { evidence, source } = input;
  if (!source || !safeResearchUrl(source.url) || isHardRejectedResearchUrl(source.url) || source.provider === 'lead-input') return false;
  if (
    evidence.subjectScope !== 'person'
    || !['fact', 'quote', 'profile_field'].includes(evidence.kind)
    || evidence.extraction.method === 'model'
    || isGenericResearchText(evidence.statement)
  ) return false;

  const sourceMatchesPerson = sourceDescribesPerson(source, input.personName);
  const statementMatchesPerson = mentionsResearchPerson(evidence.statement, input.personName);
  if (source.type === 'linkedin') return sourceMatchesPerson || statementMatchesPerson;
  if (source.type === 'registry') return false;
  return sourceMatchesPerson || statementMatchesPerson;
}

export function isRelevantResearchSignal(input: {
  evidence: ResearchEvidenceV1;
  source: ResearchSourceV1 | undefined;
  companyName?: unknown;
  companyDomain?: unknown;
}) {
  const { evidence, source } = input;
  if (!source || evidence.kind !== 'event' || !safeResearchUrl(source.url) || isHardRejectedResearchUrl(source.url) || isGenericResearchText(evidence.statement)) {
    return false;
  }

  return isSameResearchCompanyDomain(source.url, input.companyDomain)
    || mentionsResearchCompany(`${source.title || ''} ${evidence.statement}`, input);
}

export function hasUnresolvedResearchContradiction(snapshot: ResearchSnapshotV1, claim: ResearchClaimV1) {
  const supporting = new Set(claim.supportingEvidenceIds);
  return snapshot.contradictions.some((contradiction) => (
    contradiction.status === 'unresolved'
    && (contradiction.claimIds.includes(claim.id)
      || contradiction.evidenceIds.some((evidenceId) => supporting.has(evidenceId)))
  ));
}

export function isFreshResearchClaim(claim: ResearchClaimV1, nowMs: number) {
  const validUntil = Date.parse(claim.freshness.validUntil);
  return Number.isFinite(validUntil) && validUntil > nowMs;
}

export function isDraftableCompanyFactClaim(input: {
  snapshot: ResearchSnapshotV1;
  claim: ResearchClaimV1;
  nowMs: number;
}) {
  const { snapshot, claim } = input;
  if (
    claim.classification !== 'fact'
    || claim.subjectScope !== 'company'
    || !['direct', 'rule'].includes(claim.derivation.method)
    || !isFreshResearchClaim(claim, input.nowMs)
    || hasUnresolvedResearchContradiction(snapshot, claim)
  ) {
    return false;
  }

  const sourceById = new Map(snapshot.sources.map((source) => [source.id, source]));
  const evidenceById = new Map(snapshot.evidence.map((evidence) => [evidence.id, evidence]));
  return claim.supportingEvidenceIds.some((evidenceId) => {
    const evidence = evidenceById.get(evidenceId);
    return Boolean(evidence && isQualifiedResearchFactEvidence({
      evidence,
      source: sourceById.get(evidence.sourceId),
      companyName: snapshot.subject.company.name,
      companyDomain: snapshot.subject.company.domain,
    }));
  });
}

export function isDraftablePersonFactClaim(input: {
  snapshot: ResearchSnapshotV1;
  claim: ResearchClaimV1;
  nowMs: number;
}) {
  const { snapshot, claim } = input;
  if (
    claim.classification !== 'fact'
    || claim.subjectScope !== 'person'
    || !['direct', 'rule'].includes(claim.derivation.method)
    || !isFreshResearchClaim(claim, input.nowMs)
    || hasUnresolvedResearchContradiction(snapshot, claim)
  ) {
    return false;
  }

  const sourceById = new Map(snapshot.sources.map((source) => [source.id, source]));
  const evidenceById = new Map(snapshot.evidence.map((evidence) => [evidence.id, evidence]));
  return claim.supportingEvidenceIds.some((evidenceId) => {
    const evidence = evidenceById.get(evidenceId);
    return Boolean(evidence && isQualifiedResearchPersonFactEvidence({
      evidence,
      source: sourceById.get(evidence.sourceId),
      personName: snapshot.subject.person.fullName,
    }));
  });
}
