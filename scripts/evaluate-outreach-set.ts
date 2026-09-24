// Línea base de calidad de borradores. Sin escrituras en BD, sin aprobaciones, sin envíos.
// Uso: node --loader ./scripts/ts-test-loader.mjs scripts/evaluate-outreach-set.ts
// Requiere OPENAI_API_KEY en el ambiente. Guarda resultados en el dir temporal.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateOutreachFromDraftContextV2 } from '../src/ai/flows/generate-outreach-from-report';
import { generateReconnectionMessage } from '../src/ai/flows/generate-reconnection-message';
import {
  buildDraftContextV2,
  createDefaultDraftWritingStyleV2,
  normalizeDraftSellerProfileV2,
} from '../src/lib/server/draft-context-v2';
import {
  draftSnapshotFixture,
} from '../src/lib/server/draft-v2-test-fixtures';
import { canonicalSha256 } from '../src/lib/messaging-contracts';
import {
  buildSharedSequenceBrief,
  RESEARCH_SEQUENCE_STEPS,
} from '../src/lib/outreach-sequence-brief';
import { validateDraftPreflightV2 } from '../src/lib/server/draft-preflight-v2';
import { OUTREACH_OPENING_KINDS } from '../src/lib/outreach-example-library';

if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY required');

const setPath = new URL('./fixtures/outreach-eval-set.json', import.meta.url);
const evalSet = JSON.parse(readFileSync(setPath, 'utf8'));
const outDir = join(
  'C:\\Users\\nicol\\AppData\\Local\\Temp\\opencode',
  'outreach-eval',
  new Date().toISOString().replace(/[:.]/g, '-'),
);
mkdirSync(outDir, { recursive: true });

const seller = normalizeDraftSellerProfileV2({
  name: evalSet.seller.name,
  jobTitle: evalSet.seller.jobTitle,
  companyName: evalSet.seller.companyName,
  services: evalSet.seller.services,
  valueProposition: evalSet.seller.valueProposition,
  description: evalSet.seller.description,
});

