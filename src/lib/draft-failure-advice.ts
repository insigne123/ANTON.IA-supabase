/**
 * What a person is told when the app could not write a draft: why, in a line, and what is worth doing next.
 *
 * In production one person pressed «Crear borrador» 20 times in 78 minutes on the same research and every time read «El borrador no cumple los
 * controles de evidencia y calidad». The cause was in the research (its evidence could not back a sentence the writer needed), and another try
 * with it spends model calls and time without changing that. After two failures in a row the way forward is to research again.
 */

export type DraftFailureAdvice = {
  title: string;
  /** At most two causes, in plain words; empty when the refusal carries none we can name. */
  reasons: string[];
  next: string;
  /** The research is the better next step than another try: the screen leads with it. */
  researchFirst: boolean;
};

type Payload = { error?: unknown; issues?: unknown } | null | undefined;

const EVIDENCE = 'El correo se apoyaba en algo que la investigación de esta empresa no respalda.';
const TONE = 'El texto no cumplía las reglas de tono y claridad.';
const FORMAT = 'El largo o la estructura no cumplían el formato.';
const DUPLICATE = 'Repetía contenido de otro borrador.';
const PLACEHOLDER = 'Quedó un campo sin completar.';

const REASON_OF: Record<string, string> = {
  unsupported_material_claim: EVIDENCE, personalization_invalid: EVIDENCE, personalization_missing: EVIDENCE, hypothesis_invalid: EVIDENCE,
  hypothesis_unqualified: EVIDENCE, source_url_invalid: EVIDENCE,
  tone_muletilla: TONE, tone_formato: TONE, tone_asunto: TONE, tone_tratamiento: TONE, tone_pregunta: TONE, tone_ficha: TONE,
  abstract_language: TONE, corporate_copy: TONE, prohibited_phrase: TONE, commercial_relevance: TONE,
  subject_length: FORMAT, body_length: FORMAT, body_structure: FORMAT, cta_count: FORMAT,
  duplicate_content: DUPLICATE, duplicate_sentence: DUPLICATE,
  unresolved_placeholder: PLACEHOLDER,
};

/** `failures` counts this refusal and the ones before it for the same research. */
export function draftFailureAdvice(payload: Payload, failures: number): DraftFailureAdvice | null {
  const code = typeof payload?.error === 'string' ? payload.error : '';
  if (code === 'draft_preflight_failed') {
    const issues = Array.isArray(payload?.issues) ? payload.issues : [];
    const reasons = [...new Set(issues.flatMap((issue: unknown) => {
      const reason = REASON_OF[String((issue as { code?: unknown } | null)?.code ?? '')];
      return reason ? [reason] : [];
    }))].slice(0, 2);
    const repeated = failures >= 2;
    return {
      title: 'No logré escribir un correo que se pueda respaldar',
      reasons,
      next: repeated
        ? 'Ya van dos intentos con la misma investigación y otro suele fallar por lo mismo. Investiga de nuevo a este contacto o agrega un dato antes de volver a intentarlo.'
        : 'Puedes intentarlo una vez más. Si falla de nuevo, conviene investigar otra vez a este contacto.',
      researchFirst: repeated,
    };
  }
  if (code === 'openai_generation_failed' || code === 'openai_rewrite_failed') {
    return { title: 'El servicio de redacción no respondió', reasons: [], next: 'No es un problema de la investigación. Inténtalo de nuevo en un minuto.', researchFirst: false };
  }
  return null;
}
