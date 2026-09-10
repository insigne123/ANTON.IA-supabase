/**
 * Questionnaire/coverage backend slice: one fail-closed answer per approved
 * questionnaire field.
 *
 * Rules enforced here:
 * - Only `confirmed` (cited fact), `estimated` (explicit estimate language in
 *   a cited claim), `hypothesis` (explicitly framed, validation-oriented),
 *   `unavailable` (actionable gap) or `restricted` (privacy) statuses exist.
 * - Field policies decide which evidence kinds may resolve a field:
 *   `direct-only` (cited facts), `estimated-allowed` (facts, estimates),
 *   `hypothesis-allowed` (facts, estimates, hypotheses),
 *   `declared-only` (team-provided lead context, never web-invented),
 *   `private-unavailable` (never exposed, even when present upstream).
 * - Never invents revenue, competitors, probabilities, private emails/phones,
 *   seller traction, needs, budgets or intent. Unverifiable fields resolve to
 *   `unavailable` with an actionable `detail`, never to invented values.
 * - Numeric scores/probabilities are surfaced as qualitative tiers
 *   (alta/media/baja); raw confidence numbers are never rendered.
 */

export type ReportFieldStatus = 'confirmed'|'estimated'|'hypothesis'|'unavailable'|'restricted';

export type ReportFieldGroup = 'company' | 'contact' | 'commercial' | 'decision' | 'personalization';

export type ReportFieldPolicy =
  | 'direct-only'
  | 'estimated-allowed'
  | 'hypothesis-allowed'
  | 'declared-only'
  | 'private-unavailable';

export type ReportFieldAnswer = { key: string; group: 'company'|'contact'|'commercial'|'decision'|'personalization'; label: string; value: string; detail?: string; status: ReportFieldStatus; sourceUrls?: string[]; observedAt?: string|null; };

export type ReportFieldDefinition = {
  key: string;
  group: ReportFieldGroup;
  label: string;
  policy: ReportFieldPolicy;
  howToFind: string;
  source: string;
};

export const REPORT_FIELD_GROUPS: ReportFieldGroup[] = [
  'company',
  'contact',
  'commercial',
  'decision',
  'personalization',
];

