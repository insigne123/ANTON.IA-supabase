import { z } from 'zod';

import {
  MessagingPreflightV1Schema,
  canonicalSha256,
  type MessagingPreflightV1,
} from '@/lib/messaging-contracts';
import type { DraftContextV2 } from '@/lib/server/draft-context-v2';

export const DRAFT_PREFLIGHT_V2_VERSION = 'native-draft-preflight/v2';

export const DraftPersonalizationProvenanceV2Schema = z.object({
  evidenceId: z.string().trim().min(1).max(256),
  claimId: z.string().trim().min(1).max(256),
  sourceUrl: z.string().trim().min(1).max(2_048),
}).strict();
export type DraftPersonalizationProvenanceV2 = z.infer<typeof DraftPersonalizationProvenanceV2Schema>;

export const GeneratedOutreachV2Schema = z.object({
  subject: z.string(),
  body: z.string(),
  personalization: z.array(DraftPersonalizationProvenanceV2Schema).max(3),
  hypothesisIds: z.array(z.string().trim().min(1).max(256)).max(2).default([]),
}).strict();
export type GeneratedOutreachV2 = z.infer<typeof GeneratedOutreachV2Schema>;

export type DraftPreflightIssueV2 = {
  code:
    | 'subject_length'
    | 'body_length'
    | 'body_structure'
    | 'commercial_relevance'
    | 'abstract_language'
    | 'unresolved_placeholder'
    | 'prohibited_phrase'
    | 'cta_count'
    | 'duplicate_content'
    | 'duplicate_sentence'
    | 'personalization_missing'
    | 'personalization_invalid'
    | 'source_url_invalid'
    | 'hypothesis_invalid'
    | 'hypothesis_unqualified';
  message: string;
  location: 'subject' | 'body' | 'research';
};

export type DraftPreflightV2Result = {
  valid: boolean;
  issues: DraftPreflightIssueV2[];
  preflight: MessagingPreflightV1;
  contentFingerprint: string;
};

export type ValidateDraftPreflightV2Options = {
  existingContentFingerprints?: Iterable<string>;
  now?: Date;
};

export function requiredDraftPersonalizationV2(context: DraftContextV2): DraftPersonalizationProvenanceV2[] {
  const candidates = context.evidence.flatMap((evidence) =>
    evidence.supportedFactClaimIds.map((claimId) => ({
      evidenceId: evidence.evidenceId,
      claimId,
      sourceUrl: evidence.source.url,
      subjectScope: evidence.subjectScope,
      confidence: evidence.confidence,
    })),
  );
  candidates.sort((left, right) => {
    if (left.subjectScope !== right.subjectScope) return left.subjectScope === 'company' ? -1 : 1;
    if (left.confidence !== right.confidence) return right.confidence - left.confidence;
    return `${left.evidenceId}:${left.claimId}`.localeCompare(`${right.evidenceId}:${right.claimId}`);
  });
  return candidates.slice(0, context.constraints.minimumEvidenceProvenance).map(({ evidenceId, claimId, sourceUrl }) => ({
    evidenceId,
    claimId,
    sourceUrl,
  }));
}

