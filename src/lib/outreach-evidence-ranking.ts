import type { DraftContextV2, DraftEvidenceV2 } from '@/lib/server/draft-context-v2';

function text(value: unknown) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalize(value: unknown) {
  return text(value)
    .toLocaleLowerCase('es')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const rankingStopWords = new Set([
  'para', 'como', 'esta', 'este', 'estos', 'estas', 'tiene', 'tienen', 'donde', 'desde',
  'hacia', 'sobre', 'entre', 'hasta', 'cada', 'todo', 'toda', 'todos', 'todas', 'unas',
  'unos', 'ella', 'ello', 'ellos', 'ellas', 'este', 'esta', 'pero', 'porque', 'cuando',
  'with', 'from', 'that', 'this', 'with', 'para', 'empresa', 'empresas',
]);

function materialTerms(value: unknown) {
  return [...new Set(normalize(value).split(' ').filter((term) => term.length >= 4 && !rankingStopWords.has(term)))];
}

function overlapRatio(statement: string, vocabulary: Set<string>) {
  const terms = materialTerms(statement);
  if (terms.length === 0 || vocabulary.size === 0) return 0;
  const matches = terms.filter((term) => vocabulary.has(term)
    || [...vocabulary].some((word) => (word.startsWith(term) && word.length >= term.length + 2)
      || (term.startsWith(word) && term.length >= word.length + 2)));
  return matches.length / Math.max(3, terms.length);
}

export type RankedOutreachEvidence = {
  evidence: DraftEvidenceV2;
  score: number;
  anchorRank: number | null;
  roleOverlap: number;
  offerOverlap: number;
};

export function rankOutreachEvidence(context: DraftContextV2): RankedOutreachEvidence[] {
  const anchorOrder = new Map(
    (context.report?.outreachBrief.selectedFactualAnchorClaimIds || []).map((claimId, index) => [claimId, index]),
  );
  const anchorCount = Math.max(1, anchorOrder.size);
  const roleVocabulary = new Set([
    ...materialTerms(context.person.title),
    ...materialTerms(context.recipient.displayName),
  ]);
  const offerVocabulary = new Set([
    ...materialTerms(context.seller.services.join(' ')),
    ...materialTerms(context.seller.valueProposition),
    ...materialTerms(context.seller.proofPoints.join(' ')),
  ]);
  return context.evidence
    .filter((evidence) => evidence.supportedFactClaimIds.length > 0)
    .map((evidence) => {
      const anchorRank = anchorOrder.has(evidence.supportedFactClaimIds[0]!)
        ? anchorOrder.get(evidence.supportedFactClaimIds[0]!)!
        : null;
      const roleOverlap = overlapRatio(evidence.statement, roleVocabulary);
      const offerOverlap = overlapRatio(evidence.statement, offerVocabulary);
      const score = 0.3 * evidence.confidence
        + 0.2 * evidence.source.reliability
        + (anchorRank === null ? 0 : 0.25 * (1 - anchorRank / anchorCount))
        + 0.15 * roleOverlap
        + 0.1 * offerOverlap;
      return { evidence, score, anchorRank, roleOverlap, offerOverlap };
    })
    .sort((left, right) => {
      if (left.score !== right.score) return right.score - left.score;
      return left.evidence.evidenceId.localeCompare(right.evidence.evidenceId);
    });
}

export type OutreachStrategy = {
  version: 'outreach-strategy/v1';
  primaryFact: { evidenceId: string; claimId: string; statement: string };
  supportingFact: { evidenceId: string; claimId: string; statement: string } | null;
  capability: string;
  proofPoint: string | null;
  /** Internal guidance for the writer. Hypotheses stay possibilities, never facts. */
  angle: string;
  exploratory: boolean;
  warnings: string[];
};

function capabilityForFact(context: DraftContextV2, statement: string) {
  const vocabulary = new Set(materialTerms(`${statement} ${context.person.title || ''}`));
  const candidates = [
    ...context.seller.services.map((service) => ({ label: service, weight: 1 })),
    ...(context.seller.valueProposition ? [{ label: context.seller.valueProposition, weight: 0.8 }] : []),
  ];
  let best: { label: string; score: number } | null = null;
  for (const candidate of candidates) {
    const score = candidate.weight * overlapRatio(candidate.label, vocabulary);
    if (!best || score > best.score) best = { label: candidate.label, score };
  }
  if (best && best.score > 0) return { label: text(best.label), matched: true };
  const fallback = text(context.seller.services[0] || context.seller.valueProposition || '');
  return { label: fallback, matched: false };
}

export function selectOutreachStrategy(
  context: DraftContextV2,
  input: { avoidClaimIds?: string[] } = {},
): OutreachStrategy | null {
  const avoid = new Set(input.avoidClaimIds || []);
  const ranked = rankOutreachEvidence(context).filter(
    (item) => !item.evidence.supportedFactClaimIds.some((claimId) => avoid.has(claimId)),
  );
  const primary = ranked[0];
  if (!primary) return null;
  const primaryClaimId = primary.evidence.supportedFactClaimIds[0]!;
  const supporting = ranked.find(
    (item) => item.evidence.evidenceId !== primary.evidence.evidenceId
      && !item.evidence.supportedFactClaimIds.includes(primaryClaimId),
  ) || null;
  const capabilityMatch = capabilityForFact(context, primary.evidence.statement);
  const capability = capabilityMatch.label;
  const proofPoint = text(context.seller.proofPoints[0] || '') || null;
  const exploratory = primary.score < 0.4 || !capabilityMatch.matched || !capability;
  const role = text(context.person.title);
  const angle = exploratory
    ? 'No hay un puente sólido entre la evidencia y la oferta: plantea una aplicación concreta como pregunta exploratoria, sin afirmar necesidades.'
    : `Conecta ${role ? `el rol (${role})` : 'al contacto'} con ${capability || 'la oferta'} a partir del hecho seleccionado.`;
  return {
    version: 'outreach-strategy/v1',
    primaryFact: {
      evidenceId: primary.evidence.evidenceId,
      claimId: primaryClaimId,
      statement: primary.evidence.statement,
    },
    supportingFact: supporting ? {
      evidenceId: supporting.evidence.evidenceId,
      claimId: supporting.evidence.supportedFactClaimIds[0]!,
      statement: supporting.evidence.statement,
    } : null,
    capability,
    proofPoint,
    angle,
    exploratory,
    warnings: [
      ...context.warnings.slice(0, 5),
      'El cargo no confirma problemas, presupuesto, proveedores ni intención de compra.',
    ],
  };
}