function buildSnapshot(evalCase: any) {
  const snapshot: any = draftSnapshotFixture({ includeRole: Boolean(evalCase.destinatario.cargo) });
  const dest = evalCase.destinatario;
  const ascii = (value: string) => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '.').replace(/^\.+|\.+$/g, '').toLocaleLowerCase('en');
  snapshot.subject.email = dest.nombre
    ? `${ascii(dest.nombre)}@${dest.dominio}`
    : `contacto@${dest.dominio}`;
  snapshot.subject.person = dest.nombre ? { fullName: dest.nombre } : {};
  if (dest.cargo) snapshot.subject.person.title = dest.cargo;
  snapshot.subject.company = { name: dest.empresa, domain: dest.dominio };
  snapshot.subject.leadRef = evalCase.id;
  snapshot.subject.leadId = evalCase.id;

  const sources: any[] = [];
  const evidence: any[] = [];
  const claims: any[] = [];
  if (evalCase.actividadEmpresa) {
    sources.push({
      id: 'source-empresa', type: 'official_site',
      url: `https://${dest.dominio}`, canonicalUrl: `https://${dest.dominio}`,
      title: dest.empresa, provider: 'eval', retrievedAt: '2026-09-20T12:00:00.000Z', reliability: 0.85,
    });
    evidence.push({
      id: 'evidence-empresa', subjectScope: 'company', kind: 'fact', path: 'eval.company',
      statement: evalCase.actividadEmpresa, sourceId: 'source-empresa',
      extractedAt: '2026-9-20T12:00:00.000Z'.replace('-9-', '-09-'),
      confidence: 0.8, extraction: { method: 'rule', provider: 'eval', version: 'eval/v1' },
    });
    claims.push({
      id: 'claim-empresa-overview', kind: 'company_overview', subjectScope: 'company',
      classification: 'fact', statement: evalCase.actividadEmpresa,
      supportingEvidenceIds: ['evidence-empresa'], contradictingEvidenceIds: [],
      confidence: 0.8,
      freshness: { asOf: '2026-09-20T12:00:00.000Z', validUntil: '2026-10-20T12:00:00.000Z', policyVersion: 'research-freshness/v1' },
      derivation: { method: 'rule', promptVersion: 'eval/v1' },
    });
  }
  if (evalCase.senal) {
    sources.push({
      id: 'source-senal', type: 'news',
      url: `https://${dest.dominio}/noticias`, canonicalUrl: `https://${dest.dominio}/noticias`,
      title: `${dest.empresa} señal`, provider: 'eval', retrievedAt: '2026-09-20T12:00:00.000Z', reliability: 0.8,
    });
    evidence.push({
      id: 'evidence-senal', subjectScope: 'company', kind: 'fact', path: 'eval.signal',
      statement: `${evalCase.senal.hecho} (${evalCase.senal.fuente}, ${evalCase.senal.fecha}).`,
      sourceId: 'source-senal', extractedAt: '2026-09-20T12:00:00.000Z',
      confidence: 0.8, extraction: { method: 'rule', provider: 'eval', version: 'eval/v1' },
    });
    claims.push({
      id: 'claim-senal', kind: 'company_overview', subjectScope: 'company',
      classification: 'fact', statement: evalCase.senal.hecho,
      supportingEvidenceIds: ['evidence-senal'], contradictingEvidenceIds: [],
      confidence: 0.78,
      freshness: { asOf: '2026-09-20T12:00:00.000Z', validUntil: '2026-10-20T12:00:00.000Z', policyVersion: 'research-freshness/v1' },
      derivation: { method: 'rule', promptVersion: 'eval/v1' },
    });
  }
  if (dest.cargo) {
    sources.push({
      id: 'source-rol', type: 'linkedin',
      url: `https://www.linkedin.com/in/eval-${evalCase.id}`, canonicalUrl: `https://www.linkedin.com/in/eval-${evalCase.id}`,
      title: dest.nombre || dest.cargo, provider: 'eval', retrievedAt: '2026-09-20T12:00:00.000Z', reliability: 0.75,
    });
    evidence.push({
      id: 'evidence-rol', subjectScope: 'person', kind: 'profile_field', path: 'eval.person',
      statement: `${dest.nombre || 'El contacto'} figura como ${dest.cargo} en ${dest.empresa}.`,
      sourceId: 'source-rol', extractedAt: '2026-09-20T12:00:00.000Z',
      confidence: 0.75, extraction: { method: 'rule', provider: 'eval', version: 'eval/v1' },
    });
    claims.push({
      id: 'claim-rol', kind: 'lead_role', subjectScope: 'person',
      classification: 'fact', statement: `${dest.nombre || 'El contacto'} ocupa el cargo de ${dest.cargo}.`,
      supportingEvidenceIds: ['evidence-rol'], contradictingEvidenceIds: [],
      confidence: 0.75,
      freshness: { asOf: '2026-09-20T12:00:00.000Z', validUntil: '2026-10-20T12:00:00.000Z', policyVersion: 'research-freshness/v1' },
      derivation: { method: 'rule', promptVersion: 'eval/v1' },
    });
  }
  snapshot.sources = sources;
  snapshot.evidence = evidence;
  snapshot.claims = claims;
  return snapshot;
}

function wordCount(value: string) {
  return value.match(/[\p{L}\p{N}]+/gu)?.length || 0;
}

function firstWords(body: string, n = 6) {
  const lines = body.split('\n').map((line) => line.trim()).filter(Boolean);
  const noGreeting = lines.length > 1 && /^hola\b/i.test(lines[0]) ? lines.slice(1) : lines;
  return (noGreeting[0] || '').split(/\s+/).slice(0, n).join(' ').toLocaleLowerCase('es');
}

function trigrams(text: string) {
  const words = (text.toLocaleLowerCase('es').match(/[\p{L}\p{N}]+/gu) || []);
  const set = new Set<string>();
  for (let i = 0; i + 2 < words.length; i++) set.add(words.slice(i, i + 3).join(' '));
  return set;
}