function text(value: unknown) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeForMatch(value: unknown) {
  return text(value)
    .toLocaleLowerCase('es')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const personalizationBoilerplate = /\b(?:ir al contenido|profile picture|email & phone number|facebook-f|linkedin-in|instagram|tiktok|youtube|search)\b|\.{3}/i;

export function draftEvidencePersonalizationStatementV2(value: unknown) {
  const statement = text(value);
  const conditionalClause = /,\s*(?:si\b|siempre que\b|aunque\b|cuando\b|porque\b|mientras\b|salvo\b|excepto\b|a menos que\b)/i.test(statement);
  const focusedListItem = statement.includes(',') && hasEnumerationCue(statement) && !conditionalClause
    ? statement
      .split(',')
      .map(text)
      .find((candidate) => {
        const words = wordCount(candidate);
        return candidate.length >= 24
          && candidate.length <= 120
          && words >= 4
          && words <= 16
          && !personalizationBoilerplate.test(candidate);
      })
    : undefined;
  if (focusedListItem) return focusedListItem;
  if (statement.length <= 180 && !personalizationBoilerplate.test(statement)) return statement;
  const excerpt = statement
    .split(/(?:[.!?;]\s+|\|)/)
    .map(text)
    .find((candidate) => {
      const words = candidate.match(/[\p{L}\p{N}]+/gu)?.length || 0;
      return candidate.length >= 24
        && candidate.length <= 180
        && words >= 4
        && words <= 28
        && !personalizationBoilerplate.test(candidate);
    });
  return excerpt || statement;
}

function countOccurrences(value: string, phrase: string) {
  if (!phrase) return 0;
  let count = 0;
  let index = value.indexOf(phrase);
  while (index !== -1) {
    count += 1;
    index = value.indexOf(phrase, index + phrase.length);
  }
  return count;
}

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function normalizedUrl(value: string) {
  try {
    return new URL(value).toString();
  } catch {
    return '';
  }
}

function hasPlaceholder(value: string) {
  return /\{\{[^}]+\}\}|\[\[[^\]]+\]\]|\[(?:su |tu |your |company|lead|sender|nombre|empresa)[^\]]*\]|%(?:first_?name|last_?name|company|lead|sender)%|<(?:first_?name|last_?name|company|lead|sender)>/i.test(value)
    || /\[[A-Z][A-Z0-9_. -]{1,80}\]/.test(value);
}

function wordCount(value: string) {
  return value.match(/[\p{L}\p{N}]+/gu)?.length || 0;
}

function bodyParagraphs(value: string) {
  return String(value || '')
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map(text)
    .filter(Boolean);
}

function sentenceParts(value: string) {
  return value
    .split(/(?<=[.!?])\s+|\n{2,}/)
    .map((item) => text(item))
    .filter(Boolean);
}

const draftCtaCue = /\b(?:agenda(?:mos|r)?|agend(?:amos|ar)?|coordina(?:mos|r)?\s+(?:una\s+)?(?:reunion|reunión|llamada|call|cita)|conversemos|conversar|hablemos|hablar|reunion|reunión|llamada|call|calendly|calendar|te parece|te sirve|podemos (?:hablar|conversar|coordinar)|responde|disponibilidad)\b/i;
const commercialActionCue = /\b(?:ayud\w*|automat\w*|orden\w*|reun\w*|encontr\w*|respond\w*|actualiz\w*|dej\w*|part\w*|trabaj\w*)\b/i;
const commercialOutcomeCue = /\b(?:para\s+\p{L}|podr[ií]a|quiz[aá]s|si\b|cuando\b|as[ií]|sin\s+\p{L})/iu;
const abstractCommercialLanguage = /\b(?:no\s+(?:quiero|quisiera|busco)\s+asumir|sin\s+asumir|explorar\s+si|prioridades?\s+(?:actuales|comerciales)|(?:ese|este|un)\s+relato|relato\s+comercial|narrativa\s+comercial|mensajes?\s+comerciales?)\b/i;

function isUnapprovedDraftCtaSentence(sentence: string) {
  return draftCtaCue.test(sentence) || /[¿?]/.test(sentence);
}

export function stripUnapprovedDraftCtasV2(body: string, approvedCta: string) {
  const withoutApprovedCta = approvedCta ? body.split(approvedCta).join(' ') : body;
  return withoutApprovedCta
    .split(/\n{2,}/)
    .map((paragraph) => sentenceParts(paragraph)
      .filter((sentence) => !isUnapprovedDraftCtaSentence(sentence))
      .join(' '))
    .map(text)
    .filter(Boolean)
    .join('\n\n');
}

function ctaSentenceCount(body: string) {
  return sentenceParts(body).filter((sentence) => draftCtaCue.test(sentence)).length;
}

