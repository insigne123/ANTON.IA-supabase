import { classifySupliaIntent, type SupliaConversationIntent } from '@/lib/suplia/intent';

export type EvalIssue = string;

const BANNED_PHRASES = [
  'garantizamos',
  '100% seguro',
  'sin riesgo',
  'mejor del mundo',
  'oferta unica',
  'compra ahora',
];

export function assertCopyQuality(subject: string, body: string): EvalIssue[] {
  const issues: EvalIssue[] = [];
  const cleanSubject = String(subject || '').trim();
  const subjectWords = cleanSubject ? cleanSubject.split(/\s+/).filter(Boolean).length : 0;

  if (subjectWords < 3 || subjectWords > 9) issues.push(`Asunto fuera de rango (3-9 palabras): ${subjectWords}`);
  if (/[A-ZÁÉÍÓÚÑ]{5,}/.test(cleanSubject)) issues.push('Asunto con mayusculas gritonas');

  const bodyText = String(body || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const bodyWords = bodyText ? bodyText.split(/\s+/).filter(Boolean).length : 0;

  if (bodyWords < 15) issues.push(`Cuerpo demasiado corto: ${bodyWords} palabras`);
  if (bodyWords > 130) issues.push(`Cuerpo demasiado largo: ${bodyWords} palabras`);

  const hasCta = /\?|reun|15 min|llamada|conversemos|te muestro|agendar|coordinar|revisar|vemos/i.test(bodyText);
  if (!hasCta) issues.push('Sin CTA claro');

  const haystack = `${cleanSubject} ${bodyText}`.toLowerCase();
  const banned = BANNED_PHRASES.filter((phrase) => haystack.includes(phrase));
  if (banned.length > 0) issues.push(`Frases prohibidas: ${banned.join(', ')}`);

  return issues;
}

export type CopySample = {
  subject?: string;
  textBody?: string;
  bodyHtml?: string;
};

export function evalCopySamples(samples: CopySample[]) {
  const results = (samples || []).map((sample) => ({
    subject: sample.subject || '',
    issues: assertCopyQuality(sample.subject || '', sample.textBody || sample.bodyHtml || ''),
  }));
  const passed = results.filter((result) => result.issues.length === 0).length;

  return {
    total: results.length,
    passed,
    passRate: results.length ? Math.round((passed / results.length) * 100) : 0,
    failing: results.filter((result) => result.issues.length > 0),
  };
}

export const INTENT_GOLDEN: Array<{ message: string; expected: SupliaConversationIntent }> = [
  { message: 'hola', expected: 'smalltalk' },
  { message: 'que puedes hacer?', expected: 'capabilities' },
  { message: 'busca empresas de seguridad y contacta a recursos humanos', expected: 'job_workflow' },
  { message: 'redacta un correo para constructoras grandes', expected: 'artifact_create' },
  { message: 'hazlo mas corto', expected: 'artifact_update' },
  { message: 'cuanto es 2+2', expected: 'out_of_scope' },
  { message: 'envia la campana a todos los contactados', expected: 'pending_action' },
];

export function evalIntentRegex(golden: typeof INTENT_GOLDEN = INTENT_GOLDEN) {
  const results = golden.map((item) => {
    const got = classifySupliaIntent(item.message).intent;
    return { message: item.message, expected: item.expected, got, ok: got === item.expected };
  });
  const passed = results.filter((result) => result.ok).length;

  return {
    total: results.length,
    passed,
    accuracy: results.length ? Math.round((passed / results.length) * 100) : 0,
    misses: results.filter((result) => !result.ok),
  };
}

export function evalScoringMonotonic(
  scoreOf: (company: Record<string, unknown>) => number,
  better: Record<string, unknown>,
  worse: Record<string, unknown>,
) {
  const betterScore = scoreOf(better);
  const worseScore = scoreOf(worse);
  return { ok: betterScore > worseScore, better: betterScore, worse: worseScore };
}