/** Approved questionnaire coverage: company, contact, commercial, decision-map and personalization. */
export const REPORT_FIELD_DEFINITIONS: ReportFieldDefinition[] = [
  { key: 'company.name', group: 'company', label: 'Empresa', policy: 'declared-only', howToFind: 'Confirma el nombre comercial y el dominio en el sitio corporativo o en un registro oficial.', source: 'Datos aportados por tu equipo.' },
  { key: 'company.website', group: 'company', label: 'Sitio web', policy: 'declared-only', howToFind: 'Confirma el dominio en el sitio corporativo o en un registro oficial.', source: 'Datos aportados por tu equipo.' },
  { key: 'company.industry', group: 'company', label: 'Industria', policy: 'direct-only', howToFind: 'Busca la industria declarada en el sitio corporativo o en una ficha sectorial.', source: 'Sitio corporativo o fuente sectorial.' },
  { key: 'company.linkedin', group: 'company', label: 'LinkedIn empresa', policy: 'declared-only', howToFind: 'Usa el LinkedIn corporativo importado por tu equipo; no se adivina la URL.', source: 'Datos aportados por tu equipo.' },
  { key: 'company.subindustry', group: 'company', label: 'Subindustria', policy: 'direct-only', howToFind: 'Busca la especialidad dentro de la industria en el sitio corporativo.', source: 'Sitio corporativo o fuente sectorial.' },
  { key: 'company.country', group: 'company', label: 'País', policy: 'declared-only', howToFind: 'Confirma el país de operación en el contexto importado.', source: 'Datos aportados por tu equipo.' },
  { key: 'company.cities', group: 'company', label: 'Ciudades donde opera', policy: 'direct-only', howToFind: 'Busca sedes, sucursales u oficinas nombradas en el sitio corporativo.', source: 'Sitio corporativo por jurisdicción.' },
  { key: 'company.employees', group: 'company', label: 'Número de empleados', policy: 'estimated-allowed', howToFind: 'Busca cifras de colaboradores o dotación en páginas corporativas, registros o prensa.', source: 'Página corporativa, registro o prensa.' },
  { key: 'company.revenue', group: 'company', label: 'Facturación estimada', policy: 'estimated-allowed', howToFind: 'Solo se muestra si una fuente cita moneda y cifra; si no, queda pendiente.', source: 'Fuente con moneda y cifra explícitas.' },
  { key: 'company.offerings', group: 'company', label: 'Productos o servicios', policy: 'direct-only', howToFind: 'Revisa las páginas de servicios o el catálogo del sitio corporativo.', source: 'Sitio corporativo.' },
  { key: 'company.customers', group: 'company', label: 'Tipo de clientes', policy: 'hypothesis-allowed', howToFind: 'Infiere B2B/B2C/B2G desde sectores atendidos y valida en descubrimiento.', source: 'Sectores citados e hipótesis comercial.' },
  { key: 'company.businessModel', group: 'company', label: 'Modelo de negocio', policy: 'hypothesis-allowed', howToFind: 'Infiere B2B/B2C/B2G desde la oferta y los clientes citados.', source: 'Oferta citada e hipótesis comercial.' },
  { key: 'company.markets', group: 'company', label: 'Principales mercados', policy: 'direct-only', howToFind: 'Revisa países y operaciones citadas en el sitio corporativo.', source: 'Sitio corporativo por jurisdicción.' },
  { key: 'company.competitors', group: 'company', label: 'Competidores', policy: 'direct-only', howToFind: 'Solo se nombran competidores citados en la evidencia; nunca por memoria del modelo.', source: 'Evidencia citada.' },
  { key: 'signal.hiring', group: 'company', label: 'Contrataciones recientes', policy: 'direct-only', howToFind: 'Busca vacantes u ofertas fechadas en empleo o prensa.', source: 'Empleo o prensa fechada.' },
  { key: 'signal.funding', group: 'company', label: 'Nueva ronda de inversión', policy: 'direct-only', howToFind: 'Busca anuncios de financiamiento fechados en prensa.', source: 'Prensa fechada.' },
  { key: 'signal.ceo', group: 'company', label: 'Nuevo CEO', policy: 'direct-only', howToFind: 'Busca nombramientos de CEO fechados en prensa corporativa.', source: 'Prensa fechada.' },
  { key: 'signal.leadership', group: 'company', label: 'Cambios directivos', policy: 'direct-only', howToFind: 'Busca cambios en cargos directivos fechados y relevantes.', source: 'Prensa o perfiles fechados.' },
  { key: 'signal.restructuring', group: 'company', label: 'Reestructuración', policy: 'direct-only', howToFind: 'Busca anuncios de reestructuración fechados.', source: 'Prensa fechada.' },
  { key: 'signal.expansion', group: 'company', label: 'Expansión', policy: 'direct-only', howToFind: 'Busca anuncios de expansión fechados.', source: 'Prensa fechada.' },
  { key: 'signal.offices', group: 'company', label: 'Nuevas oficinas', policy: 'direct-only', howToFind: 'Busca aperturas de oficinas o sedes fechadas.', source: 'Prensa o sitio corporativo fechado.' },
  { key: 'signal.newMarkets', group: 'company', label: 'Entrada a nuevos mercados', policy: 'direct-only', howToFind: 'Busca anuncios de entrada a nuevos países o mercados.', source: 'Prensa fechada.' },
  { key: 'signal.newProducts', group: 'company', label: 'Nuevos productos o servicios', policy: 'direct-only', howToFind: 'Busca lanzamientos fechados en el sitio corporativo o prensa.', source: 'Sitio corporativo o prensa.' },
  { key: 'signal.tenders', group: 'company', label: 'Licitaciones', policy: 'direct-only', howToFind: 'Busca licitaciones públicas o privadas fechadas.', source: 'Registros o prensa fechada.' },
  { key: 'signal.contracts', group: 'company', label: 'Nuevos contratos', policy: 'direct-only', howToFind: 'Busca contratos adjudicados o firmados con fecha.', source: 'Prensa o registros fechados.' },
  { key: 'signal.mna', group: 'company', label: 'Adquisiciones o fusiones', policy: 'direct-only', howToFind: 'Busca anuncios de M&A fechados.', source: 'Prensa fechada.' },
  { key: 'signal.regulatory', group: 'company', label: 'Cambios regulatorios', policy: 'direct-only', howToFind: 'Busca normativa aplicable fechada en reguladores.', source: 'Regulador o registro oficial.' },
  { key: 'signal.news', group: 'company', label: 'Noticias relevantes', policy: 'direct-only', howToFind: 'Busca noticias fechadas con relevancia comercial.', source: 'Prensa fechada.' },
  { key: 'contact.name', group: 'contact', label: 'Nombre completo', policy: 'declared-only', howToFind: 'Confirma el nombre del contacto en su perfil profesional público.', source: 'Datos aportados por tu equipo.' },
  { key: 'contact.title', group: 'contact', label: 'Cargo actual', policy: 'direct-only', howToFind: 'Confirma el cargo actual en el perfil profesional público del contacto.', source: 'Perfil profesional público.' },
  { key: 'contact.area', group: 'contact', label: 'Área / departamento', policy: 'declared-only', howToFind: 'Confirma el área en el perfil del contacto o en tu base.', source: 'Datos aportados por tu equipo.' },
  { key: 'contact.seniority', group: 'contact', label: 'Nivel de seniority', policy: 'hypothesis-allowed', howToFind: 'Infiere el nivel desde el cargo y valida en descubrimiento.', source: 'Cargo citado e hipótesis.' },
  { key: 'contact.tenureRole', group: 'contact', label: 'Antigüedad en el cargo', policy: 'direct-only', howToFind: 'Busca fechas de inicio en el cargo en el perfil profesional.', source: 'Perfil profesional fechado.' },
  { key: 'contact.tenureCompany', group: 'contact', label: 'Antigüedad en la empresa', policy: 'direct-only', howToFind: 'Busca fechas de ingreso a la empresa en el perfil profesional.', source: 'Perfil profesional fechado.' },
  { key: 'contact.location', group: 'contact', label: 'Ubicación / país', policy: 'declared-only', howToFind: 'Confirma ciudad y país en el perfil del contacto.', source: 'Datos aportados por tu equipo.' },
  { key: 'contact.linkedin', group: 'contact', label: 'LinkedIn', policy: 'declared-only', howToFind: 'Usa el LinkedIn importado por tu equipo; no se adivina la URL.', source: 'Datos aportados por tu equipo.' },
  { key: 'contact.email', group: 'contact', label: 'Email corporativo', policy: 'declared-only', howToFind: 'Usa el email corporativo registrado en tu base.', source: 'Datos aportados por tu equipo.' },
  { key: 'contact.phone', group: 'contact', label: 'Teléfono', policy: 'private-unavailable', howToFind: 'Solicita el teléfono por un canal autorizado.', source: 'No se expone por privacidad.' },
  { key: 'contact.responsibilities', group: 'contact', label: 'Responsabilidades', policy: 'hypothesis-allowed', howToFind: 'Infiere responsabilidades desde cargo y área; valida en descubrimiento.', source: 'Cargo citado e hipótesis.' },
  { key: 'contact.decisions', group: 'contact', label: 'Decisiones que controla', policy: 'hypothesis-allowed', howToFind: 'Infiere decisiones probables desde cargo y seniority.', source: 'Cargo citado e hipótesis.' },
  { key: 'contact.roleDecisor', group: 'contact', label: 'Rol: decisor', policy: 'hypothesis-allowed', howToFind: 'Evalúa si el cargo decide presupuesto o compra.', source: 'Cargo citado e hipótesis.' },
  { key: 'contact.roleInfluencer', group: 'contact', label: 'Rol: influenciador', policy: 'hypothesis-allowed', howToFind: 'Evalúa si el cargo influye en la evaluación técnica.', source: 'Cargo citado e hipótesis.' },
  { key: 'contact.roleUser', group: 'contact', label: 'Rol: usuario', policy: 'hypothesis-allowed', howToFind: 'Evalúa si el cargo usaría la solución a diario.', source: 'Cargo citado e hipótesis.' },
  { key: 'contact.roleGatekeeper', group: 'contact', label: 'Rol: gatekeeper', policy: 'hypothesis-allowed', howToFind: 'Evalúa si el contacto filtra el acceso a decisores.', source: 'Evidencia citada o descubrimiento.' },
  { key: 'pain.process', group: 'commercial', label: 'Proceso probable', policy: 'hypothesis-allowed', howToFind: 'Propón el proceso observable del área y valida en descubrimiento.', source: 'Evidencia del área e hipótesis.' },
  { key: 'pain.current', group: 'commercial', label: 'Cómo lo hacen hoy', policy: 'hypothesis-allowed', howToFind: 'Describe la forma actual probable y valida en descubrimiento.', source: 'Evidencia del área e hipótesis.' },
  { key: 'pain.manual', group: 'commercial', label: 'Parte probablemente manual', policy: 'hypothesis-allowed', howToFind: 'Identifica pasos manuales probables desde el proceso del área.', source: 'Evidencia e hipótesis.' },
  { key: 'pain.slowness', group: 'commercial', label: 'Lentitud posible', policy: 'hypothesis-allowed', howToFind: 'Estima cuellos de botella probables sin inventar cifras.', source: 'Evidencia e hipótesis.' },
  { key: 'pain.people', group: 'commercial', label: 'Personas involucradas', policy: 'hypothesis-allowed', howToFind: 'Estima roles involucrados desde el proceso del área.', source: 'Evidencia e hipótesis.' },
  { key: 'pain.cost', group: 'commercial', label: 'Costo posible', policy: 'estimated-allowed', howToFind: 'Estima costo solo con volumen, minutos y tarifa explícitos.', source: 'Cifras citadas y supuestos.' },
  { key: 'pain.risk', group: 'commercial', label: 'Riesgo del proceso', policy: 'hypothesis-allowed', howToFind: 'Identifica riesgos operativos o de cumplimiento probables.', source: 'Evidencia e hipótesis.' },
  { key: 'pain.errors', group: 'commercial', label: 'Errores posibles', policy: 'hypothesis-allowed', howToFind: 'Identifica errores típicos del proceso manual.', source: 'Evidencia e hipótesis.' },
  { key: 'pain.missingInfo', group: 'commercial', label: 'Información faltante', policy: 'hypothesis-allowed', howToFind: 'Identifica datos que el área probablemente no tiene a mano.', source: 'Evidencia e hipótesis.' },
  { key: 'pain.repetitive', group: 'commercial', label: 'Tareas repetitivas', policy: 'hypothesis-allowed', howToFind: 'Identifica tareas repetitivas del proceso del área.', source: 'Evidencia e hipótesis.' },
  { key: 'pain.automatable', group: 'commercial', label: 'Proceso automatizable', policy: 'hypothesis-allowed', howToFind: 'Propón qué parte podría automatizarse y cómo medirlo.', source: 'Evidencia e hipótesis.' },
  { key: 'pain.kpi', group: 'commercial', label: 'KPI a mejorar', policy: 'hypothesis-allowed', howToFind: 'Propón el KPI con unidad y línea base a validar.', source: 'Evidencia e hipótesis.' },
  { key: 'pain.solution', group: 'commercial', label: 'Problema que resolvemos', policy: 'hypothesis-allowed', howToFind: 'Conecta un problema probable con una capacidad declarada.', source: 'Evidencia y perfil del vendedor.' },
  { key: 'commercial.icpFit', group: 'commercial', label: 'Encaje ICP', policy: 'hypothesis-allowed', howToFind: 'Contrasta empresa y contacto con tu ICP en descubrimiento.', source: 'Evidencia citada y perfil del vendedor.' },
  { key: 'commercial.leadScore', group: 'commercial', label: 'Score del lead', policy: 'hypothesis-allowed', howToFind: 'Usa el puntaje interno de investigación como referencia cualitativa.', source: 'Puntaje interno de investigación.' },
  { key: 'commercial.companyScore', group: 'commercial', label: 'Score de la empresa', policy: 'hypothesis-allowed', howToFind: 'Usa la cobertura del informe como referencia cualitativa.', source: 'Cobertura del informe.' },
  { key: 'commercial.productFit', group: 'commercial', label: 'Fit con tu producto', policy: 'hypothesis-allowed', howToFind: 'Contrasta la evidencia observada con tu propuesta en descubrimiento.', source: 'Evidencia citada y perfil del vendedor.' },
  { key: 'commercial.opportunitySize', group: 'commercial', label: 'Tamaño de oportunidad', policy: 'estimated-allowed', howToFind: 'Dimensiona solo con cifras declaradas y supuestos explícitos.', source: 'Cifras citadas y supuestos.' },
  { key: 'commercial.productInterest', group: 'commercial', label: 'Producto probable', policy: 'hypothesis-allowed', howToFind: 'Elige el producto según evidencia del área y rol.', source: 'Evidencia citada e hipótesis.' },
  { key: 'commercial.useCase', group: 'commercial', label: 'Caso de uso probable', policy: 'hypothesis-allowed', howToFind: 'Propón el caso de uso observable del área.', source: 'Evidencia citada e hipótesis.' },
  { key: 'commercial.ticket', group: 'commercial', label: 'Ticket estimado', policy: 'estimated-allowed', howToFind: 'Estima ticket solo con volumen, alcance y supuestos explícitos.', source: 'Cifras citadas y supuestos.' },
  { key: 'commercial.priority', group: 'commercial', label: 'Prioridad comercial', policy: 'hypothesis-allowed', howToFind: 'Prioriza según encaje, señales y puntajes internos.', source: 'Evidencia e hipótesis.' },
  { key: 'commercial.timing', group: 'commercial', label: 'Timing', policy: 'hypothesis-allowed', howToFind: 'Evalúa el momento según señales recientes y rol.', source: 'Señales citadas e hipótesis.' },
  { key: 'commercial.responseProbability', group: 'commercial', label: 'Probabilidad de respuesta', policy: 'private-unavailable', howToFind: 'No estimamos probabilidades numéricas sin datos calibrados.', source: 'No disponible por política.' },
  { key: 'commercial.conversionProbability', group: 'commercial', label: 'Probabilidad de conversión', policy: 'private-unavailable', howToFind: 'No estimamos probabilidades numéricas sin datos calibrados.', source: 'No disponible por política.' },
  { key: 'decision.owner', group: 'decision', label: 'Quién tiene el problema', policy: 'hypothesis-allowed', howToFind: 'Identifica el dueño del dolor por cargo y área.', source: 'Cargo citado e hipótesis.' },
  { key: 'decision.user', group: 'decision', label: 'Quién usa la solución', policy: 'hypothesis-allowed', howToFind: 'Identifica usuarios diarios probables por cargo.', source: 'Cargo citado e hipótesis.' },
  { key: 'decision.evaluator', group: 'decision', label: 'Quién evalúa', policy: 'hypothesis-allowed', howToFind: 'Identifica evaluadores técnicos o de negocio probables.', source: 'Cargo citado e hipótesis.' },
  { key: 'decision.approver', group: 'decision', label: 'Quién aprueba presupuesto', policy: 'hypothesis-allowed', howToFind: 'Identifica quién aprueba gasto por nivel del cargo.', source: 'Cargo citado e hipótesis.' },
  { key: 'decision.signer', group: 'decision', label: 'Quién firma', policy: 'hypothesis-allowed', howToFind: 'Identifica firmantes probables por nivel del cargo.', source: 'Cargo citado e hipótesis.' },
  { key: 'decision.blocker', group: 'decision', label: 'Quién podría bloquear', policy: 'hypothesis-allowed', howToFind: 'Identifica bloqueadores probables: finanzas, legal, TI o el proveedor actual.', source: 'Evidencia e hipótesis.' },
  { key: 'decision.others', group: 'decision', label: 'A quién más contactar', policy: 'hypothesis-allowed', howToFind: 'Propón perfiles complementarios por área y nivel.', source: 'Mapa de roles e hipótesis.' },
  { key: 'decision.relations', group: 'decision', label: 'Relaciones entre contactos', policy: 'hypothesis-allowed', howToFind: 'Describe relaciones solo si hay evidencia; si no, propone validarlas.', source: 'Evidencia o descubrimiento.' },
  { key: 'personalization.reason', group: 'personalization', label: 'Razón del contacto', policy: 'hypothesis-allowed', howToFind: 'Combina rol, señal y encaje en una razón específica.', source: 'Evidencia citada e hipótesis.' },
  { key: 'personalization.event', group: 'personalization', label: 'Evento reciente', policy: 'direct-only', howToFind: 'Usa solo eventos fechados; sin evento, no se inventa apertura.', source: 'Prensa, empleo o registro.' },
  { key: 'personalization.pain', group: 'personalization', label: 'Problema que creemos que tiene', policy: 'hypothesis-allowed', howToFind: 'Formula el problema como hipótesis con pregunta de validación.', source: 'Evidencia e hipótesis.' },
  { key: 'personalization.benefit', group: 'personalization', label: 'Beneficio específico', policy: 'hypothesis-allowed', howToFind: 'Conecta una capacidad declarada con una consecuencia práctica.', source: 'Perfil del vendedor e hipótesis.' },
  { key: 'personalization.successCase', group: 'personalization', label: 'Caso de éxito', policy: 'direct-only', howToFind: 'Solo casos aportados por tu equipo; nunca inventados.', source: 'Perfil del vendedor.' },
  { key: 'personalization.similarCompany', group: 'personalization', label: 'Empresa similar cliente', policy: 'direct-only', howToFind: 'Solo empresas aportadas por tu equipo; nunca inventadas.', source: 'Perfil del vendedor.' },
  { key: 'personalization.metric', group: 'personalization', label: 'Métrica relevante', policy: 'estimated-allowed', howToFind: 'Usa métricas con unidad y base a validar.', source: 'Cifras citadas y supuestos.' },
  { key: 'personalization.icebreaker', group: 'personalization', label: 'Icebreaker', policy: 'hypothesis-allowed', howToFind: 'Abre con un hecho confirmado, sin adornos.', source: 'Hecho confirmado.' },
  { key: 'personalization.angle', group: 'personalization', label: 'Ángulo del mensaje', policy: 'hypothesis-allowed', howToFind: 'Elige un ancla factual específica y conviértela en mensaje.', source: 'Evidencia reciente y verificada.' },
  { key: 'personalization.discovery', group: 'personalization', label: 'Pregunta de descubrimiento', policy: 'hypothesis-allowed', howToFind: 'Convierte cada hueco de evidencia en una pregunta de descubrimiento.', source: 'Análisis de evidencia y huecos.' },
  { key: 'personalization.cta', group: 'personalization', label: 'CTA recomendado', policy: 'hypothesis-allowed', howToFind: 'Un solo pedido de baja fricción acorde al encaje.', source: 'Recomendación comercial.' },
];