const personalizationStopWords = new Set([
  'actualidad', 'ademas', 'ayuda', 'ayudan', 'como', 'comunica', 'desde', 'donde', 'empresa',
  'equipos', 'esta', 'este', 'estos', 'figura', 'hacia', 'para', 'publica', 'sobre', 'tiene',
  'trabajo', 'una', 'unas', 'uno', 'unos',
]);

function materialPersonalizationTerms(value: string) {
  return normalizeForMatch(value)
    .split(' ')
    .map((term) => term.replace(/(?:es|os|as|s)$/u, ''))
    .filter((term) => term.length >= 4 && !personalizationStopWords.has(term));
}

function hasEnumerationCue(value: string) {
  const separatorCount = (value.match(/[,;]/g) || []).length;
  return separatorCount >= 2
    || /[,;]\s+[^.!?]+\b(?:y|e|o)\b/i.test(value);
}

function hasGroundedPersonalization(
  context: DraftContextV2,
  personalization: DraftPersonalizationProvenanceV2[],
  content: string,
) {
  const evidenceById = new Map(context.evidence.map((evidence) => [evidence.evidenceId, evidence]));
  const normalizedContent = normalizeForMatch(content);
  return personalization.every((item) => {
    const statement = draftEvidencePersonalizationStatementV2(
      evidenceById.get(item.evidenceId)?.statement || '',
    );
    const materialTerms = [...new Set(materialPersonalizationTerms(statement))];
    const matchedTerms = materialTerms.filter((term) => normalizedContent.includes(term));
    // A faithful paraphrase often changes verbs and nouns. Two material terms
    // still bind the copy to the selected evidence without requiring verbatim text.
    const minimumMatches = Math.min(2, materialTerms.length);
    return Boolean(statement && minimumMatches > 0 && matchedTerms.length >= minimumMatches);
  });
}

function hasCataloguedPersonalization(
  context: DraftContextV2,
  personalization: DraftPersonalizationProvenanceV2[],
  body: string,
) {
  return Boolean(cataloguedPersonalizationSentence(context, personalization, body));
}

function cataloguedPersonalizationSentence(
  context: DraftContextV2,
  personalization: DraftPersonalizationProvenanceV2[],
  body: string,
) {
  const evidenceById = new Map(context.evidence.map((evidence) => [evidence.evidenceId, evidence]));
  const sentences = sentenceParts(body);
  for (const item of personalization) {
    const statement = text(evidenceById.get(item.evidenceId)?.statement || '');
    const materialTerms = [...new Set(materialPersonalizationTerms(statement))];
    if (materialTerms.length < 7) continue;
    const sentence = sentences.find((candidate) => hasEnumerationCue(candidate) && (
      materialTerms.filter((term) => normalizeForMatch(candidate).includes(term)).length >= 5
    ));
    if (sentence) return { sentence, materialTerms };
  }
  return null;
}

export function repairCataloguedDraftPersonalizationV2(
  context: DraftContextV2,
  outputInput: GeneratedOutreachV2,
) {
  const output = GeneratedOutreachV2Schema.parse(outputInput);
  let body = output.body;

  for (let attempt = 0; attempt < output.personalization.length; attempt += 1) {
    const catalogued = cataloguedPersonalizationSentence(context, output.personalization, body);
    if (!catalogued) break;
    const separatorIndexes = [...new Set([
      ...[...catalogued.sentence.matchAll(/[,;]/g)].map((match) => match.index),
      ...[...catalogued.sentence.matchAll(/\s+(?:y|e|o)\s+/gi)].map((match) => match.index),
    ])].sort((left, right) => Number(left) - Number(right));
    const replacements = separatorIndexes.flatMap((index) => {
      if (index === undefined) return [];
      const candidate = text(catalogued.sentence.slice(0, index)).replace(/[,:;.!?]+$/g, '');
      const normalizedCandidate = normalizeForMatch(candidate);
      const matchedTerms = catalogued.materialTerms.filter((term) => normalizedCandidate.includes(term));
      const endsWithConnector = /\b(?:a|con|de|del|e|el|en|la|las|los|o|para|por|un|una|y)$/i.test(candidate);
      return wordCount(candidate) >= 5
        && matchedTerms.length >= 2
        && !endsWithConnector
        && !hasEnumerationCue(candidate)
        ? [`${candidate}.`]
        : [];
    });
    const replacement = replacements.find((candidate) => (
      wordCount(body.replace(catalogued.sentence, candidate)) >= context.constraints.body.minWords
    )) || replacements[0];
    if (!replacement || replacement === catalogued.sentence) break;
    body = body.replace(catalogued.sentence, replacement);
  }

  return GeneratedOutreachV2Schema.parse({ ...output, body });
}

