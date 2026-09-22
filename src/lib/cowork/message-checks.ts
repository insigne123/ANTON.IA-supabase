/** Deterministic message checks. Never invents coverage, authority or evidence:
 * it reports matches against supplied context and research observations. */

export type MessagingContext = {
  prohibitedTerms?: string[] | null;
  requiredTerms?: string[] | null;
  approvedClaims?: Array<{ claim?: string | null; evidence?: string | null }> | null;
} | null;

const normalize = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
function containsTerm(haystack: string, term: string) {
  const needle = normalize(term.trim());
  if (!needle) return false;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?:$|[^\\p{L}\\p{N}])`, 'u').test(normalize(haystack));
}

export function checkMessageTerms(text: string, context: MessagingContext) {
  const prohibited = (context?.prohibitedTerms || []).filter(term => containsTerm(text, term));
  const required = context?.requiredTerms || [];
  const requiredPresent = required.filter(term => containsTerm(text, term));
  const requiredMissing = required.filter(term => !requiredPresent.includes(term));
  const conflicting = prohibited.filter(term => required.includes(term));
  const hasRules = (context?.prohibitedTerms?.length || 0) + (context?.requiredTerms?.length || 0) > 0;
  return {
    prohibitedFound: prohibited,
    requiredMissing,
    requiredConfigured: required.length,
    conflictingTerms: conflicting,
    verdict: prohibited.length ? 'blocked' as const
      : conflicting.length ? 'blocked' as const
      : requiredMissing.length ? 'fail' as const
      : !hasRules ? 'unconfigured' as const : 'pass' as const,
    notice: !hasRules
      ? 'Sin términos configurados: este chequeo no valida nada. Configura el contexto antes de confiar en él.'
      : 'Coincidencia literal insensible a acentos y mayúsculas. No detecta paráfrasis ni ironía.',
  };
}

const ASSERTION_PATTERNS: Array<{ id: string; pattern: RegExp; label: string }> = [
  { id: 'number', pattern: /\d+(\s?[.,]\s?\d+)*\s?(%|por\s?ciento|millones|mil|veces|x\b)/i, label: 'Cifra o porcentaje' },
  { id: 'quantity', pattern: /\b\d[\d\s.,]*\s?(personas?|minutos?|horas?|d[íi]as?|correos?|reuniones?|empresas?|clientes?|casos?)\b/i, label: 'Cantidad concreta' },
  { id: 'comparative', pattern: /m[áa]s\s+(barat|rapid|r[áa]pid|buen|mejor|eficient|econ[óo]mic)|mejor\s+precio|misma\s+funci[óo]n|hace\s+lo\s+mismo/i, label: 'Comparación con alternativas' },
  { id: 'guarantee', pattern: /garantiz|asegura.*resultado|100\s?%|sin\s+riesgo/i, label: 'Garantía de resultado' },
  { id: 'launch', pattern: /lanzam(?:os|iento)|pr[óo]ximamente|nuevo\s+(m[óo]dulo|funci[óo]n)|roadmap/i, label: 'Lanzamiento o cobertura futura' },
];

export function extractDraftAssertions(subject: string | null, text: string) {
  const body = `${subject || ''}\n${text}`;
  return ASSERTION_PATTERNS
    .map(({ id, label, pattern }) => {
      pattern.lastIndex = 0;
      const match = pattern.exec(body);
      if (!match || match.index === undefined) return null;
      const start = Math.max(0, match.index - 60);
      return { id, label, excerpt: body.slice(start, match.index + match[0].length + 60).replace(/\s+/g, ' ').trim().slice(0, 280) };
    })
    .filter((item): item is { id: string; label: string; excerpt: string } => item !== null);
}

export type ResearchClaim = { statement?: string | null; evidence?: string[] | null };
export function pairAssertionsWithEvidence(assertions: Array<{ id: string; label: string; excerpt: string }>,
  claims: ResearchClaim[], approvedClaims: Array<{ claim?: string | null; evidence?: string | null }>) {
  return assertions.map(assertion => ({
    ...assertion,
    status: 'needs_human_judgment' as const,
    researchClaimsObserved: claims.length,
    approvedClaimsObserved: approvedClaims.length,
    notice: 'Vincula este fragmento a una evidencia observada (investigación o afirmación aprobada con su evidencia) o retíralo. Sin vínculo explícito no puede aprobarse el envío.',
  }));
}
