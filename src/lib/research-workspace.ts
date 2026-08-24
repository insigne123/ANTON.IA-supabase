import type { NativeResearchStatus } from '@/lib/native-research-contracts';
import { ResearchSnapshotV1Schema, type ResearchSnapshotV1 } from '@/lib/research-contracts';
import {
  ResearchReportDocumentV1Schema,
  validateResearchReportDocumentCitationsV1,
  type ResearchReportDocumentV1,
  type ResearchReportFactualBlockV1,
  type ResearchReportHypothesisBlockV1,
  type ResearchReportSectionV1,
} from '@/lib/research-report-contracts';
import {
  isFreshResearchClaim,
  isGenericResearchText,
  isDraftablePersonFactClaim,
  isQualifiedResearchFactEvidence,
  isRelevantResearchSignal,
} from '@/lib/research-fact-eligibility';

export const MAX_RESEARCH_BATCH_SIZE = 50;

export type ResearchWorkspaceLead = {
  key: string;
  id?: string | null;
  fullName?: string | null;
  email?: string | null;
  title?: string | null;
  headline?: string | null;
  seniority?: string | null;
  departments?: string[] | null;
  linkedinUrl?: string | null;
  companyName?: string | null;
  companyDomain?: string | null;
  organizationIndustry?: string | null;
  organizationSize?: number | null;
  city?: string | null;
  country?: string | null;
};

export type ResearchWorkspaceStatus = NativeResearchStatus | 'idle';

export type ResearchWorkspaceEvidence = {
  id: string;
  statement: string;
  sourceUrl: string;
  kind: string;
};

export type ResearchWorkspaceSource = {
  id: string;
  title: string;
  url: string;
  type?: string;
};

export type ResearchWorkspaceResult = {
  status: ResearchWorkspaceStatus;
  researchSnapshotId: string | null;
  lead: Omit<ResearchWorkspaceLead, 'key'>;
  score: number | null;
  evidence: ResearchWorkspaceEvidence[];
  sources: ResearchWorkspaceSource[];
  angle: string;
  promptPack?: {
    claims: string[];
  };
  quality: {
    score: number | null;
    sufficientResearch: boolean | null;
  };
  draftEligibility: {
    eligible: boolean | null;
    blockReason: string | null;
  };
  warnings: string[];
  snapshot?: ResearchSnapshotV1;
};

export type ResearchNarrative = {
  person: string;
  company: string;
  companyAvailable: boolean;
  opportunity: string;
  opportunityAvailable: boolean;
  findings: string[];
};

export type ResearchReportEvidence = {
  id: string;
  statement: string;
  sourceId: string;
  sourceUrl: string;
  sourceTitle: string;
  sourceType: string;
  publishedAt: string | null;
  retrievedAt: string | null;
  confidence: number | null;
};

export type ResearchReportClaim = {
  id: string;
  kind: string;
  statement: string;
  classification: 'fact' | 'hypothesis';
  confidence: number;
  validUntil: string | null;
  observedAt: string | null;
  canonicalClaimIds: string[];
  evidence: ResearchReportEvidence[];
};

export type ResearchReportProfileField = {
  label: string;
  value: string;
  href?: string;
};

export type ResearchReportCompanySections = {
  overview: ResearchReportClaim[];
  offerings: ResearchReportClaim[];
  market: ResearchReportClaim[];
  scale: ResearchReportClaim[];
};

export type ResearchReportGap = {
  id: string;
  section: ResearchReportSectionV1;
  description: string;
};

export type ResearchReportContradiction = {
  id: string;
  summary: string;
  status: 'unresolved' | 'resolved';
  evidence: ResearchReportEvidence[];
};

export type ResearchReportView = {
  executive: ResearchReportClaim[];
  person: {
    fields: ResearchReportProfileField[];
    facts: ResearchReportClaim[];
  };
  company: ResearchReportClaim[];
  companyContext: ResearchReportProfileField[];
  companySections: ResearchReportCompanySections;
  signals: ResearchReportClaim[];
  opportunities: ResearchReportClaim[];
  gaps: ResearchReportGap[];
  contradictions: ResearchReportContradiction[];
  evidenceRecords: ResearchReportEvidence[];
  sources: ResearchReportEvidence[];
  updatedAt: string | null;
  completeness: {
    status: 'complete' | 'partial';
    score: number;
    coveredSections: ResearchReportSectionV1[];
    missingSections: ResearchReportSectionV1[];
  } | null;
  coverage: {
    claims: number;
    evidenceRecords: number;
    companyFacts: number;
    signals: number;
    sources: number;
    profileFields: number;
  };
  missing: {
    company: boolean;
    person: boolean;
  };
};

export type ResearchWorkspaceRunItem = {
  id: string;
  reportId: string | null;
  position: number;
  leadRef: string;
  status: ResearchWorkspaceStatus;
  lead: ResearchWorkspaceLead;
  result: ResearchWorkspaceResult | null;
  researchSnapshotId: string | null;
  errorMessage: string | null;
  updatedAt: string | null;
  evidenceCount: number;
  sourceCount: number;
  qualityScore: number | null;
  canCreateDraft: boolean;
  readiness: ResearchReadiness;
};

export type ResearchWorkspaceRun = {
  id: string;
  status: ResearchWorkspaceStatus;
  totalCount: number;
  completedCount: number;
  failedCount: number;
  updatedAt: string | null;
  items: ResearchWorkspaceRunItem[];
};

export type ResearchReportDetail = {
  reportId: string | null;
  result: ResearchWorkspaceResult;
  reportDocument: ResearchReportDocumentV1 | null;
};

export type ResearchReadiness =
  | 'ready'
  | 'in_progress'
  | 'needs_attention'
  | 'limited'
  | 'missing_email'
  | 'missing_evidence'
  | 'contact_limit'
  | 'review';