export const REPORT_FIELD_UNAVAILABLE_VALUE = 'No disponible en la evidencia actual.';
export const REPORT_FIELD_RESTRICTED_VALUE = 'No disponible por privacidad.';
export const REPORT_FIELD_DECLARED_DETAIL = 'Dato aportado por tu equipo; no se verificó en fuentes públicas.';
export const REPORT_FIELD_HYPOTHESIS_PREFIX = 'Hipótesis por validar:';

/** Topics this slice must never synthesize without cited evidence. */
export const FORBIDDEN_FABRICATION_TOPICS = [
  'revenue',
  'competitors',
  'probabilities',
  'private emails/phones',
  'seller traction',
  'needs',
  'budgets',
  'intent',
] as const;

const ESTIMATE_MARKERS = /estimad|aprox|rangos?|escenarios?|proyectad|calculad/i;
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const NUMERIC_PROBABILITY_PATTERN = /\d+\s*%|\b0\.\d+\b/;

function text(value: unknown, maxLength = 220): string {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).replace(/\s+\S*$/, '').replace(/[\s,;:.!?-]+$/, '') || normalized.slice(0, maxLength - 1)}…`;
}

function nullableText(value: unknown): string | null {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  return normalized || null;
}

/** Qualitative tier for model-facing levels. Raw scores are never rendered. */
export function confidenceTierFor(confidence: number | null | undefined): 'alta' | 'media' | 'baja' | 'sin determinar' {
  if (confidence == null || !Number.isFinite(confidence)) return 'sin determinar';
  if (confidence >= 0.8) return 'alta';
  if (confidence >= 0.5) return 'media';
  return 'baja';
}

type FieldClaim = {
  id: string;
  statement: string;
  classification: 'fact' | 'hypothesis';
  kind: string;
  confidence: number | null;
  observedAt: string | null;
  sourceUrls: string[];
};

function claimsFromBucket(bucket: unknown): FieldClaim[] {
  if (!Array.isArray(bucket)) return [];
  return bucket.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const claim = entry as Record<string, unknown>;
    const statement = text(claim.statement);
    if (!statement) return [];
    const classification = claim.classification === 'hypothesis' ? 'hypothesis' : 'fact';
    const evidence = Array.isArray(claim.evidence) ? claim.evidence : [];
    const sourceUrls = [...new Set(evidence.flatMap((item) => {
      const url = item && typeof item === 'object'
        ? String((item as Record<string, unknown>).sourceUrl || '').trim()
        : '';
      try {
        const parsed = new URL(url);
        return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? [parsed.toString()] : [];
      } catch {
        return [];
      }
    }))].slice(0, 3);
    const confidence = typeof claim.confidence === 'number' && Number.isFinite(claim.confidence) ? claim.confidence : null;
    return [{
      id: String(claim.id || statement),
      statement,
      classification: classification as 'fact' | 'hypothesis',
      kind: String(claim.kind || '').toLowerCase(),
      confidence,
      observedAt: nullableText(claim.observedAt),
      sourceUrls,
    }];
  });
}

type AnswerContext = {
  report: import('@/lib/research-workspace').ResearchReportView;
  result?: import('@/lib/research-workspace').ResearchWorkspaceResult;
  facts: FieldClaim[];
  hypotheses: FieldClaim[];
  opportunities: FieldClaim[];
  signals: FieldClaim[];
  leadScore: number | null;
  coverageScore: number | null;
  leadTitle: string;
  leadArea: string | null;
};

function buildContext(
  report: import('@/lib/research-workspace').ResearchReportView,
  result?: import('@/lib/research-workspace').ResearchWorkspaceResult,
): AnswerContext {
  const seen = new Set<string>();
  const pooled: FieldClaim[] = [];
  [
    ...(report.executive || []),
    ...(report.person?.facts || []),
    ...(report.company || []),
    ...(report.signals || []),
    ...(report.opportunities || []),
  ].forEach((entry) => {
    const parsed = claimsFromBucket([entry])[0];
    if (parsed && !seen.has(parsed.id)) {
      seen.add(parsed.id);
      pooled.push(parsed);
    }
  });
  return {
    report,
    result,
    facts: pooled.filter((claim) => claim.classification === 'fact' && claim.sourceUrls.length > 0),
    hypotheses: pooled.filter((claim) => claim.classification === 'hypothesis'),
    opportunities: claimsFromBucket(report.opportunities),
    signals: claimsFromBucket(report.signals).filter((claim) => claim.classification === 'fact' && claim.sourceUrls.length > 0),
    leadScore: typeof result?.quality?.score === 'number' && Number.isFinite(result.quality.score)
      ? result.quality.score
      : (typeof result?.score === 'number' && Number.isFinite(result.score) ? result.score : null),
    coverageScore: typeof report.completeness?.score === 'number' && Number.isFinite(report.completeness.score)
      ? report.completeness.score
      : null,
    leadTitle: text(result?.lead?.title) || profileField(report, 'Cargo') || '',
    leadArea: profileField(report, 'Área'),
  };
}

function definitionFor(key: string): ReportFieldDefinition {
  const found = REPORT_FIELD_DEFINITIONS.find((definition) => definition.key === key);
  if (!found) throw new Error(`REPORT_FIELD_UNKNOWN:${key}`);
  return found;
}

function unavailable(definition: ReportFieldDefinition, detail?: string): ReportFieldAnswer {
  return {
    key: definition.key,
    group: definition.group,
    label: definition.label,
    value: REPORT_FIELD_UNAVAILABLE_VALUE,
    detail: detail || definition.howToFind,
    status: 'unavailable',
    sourceUrls: [],
    observedAt: null,
  };
}

function restricted(definition: ReportFieldDefinition): ReportFieldAnswer {
  return {
    key: definition.key,
    group: definition.group,
    label: definition.label,
    value: REPORT_FIELD_RESTRICTED_VALUE,
    detail: 'Los emails y teléfonos privados no se exponen en el informe aunque existan en la fuente.',
    status: 'restricted',
    sourceUrls: [],
    observedAt: null,
  };
}

function declared(ctx: AnswerContext, definition: ReportFieldDefinition, value: unknown): ReportFieldAnswer {
  const normalized = text(value, 200);
  if (!normalized) return unavailable(definition);
  return {
    key: definition.key,
    group: definition.group,
    label: definition.label,
    value: normalized,
    detail: REPORT_FIELD_DECLARED_DETAIL,
    status: 'confirmed',
    sourceUrls: [],
    observedAt: null,
  };
}

function firstFact(ctx: AnswerContext, kinds: string[]): FieldClaim | null {
  return ctx.facts.find((claim) => kinds.some((kind) => claim.kind.includes(kind))) || null;
}

function confirmedFrom(definition: ReportFieldDefinition, claim: FieldClaim, detail?: string): ReportFieldAnswer {
  return {
    key: definition.key,
    group: definition.group,
    label: definition.label,
    value: claim.statement,
    ...(detail ? { detail } : {}),
    status: 'confirmed',
    sourceUrls: claim.sourceUrls,
    observedAt: claim.observedAt,
  };
}

function directOnly(ctx: AnswerContext, definition: ReportFieldDefinition, kinds: string[]): ReportFieldAnswer {
  const claim = firstFact(ctx, kinds);
  if (!claim) return unavailable(definition);
  return confirmedFrom(definition, claim);
}

function estimatedAllowed(ctx: AnswerContext, definition: ReportFieldDefinition, kinds: string[]): ReportFieldAnswer {
  const claim = firstFact(ctx, kinds);
  if (!claim) return unavailable(definition);
  if (ESTIMATE_MARKERS.test(claim.statement)) {
    return {
      key: definition.key,
      group: definition.group,
      label: definition.label,
      value: claim.statement,
      detail: 'Cifra aproximada según la fuente citada; úsala como rango, no como dato exacto.',
      status: 'estimated',
      sourceUrls: claim.sourceUrls,
      observedAt: claim.observedAt,
    };
  }
  return confirmedFrom(definition, claim);
}

function hypothesisAllowed(
  ctx: AnswerContext,
  definition: ReportFieldDefinition,
  kinds: string[],
  pool?: FieldClaim[],
): ReportFieldAnswer {
  const fact = firstFact(ctx, kinds);
  if (fact) return confirmedFrom(definition, fact, `Confianza de la evidencia: ${confidenceTierFor(fact.confidence)}.`);
  const candidates = pool || ctx.hypotheses;
  const hypothesis = candidates.find((claim) => kinds.length === 0 || kinds.some((kind) => claim.kind.includes(kind)))
    || (kinds.length === 0 ? candidates[0] : undefined);
  if (!hypothesis) return unavailable(definition);
  return {
    key: definition.key,
    group: definition.group,
    label: definition.label,
    value: `${REPORT_FIELD_HYPOTHESIS_PREFIX} ${hypothesis.statement}`,
    detail: `Señal cualitativa: ${confidenceTierFor(hypothesis.confidence)}. ${definition.howToFind}`,
    status: 'hypothesis',
    sourceUrls: hypothesis.sourceUrls,
    observedAt: hypothesis.observedAt,
  };
}

function normalizeKeywordText(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function findClaim(pool: FieldClaim[], keywords: string[]): FieldClaim | null {
  const terms = keywords.map(normalizeKeywordText).filter(Boolean);
  return pool.find((claim) => {
    const haystack = normalizeKeywordText(claim.statement);
    return terms.some((term) => term && haystack.includes(term));
  }) || null;
}

function framedHypothesis(definition: ReportFieldDefinition, claim: FieldClaim, detail?: string): ReportFieldAnswer {
  return {
    key: definition.key,
    group: definition.group,
    label: definition.label,
    value: `${REPORT_FIELD_HYPOTHESIS_PREFIX} ${claim.statement}`,
    detail: detail || `Señal cualitativa: ${confidenceTierFor(claim.confidence)}. ${definition.howToFind}`,
    status: 'hypothesis',
    sourceUrls: claim.sourceUrls,
    observedAt: claim.observedAt,
  };
}

function policyBlocked(definition: ReportFieldDefinition): ReportFieldAnswer {
  return {
    key: definition.key,
    group: definition.group,
    label: definition.label,
    value: 'No disponible por política.',
    detail: definition.howToFind,
    status: 'restricted',
    sourceUrls: [],
    observedAt: null,
  };
}

function profileHref(report: import('@/lib/research-workspace').ResearchReportView, label: string): string | null {
  const found = (report.person?.fields || []).find((field) => field.label === label);
  const href = found?.href ? String(found.href).trim() : '';
  try {
    const parsed = new URL(href);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function declaredLink(definition: ReportFieldDefinition, href: string | null, label: string): ReportFieldAnswer {
  if (!href) return unavailable(definition);
  return {
    key: definition.key,
    group: definition.group,
    label: definition.label,
    value: label,
    detail: REPORT_FIELD_DECLARED_DETAIL,
    status: 'confirmed',
    sourceUrls: [href],
    observedAt: null,
  };
}

function scoreTier(score: number | null | undefined): 'Alta' | 'Media' | 'Baja' | null {
  if (score == null || !Number.isFinite(score)) return null;
  if (score >= 80) return 'Alta';
  if (score >= 65) return 'Media';
  if (score >= 48) return 'Baja';
  return null;
}

function seniorityFromTitle(title: string): string | null {
  const normalized = normalizeKeywordText(title);
  if (/(c level|ceo|gerente general|director general|presidente)/.test(normalized)) return 'C-Level';
  if (/\bdirector/.test(normalized)) return 'Director';
  if (/\bgerente/.test(normalized)) return 'Gerente';
  if (/\bjefe/.test(normalized)) return 'Jefe';
  if (/\bcoordinador/.test(normalized)) return 'Coordinador';
  if (/\banalista/.test(normalized)) return 'Analista';
  return null;
}

const TRIGGER_KEYWORDS: Record<string, string[]> = {
  'signal.hiring': ['contratacion', 'vacante', 'empleo', 'busqueda de talento', 'hiring'],
  'signal.funding': ['inversion', 'financiamiento', 'ronda', 'capital', 'funding'],
  'signal.ceo': ['nuevo ceo', 'ceo', 'director ejecutivo'],
  'signal.leadership': ['directivo', 'gerencia', 'nombramiento', 'liderazgo'],
  'signal.restructuring': ['reestructuracion', 'reorganizacion'],
  'signal.expansion': ['expansion', 'crecimiento', 'ampliacion'],
  'signal.offices': ['oficina', 'sede', 'sucursal', 'apertura'],
  'signal.newMarkets': ['nuevo mercado', 'nuevo pais', 'expansion regional', 'ingreso a'],
  'signal.newProducts': ['lanzamiento', 'nuevo producto', 'nuevo servicio'],
  'signal.tenders': ['licitacion', 'tender'],
  'signal.contracts': ['contrato', 'adjudicacion', 'acuerdo firmado'],
  'signal.mna': ['fusion', 'adquisicion', 'compra de empresa', 'm&a'],
  'signal.regulatory': ['regulacion', 'normativa', 'ley ', 'fiscalizacion', 'cumplimiento'],
  'signal.news': ['noticia', 'anuncio', 'prensa', 'publico que'],
};

const PAIN_KEYWORDS: Record<string, string[]> = {
  'pain.process': ['proceso', 'operacion', 'flujo', 'gestion'],
  'pain.current': ['actualmente', 'hoy', 'actual', 'forma de trabajar'],
  'pain.manual': ['manual', 'planilla', 'correo', 'papel'],
  'pain.slowness': ['lento', 'demora', 'tiempo', 'cuello de botella'],
  'pain.people': ['personas', 'equipo', 'personal', 'dotacion'],
  'pain.cost': ['costo', 'gasto', 'ahorro', 'presupuesto'],
  'pain.risk': ['riesgo', 'incumplimiento', 'multa'],
  'pain.errors': ['error', 'falla', 'reproceso', 'reclamo'],
  'pain.missingInfo': ['falta', 'informacion', 'datos', 'visibilidad', 'trazabilidad'],
  'pain.repetitive': ['repetitiv', 'rutinario', 'recurrente', 'todos los meses'],
  'pain.automatable': ['automat', 'digitaliz', 'sistema'],
  'pain.kpi': ['kpi', 'metrica', 'indicador', 'medicion', 'tiempo de respuesta'],
  'pain.solution': ['oportunidad', 'propuesta', 'solucion', 'encaje'],
};

function profileField(report: import('@/lib/research-workspace').ResearchReportView, label: string): string | null {
  const found = (report.person?.fields || []).find((field) => field.label === label);
  return found ? nullableText(found.value) : null;
}

function resolveTrigger(ctx: AnswerContext, definition: ReportFieldDefinition): ReportFieldAnswer {
  const keywords = TRIGGER_KEYWORDS[definition.key] || [];
  const match = findClaim(ctx.signals, keywords) || findClaim(ctx.facts, keywords);
  if (!match) return unavailable(definition);
  return confirmedFrom(definition, match);
}

function resolvePain(ctx: AnswerContext, definition: ReportFieldDefinition, usedHypothesisIds: Set<string>): ReportFieldAnswer {
  const keywords = PAIN_KEYWORDS[definition.key] || [];
  const pool = [...ctx.opportunities, ...ctx.hypotheses].filter((claim) => !usedHypothesisIds.has(claim.id));
  const match = findClaim(pool, keywords);
  if (!match) {
    return {
      ...unavailable(definition),
      value: 'Hipótesis pendiente: sin evidencia para describir este punto.',
      detail: `Conviértelo en pregunta de descubrimiento. ${definition.howToFind}`,
    };
  }
  usedHypothesisIds.add(match.id);
  if (match.classification === 'hypothesis') return framedHypothesis(definition, match);
  if (match.sourceUrls.length === 0) return unavailable(definition);
  return confirmedFrom(definition, match);
}

function tieredScore(definition: ReportFieldDefinition, score: number | null, max: number, basis: string): ReportFieldAnswer {
  if (score == null) return unavailable(definition);
  const normalized = max === 100 ? score : score * 100;
  const tier = scoreTier(normalized);
  if (!tier) return unavailable(definition);
  return {
    key: definition.key,
    group: definition.group,
    label: definition.label,
     value: `Nivel ${tier}.`,
    detail: basis,
    status: 'estimated',
    sourceUrls: [],
    observedAt: null,
  };
}

function seniorityHypothesis(definition: ReportFieldDefinition, title: string, declaredValue: string | null): ReportFieldAnswer {
  if (declaredValue) {
    return {
      key: definition.key,
      group: definition.group,
      label: definition.label,
      value: declaredValue,
      detail: REPORT_FIELD_DECLARED_DETAIL,
      status: 'confirmed',
      sourceUrls: [],
      observedAt: null,
    };
  }
  const inferred = seniorityFromTitle(title);
  if (!inferred || !title) return unavailable(definition);
  return {
    key: definition.key,
    group: definition.group,
    label: definition.label,
    value: `${REPORT_FIELD_HYPOTHESIS_PREFIX} nivel ${inferred} por su cargo de ${title}.`,
    detail: `Inferencia desde el cargo citado; confirma el nivel en descubrimiento. ${definition.howToFind}`,
    status: 'hypothesis',
    sourceUrls: [],
    observedAt: null,
  };
}

function roleHypothesis(ctx: AnswerContext, definition: ReportFieldDefinition, role: 'decisor' | 'influencer' | 'user' | 'gatekeeper'): ReportFieldAnswer {
  if (role === 'gatekeeper') {
    const evidence = findClaim([...ctx.facts, ...ctx.hypotheses], ['filtra', 'acceso', 'asistente', 'gatekeeper', 'porteria']);
    if (!evidence) {
      return {
        ...unavailable(definition),
        detail: 'Sin evidencia de que filtre el acceso; pregúntalo en descubrimiento si no llegas al decisor.',
      };
    }
    if (evidence.classification === 'hypothesis') return framedHypothesis(definition, evidence);
    if (evidence.sourceUrls.length === 0) return unavailable(definition);
    return confirmedFrom(definition, evidence);
  }
  if (!ctx.leadTitle) return unavailable(definition);
  const seniority = seniorityFromTitle(ctx.leadTitle);
  const senior = seniority === 'C-Level' || seniority === 'Director' || seniority === 'Gerente';
  const roleText = role === 'decisor'
    ? (senior ? `podría decidir presupuesto o compra como ${ctx.leadTitle}` : `podría influir en la decisión como ${ctx.leadTitle}, sin evidencia de que firme presupuesto`)
    : role === 'influencer'
      ? `podría influir en la evaluación como ${ctx.leadTitle}`
      : `podría usar la solución en su operación diaria como ${ctx.leadTitle}`;
  return {
    key: definition.key,
    group: definition.group,
    label: definition.label,
    value: `${REPORT_FIELD_HYPOTHESIS_PREFIX} ${roleText}.`,
    detail: `Inferencia desde el cargo citado; valida el rol real en descubrimiento. ${definition.howToFind}`,
    status: 'hypothesis',
    sourceUrls: [],
    observedAt: null,
  };
}

function resolveAnswer(ctx: AnswerContext, definition: ReportFieldDefinition, usedHypothesisIds: Set<string>): ReportFieldAnswer {
  if (definition.key.startsWith('signal.')) return resolveTrigger(ctx, definition);
  if (definition.key.startsWith('pain.')) return resolvePain(ctx, definition, usedHypothesisIds);
  switch (definition.key) {
    case 'company.name':
      return declared(ctx, definition, ctx.result?.lead?.companyName);
    case 'company.industry':
      return directOnly(ctx, definition, ['company_industry']);
    case 'company.offerings':
      return directOnly(ctx, definition, ['company_service']);
    case 'company.operations':
      return directOnly(ctx, definition, ['company_geography']);
    case 'company.scale':
      return estimatedAllowed(ctx, definition, ['company_size']);
    case 'contact.name':
      return declared(ctx, definition, ctx.result?.lead?.fullName || profileField(ctx.report, 'Nombre'));
    case 'contact.role':
      return directOnly(ctx, definition, ['contact_role', 'lead_role']);
    case 'contact.authority': {
      const answer = hypothesisAllowed(ctx, definition, ['contact_authority']);
      return answer;
    }
    case 'contact.channels':
      return restricted(definition);
    case 'commercial.volume': {
      const answer = estimatedAllowed(ctx, definition, ['volume_estimate']);
      if (answer.status !== 'unavailable') {
        return {
          ...answer,
          detail: 'Estimación con supuestos explícitos; revisa la fórmula y los supuestos antes de usarla.',
        };
      }
      return answer;
    }
    case 'commercial.fit':
      return hypothesisAllowed(ctx, definition, [], ctx.opportunities);
    case 'commercial.risks':
      return directOnly(ctx, definition, ['risk', 'regulatory']);
    case 'decision.primary':
      return directOnly(ctx, definition, ['buying_committee', 'contact_authority']);
    case 'decision.committee': {
      const members = ctx.facts.filter((claim) => claim.kind.includes('buying_committee'));
      if (members.length === 0) return unavailable(definition);
      const first = members[0];
      return confirmedFrom(
        definition,
        first,
        members.length > 1 ? `${members.length} integrantes citados en la evidencia.` : undefined,
      );
    }
    case 'personalization.signal': {
      const signal = [...ctx.signals].sort((left, right) => Number(Boolean(right.observedAt)) - Number(Boolean(left.observedAt)))[0];
      if (!signal) return unavailable(definition);
      return confirmedFrom(definition, signal);
    }
    case 'personalization.angle': {
      const next = ctx.opportunities.find((claim) => claim.classification === 'hypothesis' && !usedHypothesisIds.has(claim.id));
      if (next) {
        usedHypothesisIds.add(next.id);
        return {
          key: definition.key,
          group: definition.group,
          label: definition.label,
          value: `${REPORT_FIELD_HYPOTHESIS_PREFIX} ${next.statement}`,
          detail: `Señal cualitativa: ${confidenceTierFor(next.confidence)}. ${definition.howToFind}`,
          status: 'hypothesis',
          sourceUrls: next.sourceUrls,
          observedAt: next.observedAt,
        };
      }
      return unavailable(definition);
    }
    case 'personalization.discovery': {
      const question = ctx.opportunities.find((claim) => claim.classification === 'hypothesis' && !usedHypothesisIds.has(claim.id) && claim.statement.includes('?'));
      const fallback = question || ctx.opportunities.find((claim) => claim.classification === 'hypothesis' && !usedHypothesisIds.has(claim.id));
      if (fallback) {
        usedHypothesisIds.add(fallback.id);
        return {
          key: definition.key,
          group: definition.group,
          label: definition.label,
          value: `${REPORT_FIELD_HYPOTHESIS_PREFIX} ${fallback.statement}`,
          detail: `Señal cualitativa: ${confidenceTierFor(fallback.confidence)}. ${definition.howToFind}`,
          status: 'hypothesis',
          sourceUrls: fallback.sourceUrls,
          observedAt: fallback.observedAt,
        };
      }
      const gap = (ctx.report.gaps || [])[0];
      if (gap && text((gap as Record<string, unknown>).description)) {
        return {
          key: definition.key,
          group: definition.group,
          label: definition.label,
          value: 'Pendiente: falta evidencia para formular la pregunta.',
          detail: text((gap as Record<string, unknown>).description, 400),
          status: 'unavailable',
          sourceUrls: [],
          observedAt: null,
        };
      }
      return unavailable(definition);
    }
    case 'company.website': {
      const website = text(ctx.result?.lead?.companyWebsite);
      if (website) {
        return declaredLink(definition, website.startsWith('http') ? website : `https://${website}`, 'Sitio web');
      }
      const domain = text(ctx.result?.lead?.companyDomain);
      if (domain) return declaredLink(definition, `https://${domain}`, domain);
      return unavailable(definition);
    }
    case 'company.linkedin':
      return declaredLink(definition, profileHref(ctx.report, 'Perfil de empresa'), 'LinkedIn');
    case 'company.subindustry': {
      const industries = ctx.facts.filter((claim) => claim.kind.includes('company_industry'));
      if (industries.length === 0) return unavailable(definition);
      return confirmedFrom(definition, industries.length > 1 ? industries[1] : industries[0]);
    }
    case 'company.country':
      return declared(ctx, definition, ctx.result?.lead?.country);
    case 'company.cities': {
      const match = findClaim(ctx.facts, ['ciudad', 'sede', 'sucursal', 'oficina', 'planta', 'faena']);
      if (!match) return unavailable(definition);
      return confirmedFrom(definition, match);
    }
    case 'company.employees':
      return estimatedAllowed(ctx, definition, ['company_size']);
    case 'company.revenue': {
      const match = ctx.facts.find((claim) => claim.kind.includes('company_size') && /[$€]|usd|clp|\bmm\b|millones|facturacion|ingresos|ventas/i.test(claim.statement) && /\d/.test(claim.statement));
      if (!match) {
        return {
          ...unavailable(definition),
          detail: 'Sin fuente con moneda y cifra explícitas; no se estima facturación sin base.',
        };
      }
      return {
        key: definition.key,
        group: definition.group,
        label: definition.label,
        value: match.statement,
        detail: 'Cifra citada textual; úsala como referencia, no como dato auditado.',
        status: 'estimated',
        sourceUrls: match.sourceUrls,
        observedAt: match.observedAt,
      };
    }
    case 'company.customers':
    case 'company.businessModel': {
      const answer = hypothesisAllowed(ctx, definition, ['company_industry', 'company_service']);
      return answer;
    }
    case 'company.markets':
      return directOnly(ctx, definition, ['company_geography']);
    case 'company.competitors':
      return directOnly(ctx, definition, ['competitor']);
    case 'contact.title': {
      const declaredTitle = text(ctx.result?.lead?.title) || profileField(ctx.report, 'Cargo');
      if (declaredTitle) {
        return {
          key: definition.key,
          group: definition.group,
          label: definition.label,
          value: declaredTitle,
          detail: REPORT_FIELD_DECLARED_DETAIL,
          status: 'confirmed',
          sourceUrls: [],
          observedAt: null,
        };
      }
      return directOnly(ctx, definition, ['contact_role', 'lead_role']);
    }
    case 'contact.area':
      return declared(ctx, definition, ctx.leadArea);
    case 'contact.seniority':
      return seniorityHypothesis(definition, ctx.leadTitle, profileField(ctx.report, 'Seniority'));
    case 'contact.tenureRole':
    case 'contact.tenureCompany': {
      const match = ctx.facts.find((claim) => {
        const haystack = normalizeKeywordText(claim.statement);
        return ['antiguedad', 'anos', 'meses', 'ingreso', 'inicio', 'desde'].some((term) => haystack.includes(term));
      });
      if (!match) return unavailable(definition);
      return confirmedFrom(definition, match);
    }
    case 'contact.location': {
      const declaredLocation = profileField(ctx.report, 'Ubicación')
        || [text(ctx.result?.lead?.city), text(ctx.result?.lead?.country)].filter(Boolean).join(', ');
      return declared(ctx, definition, declaredLocation || null);
    }
    case 'contact.linkedin': {
      const href = profileHref(ctx.report, 'Perfil importado') || text(ctx.result?.lead?.linkedinUrl);
      return declaredLink(definition, href || null, 'LinkedIn');
    }
    case 'contact.email':
      return declared(ctx, definition, ctx.result?.lead?.email);
    case 'contact.phone':
      return restricted(definition);
    case 'contact.responsibilities': {
      if (!ctx.leadTitle) return unavailable(definition);
      return {
        key: definition.key,
        group: definition.group,
        label: definition.label,
        value: `${REPORT_FIELD_HYPOTHESIS_PREFIX} sus responsabilidades giran en torno a ${ctx.leadArea || 'su área'} según su cargo de ${ctx.leadTitle}.`,
        detail: `Inferencia desde el cargo citado; valida funciones reales en descubrimiento. ${definition.howToFind}`,
        status: 'hypothesis',
        sourceUrls: [],
        observedAt: null,
      };
    }
    case 'contact.decisions': {
      if (!ctx.leadTitle) return unavailable(definition);
      const seniority = seniorityFromTitle(ctx.leadTitle);
      const senior = seniority === 'C-Level' || seniority === 'Director' || seniority === 'Gerente';
      return {
        key: definition.key,
        group: definition.group,
        label: definition.label,
        value: `${REPORT_FIELD_HYPOTHESIS_PREFIX} como ${ctx.leadTitle} ${senior ? 'participa en decisiones de su ámbito' : 'escala decisiones relevantes a su jefatura'}.`,
        detail: `Inferencia desde el cargo citado; valida qué decide y qué solo recomienda. ${definition.howToFind}`,
        status: 'hypothesis',
        sourceUrls: [],
        observedAt: null,
      };
    }
    case 'contact.roleDecisor':
      return roleHypothesis(ctx, definition, 'decisor');
    case 'contact.roleInfluencer':
      return roleHypothesis(ctx, definition, 'influencer');
    case 'contact.roleUser':
      return roleHypothesis(ctx, definition, 'user');
    case 'contact.roleGatekeeper':
      return roleHypothesis(ctx, definition, 'gatekeeper');
    case 'commercial.icpFit':
      return hypothesisAllowed(ctx, definition, [], ctx.opportunities);
    case 'commercial.leadScore':
      return tieredScore(definition, ctx.leadScore, 100, 'Nivel cualitativo derivado del puntaje interno de investigación.');
    case 'commercial.companyScore':
      return tieredScore(definition, ctx.coverageScore == null ? null : ctx.coverageScore * 100, 100, 'Nivel cualitativo derivado de la cobertura del informe.');
    case 'commercial.productFit':
      return hypothesisAllowed(ctx, definition, [], ctx.opportunities);
    case 'commercial.opportunitySize': {
      const answer = estimatedAllowed(ctx, definition, ['volume_estimate']);
      if (answer.status !== 'unavailable') return answer;
      return {
        ...unavailable(definition),
        detail: 'Para dimensionar se necesitan volumen, alcance y supuestos explícitos.',
      };
    }
    case 'commercial.productInterest':
      return hypothesisAllowed(ctx, definition, ['company_service', 'volume_estimate']);
    case 'commercial.useCase':
      return hypothesisAllowed(ctx, definition, [], ctx.opportunities);
    case 'commercial.ticket': {
      const answer = estimatedAllowed(ctx, definition, ['volume_estimate']);
      if (answer.status !== 'unavailable') return answer;
      return {
        ...unavailable(definition),
        detail: 'Para estimar ticket se necesitan volumen, alcance y supuestos explícitos.',
      };
    }
    case 'commercial.priority': {
      const tier = scoreTier(ctx.leadScore);
      const hasSignal = ctx.signals.length > 0;
      if (!tier && !hasSignal) return unavailable(definition);
      return {
        key: definition.key,
        group: definition.group,
        label: definition.label,
        value: `${REPORT_FIELD_HYPOTHESIS_PREFIX} prioridad ${tier || 'Media'}${hasSignal ? ' con señales recientes por validar' : ''}.`,
        detail: `Priorización cualitativa desde puntaje interno y señales; valida interés real en descubrimiento. ${definition.howToFind}`,
        status: 'hypothesis',
        sourceUrls: [],
        observedAt: null,
      };
    }
    case 'commercial.timing': {
      if (ctx.signals.length === 0) {
        return {
          ...unavailable(definition),
          detail: 'Sin señales recientes confirmadas; el timing se define en descubrimiento.',
        };
      }
      return framedHypothesis(definition, ctx.signals[0], 'Hay señales recientes por validar antes de acelerar el contacto.');
    }
    case 'commercial.responseProbability':
    case 'commercial.conversionProbability':
      return policyBlocked(definition);
    case 'decision.owner':
    case 'decision.user':
    case 'decision.evaluator':
    case 'decision.approver':
    case 'decision.signer':
    case 'decision.blocker':
    case 'decision.others':
    case 'decision.relations': {
      const keywords: Record<string, string[]> = {
        'decision.owner': ['responsable', 'lider', 'jefe', 'dueno'],
        'decision.user': ['usuario', 'operacion', 'equipo', 'analista'],
        'decision.evaluator': ['evalua', 'tecnico', 'comite', 'revisor'],
        'decision.approver': ['aprueba', 'presupuesto', 'gerente', 'director'],
        'decision.signer': ['firma', 'contrato', 'representante'],
        'decision.blocker': ['bloquea', 'frena', 'finanzas', 'legal', 'proveedor actual'],
        'decision.others': ['contactar', 'recomienda', 'referente'],
        'decision.relations': ['reporta', 'relacion', 'depende', 'colabora'],
      };
      const match = findClaim([...ctx.facts, ...ctx.hypotheses], keywords[definition.key] || []);
      if (!match) {
        return {
          ...unavailable(definition),
          detail: 'Sin evidencia del mapa de compra; propón el perfil y valida en descubrimiento.',
        };
      }
      if (match.classification === 'hypothesis') return framedHypothesis(definition, match);
      return confirmedFrom(definition, match);
    }
    case 'personalization.reason': {
      const anchor = ctx.signals[0] || ctx.opportunities.find((claim) => !usedHypothesisIds.has(claim.id));
      if (!anchor) return unavailable(definition);
      if (anchor.classification === 'hypothesis') {
        usedHypothesisIds.add(anchor.id);
        return framedHypothesis(definition, anchor);
      }
      if (anchor.sourceUrls.length === 0) return unavailable(definition);
      return confirmedFrom(definition, anchor);
    }
    case 'personalization.event': {
      const dated = [...ctx.signals].sort((left, right) => Number(Boolean(right.observedAt)) - Number(Boolean(left.observedAt)))[0];
      if (!dated) {
        return {
          ...unavailable(definition),
          detail: 'Sin evento fechado; no se inventa apertura. Usa el rol o una pregunta de descubrimiento.',
        };
      }
      return confirmedFrom(definition, dated);
    }
    case 'personalization.pain':
    case 'personalization.benefit': {
      const next = ctx.opportunities.find((claim) => !usedHypothesisIds.has(claim.id));
      if (!next) return unavailable(definition);
      usedHypothesisIds.add(next.id);
      if (next.classification === 'hypothesis') return framedHypothesis(definition, next);
      if (next.sourceUrls.length === 0) return unavailable(definition);
      return confirmedFrom(definition, next);
    }
    case 'personalization.successCase':
    case 'personalization.similarCompany':
      return {
        ...unavailable(definition),
        detail: 'Aporta el caso en tu perfil comercial; el informe nunca inventa clientes ni resultados.',
      };
    case 'personalization.metric': {
      const answer = estimatedAllowed(ctx, definition, ['volume_estimate']);
      if (answer.status !== 'unavailable') return answer;
      return {
        ...unavailable(definition),
        detail: 'Propón la métrica con unidad y línea base a validar en descubrimiento.',
      };
    }
    case 'personalization.icebreaker': {
      const anchor = [...ctx.facts].find((claim) => claim.sourceUrls.length > 0);
      if (!anchor) return unavailable(definition);
      return {
        key: definition.key,
        group: definition.group,
        label: definition.label,
        value: `${REPORT_FIELD_HYPOTHESIS_PREFIX} abrir con este hecho generará mejor respuesta: ${anchor.statement}`,
        detail: 'Sugerencia construida solo sobre un hecho confirmado y citado.',
        status: 'hypothesis',
        sourceUrls: anchor.sourceUrls,
        observedAt: anchor.observedAt,
      };
    }
    case 'personalization.cta':
      return {
        key: definition.key,
        group: definition.group,
        label: definition.label,
        value: `${REPORT_FIELD_HYPOTHESIS_PREFIX} un solo pedido de baja fricción es el cierre adecuado si el encaje se confirma en descubrimiento.`,
        detail: 'Recomendación comercial, no un hecho del prospecto.',
        status: 'hypothesis',
        sourceUrls: [],
        observedAt: null,
      };
    default:
      return unavailable(definition);
  }
}

