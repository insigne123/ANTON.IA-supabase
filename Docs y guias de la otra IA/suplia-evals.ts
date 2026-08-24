/* =====================================================================
   suplia-evals.ts  —  Fase 2: evals propios de SUPL.IA (sin costo, CI-friendly)
   Mide calidad de copy e intención sin llamar a modelos (deterministas).
   Va en: src/lib/suplia/suplia-evals.ts
   Úsalo en tests o en un script: alimenta los outputs reales de los tools.
   ===================================================================== */
import { classifySupliaIntent, type SupliaConversationIntent } from '@/lib/suplia/intent';

export type EvalIssue = string;

const BANNED_PHRASES = ['garantizamos', '100% seguro', 'sin riesgo', 'mejor del mundo', 'oferta unica', 'compra ahora'];

/** Reglas de calidad de un correo en frío. Devuelve la lista de problemas (vacía = OK). */
export function assertCopyQuality(subject: string, body: string): EvalIssue[] {
  const issues: EvalIssue[] = [];
  const subj = String(subject || '').trim();
  const subjWords = subj ? subj.split(/\s+/).filter(Boolean).length : 0;
  if (subjWords < 3 || subjWords > 9) issues.push(`Asunto fuera de rango (3-9 palabras): tiene ${subjWords}`);
  if (/[A-ZÁÉÍÓÚÑ]{5,}/.test(subj)) issues.push('Asunto con MAYUSCULAS gritonas');

  const bodyText = String(body || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const bodyWords = bodyText ? bodyText.split(/\s+/).filter(Boolean).length : 0;
  if (bodyWords < 15) issues.push(`Cuerpo demasiado corto (${bodyWords} palabras)`);
  if (bodyWords > 130) issues.push(`Cuerpo demasiado largo (${bodyWords} palabras)`);

  const hasCta = /\?|reun|15 min|llamada|conversemos|te muestro|agendar|coordinar|revisar|vemos/i.test(bodyText);
  if (!hasCta) issues.push('Sin CTA claro');

  const haystack = `${subj} ${bodyText}`.toLowerCase();
  const banned = BANNED_PHRASES.filter((b) => haystack.includes(b));
  if (banned.length) issues.push(`Frases prohibidas: ${banned.join(', ')}`);

  return issues;
}

export type CopySample = { subject?: string; textBody?: string; bodyHtml?: string };

/** Corre las reglas sobre un lote de previews/borradores (ej. salida de email.bulk_variant_preview). */
export function evalCopySamples(samples: CopySample[]) {
  const results = (samples || []).map((s) => ({
    subject: s.subject || '',
    issues: assertCopyQuality(s.subject || '', s.textBody || s.bodyHtml || ''),
  }));
  const passed = results.filter((r) => r.issues.length === 0).length;
  return {
    total: results.length,
    passed,
    passRate: results.length ? Math.round((passed / results.length) * 100) : 0,
    failing: results.filter((r) => r.issues.length > 0),
  };
}

/** Set dorado para la clasificación de intención (mejóralo con casos reales). */
export const INTENT_GOLDEN: Array<{ message: string; expected: SupliaConversationIntent }> = [
  { message: 'hola', expected: 'smalltalk' },
  { message: 'que puedes hacer?', expected: 'capabilities' },
  { message: 'busca empresas de seguridad y contacta a recursos humanos', expected: 'job_workflow' },
  { message: 'redacta un correo para constructoras grandes', expected: 'artifact_create' },
  { message: 'hazlo mas corto', expected: 'artifact_update' },
  { message: 'cuanto es 2+2', expected: 'out_of_scope' },
  { message: 'envia la campana a todos los contactados', expected: 'pending_action' },
];

/** Evalúa el clasificador regex contra el set dorado (offline). */
export function evalIntentRegex(golden: typeof INTENT_GOLDEN = INTENT_GOLDEN) {
  const results = golden.map((g) => {
    const got = classifySupliaIntent(g.message).intent;
    return { message: g.message, expected: g.expected, got, ok: got === g.expected };
  });
  const passed = results.filter((r) => r.ok).length;
  return {
    total: results.length,
    passed,
    accuracy: results.length ? Math.round((passed / results.length) * 100) : 0,
    misses: results.filter((r) => !r.ok),
  };
}

/** Sanity del scoring: dado un scorer, una mejor empresa debe puntuar más que una peor. */
export function evalScoringMonotonic(
  scoreOf: (company: Record<string, unknown>) => number,
  better: Record<string, unknown>,
  worse: Record<string, unknown>,
): { ok: boolean; better: number; worse: number } {
  const b = scoreOf(better);
  const w = scoreOf(worse);
  return { ok: b > w, better: b, worse: w };
}