// Imita el loop productivo (native-drafts): 1 generación + 1 reintento
// correctivo Luna con los errores del preflight. Devuelve el resultado final.
async function generateWithRetry(
  baseArgs: Record<string, unknown>,
  validate: (candidate: { subject: string; body: string; personalization: unknown; hypothesisIds: unknown }) => { validation: { valid: boolean; issues: Array<{ message: string }>; preflight: { warnings: string[] } }; body: string },
  onUsage: (usage: { inputTokens: number; outputTokens: number }) => void,
) {
  let output = await generateOutreachFromDraftContextV2(baseArgs as never);
  onUsage(output.usage);
  let checked = validate({ subject: output.subject, body: output.body, personalization: output.personalization, hypothesisIds: output.hypothesisIds });
  if (checked.validation.valid) return { output, validation: checked.validation, body: checked.body, attempts: 1, recovered: false };
  const retry = await generateOutreachFromDraftContextV2({
    ...baseArgs,
    rewrite: {
      previous: { subject: output.subject, body: output.body, personalization: output.personalization, hypothesisIds: output.hypothesisIds },
      errors: checked.validation.issues.map((issue) => issue.message),
    },
  } as never);
  onUsage(retry.usage);
  checked = validate({ subject: retry.subject, body: retry.body, personalization: retry.personalization, hypothesisIds: retry.hypothesisIds });
  return { output: retry, validation: checked.validation, body: checked.body, attempts: 2, recovered: checked.validation.valid };
}

const results: any[] = [];
let inputTokens = 0;
let outputTokens = 0;
let startedAt = Date.now();

