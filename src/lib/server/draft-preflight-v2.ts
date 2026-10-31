import { z } from 'zod';

import {
  MessagingPreflightV1Schema,
  canonicalSha256,
  type MessagingPreflightV1,
} from '@/lib/messaging-contracts';
import { DRAFT_STYLE_ADVISORIES, isDatedEventEvidence, isSignalLikeEvidence, requiredReportAwareDraftPersonalizationV2, type DraftContextV2 } from '@/lib/server/draft-context-v2';
import { checkHumanTone } from '@/lib/server/human-tone-checks';
import { EDITED_EMAIL_BODY_WORDS } from '@/lib/drafts/email-length';

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
    | 'corporate_copy'
    | 'unresolved_placeholder'
    | 'prohibited_phrase'
    | 'cta_count'
    | 'duplicate_content'
    | 'duplicate_sentence'
    | 'personalization_missing'
    | 'personalization_invalid'
    | 'source_url_invalid'
    | 'hypothesis_invalid'
    | 'unsupported_material_claim'
    | 'hypothesis_unqualified'
    | 'tone_muletilla'
    | 'tone_formato'
    | 'tone_asunto'
    | 'tone_tratamiento'
    | 'tone_pregunta'
    | 'tone_ficha'
    | 'tone_fragmento';
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
  // Editorial repair applies to model output, not to user-authored edits or approval.
  checkGeneratedCopy?: boolean;
  existingContentFingerprints?: Iterable<string>;
  now?: Date;
  // The closing step ends the sequence with a direct breakup: the server
  // appends no CTA and the model must not write a meeting ask either, but a
  // single direct yes-or-no question is the close itself. Follow-up steps
  // ('model') write their own single closing question with the configured
  // minutes instead of repeating the approved text verbatim.
  expectedCtaCount?: 0 | 1 | 'model';
  // Chequeos de tono humano (muletillas, formato, asunto, tratamiento,
  // ficha corporativa). Solo para texto del modelo, nunca ediciones del
  // usuario: el llamador los activa junto a checkGeneratedCopy.
  checkHumanTone?: boolean;
  // The corrective retry: what only asks for a better opening (a ficha without a dated fact) is a notice there, so the draft is still created.
  retryAttempt?: boolean;
  // The version is the person's own edit (generation_method 'human'): its length is a notice inside
  // EDITED_EMAIL_BODY_WORDS, not an error (src/lib/drafts/email-length.ts), and so are its closing and its use of the research (PERSON_DECIDES).
  editedByPerson?: boolean;
};