function commercialOfferParagraph(body: string, approvedCta: string) {
  const paragraphs = bodyParagraphs(approvedCta ? body.split(approvedCta).join(' ') : body);
  return paragraphs[paragraphs.length - 1] || '';
}

const sellerOfferStopWords = new Set([
  'ayuda', 'ayudamos', 'clientes', 'empresa', 'empresas', 'equipo', 'equipos', 'informacion',
  'negocio', 'para', 'producto', 'productos',
  'resultado', 'resultados', 'servicio', 'servicios', 'solucion', 'soluciones', 'tarea', 'tareas',
  'trabajo', 'valor',
]);

function sellerOfferTerms(context: DraftContextV2) {
  const values = [
    context.seller.valueProposition,
    ...context.seller.services,
    ...context.seller.proofPoints,
  ];
  return [...new Set(values.flatMap((value) => normalizeForMatch(value).split(' ')))]
    .filter((term) => term.length >= 5 && !sellerOfferStopWords.has(term));
}

function relatedCommercialTerm(left: string, right: string) {
  if (left === right) return true;
  const prefixLength = Math.min(left.length, right.length, 8);
  return prefixLength >= 7 && left.slice(0, prefixLength) === right.slice(0, prefixLength);
}

function isGroundedInSellerOffer(context: DraftContextV2, offerParagraph: string) {
  const declaredTerms = sellerOfferTerms(context);
  if (declaredTerms.length === 0) return false;
  const outputTerms = normalizeForMatch(offerParagraph).split(' ').filter((term) => term.length >= 5);
  return declaredTerms.some((declared) => outputTerms.some((output) => relatedCommercialTerm(declared, output)));
}

function isGroundedInTargetEvidence(context: DraftContextV2, offerParagraph: string) {
  const outputTerms = new Set(materialPersonalizationTerms(offerParagraph));
  return context.evidence.some((evidence) => materialPersonalizationTerms(
    draftEvidencePersonalizationStatementV2(evidence.statement),
  ).some((term) => outputTerms.has(term)));
}

function hasCommercialRelevance(context: DraftContextV2, body: string, approvedCta: string) {
  const sellerName = normalizeForMatch(context.seller.companyName);
  const offerParagraph = commercialOfferParagraph(body, approvedCta);
  const normalizedOffer = normalizeForMatch(offerParagraph);
  const sellerMentioned = !sellerName
    || sellerName === normalizeForMatch('Mi empresa')
    || normalizedOffer.includes(sellerName);
  return sellerMentioned
    && commercialActionCue.test(offerParagraph)
    && commercialOutcomeCue.test(offerParagraph)
    && isGroundedInSellerOffer(context, offerParagraph)
    && isGroundedInTargetEvidence(context, offerParagraph);
}

function containsHypothesisHedge(body: string) {
  return /\b(?:podria|podría|explorar|posible|posiblemente|quizas|quizás|tal vez|parece|sin asumir)\b/i.test(body);
}

function hasAbsoluteHypothesisLanguage(body: string) {
  return /\b(?:sabemos que|necesitan|requieren|requiere|estan buscando|están buscando|seguro que)\b/i.test(body);
}