function record(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

function list(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function nullableText(value: unknown): string | null {
  const normalized = text(value);
  return normalized || null;
}

function numberOrNull(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === 'string' && !value.trim()) return null;
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function booleanOrNull(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

export function normalizeResearchStatus(value: unknown): ResearchWorkspaceStatus {
  const status = text(value).toLowerCase();
  if (status === 'in_progress' || status === 'pending' || status === 'processing') return 'running';
  if (['queued', 'running', 'completed', 'partial', 'insufficient_data', 'failed', 'cancelled'].includes(status)) {
    return status as NativeResearchStatus;
  }
  return 'idle';
}

export function isResearchInFlight(status: ResearchWorkspaceStatus): boolean {
  return status === 'queued' || status === 'running';
}

export function isResearchTerminal(status: ResearchWorkspaceStatus): boolean {
  return ['completed', 'partial', 'insufficient_data', 'failed', 'cancelled'].includes(status);
}

export function researchStatusLabel(status: ResearchWorkspaceStatus): string {
  switch (status) {
    case 'queued':
      return 'En espera';
    case 'running':
      return 'Investigando';
    case 'completed':
      return 'Completada';
    case 'partial':
      return 'Completada con revisión';
    case 'insufficient_data':
      return 'Información limitada';
    case 'failed':
      return 'No se completó';
    case 'cancelled':
      return 'Cancelada';
    default:
      return 'Por investigar';
  }
}

export function researchReadinessLabel(readiness: ResearchReadiness): string {
  switch (readiness) {
    case 'ready':
      return 'Lista para redactar';
    case 'in_progress':
      return 'En curso';
    case 'needs_attention':
      return 'Requiere atención';
    case 'limited':
      return 'Información limitada';
    case 'missing_email':
      return 'Falta email';
    case 'missing_evidence':
      return 'Falta evidencia';
    case 'contact_limit':
      return 'Límite de contactos';
    default:
      return 'Revisión necesaria';
  }
}

export function researchDraftBlockReasonLabel(
  blockReason: string | null | undefined,
  readiness: ResearchReadiness = 'review',
): string {
  if (blockReason === 'company_contact_limit_reached') {
    return 'Se alcanzó el límite de contactos para esta empresa.';
  }
  if (blockReason === 'insufficient_research') {
    return 'La evidencia disponible aún no es suficiente para redactar.';
  }

  switch (readiness) {
    case 'in_progress':
      return 'La investigación sigue en curso.';
    case 'missing_email':
      return 'Falta un email válido para crear el borrador.';
    case 'missing_evidence':
      return 'Falta evidencia con fuentes antes de redactar.';
    case 'contact_limit':
      return 'Se alcanzó el límite de contactos para esta empresa.';
    case 'limited':
      return 'La información disponible aún es limitada.';
    case 'needs_attention':
      return 'La investigación necesita atención antes de redactar.';
    default:
      return 'La investigación requiere revisión antes de redactar.';
  }
}

export function researchEvidenceKindLabel(kind: string): string {
  switch (text(kind).toLowerCase()) {
    case 'fact':
      return 'Dato verificado';
    case 'signal':
      return 'Señal reciente';
    case 'hypothesis':
      return 'Hipótesis por validar';
    default:
      return 'Evidencia';
  }
}

export function researchSourceTypeLabel(type: string | null | undefined): string {
  switch (text(type).toLowerCase()) {
    case 'official_site':
      return 'Sitio oficial';
    case 'news':
      return 'Noticias';
    case 'jobs':
      return 'Empleo';
    case 'linkedin':
      return 'LinkedIn';
    case 'registry':
      return 'Registro público';
    case 'other':
      return 'Fuente externa';
    default:
      return 'Fuente';
  }
}

export function researchWarningLabel(warning: string): string {
  const normalized = text(warning).toLowerCase();
  const labels: Record<string, string> = {
    official_site_redirect_missing: 'El sitio oficial no pudo validarse después de una redirección.',
    official_site_timeout: 'El sitio oficial no respondió a tiempo; se usaron otras fuentes.',
    official_site_fetch_failed: 'No pudimos consultar el sitio oficial; se usaron otras fuentes.',
    company_identity_missing: 'Faltan datos para confirmar la identidad de la empresa.',
    company_context_missing: 'No encontramos una descripción corporativa verificable para esta empresa.',
    company_artifact_payload_invalid: 'Una fuente de empresa devolvió datos incompletos.',
    official_site_content_generic: 'El sitio oficial no ofreció contenido específico suficiente para respaldar el reporte.',
    whois_unavailable: 'Los datos de registro del dominio no estuvieron disponibles.',
    brand_unavailable: 'No pudimos confirmar señales públicas de marca.',
    company_news_unavailable: 'Las noticias recientes de la empresa no estuvieron disponibles.',
    hiring_signals_unavailable: 'Las señales recientes de contratación no estuvieron disponibles.',
  };
  if (labels[normalized]) return labels[normalized];
  if (/^[a-z0-9_:-]+$/.test(normalized)) return 'Hay una señal que conviene validar antes de contactar.';
  return text(warning);
}

/** Turns structured draft preflight failures into concise, actionable product copy. */
export function researchDraftErrorMessage(payload: unknown, fallback: string): string {
  const root = record(payload);
  const result = record(root.result);
  const code = text(root.error || root.code || result.code).toLowerCase();
  if (code.includes('auth')) return 'Tu sesión ya no está disponible. Vuelve a iniciar sesión e inténtalo nuevamente.';
  if (code.includes('privacy') || code.includes('suppressed')) return 'No podemos continuar con este contacto por sus preferencias de privacidad.';
  if (code.includes('in_progress')) return 'Ya estamos preparando este borrador. Espera un momento antes de volver a intentarlo.';

  const rawIssues = list(root.issues).length > 0 ? list(root.issues) : list(result.issues);
  const issues = rawIssues.map((issue) => {
    if (typeof issue === 'string') return text(issue);
    const value = record(issue);
    return text(value.message || value.description);
  }).filter((issue) => issue && issue.length <= 500);
  if (issues.length > 0) {
    const remaining = issues.length - 1;
    if (remaining === 0) return issues[0];
    return `${issues[0]} ${remaining === 1 ? 'Hay 1 punto más por revisar.' : `Hay ${remaining} puntos más por revisar.`}`;
  }

  if (code.includes('setup') || code.includes('metadata')) return 'No pudimos preparar el borrador todavía. Inténtalo nuevamente en unos minutos.';
  if (code.includes('quota')) return 'Alcanzaste el límite disponible para preparar borradores por ahora. Inténtalo más tarde.';
  const message = text(root.message || result.message);
  return message && message.length <= 300 ? message : fallback;
}

export function safeResearchSourceUrl(value: unknown): string | null {
  const candidate = text(value);
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function conciseNarrativeText(value: unknown, maxLength = 320): string {
  const normalized = text(value);
  if (normalized.length <= maxLength) return normalized;
  const shortened = normalized
    .slice(0, maxLength - 1)
    .replace(/\s+\S*$/, '')
    .replace(/[\s,;:.!?-]+$/, '');
  return `${shortened || normalized.slice(0, maxLength - 1)}…`;
}

function narrativeKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function withFinalPeriod(value: string): string {
  return /[.!?…]$/.test(value) ? value : `${value}.`;
}

function profileFieldsFor(
  lead: ResearchWorkspaceResult['lead'],
  importedContext?: ResearchReportDocumentV1['person']['importedContext'],
): ResearchReportProfileField[] {
  const person = importedContext || {
    fullName: lead.fullName,
    title: lead.title,
    linkedinUrl: lead.linkedinUrl,
    city: lead.city,
    country: lead.country,
  };
  const fields: Array<ResearchReportProfileField | null> = [
    text(person.fullName) ? { label: 'Nombre', value: text(person.fullName) } : null,
    text(person.title) ? { label: 'Cargo', value: text(person.title) } : null,
    !importedContext && text(lead.headline) ? { label: 'Titular profesional', value: text(lead.headline) } : null,
    !importedContext && text(lead.seniority) ? { label: 'Seniority', value: text(lead.seniority) } : null,
    !importedContext && Array.isArray(lead.departments) && lead.departments.some(Boolean)
      ? { label: 'Área', value: lead.departments.filter(Boolean).join(', ') }
      : null,
    [person.city, person.country].filter(Boolean).length > 0
      ? { label: 'Ubicación', value: [person.city, person.country].filter(Boolean).join(', ') }
      : null,
    safeResearchSourceUrl(person.linkedinUrl)
      ? { label: 'Perfil importado', value: 'LinkedIn', href: safeResearchSourceUrl(person.linkedinUrl)! }
      : null,
  ];
  return fields.filter((field): field is ResearchReportProfileField => Boolean(field));
}

function companyContextFieldsFor(lead: ResearchWorkspaceResult['lead']): ResearchReportProfileField[] {
  const fields: Array<[string, unknown]> = [
    ['Industria', lead.organizationIndustry],
    ['Tamaño de empresa', lead.organizationSize ? `${lead.organizationSize.toLocaleString('es-CL')} personas` : null],
  ];
  return fields.flatMap(([label, value]) => {
    const normalized = text(value);
    return normalized ? [{ label, value: normalized }] : [];
  });
}

function reportEvidenceFromSnapshot(
  snapshot: ResearchSnapshotV1,
  evidenceId: string,
): ResearchReportEvidence | null {
  const evidence = snapshot.evidence.find((item) => item.id === evidenceId);
  if (!evidence) return null;
  const source = snapshot.sources.find((item) => item.id === evidence.sourceId);
  const sourceUrl = safeResearchSourceUrl(source?.canonicalUrl || source?.url);
  if (!source || !sourceUrl) return null;
  return {
    id: evidence.id,
    statement: text(evidence.statement),
    sourceId: source.id,
    sourceUrl,
    sourceTitle: text(source.title) || sourceUrl,
    sourceType: text(source.type),
    publishedAt: nullableText(source.publishedAt),
    retrievedAt: nullableText(source.retrievedAt),
    confidence: numberOrNull(evidence.confidence),
  };
}

function fallbackReportEvidence(result: ResearchWorkspaceResult, kind: 'fact' | 'signal') {
  const sourceByUrl = new Map(result.sources.map((source) => [safeResearchSourceUrl(source.url), source]));
  return result.evidence.flatMap((evidence) => {
    if (text(evidence.kind).toLowerCase() !== kind || isGenericResearchText(evidence.statement)) return [];
    const sourceUrl = safeResearchSourceUrl(evidence.sourceUrl);
    if (!sourceUrl) return [];
    const source = sourceByUrl.get(sourceUrl);
    return [{
      id: evidence.id,
      statement: text(evidence.statement),
      sourceId: source?.id || evidence.id,
      sourceUrl,
      sourceTitle: text(source?.title) || sourceUrl,
      sourceType: text(source?.type),
      publishedAt: null,
      retrievedAt: null,
      confidence: null,
    }];
  });
}

function uniqueReportEvidence(values: ResearchReportEvidence[]) {
  const seen = new Set<string>();
  return values.filter((item) => {
    if (!item.id || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function uniqueReportSources(values: ResearchReportEvidence[]) {
  const seen = new Set<string>();
  return values.filter((item) => {
    const key = item.sourceId || item.sourceUrl;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function emptyCompanySections(): ResearchReportCompanySections {
  return { overview: [], offerings: [], market: [], scale: [] };
}

function reportClaimFromSnapshot(
  snapshot: ResearchSnapshotV1,
  claim: ResearchSnapshotV1['claims'][number],
  options: {
    id?: string;
    statement?: string;
    evidenceIds?: string[];
    observedAt?: string | null;
  } = {},
): ResearchReportClaim | null {
  const evidence = uniqueReportEvidence((options.evidenceIds || claim.supportingEvidenceIds).flatMap((evidenceId) => {
    const item = reportEvidenceFromSnapshot(snapshot, evidenceId);
    return item ? [item] : [];
  }));
  if (evidence.length === 0) return null;
  return {
    id: options.id || claim.id,
    kind: claim.kind,
    statement: text(options.statement ?? claim.statement),
    classification: claim.classification,
    confidence: claim.confidence,
    validUntil: nullableText(claim.freshness.validUntil),
    observedAt: nullableText(options.observedAt),
    canonicalClaimIds: [claim.id],
    evidence,
  };
}

function reportClaimFromDocumentBlock(
  snapshot: ResearchSnapshotV1,
  block: ResearchReportFactualBlockV1 | ResearchReportHypothesisBlockV1,
  observedAt: string | null = null,
): ResearchReportClaim | null {
  const claims = block.citations.claimIds.flatMap((claimId) => {
    const claim = snapshot.claims.find((item) => item.id === claimId);
    return claim ? [claim] : [];
  });
  const evidence = uniqueReportEvidence(block.citations.evidenceIds.flatMap((evidenceId) => {
    const item = reportEvidenceFromSnapshot(snapshot, evidenceId);
    return item ? [item] : [];
  }));
  if (claims.length === 0 || evidence.length === 0) return null;
  const validUntil = claims.map((claim) => nullableText(claim.freshness.validUntil)).filter((value): value is string => Boolean(value)).sort()[0] || null;
  return {
    id: block.id,
    kind: claims[0].kind,
    statement: text(block.statement),
    classification: block.classification,
    confidence: Math.min(...claims.map((claim) => claim.confidence)),
    validUntil,
    observedAt: nullableText(observedAt),
    canonicalClaimIds: claims.map((claim) => claim.id),
    evidence,
  };
}

function reportCoverage(input: {
  claims: ResearchReportClaim[];
  additionalEvidence?: ResearchReportEvidence[];
  companyFacts: number;
  signals: number;
  profileFields: number;
}) {
  const claimIds = new Set<string>();
  input.claims.forEach((claim) => {
    const ids = claim.canonicalClaimIds.length > 0 ? claim.canonicalClaimIds : [claim.id];
    ids.forEach((id) => claimIds.add(id));
  });
  const evidenceRecords = uniqueReportEvidence([
    ...input.claims.flatMap((claim) => claim.evidence),
    ...(input.additionalEvidence || []),
  ]);
  const sources = uniqueReportSources(evidenceRecords);
  return {
    evidenceRecords,
    sources,
    coverage: {
      claims: claimIds.size,
      evidenceRecords: evidenceRecords.length,
      companyFacts: input.companyFacts,
      signals: input.signals,
      sources: sources.length,
      profileFields: input.profileFields,
    },
  };
}

/** Projects the immutable snapshot into a readable report without filling gaps with generated prose. */
export function buildResearchReport(
  result: ResearchWorkspaceResult,
  reportDocument?: ResearchReportDocumentV1 | null,
): ResearchReportView {
  const snapshot = result.snapshot;
  const companyContext = companyContextFieldsFor(result.lead);

  if (snapshot && reportDocument) {
    const executive = reportDocument.executiveSummary.facts.flatMap((block) => {
      const claim = reportClaimFromDocumentBlock(snapshot, block);
      return claim ? [claim] : [];
    });
    const personFacts = reportDocument.person.verifiedFacts.flatMap((block) => {
      const claim = reportClaimFromDocumentBlock(snapshot, block);
      return claim ? [claim] : [];
    });
    const companySections: ResearchReportCompanySections = {
      overview: reportDocument.company.overview.flatMap((block) => {
        const claim = reportClaimFromDocumentBlock(snapshot, block);
        return claim ? [claim] : [];
      }),
      offerings: reportDocument.company.offerings.flatMap((block) => {
        const claim = reportClaimFromDocumentBlock(snapshot, block);
        return claim ? [claim] : [];
      }),
      market: reportDocument.company.market.flatMap((block) => {
        const claim = reportClaimFromDocumentBlock(snapshot, block);
        return claim ? [claim] : [];
      }),
      scale: reportDocument.company.scale.flatMap((block) => {
        const claim = reportClaimFromDocumentBlock(snapshot, block);
        return claim ? [claim] : [];
      }),
    };
    const company = [
      ...companySections.overview,
      ...companySections.offerings,
      ...companySections.market,
      ...companySections.scale,
    ];
    const signals = reportDocument.signals.flatMap((block) => {
      const claim = reportClaimFromDocumentBlock(snapshot, block, block.observedAt);
      return claim ? [claim] : [];
    });
    const opportunities = reportDocument.commercialHypotheses.flatMap((block) => {
      const claim = reportClaimFromDocumentBlock(snapshot, block);
      return claim ? [claim] : [];
    });
    const contradictions = reportDocument.contradictions.map((item) => ({
      id: item.id,
      summary: item.summary,
      status: item.status,
      evidence: uniqueReportEvidence(item.citations.evidenceIds.flatMap((evidenceId) => {
        const evidence = reportEvidenceFromSnapshot(snapshot, evidenceId);
        return evidence ? [evidence] : [];
      })),
    }));
    const visibleClaims = [...executive, ...personFacts, ...company, ...signals, ...opportunities];
    const metrics = reportCoverage({
      claims: visibleClaims,
      additionalEvidence: contradictions.flatMap((item) => item.evidence),
      companyFacts: company.length,
      signals: signals.length,
      profileFields: profileFieldsFor(result.lead, reportDocument.person.importedContext).length,
    });
    const profileFields = profileFieldsFor(result.lead, reportDocument.person.importedContext);
    return {
      executive,
      person: { fields: profileFields, facts: personFacts },
      company,
      companyContext,
      companySections,
      signals,
      opportunities,
      gaps: reportDocument.gaps,
      contradictions,
      evidenceRecords: metrics.evidenceRecords,
      sources: metrics.sources,
      updatedAt: nullableText(reportDocument.synthesis.generatedAt),
      completeness: reportDocument.completeness,
      coverage: metrics.coverage,
      missing: { company: company.length === 0, person: profileFields.length === 0 && personFacts.length === 0 },
    };
  }

  const profileFields = profileFieldsFor(result.lead);
  if (!snapshot) {
    const companyEvidence = fallbackReportEvidence(result, 'fact');
    const signals = fallbackReportEvidence(result, 'signal');
    const company = companyEvidence.slice(0, 4).map((evidence) => ({
      id: `fact-${evidence.id}`,
      kind: 'company_overview',
      statement: evidence.statement,
      classification: 'fact' as const,
      confidence: evidence.confidence ?? 0.6,
      validUntil: null,
      observedAt: null,
      canonicalClaimIds: [`fact-${evidence.id}`],
      evidence: [evidence],
    }));
    const signalClaims = signals.slice(0, 4).map((evidence) => ({
      id: `signal-${evidence.id}`,
      kind: 'site_signal',
      statement: evidence.statement,
      classification: 'fact' as const,
      confidence: evidence.confidence ?? 0.6,
      validUntil: null,
      observedAt: evidence.publishedAt || evidence.retrievedAt,
      canonicalClaimIds: [`signal-${evidence.id}`],
      evidence: [evidence],
    }));
    const companySections = { ...emptyCompanySections(), overview: company };
    const executive = [...company.slice(0, 2), ...signalClaims.slice(0, 1)];
    const metrics = reportCoverage({
      claims: [...executive, ...company, ...signalClaims],
      companyFacts: company.length,
      signals: signalClaims.length,
      profileFields: profileFields.length,
    });
    return {
      executive,
      person: { fields: profileFields, facts: [] },
      company,
      companyContext,
      companySections,
      signals: signalClaims,
      opportunities: [],
      gaps: [],
      contradictions: [],
      evidenceRecords: metrics.evidenceRecords,
      sources: metrics.sources,
      updatedAt: null,
      completeness: null,
      coverage: metrics.coverage,
      missing: { company: company.length === 0, person: profileFields.length === 0 },
    };
  }

  const sourceById = new Map(snapshot.sources.map((source) => [source.id, source]));
  const evidenceById = new Map(snapshot.evidence.map((evidence) => [evidence.id, evidence]));
  const companyClaims = snapshot.claims.flatMap((claim) => {
    if (claim.classification !== 'fact' || claim.subjectScope !== 'company' || !isFreshResearchClaim(claim, Date.now())) return [];
    if (['news_signal', 'hiring_signal', 'technology_signal', 'site_signal'].includes(claim.kind)) return [];
    const projected = reportClaimFromSnapshot(snapshot, claim);
    const supported = claim.supportingEvidenceIds.some((evidenceId) => {
      const evidence = evidenceById.get(evidenceId);
      return Boolean(evidence && isQualifiedResearchFactEvidence({
        evidence,
        source: sourceById.get(evidence.sourceId),
        companyName: snapshot.subject.company.name,
        companyDomain: snapshot.subject.company.domain,
      }));
    });
    return supported && projected ? [projected] : [];
  });
  const personClaims = snapshot.claims.flatMap((claim) => {
    if (!isDraftablePersonFactClaim({ snapshot, claim, nowMs: Date.now() })) return [];
    const projected = reportClaimFromSnapshot(snapshot, claim);
    return projected ? [projected] : [];
  });
  const signals = snapshot.claims.flatMap((claim) => {
    if (claim.classification !== 'fact' || !['news_signal', 'hiring_signal', 'technology_signal', 'site_signal'].includes(claim.kind)) return [];
    const firstEvidence = claim.supportingEvidenceIds.map((evidenceId) => evidenceById.get(evidenceId)).find(Boolean);
    const firstSource = firstEvidence ? sourceById.get(firstEvidence.sourceId) : undefined;
    const projected = reportClaimFromSnapshot(snapshot, claim, {
      observedAt: firstEvidence?.observedAt || firstSource?.publishedAt || firstSource?.retrievedAt || null,
    });
    const supported = claim.supportingEvidenceIds.some((evidenceId) => {
      const evidence = evidenceById.get(evidenceId);
      return Boolean(evidence && isRelevantResearchSignal({
        evidence,
        source: sourceById.get(evidence.sourceId),
        companyName: snapshot.subject.company.name,
        companyDomain: snapshot.subject.company.domain,
      }));
    });
    return supported && projected ? [projected] : [];
  });
  const opportunities = snapshot.claims.flatMap((claim) => {
    if (claim.classification !== 'hypothesis' || !isFreshResearchClaim(claim, Date.now())) return [];
    const projected = reportClaimFromSnapshot(snapshot, claim);
    const supported = claim.supportingEvidenceIds.some((evidenceId) => {
      const evidence = evidenceById.get(evidenceId);
      const source = evidence ? sourceById.get(evidence.sourceId) : undefined;
      return Boolean(evidence && source && (
        isQualifiedResearchFactEvidence({
          evidence,
          source,
          companyName: snapshot.subject.company.name,
          companyDomain: snapshot.subject.company.domain,
        }) || isRelevantResearchSignal({
          evidence,
          source,
          companyName: snapshot.subject.company.name,
          companyDomain: snapshot.subject.company.domain,
        })
      ));
    });
    return supported && projected ? [projected] : [];
  });
  const companySections: ResearchReportCompanySections = {
    overview: companyClaims.filter((claim) => ['company_overview', 'company_identity', 'company_priority'].includes(claim.kind)),
    offerings: companyClaims.filter((claim) => claim.kind === 'company_service'),
    market: companyClaims.filter((claim) => claim.kind === 'company_industry'),
    scale: companyClaims.filter((claim) => claim.kind === 'company_size'),
  };
  const executive = [
    ...personClaims.slice(0, 1),
    ...companySections.overview.slice(0, 2),
    ...signals.slice(0, 1),
  ];
  const contradictions = snapshot.contradictions.map((item) => ({
    id: item.id,
    summary: item.summary,
    status: item.status,
    evidence: uniqueReportEvidence(item.evidenceIds.flatMap((evidenceId) => {
      const evidence = reportEvidenceFromSnapshot(snapshot, evidenceId);
      return evidence ? [evidence] : [];
    })),
  }));
  const metrics = reportCoverage({
    claims: [...executive, ...personClaims, ...companyClaims, ...signals, ...opportunities],
    additionalEvidence: contradictions.flatMap((item) => item.evidence),
    companyFacts: companyClaims.length,
    signals: signals.length,
    profileFields: profileFields.length,
  });

  return {
    executive,
    person: { fields: profileFields, facts: personClaims },
    company: companyClaims,
    companyContext,
    companySections,
    signals,
    opportunities,
    gaps: [],
    contradictions,
    evidenceRecords: metrics.evidenceRecords,
    sources: metrics.sources,
    updatedAt: nullableText(snapshot.updatedAt),
    completeness: null,
    coverage: metrics.coverage,
    missing: { company: companyClaims.length === 0, person: profileFields.length === 0 && personClaims.length === 0 },
  };
}

function isGenericWebpageText(value: string): boolean {
  const normalized = narrativeKey(value);
  if (!normalized) return true;

  return [
    /\b(?:selecciona|elige|escoge) (?:tu |el |un )?(?:pais|region|idioma|ubicacion)\b/,
    /\b(?:select|choose) (?:(?:a|your) )?(?:country|region|language|location)\b/,
    /\b(?:aceptar|configurar|administrar|gestionar) (?:las )?cookies\b/,
    /\b(?:accept|manage|customize) (?:all )?cookies\b/,
    /\b(?:saltar al contenido|skip to (?:main )?content|menu principal|main menu)\b/,
    /\b(?:habilita|activa|enable) javascript\b/,
    /\b(?:pagina no encontrada|page not found|acceso denegado|access denied)\b/,
    /\b(?:todos los derechos reservados|all rights reserved)\b/,
  ].some((pattern) => pattern.test(normalized));
}

function supportedFactualEvidence(result: ResearchWorkspaceResult): ResearchWorkspaceEvidence[] {
  return result.evidence.filter((item) => (
    text(item.kind).toLowerCase() === 'fact'
    && Boolean(safeResearchSourceUrl(item.sourceUrl))
    && !isGenericWebpageText(item.statement)
  ));
}

function describesCompany(value: string): boolean {
  return /\b(?:describe a|perfil de marca|se dedica|ofrece|provee|se especializa|posicionamiento|desarrolla|fabrica|distribuye|provides|offers|speciali[sz]es|develops|builds|manufactures|distributes)\b/i.test(value);
}

/** Builds a compact, factual reading layer without inventing missing company context. */
export function buildResearchNarrative(result: ResearchWorkspaceResult): ResearchNarrative {
  const name = text(result.lead.fullName);
  const title = text(result.lead.title);
  const companyName = text(result.lead.companyName);
  const domain = text(result.lead.companyDomain);
  const companyLabel = companyName || domain;
  const location = [text(result.lead.city), text(result.lead.country)].filter(Boolean).join(', ');

  let person = 'No hay información disponible sobre la persona.';
  if (name && title) {
    person = `${name} ocupa el cargo de ${title}${companyLabel ? ` en ${companyLabel}` : ''}${location ? `. Ubicación: ${location}` : ''}.`;
  } else if (title) {
    person = `El contacto ocupa el cargo de ${title}${companyLabel ? ` en ${companyLabel}` : ''}${location ? `. Ubicación: ${location}` : ''}.`;
  } else if (name && companyLabel) {
    person = `${name} es el contacto asociado a ${companyLabel}${location ? ` en ${location}` : ''}.`;
  } else if (name) {
    person = `El contacto investigado es ${name}${location ? ` y está en ${location}` : ''}.`;
  } else if (companyLabel) {
    person = `No hay información personal disponible; el contacto está asociado a ${companyLabel}.`;
  }

  const factualEvidence = supportedFactualEvidence(result);
  const officialUrls = new Set(result.sources
    .filter((source) => text(source.type).toLowerCase() === 'official_site')
    .map((source) => safeResearchSourceUrl(source.url))
    .filter((url): url is string => Boolean(url)));
  const companyEvidence = factualEvidence.find((item) => {
    if (!describesCompany(item.statement)) return false;
    const sourceUrl = safeResearchSourceUrl(item.sourceUrl);
    return Boolean(sourceUrl && officialUrls.has(sourceUrl));
  }) || factualEvidence.find((item) => describesCompany(item.statement));
  const companyContext = conciseNarrativeText(companyEvidence?.statement);
  const company = companyContext || (companyLabel
    ? `No hay información de la empresa disponible para explicar qué hace ${companyLabel}.`
    : 'No hay información de la empresa disponible para identificarla o explicar qué hace.');

  const opportunityContext = conciseNarrativeText(result.angle);
  const opportunity = opportunityContext
    ? withFinalPeriod(opportunityContext)
    : 'No hay una oportunidad respaldada por la información disponible.';

  const findings: string[] = [];
  const findingKeys = new Set<string>();
  factualEvidence.forEach((item) => {
    if (findings.length >= 3) return;
    const statement = conciseNarrativeText(item.statement);
    const key = narrativeKey(statement);
    if (!statement || !key || findingKeys.has(key)) return;
    findingKeys.add(key);
    findings.push(withFinalPeriod(statement));
  });

  return {
    person: conciseNarrativeText(person),
    company: withFinalPeriod(conciseNarrativeText(company)),
    companyAvailable: Boolean(companyContext),
    opportunity,
    opportunityAvailable: Boolean(opportunityContext),
    findings,
  };
}

function normalizeResult(value: unknown): ResearchWorkspaceResult | null {
  const raw = record(value);
  if (Object.keys(raw).length === 0) return null;

  const quality = record(raw.quality);
  const draftEligibility = record(raw.draftEligibility ?? raw.draft_eligibility);
  const promptPack = record(raw.promptPack ?? raw.prompt_pack);
  const lead = record(raw.lead);
  const parsedSnapshot = ResearchSnapshotV1Schema.safeParse(raw.snapshot);
  const snapshot = parsedSnapshot.success ? parsedSnapshot.data : undefined;
  const evidence = list(raw.evidence).map((item, index) => {
    const evidenceItem = record(item);
    return {
      id: nullableText(evidenceItem.id) || `evidence-${index}`,
      statement: text(evidenceItem.statement),
      sourceUrl: text(evidenceItem.sourceUrl ?? evidenceItem.source_url),
      kind: text(evidenceItem.kind),
    };
  }).filter((item) => item.statement);
  const sources = list(raw.sources).map((item, index) => {
    const source = record(item);
    return {
      id: nullableText(source.id) || `source-${index}`,
      title: text(source.title) || text(source.url),
      url: text(source.url),
      ...(text(source.type) ? { type: text(source.type) } : {}),
    };
  }).filter((item) => item.url);
  const claims = list(promptPack.claims ?? raw.claims).map((item) => (
    typeof item === 'string' ? text(item) : text(record(item).statement)
  )).filter(Boolean);

  return {
    status: normalizeResearchStatus(raw.status),
    researchSnapshotId: nullableText(raw.researchSnapshotId ?? raw.research_snapshot_id),
    lead: {
      id: nullableText(lead.id),
      fullName: nullableText(lead.fullName ?? lead.full_name),
      email: nullableText(lead.email),
      title: nullableText(lead.title),
      headline: nullableText(lead.headline),
      seniority: nullableText(lead.seniority),
      departments: list(lead.departments).map(text).filter(Boolean),
      linkedinUrl: nullableText(lead.linkedinUrl ?? lead.linkedin_url),
      companyName: nullableText(lead.companyName ?? lead.company_name),
      companyDomain: nullableText(lead.companyDomain ?? lead.company_domain),
      organizationIndustry: nullableText(lead.organizationIndustry ?? lead.organization_industry),
      organizationSize: numberOrNull(lead.organizationSize ?? lead.organization_size),
      city: nullableText(lead.city),
      country: nullableText(lead.country),
    },
    score: numberOrNull(raw.score),
    evidence,
    sources,
    angle: text(raw.angle),
    promptPack: { claims },
    quality: {
      score: numberOrNull(quality.score),
      sufficientResearch: booleanOrNull(quality.sufficientResearch ?? quality.sufficient_research),
    },
    draftEligibility: {
      eligible: booleanOrNull(draftEligibility.eligible),
      blockReason: nullableText(draftEligibility.blockReason ?? draftEligibility.block_reason),
    },
    warnings: list(raw.warnings).map(text).filter(Boolean),
    snapshot,
  };
}

/** Parses the tenant-scoped detail response and validates document citations against its snapshot. */
export function parseResearchReportDetail(
  payload: unknown,
  fallbackResult?: ResearchWorkspaceResult | null,
): ResearchReportDetail | null {
  const root = record(payload);
  const rawResult = record(root.result);
  const parsedSnapshot = ResearchSnapshotV1Schema.safeParse(root.snapshot);
  const normalized = normalizeResult({
    ...rawResult,
    status: rawResult.status ?? root.status,
    researchSnapshotId: rawResult.researchSnapshotId ?? root.researchSnapshotId ?? root.research_snapshot_id,
    ...(parsedSnapshot.success ? { snapshot: parsedSnapshot.data } : {}),
  });
  const result = normalized || (fallbackResult
    ? { ...fallbackResult, ...(parsedSnapshot.success ? { snapshot: parsedSnapshot.data } : {}) }
    : null);
  if (!result) return null;

  const rawDocument = root.reportDocument ?? root.report_document;
  let reportDocument: ResearchReportDocumentV1 | null = null;
  if (rawDocument != null) {
    if (!parsedSnapshot.success) return null;
    const parsedDocument = ResearchReportDocumentV1Schema.safeParse(rawDocument);
    if (!parsedDocument.success) return null;
    try {
      reportDocument = validateResearchReportDocumentCitationsV1(parsedDocument.data, parsedSnapshot.data);
    } catch {
      return null;
    }
  }

  return {
    reportId: nullableText(root.reportId ?? root.report_id),
    result,
    reportDocument,
  };
}

function fallbackLead(leadRef: string, position: number): ResearchWorkspaceLead {
  return {
    key: leadRef || `research-item-${position}`,
    fullName: leadRef || 'Contacto',
  };
}

export function researchReadinessFor(input: {
  status: ResearchWorkspaceStatus;
  lead: Pick<ResearchWorkspaceLead, 'email'>;
  result: ResearchWorkspaceResult | null;
  snapshotId: string | null;
  evidenceCount: number;
  sourceCount: number;
}): ResearchReadiness {
  if (isResearchInFlight(input.status)) return 'in_progress';
  if (input.status === 'failed' || input.status === 'cancelled') return 'needs_attention';
  if (input.status === 'insufficient_data') return 'limited';
  if (!nullableText(input.lead.email)) return 'missing_email';
  if (input.result?.draftEligibility.blockReason === 'company_contact_limit_reached') return 'contact_limit';
  if (input.evidenceCount === 0 || input.sourceCount === 0) return 'missing_evidence';
  if (input.result && buildResearchReport(input.result).coverage.companyFacts === 0) return 'limited';
  if (
    ['completed', 'partial'].includes(input.status)
    && Boolean(nullableText(input.snapshotId))
    && input.result?.quality.sufficientResearch === true
    && (input.result.quality.score ?? input.result.score ?? 0) >= 48
    && input.result.draftEligibility.eligible === true
  ) {
    return 'ready';
  }
  return 'review';
}

export function canShowResearchDraftAction(input: {
  readiness: ResearchReadiness;
  snapshotId: string | null | undefined;
  eligible: boolean | null | undefined;
  canCreateDraft?: boolean;
}): boolean {
  return input.readiness === 'ready'
    && Boolean(nullableText(input.snapshotId))
    && input.eligible === true
    && input.canCreateDraft !== false;
}

function normalizeRunItem(rawValue: unknown, fallbackPosition: number, leads: ResearchWorkspaceLead[]): ResearchWorkspaceRunItem {
  const raw = record(rawValue);
  const job = record(raw.job);
  const positionValue = numberOrNull(raw.position);
  const position = positionValue != null && positionValue >= 0 ? Math.floor(positionValue) : fallbackPosition;
  const leadRef = nullableText(raw.lead_ref ?? raw.leadRef) || '';
  const result = normalizeResult(job.result_payload ?? job.resultPayload ?? raw.result);
  const savedLead = leads[position] || leads.find((lead) => lead.key === leadRef);
  const fallback = fallbackLead(leadRef, position);
  const lead = {
    ...fallback,
    ...result?.lead,
    ...savedLead,
    key: savedLead?.key || leadRef || fallback.key,
  };
  const status = normalizeResearchStatus(raw.status || job.status || result?.status);
  const researchSnapshotId = nullableText(
    job.research_snapshot_id
      ?? job.researchSnapshotId
      ?? result?.researchSnapshotId,
  );
  const report = result ? buildResearchReport(result) : null;
  const evidenceCount = report?.coverage.evidenceRecords ?? result?.evidence.length ?? 0;
  const sourceCount = report?.coverage.sources ?? result?.sources.length ?? 0;
  const readiness = researchReadinessFor({
    status,
    lead,
    result,
    snapshotId: researchSnapshotId,
    evidenceCount,
    sourceCount,
  });

  return {
    id: nullableText(raw.id ?? raw.job_id ?? raw.jobId ?? job.id) || `research-item-${position}`,
    reportId: nullableText(raw.report_id ?? raw.reportId ?? job.provider_report_id ?? job.providerReportId),
    position,
    leadRef: leadRef || lead.key,
    status,
    lead,
    result,
    researchSnapshotId,
    errorMessage: nullableText(raw.error_message ?? raw.errorMessage ?? job.error_message ?? job.errorMessage),
    updatedAt: nullableText(raw.updated_at ?? raw.updatedAt),
    evidenceCount,
    sourceCount,
    qualityScore: result?.quality.score ?? result?.score ?? null,
    canCreateDraft: readiness === 'ready',
    readiness,
  };
}

export function parseResearchWorkspaceRun(payload: unknown, leads: ResearchWorkspaceLead[]): ResearchWorkspaceRun | null {
  const root = record(payload);
  const raw = record(root.run ?? root);
  const id = nullableText(raw.id);
  if (!id) return null;

  const items = list(raw.items)
    .map((item, index) => normalizeRunItem(item, index, leads))
    .sort((left, right) => left.position - right.position);

  return {
    id,
    status: normalizeResearchStatus(raw.status),
    totalCount: numberOrNull(raw.total_count ?? raw.totalCount) ?? items.length,
    completedCount: numberOrNull(raw.completed_count ?? raw.completedCount) ?? items.filter((item) => item.canCreateDraft).length,
    failedCount: numberOrNull(raw.failed_count ?? raw.failedCount) ?? items.filter((item) => ['failed', 'cancelled', 'insufficient_data'].includes(item.status)).length,
    updatedAt: nullableText(raw.updated_at ?? raw.updatedAt),
    items,
  };
}

export function createQueuedResearchWorkspaceRun(input: {
  runId: string;
  leads: ResearchWorkspaceLead[];
  items?: unknown;
}): ResearchWorkspaceRun {
  const items = list(input.items).map((item, index) => normalizeRunItem({
    ...record(item),
    position: record(item).position ?? index,
    status: record(item).status ?? 'queued',
  }, index, input.leads));

  return {
    id: input.runId,
    status: 'queued',
    totalCount: input.leads.length,
    completedCount: 0,
    failedCount: 0,
    updatedAt: null,
    items,
  };
}

export function shouldPollResearchRun(run: ResearchWorkspaceRun | null): boolean {
  if (!run) return false;
  if (run.items.length > 0 && run.items.every((item) => isResearchTerminal(item.status))) return false;
  if (isResearchInFlight(run.status)) return true;
  return run.items.some((item) => isResearchInFlight(item.status));
}