for (const evalCase of evalSet.cases) {
  const tratamiento = evalCase.tratamiento === 'usted'
    ? 'Usa tratamiento de usted en todo el correo (usted, le, su). Nunca tutees.'
    : null;
  // Rota el tipo de apertura entre casos para medir variedad real.
  const openingKind = evalCase.type === 'frio'
    ? OUTREACH_OPENING_KINDS[results.length % OUTREACH_OPENING_KINDS.length]
    : undefined;
  try {
    if (evalCase.type === 'reconexion') {
      const recon = evalCase.reconexion;
      const out = await generateReconnectionMessage({
        brief: {
          offerName: recon.oferta,
          offerSummary: recon.oferta,
          audienceHint: evalCase.destinatario.cargo,
          cta: 'Proponer una llamada breve',
          tone: tratamiento ? 'formal, de usted' : 'directo y cercano',
        },
        lead: { name: evalCase.destinatario.nombre, company: evalCase.destinatario.empresa, title: evalCase.destinatario.cargo },
        report: { actividad: evalCase.actividadEmpresa },
        senderProfile: { name: seller.name, jobTitle: seller.jobTitle, companyName: seller.companyName },
        step: { name: 'Reconexión', offsetDays: 0, stepIndex: 0, totalSteps: 1 },
        interaction: { lastContactAt: recon.ultimoContacto, daysSinceLastContact: recon.diasDesdeContacto, matchReason: recon.ultimoContacto },
      });
      results.push({ id: evalCase.id, type: evalCase.type, subject: out.subject, body: out.bodyHtml, words: wordCount(out.bodyHtml.replace(/<[^>]+>/g, ' ')), preflight: null });
      continue;
    }

    const snapshot = buildSnapshot(evalCase);
    const built = buildDraftContextV2({
      snapshot,
      artifact: { contentHash: canonicalSha256(snapshot), capturedAt: '2026-09-20T12:00:00.000Z' },
      seller,
      style: createDefaultDraftWritingStyleV2(),
      now: new Date(),
    });
    if (built.status !== 'ready') {
      results.push({ id: evalCase.id, type: evalCase.type, blocked: built.reason, message: built.message });
      continue;
    }
    const context = built.context;
    if (!evalCase.destinatario.nombre) context.recipient.displayName = null;

    const objecionInstruction = evalCase.objecion
      ? `Esto es una RESPUESTA breve al mensaje del destinatario (no un correo frío): "${evalCase.objecion}". Responde en el mismo hilo con una sola idea y una sola pregunta fácil.`
      : undefined;
    const requestExtras = evalCase.objecion ? { userInstruction: [tratamiento, objecionInstruction].filter(Boolean).join(' ') } : tratamiento ? { userInstruction: tratamiento } : {};

    if (evalCase.type === 'secuencia') {
      const brief = buildSharedSequenceBrief(context);
      const priorMessages: any[] = [];
      const steps: any[] = [];
      for (let index = 0; index < 4; index++) {
        const step = RESEARCH_SEQUENCE_STEPS[index - 1];
        const baseArgs = {
          context, sharedSequenceBrief: brief, ...requestExtras,
          ...(index === 0 && openingKind ? { openingKind } : {}),
          ...(index ? { sequenceContext: { sequenceInstruction: 'Desarrolla el mismo tema comercial.', priorMessages: [...priorMessages], currentStep: { index, total: 3, ...step } } } : {}),
        };
        const policy = index === 0 ? {} : index === 3 ? { expectedCtaCount: 0 as const } : { expectedCtaCount: 'model' as const };
        const tried = await generateWithRetry(
          baseArgs,
          (candidate) => {
            const candidateBody = index === 0 ? `${candidate.body}\n\n${context.constraints.cta.exactText}` : candidate.body;
            const validation = validateDraftPreflightV2(
              context,
              { subject: candidate.subject, body: candidateBody, personalization: candidate.personalization as never, hypothesisIds: candidate.hypothesisIds as never },
              { checkGeneratedCopy: true, checkHumanTone: true, ...policy },
            );
            return { validation, body: candidateBody };
          },
          (usage) => { inputTokens += usage.inputTokens; outputTokens += usage.outputTokens; },
        );
        const { output, validation, body, attempts, recovered } = tried;
        steps.push({
          step: index, subject: output.subject, body, model: output.model,
          words: wordCount(body), subjectWords: wordCount(output.subject),
          valid: validation.valid, attempts, recovered,
          issues: validation.issues.map((issue: any) => issue.message),
          warnings: validation.preflight.warnings,
        });
        priorMessages.push({ kind: index ? 'follow_up' : 'initial', index, name: step?.name || 'Inicial', subject: output.subject, body });
      }
      results.push({ id: evalCase.id, type: evalCase.type, openingKind, steps });
      continue;
    }

    const tried = await generateWithRetry(
      { context, ...requestExtras, ...(openingKind ? { openingKind } : {}) },
      (candidate) => {
        const candidateBody = `${candidate.body}\n\n${context.constraints.cta.exactText}`;
        const validation = validateDraftPreflightV2(
          context,
          { subject: candidate.subject, body: candidateBody, personalization: candidate.personalization as never, hypothesisIds: candidate.hypothesisIds as never },
          { checkGeneratedCopy: true, checkHumanTone: true },
        );
        return { validation, body: candidateBody };
      },
      (usage) => { inputTokens += usage.inputTokens; outputTokens += usage.outputTokens; },
    );
    const { output, validation, body, attempts, recovered } = tried;
    results.push({
      id: evalCase.id, type: evalCase.type, openingKind, subject: output.subject, body, model: output.model,
      words: wordCount(body), subjectWords: wordCount(output.subject),
      valid: validation.valid, attempts, recovered,
      issues: validation.issues.map((issue: any) => issue.message),
      warnings: validation.preflight.warnings,
    });
  } catch (error) {
    results.push({ id: evalCase.id, type: evalCase.type, error: String(error).slice(0, 300) });
  }
}