function meaningfulTitle(value: unknown) {
  const normalized = normalizeForMatch(value);
  return normalized.length >= 6 && normalized.split(' ').length >= 2 ? normalized : '';
}

function contactTitles(context: DraftContextV2) {
  return [...new Set([
    meaningfulTitle(context.person.title),
    meaningfulTitle(context.seller.jobTitle),
  ].filter(Boolean))];
}

function duplicateSentence(body: string) {
  const seen = new Set<string>();
  for (const sentence of sentenceParts(body)) {
    const normalized = normalizeForMatch(sentence);
    if (normalized.length < 16) continue;
    if (seen.has(normalized)) return true;
    seen.add(normalized);
  }
  return false;
}

export function draftContentFingerprintV2(subject: string, body: string) {
  return canonicalSha256({
    subject: normalizeForMatch(subject),
    body: normalizeForMatch(body),
  });
}

export function createFailedDraftPreflightV2(
  errors: string[],
  warnings: string[] = [],
  now: Date = new Date(),
): MessagingPreflightV1 {
  return MessagingPreflightV1Schema.parse({
    status: 'failed',
    checkedAt: now.toISOString(),
    errors: errors.map(text).filter(Boolean).slice(0, 100),
    warnings: warnings.map(text).filter(Boolean).slice(0, 100),
  });
}