export function buildReportFieldAnswers(report: import('@/lib/research-workspace').ResearchReportView, result?: import('@/lib/research-workspace').ResearchWorkspaceResult): ReportFieldAnswer[] {
  const ctx = buildContext(report, result);
  const usedHypothesisIds = new Set<string>();
  return REPORT_FIELD_DEFINITIONS.map((definition) => resolveAnswer(ctx, definition, usedHypothesisIds));
}

export function reportFieldDefinitionFor(key: string): ReportFieldDefinition {
  return definitionFor(key);
}

export function countReportFieldAnswersByStatus(answers: ReportFieldAnswer[]): Record<ReportFieldStatus, number> {
  const counts: Record<ReportFieldStatus, number> = {
    confirmed: 0,
    estimated: 0,
    hypothesis: 0,
    unavailable: 0,
    restricted: 0,
  };
  answers.forEach((answer) => {
    counts[answer.status] += 1;
  });
  return counts;
}

/**
 * Structural fail-closed validation for field answers. Returns issue codes;
 * an empty array means the answers carry no fabrication signals.
 */
export function validateReportFieldAnswers(
  answers: ReportFieldAnswer[],
  definitions: ReportFieldDefinition[] = REPORT_FIELD_DEFINITIONS,
): string[] {
  const issues: string[] = [];
  const byKey = new Map(answers.map((answer) => [answer.key, answer]));
  definitions.forEach((definition) => {
    const answer = byKey.get(definition.key);
    if (!answer) {
      issues.push(`missing_field:${definition.key}`);
      return;
    }
    if (answer.status === 'confirmed' && definition.policy !== 'declared-only' && answer.detail !== REPORT_FIELD_DECLARED_DETAIL && (answer.sourceUrls || []).length === 0) {
      issues.push(`confirmed_without_sources:${definition.key}`);
    }
    if ((answer.status === 'unavailable' || answer.status === 'restricted') && (answer.sourceUrls || []).length > 0) {
      issues.push(`redacted_with_sources:${definition.key}`);
    }
    if (answer.status === 'hypothesis' && !answer.value.startsWith(REPORT_FIELD_HYPOTHESIS_PREFIX)) {
      issues.push(`hypothesis_without_framing:${definition.key}`);
    }
    if (answer.status === 'estimated' && !text(answer.detail)) {
      issues.push(`estimate_without_basis:${definition.key}`);
    }
    if (answer.status === 'restricted' && (EMAIL_PATTERN.test(answer.value) || /\d/.test(answer.value))) {
      issues.push(`private_field_exposed:${definition.key}`);
    }
    if (NUMERIC_PROBABILITY_PATTERN.test(`${answer.value} ${answer.detail || ''}`)) {
      issues.push(`numeric_probability_exposed:${definition.key}`);
    }
  });
  answers.forEach((answer) => {
    if (!definitions.some((definition) => definition.key === answer.key)) {
      issues.push(`unknown_field:${answer.key}`);
    }
  });
  return [...new Set(issues)].sort();
}