const elapsedMs = Date.now() - startedAt;
// Métricas de lote
const flatBodies = results.flatMap((result) => result.steps ? result.steps.map((step: any) => step.body) : result.body ? [result.body] : []);
const openings = new Map<string, string[]>();
for (const result of results) {
  const bodies = result.steps ? result.steps.map((step: any) => step.body) : result.body ? [result.body] : [];
  bodies.forEach((body: string, stepIndex: number) => {
    const key = firstWords(body);
    const list = openings.get(key) || [];
    list.push(`${result.id}${result.steps ? `#${stepIndex}` : ''}`);
    openings.set(key, list);
  });
}
const repeatedOpenings = [...openings.entries()].filter(([, ids]) => ids.length > 1);
const sets = flatBodies.map(trigrams);
const similarPairs: Array<[string, string, number]> = [];
const labels = results.flatMap((result) => result.steps ? result.steps.map((_: any, stepIndex: number) => `${result.id}#${stepIndex}`) : [result.id]);
for (let i = 0; i < sets.length; i++) {
  for (let j = i + 1; j < sets.length; j++) {
    const a = sets[i]!;
    const b = sets[j]!;
    if (!a.size || !b.size) continue;
    const shared = [...a].filter((t) => b.has(t)).length;
    const sim = shared / (a.size + b.size - shared);
    if (sim >= 0.35) similarPairs.push([labels[i]!, labels[j]!, Math.round(sim * 100) / 100]);
  }
}
const validated = results.filter((r) => typeof r.valid === 'boolean');
const stepsAll = results.flatMap((r) => r.steps || []);
const allGenerations = [...validated, ...stepsAll];
const summary = {
  generatedAt: new Date().toISOString(),
  promptVersion: (await import('../src/lib/native-draft-version')).NATIVE_DRAFT_PROMPT_VERSION,
  cases: results.length,
  blocked: results.filter((r) => r.blocked).length,
  errors: results.filter((r) => r.error).length,
  initialValid: validated.filter((r) => r.valid).length,
  initialTotal: validated.length,
  sequenceStepsValid: stepsAll.filter((s: any) => s.valid).length,
  sequenceStepsTotal: stepsAll.length,
  firstAttemptValid: allGenerations.filter((r: any) => r.attempts === 1 && r.valid).length,
  recoveredByRetry: allGenerations.filter((r: any) => r.recovered).length,
  totalGenerations: allGenerations.length,
  repeatedOpenings: repeatedOpenings.map(([opening, ids]) => ({ opening, ids })),
  similarPairs,
  usage: { inputTokens, outputTokens, costUsd: Math.round((inputTokens * 0.10 + outputTokens * 0.50) / 1_000_000 * 10000) / 10000 },
  elapsedMs,
};

writeFileSync(join(outDir, 'results.json'), JSON.stringify({ summary, results }, null, 2));

let md = `# Muestras de borradores (${summary.promptVersion})\n\n`;
md += `Casos: ${summary.cases} · Válidos finales: ${summary.initialValid}/${summary.initialTotal} iniciales, ${summary.sequenceStepsValid}/${summary.sequenceStepsTotal} pasos · 1er intento OK: ${summary.firstAttemptValid}/${summary.totalGenerations} · Recuperados por reintento: ${summary.recoveredByRetry} · Costo aprox: $${summary.usage.costUsd}\n\n`;
md += `## Cómo puntuar (1–5): suena_humano · especificidad · un_solo_pedido · tono_tratamiento · veracidad. Anota también la frase más artificial.\n\n`;
for (const result of results) {
  md += `---\n\n## ${result.id} (${result.type})\n\n`;
  if (result.blocked) { md += `BLOQUEADO: ${result.blocked} — ${result.message}\n\n`; continue; }
  if (result.error) { md += `ERROR: ${result.error}\n\n`; continue; }
  if (result.steps) {
    for (const step of result.steps) {
      md += `### Paso ${step.step} — preflight: ${step.valid ? 'OK' : 'FALLA'}${step.attempts > 1 ? ` (intentos: ${step.attempts}${step.recovered ? ', recuperado' : ''})` : ''} · ${step.words} palabras · asunto ${step.subjectWords}\n\n**Asunto:** ${step.subject}\n\n${step.body}\n\n`;
      if (!step.valid) md += `Problemas: ${step.issues.join(' | ')}\n\n`;
      if (step.warnings?.length) md += `Avisos: ${step.warnings.slice(0, 4).join(' | ')}\n\n`;
    }
    continue;
  }
  md += `Preflight: ${result.preflight === null ? 'N/A (reconexión)' : result.valid ? 'OK' : 'FALLA'}${result.attempts > 1 ? ` (intentos: ${result.attempts}${result.recovered ? ', recuperado' : ''})` : ''} · ${result.words} palabras · asunto ${result.subjectWords ?? '—'}\n\n**Asunto:** ${result.subject}\n\n${result.body}\n\n`;
  if (result.valid === false) md += `Problemas: ${result.issues.join(' | ')}\n\n`;
  if (result.warnings?.length) md += `Avisos: ${result.warnings.slice(0, 4).join(' | ')}\n\n`;
}
writeFileSync(join(outDir, 'muestras.md'), md);
console.log(JSON.stringify(summary, null, 2));
console.log(`\nArchivos en: ${outDir}`);