export function validateDraftPreflightV2(
  context: DraftContextV2,
  outputInput: GeneratedOutreachV2,
  options: ValidateDraftPreflightV2Options = {},
): DraftPreflightV2Result {
  const output = GeneratedOutreachV2Schema.parse(outputInput);
  const subject = text(output.subject);
  const rawBody = String(output.body || '').trim();
  const body = text(output.body);
  const issues: DraftPreflightIssueV2[] = [];
  const add = (code: DraftPreflightIssueV2['code'], message: string, location: DraftPreflightIssueV2['location']) => {
    issues.push({ code, message, location });
  };
  const contentFingerprint = draftContentFingerprintV2(subject, body);

  if (subject.length < context.constraints.subject.minCharacters || subject.length > context.constraints.subject.maxCharacters) {
    add('subject_length', `El asunto debe tener entre ${context.constraints.subject.minCharacters} y ${context.constraints.subject.maxCharacters} caracteres.`, 'subject');
  }
  const words = wordCount(body);
  if (words < context.constraints.body.minWords || words > context.constraints.body.maxWords) {
    add('body_length', `El cuerpo debe tener entre ${context.constraints.body.minWords} y ${context.constraints.body.maxWords} palabras.`, 'body');
  }
  if (bodyParagraphs(rawBody).length < 4) {
    add('body_structure', 'El correo debe separar el saludo, dos párrafos útiles y el CTA con líneas en blanco.', 'body');
  }
  if (hasPlaceholder(subject) || hasPlaceholder(body)) {
    add('unresolved_placeholder', 'El correo contiene placeholders sin resolver.', 'body');
  }

  const normalizedContent = normalizeForMatch(`${subject} ${body}`);
  for (const phrase of context.constraints.prohibitedPhrases) {
    const normalizedPhrase = normalizeForMatch(phrase);
    if (normalizedPhrase && normalizedContent.includes(normalizedPhrase)) {
      add('prohibited_phrase', `El correo contiene una frase prohibida: ${phrase}.`, 'body');
    }
  }
  for (const title of contactTitles(context)) {
    if (normalizedContent.includes(title)) {
      add('prohibited_phrase', 'El correo no debe repetir literalmente el cargo formal del contacto o del remitente.', 'body');
    }
  }

  const requiredCta = text(context.constraints.cta.exactText);
  const requiredCtaCount = countOccurrences(body, requiredCta);
  const bodyOutsideRequiredCta = requiredCta
    ? body.split(requiredCta).join(' ')
    : body;
  const hasExtraQuestion = /[¿?]/.test(bodyOutsideRequiredCta);
  if (
    requiredCtaCount !== context.constraints.cta.maximumCount
    || ctaSentenceCount(bodyOutsideRequiredCta) > 0
    || hasExtraQuestion
  ) {
    add('cta_count', 'El correo debe incluir exactamente un CTA y usar el CTA aprobado para este estilo.', 'body');
  }

  if (!hasCommercialRelevance(context, rawBody, requiredCta)) {
    add('commercial_relevance', 'El último párrafo útil debe conectar una capacidad declarada en el perfil con una acción concreta y una consecuencia práctica.', 'body');
  }
  if (abstractCommercialLanguage.test(bodyOutsideRequiredCta)) {
    add('abstract_language', 'El correo usa lenguaje meta o abstracto en lugar de explicar una acción comercial concreta.', 'body');
  }

  const existingFingerprints = new Set(options.existingContentFingerprints || []);
  if (existingFingerprints.has(contentFingerprint)) {
    add('duplicate_content', 'El asunto y cuerpo duplican un borrador existente para este destinatario.', 'body');
  }
  if (duplicateSentence(body)) {
    add('duplicate_sentence', 'El cuerpo repite una misma oración.', 'body');
  }

  const evidenceById = new Map(context.evidence.map((evidence) => [evidence.evidenceId, evidence]));
  const seenProvenance = new Set<string>();
  if (output.personalization.length < context.constraints.minimumEvidenceProvenance) {
    add('personalization_missing', 'El correo no declara evidencia verificable para su personalización.', 'research');
  }
  for (const provenance of output.personalization) {
    const key = `${provenance.evidenceId}:${provenance.claimId}`;
    if (seenProvenance.has(key)) {
      add('personalization_invalid', 'La evidencia de personalización está duplicada.', 'research');
      continue;
    }
    seenProvenance.add(key);
    const evidence = evidenceById.get(provenance.evidenceId);
    if (!evidence || !evidence.supportedFactClaimIds.includes(provenance.claimId)) {
      add('personalization_invalid', 'La personalización debe referenciar un claim factual respaldado por evidencia.', 'research');
      continue;
    }
    if (!isHttpUrl(provenance.sourceUrl) || normalizedUrl(provenance.sourceUrl) !== normalizedUrl(evidence.source.url)) {
      add('source_url_invalid', 'La URL de fuente no coincide con la evidencia declarada.', 'research');
    }
  }
  if (output.personalization.length > 0 && !hasGroundedPersonalization(context, output.personalization, `${subject} ${body}`)) {
    add('personalization_invalid', 'La personalización debe conservar los conceptos materiales de la evidencia seleccionada.', 'body');
  }
  if (output.personalization.length > 0 && hasCataloguedPersonalization(context, output.personalization, body)) {
    add('personalization_invalid', 'La personalización enumera la fuente como una ficha; debe usar solo uno o dos detalles en lenguaje natural.', 'body');
  }

  const hypothesesById = new Map(context.hypotheses.map((hypothesis) => [hypothesis.claimId, hypothesis]));
  if (new Set(output.hypothesisIds).size !== output.hypothesisIds.length || output.hypothesisIds.some((id) => !hypothesesById.has(id))) {
    add('hypothesis_invalid', 'El correo declara una hipótesis fuera del contexto de investigación.', 'research');
  }
  if (output.hypothesisIds.length > 0 && (!containsHypothesisHedge(body) || hasAbsoluteHypothesisLanguage(body))) {
    add('hypothesis_unqualified', 'Las hipótesis deben mantenerse explícitamente como posibilidades, no como hechos.', 'body');
  }

  const warnings = context.warnings.slice(0, 100);
  const preflight = issues.length === 0
    ? MessagingPreflightV1Schema.parse({
      status: 'passed',
      checkedAt: (options.now || new Date()).toISOString(),
      errors: [],
      warnings,
    })
    : createFailedDraftPreflightV2(issues.map((issue) => issue.message), warnings, options.now || new Date());
  return {
    valid: issues.length === 0,
    issues,
    preflight,
    contentFingerprint,
  };
}