export function requiredDraftPersonalizationV2(context: DraftContextV2): DraftPersonalizationProvenanceV2[] {
  const candidates = context.evidence.flatMap((evidence) =>
    evidence.supportedFactClaimIds.map((claimId) => ({
      evidenceId: evidence.evidenceId,
      claimId,
      sourceUrl: evidence.source.url,
      subjectScope: evidence.subjectScope,
      confidence: evidence.confidence,
      signalLike: isSignalLikeEvidence(evidence.statement),
    })),
  );
  candidates.sort((left, right) => {
    if (left.subjectScope !== right.subjectScope) return left.subjectScope === 'company' ? -1 : 1;
    if (left.signalLike !== right.signalLike) return left.signalLike ? -1 : 1;
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

/** What the seller's profile says about itself: the only lines a sentence about the seller may rest its figures on. */
export function draftSellerStatementsV2(seller: DraftContextV2['seller']) {
  return [
    seller.valueProposition,
    ...seller.services,
    ...seller.proofPoints,
    ...(seller.differentiators || []),
    ...(seller.referenceClients || []),
  ].filter((statement): statement is string => Boolean(statement));
}

const LEGAL_FORM = /\b(?:s ?p ?a|s ?a ?s?|s ?r ?l|ltda|limitada|inc|llc|gmbh|corp)\b/g;

/** The names a sentence can use to speak as the seller without the legal form of its company: «Yago SpA» → «yago», and the product a service line opens with («AXIS: consultas…» → «axis»). */
function sellerSpeakingNames(seller: DraftContextV2['seller']) {
  const names = new Set<string>();
  const company = normalizeForMatch(seller.companyName).replace(LEGAL_FORM, ' ').replace(/\s+/g, ' ').trim();
  if (company.length >= 3) names.add(company);
  for (const service of seller.services) {
    const product = text(service).match(/^(\p{Lu}[\p{L}\p{N}]*(?:\s\p{Lu}[\p{L}\p{N}]*)?)\s*[:–—-]\s/u)?.[1];
    const name = product ? normalizeForMatch(product) : '';
    if (name.length >= 3) names.add(name);
  }
  return [...names];
}

const personalizationBoilerplate = /\b(?:ir al contenido|profile picture|email & phone number|facebook-f|linkedin-in|instagram|tiktok|youtube|search)\b|\.{3}/i;

/**
 * The statement the writer is given to rest the email on, and the grounding check to look for. A list of services is narrowed to one of its items, so
 * the email does not recite a catalogue; with `keepSpecifics` (a context built with DRAFT_ANCHOR_SPECIFICS_ENABLED: `context.writing`) a fact that
 * names its datum after a comma keeps everything up to it (see statementThroughFirstDatum). It never reads the environment: the prompt and the
 * preflight pass the same option, taken from the context.
 */
// A clause that only introduces the fact («De acuerdo a los lineamientos de la Ley 21.015, contamos con un Programa de Inclusión Laboral…»):
// narrowed to it, the anchor asked for «acuerdo» and «lineamientos» and the draft about the programme was turned back (real research, 30 Oct 2026).
const INTRODUCTORY_CLAUSE = /^(?:de acuerdo (?:a|con)|seg[uú]n|conforme a|en el marco de|con el (?:fin|objetivo|prop[oó]sito) de|a trav[eé]s de|adem[aá]s|asimismo|por (?:eso|ello|lo tanto))\b/i;

export function draftEvidencePersonalizationStatementV2(value: unknown, options: { keepSpecifics?: boolean } = {}) {
  const statement = text(value);
  const conditionalClause = /,\s*(?:si\b|siempre que\b|aunque\b|cuando\b|porque\b|mientras\b|salvo\b|excepto\b|a menos que\b)/i.test(statement);
  const narrowable = statement.includes(',') && hasEnumerationCue(statement) && !conditionalClause;
  const throughDatum = narrowable && options.keepSpecifics ? statementThroughFirstDatum(statement) : undefined;
  if (throughDatum) return throughDatum;
  const focusedListItem = narrowable
    ? statement
      .split(',')
      .map(text)
      .find((candidate) => {
        const words = wordCount(candidate);
        return candidate.length >= 24
          && candidate.length <= 120
          && words >= 4
          && words <= 16
          && !personalizationBoilerplate.test(candidate)
          && !INTRODUCTORY_CLAUSE.test(candidate);
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

// Names that every statement about a Chilean company carries, and that say nothing about this one.
const GENERIC_PROPER_NAME = /^(?:chile|chilen[oa]s?)$/;

const startsSentence = (before: string) => /(?:^|[.!?:¿¡\n])[\s«"“'(\[—-]*$/u.test(before);

/** A figure, or a capitalised word that does not open its sentence: the region, the position or the number an email can be about. */
function isConcreteWord(word: string, sentenceStart: boolean) {
  if (GENERIC_PROPER_NAME.test(normalizeForMatch(word))) return false;
  return /\d/.test(word) || (word.length >= 4 && !sentenceStart && /^\p{Lu}/u.test(word));
}

/**
 * «Enaex mantiene vacantes abiertas en el norte de Chile, principalmente en las regiones de Antofagasta y Atacama, para conductores, técnicos…» is
 * narrowed to its first item as a list, «Enaex mantiene vacantes abiertas en el norte de Chile», and the regions never reach the writer, nor the
 * grounding check: the email says «vacantes en el norte», which fits any company that hires. When the first concrete datum comes after a comma, the
 * statement keeps everything up to the item that has it, if that stays short enough to be one detail. Otherwise the usual narrowing applies.
 */
function statementThroughFirstDatum(statement: string) {
  const datum = [...statement.matchAll(/[\p{L}\p{N}]+/gu)].find((match) => isConcreteWord(match[0], startsSentence(statement.slice(0, match.index ?? 0))));
  if (!datum || datum.index === undefined) return undefined;
  if (!statement.slice(0, datum.index).includes(',')) return undefined; // the first item has it: the usual narrowing keeps it
  const end = statement.indexOf(',', datum.index);
  const through = text(end === -1 ? statement : statement.slice(0, end));
  return through.length <= 160 && wordCount(through) <= 24 && !personalizationBoilerplate.test(through) ? through : undefined;
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

// «Soy <nombre>, de <empresa>;» or «.»: how the writer introduces itself since native-draft/v24.
const SELF_INTRODUCTION = /^\s*soy\s+[^,;.]{1,40},\s+de\s+[^,;.]{1,60}[;,]\s*/i;

/** Whether the fact the writer must rest the email on (REQUIRED_FACTUAL_PERSONALIZATION) is a dated event of the company. */
/** Words the evidence writes capitalised inside a sentence: names a subject may keep capitalised («Plan Minero Conjunto», «Temuco»). */
function evidenceNames(context: DraftContextV2) {
  return [...new Set(context.evidence.flatMap((evidence) => [...String(evidence.statement || '').matchAll(/(?<=[\p{L}\p{N},;:)] )\p{Lu}\p{L}{2,}/gu)]
    .map((match) => match[0])))].slice(0, 300);
}

export function anchoredOnDatedEvent(context: DraftContextV2) {
  const required = new Set(requiredReportAwareDraftPersonalizationV2(context).map((item) => item.evidenceId));
  return context.evidence.some((item) => required.has(item.evidenceId) && isDatedEventEvidence(item.statement));
}

function sentenceParts(value: string) {
  return value
    .split(/(?<=[.!?])\s+|\n{2,}/)
    .map((item) => text(item))
    .filter(Boolean);
}

const draftCtaCue = /\b(?:agenda(?:mos|r)?|agend(?:amos|ar)?|coordina(?:mos|r)?\s+(?:una\s+)?(?:reunion|reunión|llamada|call|cita)|conversemos|conversar|hablemos|hablar|reunion|reunión|llamada|call|calendly|calendar|te parece|te sirve|podemos (?:hablar|conversar|coordinar)|responde|disponibilidad)\b/i;
const commercialOutcomeCue = /\b(?:para\s+\p{L}|podr[ií]a|quiz[aá]s|si\b|cuando\b|as[ií]|sin\s+\p{L})/iu;
const meetingLinkCue = /\b(?:https?:\/\/|www\.|calendly|calendar|cal\.com|meet\.|zoom\.|teams\.)/i;
// A follow-up may close with an easy question about how they do it today instead of another meeting ask
// («¿Hoy esas consultas las hace alguien del equipo una por una?»). Only a meeting ask must carry the minutes.
const meetingAskCue = /\b(?:convers\w*|llam\w*|reuni\w*|minutos?|agend\w*|junt[oa]s|juntarnos|semana|videollamad\w*|telefon\w*|habl(?:emos|amos|ar)|vernos|veamos|coordinemos)\b/;

// Meeting length configured by the user in their approved CTA (e.g. "15 minutos").
// Follow-up steps restate it in their own words instead of repeating the exact text.
export function draftCtaMinutes(approvedCta: string) {
  const nearMinutes = String(approvedCta || '').match(/(\d{1,3})\s*min/i);
  if (nearMinutes) return nearMinutes[1];
  return null;
}
const abstractCommercialLanguage = /\b(?:no\s+(?:quiero|quisiera|busco)\s+asumir|sin\s+asumir|explorar\s+si|prioridades?\s+(?:actuales|comerciales)|(?:ese|este|un)\s+relato|relato\s+comercial|narrativa\s+comercial|mensajes?\s+comerciales?)\b/i;

// Reviewed commercial wording is advisory only. It can appear in a report-backed draft
// and is left for human editing; it never blocks creation by itself.
const editorialPhrases = new Set(DRAFT_STYLE_ADVISORIES.map(normalizeForMatch));

function isUnapprovedDraftCtaSentence(sentence: string) {
  return draftCtaCue.test(sentence) || /[¿?]/.test(sentence);
}

export function stripUnapprovedDraftCtasV2(body: string, approvedCta: string, options: { keepQuestions?: boolean } = {}) {
  const withoutApprovedCta = approvedCta ? body.split(approvedCta).join(' ') : body;
  return withoutApprovedCta
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.split('\n').map((line) => sentenceParts(line)
      .filter((sentence) => options.keepQuestions
        ? !(draftCtaCue.test(sentence) && !/[¿?]/.test(sentence))
        : !isUnapprovedDraftCtaSentence(sentence))
      .join(' ')).filter(Boolean).join('\n'))
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
    // The company's own voice («Contribuimos con las organizaciones…»): no email says it, so the check never asks for it (real research, 30 Oct 2026).
    .filter((word) => !/^\p{L}{4,}(?:amos|emos|imos)$/u.test(word))
    .map((term) => term.replace(/(?:es|os|as|s)$/u, ''))
    .filter((term) => term.length >= 4 && !personalizationStopWords.has(term));
}

// English evidence for a Spanish email (a lender's page on «the construction of Lines 8 and 9»): the email translates it, so the checks
// compare what a translation keeps, the first letters of a word («construction» and «construcción», «Lines» and «Líneas») and the figure
// itself. Asked for the exact words, the writer wrote «apoyo (support) a la construcción (construction)» and the draft was still turned
// back, in production, ten times for the same research (23 Oct 2026).
const ENGLISH_WORDS = /\b(?:the|and|of|to|for|with|by|is|are|will|be|from|which|its|their|as|this|that)\b/g;
const SPANISH_WORDS = /\b(?:de|la|el|los|las|en|y|para|con|por|del|que|se|su|sus|una|un)\b/g;
export function isEnglishStatement(value: unknown) {
  const normalized = normalizeForMatch(value);
  const english = (normalized.match(ENGLISH_WORDS) || []).length;
  return english >= 3 && english > (normalized.match(SPANISH_WORDS) || []).length;
}

// English plurals lose only their «s»: the Spanish stemmer turned «Lines» into «lin» and dropped it, and a follow-up that said
// «la construcción de las nuevas líneas» was turned back for lack of a second term (real research, 30 Oct 2026).
const ENGLISH_FUNCTION_WORDS = new Set(['that', 'this', 'which', 'will', 'with', 'from', 'their', 'have', 'been', 'into', 'well', 'also', 'such', 'other']);
function englishMaterialTerms(value: string) {
  return normalizeForMatch(value).split(' ')
    .map((word) => word.replace(/s$/u, ''))
    .filter((term) => term.length >= 4 && !ENGLISH_FUNCTION_WORDS.has(term) && !personalizationStopWords.has(term));
}

// Words a translation changes past their first letters: «sus filiales del Reino Unido» kept none of «commercial subsidiaries in the United
// Kingdom» by the four-letter rule, and a faithful follow-up was turned back (real research, 31 Oct 2026). English stems, without their
// plural «s», to the beginnings of the Spanish words that translate them.
const ENGLISH_TO_SPANISH: Array<[string, string[]]> = [
  ['subsidiar', ['filial', 'subsidiari']], ['commerc', ['comerc']], ['kingdom', ['reino']], ['united', ['unid']],
  ['netherland', ['holand', 'paises']], ['korea', ['corea']], ['turkey', ['turqu']], ['brazil', ['brasil']], ['japan', ['japon']],
  ['germany', ['aleman']], ['spain', ['espan']], ['england', ['inglat']], ['british', ['britan']], ['world', ['mund']],
  ['south', ['sur']], ['north', ['norte']], ['country', ['pais']], ['countrie', ['pais']], ['support', ['apoy', 'soport']],
  ['project', ['proyect']], ['construct', ['constru', 'obra']], ['build', ['edific', 'constru']], ['line', ['line']],
  ['station', ['estacion']], ['tunnel', ['tunel']], ['railway', ['ferrov', 'tren']], ['road', ['camin', 'carreter', 'vial']],
  ['highway', ['autopist', 'carreter']], ['bridge', ['puente']], ['port', ['puert']], ['airport', ['aeropuert']],
  ['compan', ['empres', 'compan']], ['branch', ['sucursal']], ['office', ['oficin']], ['headquarter', ['sede', 'casa']],
  ['store', ['tienda', 'local']], ['warehouse', ['bodeg', 'almacen', 'centro']], ['fleet', ['flota']], ['truck', ['camion']],
  ['employee', ['trabajador', 'colaborador', 'emplead']], ['worker', ['trabajador', 'operari']], ['people', ['person']],
  ['staff', ['personal', 'dotacion']], ['team', ['equip']], ['hiring', ['contrat']], ['hire', ['contrat']], ['recruit', ['reclut']],
  ['training', ['capacit', 'formac']], ['safety', ['segur']], ['health', ['salud']], ['mining', ['miner', 'mina']], ['mine', ['mina', 'miner']],
  ['copper', ['cobre']], ['garlic', ['ajo']], ['fresh', ['fresc']], ['food', ['aliment']],
  ['market', ['mercad']], ['customer', ['client']], ['sale', ['venta']], ['revenue', ['ingres', 'venta']], ['growth', ['crec']],
  ['grow', ['crec']], ['increase', ['aument', 'crec']], ['loan', ['prestam', 'credit']], ['investment', ['invers']], ['invest', ['invers', 'invert']],
  ['acquisition', ['adquisic', 'compra']], ['acquire', ['adquir', 'compr']], ['merger', ['fusion']], ['agreement', ['acuerd', 'conveni']],
  ['partner', ['alianz', 'soci']], ['award', ['premi', 'adjudic']], ['tender', ['licitac']], ['launch', ['lanz']], ['open', ['abrio', 'abrir', 'abre', 'abier', 'apertur']],
  ['develop', ['desarroll']], ['technology', ['tecnolog']], ['quality', ['calidad']], ['sustainab', ['sostenib', 'sustentab']],
  ['environment', ['ambient', 'medioambient']], ['insurance', ['segur']], ['bank', ['banc']], ['billion', ['millon']],
  ['year', ['ano']], ['month', ['mes']], ['government', ['gobiern']], ['approval', ['aprob']], ['water', ['agua']],
  ['energy', ['energ']], ['wind', ['eolic']], ['school', ['coleg', 'escuel']], ['beverage', ['bebid']], ['retail', ['retail', 'comerci']],
];

/** Whether a Spanish word (or the stem of one) can translate an English material term. */
function translates(english: string, spanish: string) {
  if (english.length >= 4 && spanish.length >= 4 && english.slice(0, 4) === spanish.slice(0, 4)) return true;
  // A short Spanish word («ajo», «sur») only as itself or its plural: «sur» must not answer for «surtido».
  return ENGLISH_TO_SPANISH.some(([stem, beginnings]) => english.startsWith(stem) && beginnings.some((beginning) => (
    beginning.length > 3
      ? spanish.startsWith(beginning)
      : spanish === beginning || spanish === `${beginning}s` || spanish === `${beginning}es`
  )));
}

function termInWords(term: string, words: string[], translated: boolean) {
  return translated ? words.some((word) => translates(term, word)) : words.some((word) => word.startsWith(term));
}

// Anchor terms for the writing prompt: the readable original words behind the
// material terms the grounding check requires. Showing them lets the model hit
// the check on the first attempt instead of paraphrasing them away and paying
// for a full corrective regeneration.
export function personalizationAnchorTerms(statement: string, max = 5): string[] {
  return plainWordsFirst(anchorWords(statement)).slice(0, max).map(({ word }) => word);
}

// The words a company sells itself with, and its verbs, go after its nouns: for «Contribuimos con las organizaciones, comprendiendo y
// potenciando las aptitudes…» the writer was asked for two of «Contribuimos, organizaciones, comprendiendo, potenciando, aptitudes» and wrote
// «potenciando», which the tone check turns back (real research, 30 Oct 2026). Any two material terms still pass the grounding check.
const SALES_WORD = /^(?:\p{L}{3,}(?:amos|emos|imos|ando|iendo|yendo)|potenci\p{L}*|integral(?:es)?|innovador\p{L}*|estrat[ée]gic\p{L}*|l[ií]der\p{L}*|liderazgo|principal(?:es)?|excelencia|calidad|soluci[óo]n(?:es)?|compañ[ií]a|empresa)$/iu;
function plainWordsFirst(words: AnchorWord[]) {
  return [...words.filter((item) => !SALES_WORD.test(item.word)), ...words.filter((item) => SALES_WORD.test(item.word))];
}

type AnchorWord = { word: string; term: string; sentenceStart: boolean; neighbours: string[] };

const pluralStem = (word: string) => normalizeForMatch(word).replace(/(?:es|os|as|s)$/u, '');

/** Every readable word behind a material term, once each, in order of appearance. */
function anchorWords(statement: string): AnchorWord[] {
  const text = String(statement || '');
  const wanted = new Set(materialPersonalizationTerms(text));
  const anchors: AnchorWord[] = [];
  for (const match of text.matchAll(/[\p{L}\p{N}]{4,}/gu)) {
    const word = match[0];
    const term = pluralStem(word);
    if (!wanted.has(term)) continue;
    wanted.delete(term);
    const start = match.index ?? 0;
    const before = text.slice(0, start);
    anchors.push({
      word,
      term,
      sentenceStart: startsSentence(before),
      // The words right next to it (only a space between), as the text wrote them.
      neighbours: [before.match(/([\p{L}\p{N}]+)[ \t]+$/u)?.[1], text.slice(start + word.length).match(/^[ \t]+([\p{L}\p{N}]+)/u)?.[1]].filter((item): item is string => Boolean(item)),
    });
  }
  return anchors;
}

/**
 * The same anchor terms with the concrete datum first (DRAFT_ANCHOR_SPECIFICS_ENABLED). In the order of appearance the five terms of «Enaex mantiene
 * vacantes abiertas en el norte de Chile, principalmente en las regiones de Antofagasta y Atacama, para conductores…» are «Enaex, mantiene, vacantes,
 * abiertas, norte», so the writer, asked for two of them, wrote «vacantes abiertas en el norte» and never the regions: the email passed the grounding
 * check and said nothing that another company's could not. A concrete term is a figure or a capitalised word that is not the first of its sentence nor
 * part of the company's own name («Besalco Construcciones»); at most three come first, the rest keep their order and the company's own words go last.
 */
export function specificAnchorTerms(statement: string, options: { companyName?: string; max?: number } = {}): string[] {
  const max = options.max ?? 5;
  const own = new Set(materialPersonalizationTerms(normalizeForMatch(options.companyName).replace(LEGAL_FORM, ' ')));
  const capitalised = (word: string) => /^\p{Lu}/u.test(word);
  const words = plainWordsFirst(anchorWords(statement));
  const isOwn = (item: AnchorWord) => own.has(item.term)
    || (capitalised(item.word) && item.neighbours.some((neighbour) => capitalised(neighbour) && own.has(pluralStem(neighbour))));
  const isConcrete = (item: AnchorWord) => !isOwn(item) && isConcreteWord(item.word, item.sentenceStart);
  const concrete = words.filter(isConcrete).slice(0, 3);
  const taken = new Set(concrete);
  const rest = words.filter((item) => !taken.has(item) && !isOwn(item));
  return [...concrete, ...rest, ...words.filter(isOwn)].slice(0, max).map(({ word }) => word);
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
  const sentences = sentenceParts(content).map(normalizeForMatch);
  return personalization.every((item) => {
    const fullStatement = evidenceById.get(item.evidenceId)?.statement || '';
    const statement = draftEvidencePersonalizationStatementV2(fullStatement, { keepSpecifics: Boolean(context.writing?.anchorSpecifics) });
    // A faithful paraphrase often changes verbs and nouns. Two material terms
    // still bind the copy to the selected evidence without requiring verbatim text.
    // The language is the evidence's, as the prompt reads it: narrowed to «Acme has commercial subsidiaries in the United Kingdom»
    // the list kept one «the», the statement was read as Spanish, and «sus filiales comerciales del Reino Unido» was turned back (31 Oct 2026).
    const translated = isEnglishStatement(fullStatement) || isEnglishStatement(statement);
    const materialTerms = [...new Set(translated ? englishMaterialTerms(statement) : materialPersonalizationTerms(statement))];
    // A translation keeps the figures as they are («Lines 8 and 9», «Líneas 8 y 9»): for English evidence they count as terms too.
    const figures = translated ? [...new Set(normalizeForMatch(statement).split(' ').filter((word) => /^\d+$/.test(word)))] : [];
    const minimumMatches = Math.min(2, materialTerms.length + figures.length);
    return Boolean(statement && minimumMatches > 0 && sentences.some((sentence) => {
      const words = sentence.split(' ');
      return materialTerms.filter((term) => termInWords(term, words, translated)).length + figures.filter((figure) => words.includes(figure)).length >= minimumMatches;
    }));
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

function contentBlocks(body: string, approvedCta: string) {
  const paragraphs = bodyParagraphs(approvedCta ? body.split(approvedCta).join(' ') : body);
  // Layout: greeting first, then opening and value blocks (prose or bullets).
  return paragraphs.slice(1);
}

function sellerMentionedBlocks(context: DraftContextV2, blocks: string[]) {
  const sellerName = normalizeForMatch(context.seller.companyName);
  if (!sellerName || sellerName === normalizeForMatch('Mi empresa')) return blocks;
  return blocks.filter((block) => {
    const normalized = normalizeForMatch(block);
    return normalized.includes(sellerName)
      || /\b(?:nosotros|nuestro|nuestra|tenemos|contamos|operamos|cubrimos|llevamos|ayudamos|trabajo en)\b/.test(normalized);
  });
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
    ...(context.seller.differentiators || []),
    ...(context.seller.painPoints || []),
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
  return context.evidence.filter((evidence) => evidence.supportedFactClaimIds.length > 0).some((evidence) => materialPersonalizationTerms(
    draftEvidencePersonalizationStatementV2(evidence.statement, { keepSpecifics: Boolean(context.writing?.anchorSpecifics) }),
  ).some((term) => outputTerms.has(term)));
}

function hasCommercialRelevance(context: DraftContextV2, body: string, approvedCta: string) {
  const blocks = contentBlocks(body, approvedCta);
  const content = blocks.join('\n\n');
  // The anchor paragraph legitimately shares evidence terms, so the seller
  // connection must hold inside the blocks that mention the seller. An
  // unrelated offer cannot borrow relevance from the anchor.
  const sellerBlocks = sellerMentionedBlocks(context, blocks);
  if (sellerBlocks.length === 0) return false;
  const sellerText = sellerBlocks.join('\n\n');
  return commercialOutcomeCue.test(content)
    && isGroundedInSellerOffer(context, sellerText)
    && isGroundedInTargetEvidence(context, content);
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

function materialQuantities(sentence: string) {
  return [...sentence.matchAll(/\b\d+(?:[.,]\d+)*(?:[ \t]+(?:mil|millones?)\b)?(?:[ \t]*%|[ \t]+por[ \t]+ciento\b)?/giu)].map((match) => {
    const after = sentence.slice(match.index + match[0].length);
    const percent = /%|por[ \t]+ciento/i.test(match[0]);
    // Bind to a single metric, never arbitrary trailing prose or the next line.
    const following = after.match(percent ? /^[ \t]+(?:de[l]?[ \t]+)?([\p{L}]+)/u : /^[ \t]+([\p{L}]+)/u)?.[1] || '';
    const connector = /^(?:a|al|con|de|del|el|en|es|la|las|los|para|por|que|y|o|e|sin|sobre|and|or|of|the|to|in|for|with|by|from)$/i;
    const preceding = sentence.slice(0, match.index).replace(/(?:\s+(?:en|un|el|de|del))+[ \t]*$/i, '').trim().match(/([\p{L}]+)$/u)?.[1] || '';
    // A year measures nothing: «en el 2017 abrimos la oficina» and «En 2017, DFV abrió…» are the same 2017, not «2017 abrimos» and «2017»
    // (a real research of 31 Oct 2026 was turned back twice for it).
    const year = !percent && /^(?:19|20)\d\d$/.test(match[0]);
    const metric = year ? '' : following && !connector.test(following) ? following : percent ? preceding : '';
    return {
      raw: match[0] + (!year && following && !connector.test(following) ? ` ${following}` : ''),
      key: normalizeForMatch(`${match[0].replace(/%/g, ' por ciento ')} ${metric}`),
      index: match.index,
    };
  });
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

// What the person decides in an email they wrote or edited themselves (generation_method 'human'), said as a notice: how it closes (the
// approved CTA, the one question of a follow-up) and whether it keeps what the research found. On 23 Oct 2026 a person rewrote their first
// email in their own words and approval refused it for both, every time they tried. For what the model writes they stay errors.
const PERSON_DECIDES: Partial<Record<DraftPreflightIssueV2['code'], string>> = {
  cta_count: 'Tu correo no cierra como propone tu estilo (una sola pregunta clara o el CTA aprobado): un cierre así suele responderse más.',
  personalization_invalid: 'Tu correo ya no usa lo que encontró la investigación sobre este contacto: un dato concreto suyo suele responderse más.',
};

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
  const warnings = context.warnings.slice(0, 100);
  const add = (code: DraftPreflightIssueV2['code'], message: string, location: DraftPreflightIssueV2['location']) => {
    const notice = options.editedByPerson ? PERSON_DECIDES[code] : undefined;
    if (notice) {
      if (!warnings.includes(notice)) warnings.push(notice);
      return;
    }
    issues.push({ code, message, location });
  };
  const contentFingerprint = draftContentFingerprintV2(subject, body);

  if (subject.length < context.constraints.subject.minCharacters || subject.length > context.constraints.subject.maxCharacters) {
    add('subject_length', `El asunto debe tener entre ${context.constraints.subject.minCharacters} y ${context.constraints.subject.maxCharacters} caracteres.`, 'subject');
  }
  if (options.checkGeneratedCopy && /^seguimiento\b/i.test(subject)) {
    add('prohibited_phrase', 'El asunto no debe empezar por «Seguimiento». Nombra el tema concreto que aporta este correo.', 'subject');
  }
  const words = wordCount(body);
  const { minWords, maxWords } = context.constraints.body;
  if (words < minWords || words > maxWords) {
    if (options.editedByPerson && words >= EDITED_EMAIL_BODY_WORDS.min && words <= EDITED_EMAIL_BODY_WORDS.max) {
      warnings.push(`El correo tiene ${words} palabras; los correos en frío de ${minWords} a ${maxWords} suelen responderse más.`);
    } else if (options.editedByPerson) {
      add('body_length', `El correo tiene ${words} palabras: para enviarlo, debe tener entre ${EDITED_EMAIL_BODY_WORDS.min} y ${EDITED_EMAIL_BODY_WORDS.max}.`, 'body');
    } else {
      add('body_length', `El cuerpo debe tener entre ${minWords} y ${maxWords} palabras.`, 'body');
    }
  }
  // A first touch is the greeting, the opening, the value and the approved CTA. A step of a sequence has no approved CTA (its own question closes the
  // value), so three paragraphs are its whole structure: asking for four warned about 18 of the 25 drafts written in October 2026.
  if (bodyParagraphs(rawBody).length < ((options.expectedCtaCount ?? 1) === 1 ? 4 : 3)) {
    warnings.push('Revisa la legibilidad: separa el saludo, el contenido útil y el CTA según la plantilla.');
  }
  if (hasPlaceholder(subject) || hasPlaceholder(body)) {
    add('unresolved_placeholder', 'El correo contiene placeholders sin resolver.', 'body');
  }

  const normalizedContent = normalizeForMatch(`${subject} ${body}`);
  for (const phrase of context.constraints.prohibitedPhrases) {
    const normalizedPhrase = normalizeForMatch(phrase);
    if (normalizedPhrase && normalizedContent.includes(normalizedPhrase)) {
      if (editorialPhrases.has(normalizedPhrase)) {
        warnings.push(`Revisa el estilo de esta expresión: ${phrase}.`);
      } else {
        add('prohibited_phrase', `El correo contiene una frase prohibida: ${phrase}.`, 'body');
      }
    }
  }
  for (const phrase of DRAFT_STYLE_ADVISORIES) {
    const normalizedAdvisory = normalizeForMatch(phrase);
    if (normalizedAdvisory && normalizedContent.includes(normalizedAdvisory)) {
      warnings.push(`Revisa el estilo de esta expresión: ${phrase}.`);
    }
  }
  for (const title of contactTitles(context)) {
    if (normalizedContent.includes(title)) {
      warnings.push('Revisa si necesitas repetir literalmente el cargo formal del contacto o del remitente.');
    }
  }

  const requiredCta = text(context.constraints.cta.exactText);
  if (options.checkGeneratedCopy) {
    const blocks = contentBlocks(rawBody, requiredCta);
    const opening = normalizeForMatch(blocks[0] || '')
      .replace(/^(?:vi que|note que|cuando)\s+/, '');
    const company = normalizeForMatch(context.company.name);
    const definition = company && opening.startsWith(`${company} `)
      ? opening.slice(company.length).trim()
      : '';
    if (/^(?:se dedica a|es una empresa|se hace cargo de|puede (?:hacerse cargo de|encargarse de)|is a company|specializes in)\b/.test(definition)) {
      add('corporate_copy', 'La apertura define la empresa del destinatario como una ficha. Integra el hecho en un motivo concreto para escribir; conserva la evidencia sin recitar la descripción corporativa.', 'body');
    }
    const description = normalizeForMatch(context.seller.description);
    if (description.split(' ').length >= 18 && blocks.slice(1).some((block) => normalizeForMatch(block).includes(description))) {
      add('corporate_copy', 'La propuesta copia la descripción del vendedor. Reescribe con una capacidad autorizada aplicada al contexto del contacto, en frases breves; no pegues la presentación corporativa.', 'body');
    }
  }
  const requiredCtaCount = countOccurrences(body, requiredCta);
  const bodyOutsideRequiredCta = requiredCta
    ? body.split(requiredCta).join(' ')
    : body;
  // The model-written closing question is the follow-up CTA: like the approved
  // text, its proposed duration is not a factual claim about the world.
  const modelClosingQuestion = options.expectedCtaCount === 'model'
    ? sentenceParts(bodyOutsideRequiredCta).find((item) => /[¿?]/.test(item)) || ''
    : '';
  const claimCheckBody = modelClosingQuestion
    ? bodyOutsideRequiredCta.split(modelClosingQuestion).join(' ')
    : bodyOutsideRequiredCta;
  // Numbers are checked per sentence and subject, not against a global bag of digits.
  // This is a conservative lexical guard, not a semantic entailment model.
  const citedEvidence = output.personalization.flatMap((item) => context.evidence.filter((evidence) => (
    evidence.evidenceId === item.evidenceId && evidence.supportedFactClaimIds.includes(item.claimId)
  )));
  const sellerStatements = draftSellerStatementsV2(context.seller);
  const sellerNames = sellerSpeakingNames(context.seller);
  const recipientName = normalizeForMatch(context.company.name);
  const materialContent = `${subject}\n\n${requiredCta ? rawBody.split(context.constraints.cta.exactText).join(' ') : rawBody}`;
  const claimCheckContent = modelClosingQuestion ? materialContent.split(modelClosingQuestion).join(' ') : materialContent;
  // Only line-leading ordinal punctuation is formatting. Remaining digits still get checked.
  const materialSentences = claimCheckContent.replace(/^[ \t]*\d+[.)][ \t]+(?=\S)/gm, '').split(/\r?\n/).flatMap(sentenceParts);
  // A standard is said as its source says it: «ISO 45001:2015» passed the figure check because «2015» belongs to «ISO 9001:2015» in the same
  // profile, which certifies «ISO 45001:2018» (a follow-up of real research, 31 Oct 2026).
  const standards = (value: string) => [...value.matchAll(/\bISO\s*(\d{3,5})(?:\s*[:-]\s*((?:19|20)\d\d))?/gi)].map((match) => ({ raw: match[0], number: match[1], year: match[2] || '' }));
  const sourceStandards = standards([...sellerStatements, ...context.evidence.map((evidence) => evidence.statement)].join('\n'));
  for (const standard of standards(claimCheckContent)) {
    const known = sourceStandards.filter((item) => item.number === standard.number);
    if (known.length > 0 && (!standard.year || known.some((item) => item.year === standard.year))) continue;
    const asWritten = [...new Set(known.map((item) => item.raw.replace(/\s+/g, ' ')))];
    add('unsupported_material_claim', asWritten.length > 0
      ? `La norma ${standard.raw} no figura así en el perfil ni en la evidencia: escríbela como figura (${asWritten.join(', ')}).`
      : `La norma ${standard.raw} no figura en el perfil ni en la evidencia: quítala.`, 'body');
  }
  for (const sentence of materialSentences) {
    // The writer introduces itself («Soy Carla, de ServiPro; …»): the clause after the introduction says whose figure it is. Speaking of the
    // recipient («…; la faena de Acme tiene más de 2.000 trabajadores») it rests on the evidence; otherwise it is the seller speaking, as before.
    const afterIntroduction = sentence.replace(SELF_INTRODUCTION, '');
    const introduced = afterIntroduction !== sentence;
    const normalized = normalizeForMatch(afterIntroduction);
    const namesRecipient = Boolean(recipientName) && normalized.includes(recipientName);
    const sellerScoped = normalized.includes(normalizeForMatch(context.seller.companyName))
      || /\b(?:nosotros|nuestro|nuestra|tenemos|contamos|operamos|cubrimos|llevamos)\b/.test(normalized)
      || (introduced && !namesRecipient);
    // A sentence that speaks as the seller without its legal name (the first person of the team, «Procesamos…», the name it goes by, «AXIS
    // procesa…», or its product, «La plataforma reúne más de 30 tests…», turned back in a real follow-up of 31 Oct 2026) may rest on the
    // seller's own lines as well as on the evidence. Never one that names the recipient: that is where a figure of the seller lands on them.
    const speaksAsSeller = !sellerScoped && !namesRecipient
      && (/\b\p{L}{3,}(?:amos|emos)\b/u.test(normalized) || /\b(?:la|el) (?:plataforma|herramienta|software|aplicacion)\b/.test(normalized)
        || sellerNames.some((name) => new RegExp(`(?:^| )${name}(?: |$)`).test(normalized)));
    const evidenceStatements = citedEvidence.map((evidence) => evidence.statement);
    const sources = sellerScoped ? sellerStatements : speaksAsSeller ? [...evidenceStatements, ...sellerStatements] : evidenceStatements;
    // «Para apoyar la construcción de las Líneas 8 y 9, en GrupoExpro hacemos cursos…» (a follow-up, real research of 30 Oct 2026): the
    // figure comes before the seller is named, in a clause about the recipient, so it rests on the evidence; one after it is the seller's.
    const sellerNameAt = normalizeForMatch(context.seller.companyName)
      ? sentence.toLocaleLowerCase('es').indexOf(text(context.seller.companyName).toLocaleLowerCase('es'))
      : -1;
    const recipientClause = (index: number) => sellerScoped && !introduced && sellerNameAt > 0 && index < sellerNameAt
      && !/\b(?:nosotros|nuestro|nuestra|tenemos|contamos|operamos|cubrimos|llevamos)\b/.test(normalizeForMatch(sentence.slice(0, sellerNameAt)));
    const quantities = materialQuantities(sentence);
    for (const quantity of quantities) {
      const quantitySources = recipientClause(quantity.index) ? evidenceStatements : sources;
      const supported = quantitySources.some((source) => {
        const translated = isEnglishStatement(source);
        const figure = (key: string) => key.split(' ')[0];
        if (!materialQuantities(source).some((item) => translated ? figure(item.key) === figure(quantity.key) : item.key === quantity.key)) return false;
        const terms = translated ? englishMaterialTerms(source) : materialPersonalizationTerms(source);
        if (translated) {
          // The figures a translation keeps («Lines 8 and 9», «Líneas 8 y 9») bind it to the subject too.
          const sourceFigures = new Set(normalizeForMatch(source).split(' ').filter((word) => /^\d+$/.test(word)));
          const sharedFigures = new Set(normalizeForMatch(sentence).split(' ').filter((word) => sourceFigures.has(word))).size;
          return materialPersonalizationTerms(sentence).filter((term) => terms.some((english) => translates(english, term))).length + sharedFigures >= 2;
        }
        const termSet = new Set(terms);
        return materialPersonalizationTerms(sentence).filter((term) => termSet.has(term)).length >= 2;
      });
      if (!supported) {
        const start = Math.max(0, quantity.index - 100);
        const excerpt = `${start ? '...' : ''}${sentence.slice(start, start + 240)}${sentence.length > start + 240 ? '...' : ''}`;
        add('unsupported_material_claim', `La cifra o su alcance no están respaldados para este sujeto: ${quantity.raw}. Oración (extracto limitado): ${JSON.stringify(excerpt)}`, 'body');
      }
    }
    for (const evidence of citedEvidence) {
      const terms = materialPersonalizationTerms(evidence.statement);
      const overlap = terms.filter((term) => materialPersonalizationTerms(sentence).includes(term)).length;
      if (sellerScoped || overlap < 2) continue;
      const source = normalizeForMatch(evidence.statement);
      const conditional = /\b(?:planea|prev[eé]|proyecta|siempre que|sujeto a|podria|si obtiene)\b/;
      const negative = /\b(?:no|nunca|sin)\b/;
      if ((conditional.test(source) && !conditional.test(normalized))
        || (negative.test(source) && !negative.test(normalized))) {
        add('unsupported_material_claim', 'La redacción elimina una condición o negación material de la evidencia.', 'body');
      }
    }
  }
  const hasExtraQuestion = /[¿?]/.test(bodyOutsideRequiredCta);
  const expectedCtaCount = options.expectedCtaCount ?? 1;
  if (expectedCtaCount === 'model') {
    if (/(?:última vez|no volver[ée] a escribir|no (?:te )?escribir[ée] (?:más|de nuevo)|cierro (?:el (?:tema|hilo)|por acá)|lo (?:dejo|dejamos) (?:hasta )?aqu[ií])/i.test(bodyOutsideRequiredCta)) {
      add('cta_count', 'Este seguimiento no es el último: elimina la despedida definitiva y termina con una sola propuesta de conversación breve.', 'body');
    }
    const minutes = draftCtaMinutes(context.constraints.cta.exactText);
    const questionCount = (bodyOutsideRequiredCta.match(/\?/g) || []).length;
    const question = sentenceParts(bodyOutsideRequiredCta).find((item) => /[¿?]/.test(item)) || '';
    const normalizedQuestion = normalizeForMatch(question);
    const modelCtaOk = questionCount === 1
      && requiredCtaCount === 0
      && ctaSentenceCount(bodyOutsideRequiredCta) <= 1
      && !meetingLinkCue.test(bodyOutsideRequiredCta)
      && (!minutes || !meetingAskCue.test(normalizedQuestion) || normalizedQuestion.split(' ').includes(minutes));
    if (!modelCtaOk) {
      add('cta_count', minutes
        ? `El seguimiento cierra con una sola pregunta, con tus palabras y sin enlaces: una pregunta fácil sobre cómo lo resuelven hoy, o una conversación breve de ${minutes} minutos. No repitas el CTA aprobado literalmente.`
        : 'El seguimiento cierra con una sola pregunta, con tus palabras y sin enlaces: una pregunta fácil sobre cómo lo resuelven hoy, o una conversación breve.', 'body');
    }
  } else if (expectedCtaCount === 0) {
    const closeQuestionCount = (bodyOutsideRequiredCta.match(/\?/g) || []).length;
    const closeOk = requiredCtaCount === 0
      && ctaSentenceCount(bodyOutsideRequiredCta) === 0
      && closeQuestionCount <= 1
      && !meetingLinkCue.test(bodyOutsideRequiredCta);
    if (!closeOk) {
      add('cta_count', 'El cierre es directo y breve: como máximo una pregunta de sí o no para cerrar el tema, sin pedir reunión, sin enlaces y sin el CTA aprobado.', 'body');
    }
  } else {
    const ctaCountOk = requiredCtaCount === context.constraints.cta.maximumCount;
    if (
      !ctaCountOk
      || ctaSentenceCount(bodyOutsideRequiredCta) > 0
      || hasExtraQuestion
    ) {
      add('cta_count', 'El correo debe incluir exactamente un CTA y usar el CTA aprobado para este estilo.', 'body');
    }
  }

  if (!hasCommercialRelevance(context, rawBody, requiredCta)) {
    warnings.push('Revisa la relevancia comercial: conecta una capacidad declarada en el perfil con una acción concreta y una consecuencia práctica.');
  }
  if (abstractCommercialLanguage.test(bodyOutsideRequiredCta)) {
    warnings.push('El correo usa lenguaje meta o abstracto en lugar de explicar una acción comercial concreta.');
  }

  const existingFingerprints = new Set(options.existingContentFingerprints || []);
  if (existingFingerprints.has(contentFingerprint)) {
    add('duplicate_content', 'El asunto y cuerpo duplican un borrador existente para este destinatario.', 'body');
  }
  if (duplicateSentence(body)) {
    warnings.push('El cuerpo repite una misma oración.');
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
  if (output.personalization.length > 0 && !hasGroundedPersonalization(context, output.personalization, rawBody)) {
    // Production v23, last two weeks: 7 of 8 drafts turned back for this were turned back again, because the retry did not know which words.
    const terms = output.personalization.flatMap((item) => personalizationAnchorTerms(draftEvidencePersonalizationStatementV2(
      evidenceById.get(item.evidenceId)?.statement || '', { keepSpecifics: Boolean(context.writing?.anchorSpecifics) },
    ))).slice(0, 5);
    const englishSource = output.personalization.some((item) => isEnglishStatement(evidenceById.get(item.evidenceId)?.statement || ''));
    add('personalization_invalid', `La personalización debe conservar los conceptos materiales de la evidencia seleccionada${terms.length >= 2 ? `: usa en una misma oración, con tus palabras, dos de estos términos${englishSource ? ', traducidos al español' : ''}: ${terms.join(', ')}` : ''}.`, 'body');
  }
  if (output.personalization.length > 0 && hasCataloguedPersonalization(context, output.personalization, body)) {
    warnings.push('La personalización enumera la fuente como una ficha; usa solo uno o dos detalles en lenguaje natural.');
  }

  const hypothesesById = new Map(context.hypotheses.map((hypothesis) => [hypothesis.claimId, hypothesis]));
  if (new Set(output.hypothesisIds).size !== output.hypothesisIds.length || output.hypothesisIds.some((id) => !hypothesesById.has(id))) {
    add('hypothesis_invalid', 'El correo declara una hipótesis fuera del contexto de investigación.', 'research');
  }
  if (output.hypothesisIds.length > 0 && (!containsHypothesisHedge(body) || hasAbsoluteHypothesisLanguage(body))) {
    add('hypothesis_unqualified', 'Las hipótesis deben mantenerse explícitamente como posibilidades, no como hechos.', 'body');
  }

  if (options.checkHumanTone && options.checkGeneratedCopy) {
    const tone = checkHumanTone({
      subject,
      body: rawBody,
      ctaExactText: context.constraints.cta.exactText,
      recipientFirstName: String(context.recipient.displayName || '').trim().split(/\s+/)[0] || null,
      companyName: context.company.name,
      maxModelQuestions: expectedCtaCount === 1 ? 0 : 1,
      // The fact the email rests on, not any line of the evidence: asked to open with a dated fact it is not anchored on, the writer could not.
      hasSignal: anchoredOnDatedEvent(context),
      finalAttempt: Boolean(options.retryAttempt),
      knownNames: [context.seller.companyName, ...evidenceNames(context)],
      sellerName: context.seller.companyName,
    });
    for (const finding of tone.errors) {
      add(finding.code, finding.message, finding.code === 'tone_asunto' ? 'subject' : 'body');
    }
    for (const finding of tone.warnings) {
      warnings.push(finding.message);
    }
    // El CTA lo configura el usuario en su estilo: si tutea y el correo es de
    // usted (o viceversa), se avisa sin bloquear para no dejar sin salida a
    // quien aún no ajustó su estilo.
    const ustedMark = /\b(usted|le|les|su|sus|consigo)\b/;
    const tuMark = /\b(tu|te|ti|contigo|tienes|puedes|quieres|necesitas|sabes|avisame|cuentame|dime|escribeme|mandame)\b/;
    const modelNorm = normalizeForMatch(bodyOutsideRequiredCta);
    const ctaNorm = normalizeForMatch(requiredCta);
    const bodyUsted = ustedMark.test(modelNorm) && !tuMark.test(modelNorm);
    const bodyTu = tuMark.test(modelNorm) && !ustedMark.test(modelNorm);
    const ctaUsted = ustedMark.test(ctaNorm) && !tuMark.test(ctaNorm);
    const ctaTu = tuMark.test(ctaNorm) && !ustedMark.test(ctaNorm);
    if ((bodyUsted && ctaTu) || (bodyTu && ctaUsted)) {
      warnings.push('El CTA aprobado usa otro tratamiento (tú/usted) que el correo. Ajusta el CTA en tu estilo de escritura para que concuerden.');
    }
  }

  const preflight = issues.length === 0
    ? MessagingPreflightV1Schema.parse({
      status: 'passed',
      checkedAt: (options.now || new Date()).toISOString(),
      errors: [],
      warnings: warnings.slice(0, 100),
    })
    : createFailedDraftPreflightV2(issues.map((issue) => issue.message), warnings, options.now || new Date());
  return {
    valid: issues.length === 0,
    issues,
    preflight,
    contentFingerprint,
  };
}
