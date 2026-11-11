/**
 * The voice pass over what Cowork's Writer wrote (src/lib/server/outreach-voice-pass.ts). The Writer and the Reviewer get the content of
 * an email right; read next to each other their emails share one way of speaking («En la venta mayorista de alimentos, cuando llega un
 * peak de distribución, los turnos por cubrir…», a campaign of 6 Nov 2026). Each email is said again as the person who signs it would
 * write it, between its greeting and its signature, which stay as they are.
 *
 * A rewrite replaces an email only if it says the same things (the pass checks figures, names, variables, links, treatment and the ask)
 * and the Writer's own checks find no more in it than in the email it replaces. Otherwise the Writer's email stands, as it does when a
 * call fails or the turn has no time left.
 *
 * It runs where the Writer works in the background (the morning contact, src/lib/server/lead-drops.ts). In the chat every model call of a
 * turn is reserved in the ledger, which gives the Writer two (cowork_reserve_model_call): the pass needs room of its own there first.
 */
import type { CoworkBlock } from '@/lib/cowork/contracts';
import { coworkDraftIssues, coworkRunContext, coworkWriterBlocks, coworkWriterPasted, type CoworkWriterOutput, type WriterInput } from '@/lib/cowork/writer';
import { voiceTreatmentOf, type VoiceStep } from '@/lib/outreach-voice';
import { voicePass, type VoicePassInput } from '@/lib/server/outreach-voice-pass';
import { voiceSamplesFrom } from '@/lib/server/outreach-voice-samples';

type Email = { subject: string; body: string };

const GREETING = /^(?:hola|estimad[oa]s?|buen[oa]s\s+(?:d[ií]as|tardes)|hi|hello|dear|ol[áa])\b/i;
const SIGN_OFF = /^(?:saludos|un saludo|atentamente|cordialmente|un abrazo|abrazos?|gracias|muchas gracias|quedo atent[oa]|best|regards|kind regards|thanks)\b/i;
const LAST_EMAIL = /[úu]ltim[oa] (?:correo|mensaje|vez)|no (?:te|le|les) escribo m[áa]s|cierro (?:el tema|por aqu[ií])/i;
const count = (text: string) => (text.match(/[\p{L}\p{N}]+/gu) || []).length;

/** An email as the Writer lays it out: its greeting, what it says, and its sign-off with the signature under it. */
export function splitCoworkEmail(body: string) {
  const paragraphs = String(body || '').split(/\n\s*\n/).map((paragraph) => paragraph.trim()).filter(Boolean);
  const greeting = paragraphs.length > 1 && GREETING.test(paragraphs[0]) && count(paragraphs[0]) <= 8 ? paragraphs.shift()! : null;
  let cut = paragraphs.length;
  for (let index = paragraphs.length - 1; index >= Math.max(1, paragraphs.length - 3); index -= 1) {
    const paragraph = paragraphs[index];
    const names = !/[.?!:]\s*$/.test(paragraph) && !/\?/.test(paragraph) && paragraph.split('\n').every((line) => count(line) <= 6);
    if (SIGN_OFF.test(paragraph) || names) cut = index;
    else break;
  }
  return { greeting, content: paragraphs.slice(0, cut), signature: paragraphs.slice(cut) };
}

// The guide and the samples are Spanish: an email in another language keeps the Writer's words.
function spanish(text: string) {
  const words = text.toLocaleLowerCase('es').match(/[\p{L}]+/gu) || [];
  const hits = (list: string[]) => words.filter((word) => list.includes(word)).length;
  return hits(['que', 'de', 'la', 'el', 'en', 'para', 'con', 'los', 'las', 'una', 'por', 'tu', 'su']) >= 4
    && hits(['the', 'and', 'you', 'your', 'we', 'our', 'with', 'for', 'você', 'não', 'uma', 'com']) < 3;
}

type Slot = { block: number; step: number | null };
type Options = Pick<WriterInput, 'request' | 'brief' | 'userContext' | 'observations'> & {
  /** How the pass calls its model: the turn's own budgeted call in the chat, the default one in a background job. */
  generate?: VoicePassInput['generate'];
  signal?: AbortSignal;
  /** Whether the turn still has time for it. */
  hasTime?: () => boolean;
};

/** The Writer's answer with each email in the voice of the person who sends it. Never throws for the pass's own failures. */
export async function coworkVoicePass(output: CoworkWriterOutput, options: Options): Promise<CoworkWriterOutput> {
  const context = coworkRunContext(options);
  // An email the person pasted to improve, or an edit they asked of the previous one, already says how they want it to sound.
  if (coworkWriterPasted(options.request) || context.edit || options.hasTime?.() === false) return output;
  const user = options.userContext as { fullName?: string | null; companyName?: string | null } | null;
  const ownSamples = voiceSamplesFrom((options.observations.slice().reverse().find((item) => item.action === 'message.context')?.result as
    { context?: { voiceExamples?: unknown } | null } | undefined)?.context?.voiceExamples);
  const names = [...(context.recipients || []).flatMap((recipient) => [recipient.name, recipient.company]), ...(context.products || []), context.signer || ''];
  const issues = (blocks: CoworkBlock[]) => coworkDraftIssues(coworkWriterBlocks({ ...output, blocks }), context);
  const emailAt = (blocks: CoworkBlock[], slot: Slot): Email | null => {
    const block = blocks[slot.block];
    if (block?.type === 'email_draft') return block;
    return block?.type === 'sequence' && slot.step !== null ? block.steps[slot.step] ?? null : null;
  };
  const withBody = (blocks: CoworkBlock[], slot: Slot, body: string): CoworkBlock[] => blocks.map((block, index) => (index !== slot.block ? block
    : block.type === 'email_draft' ? { ...block, body }
      : block.type === 'sequence' ? { ...block, steps: block.steps.map((step, at) => (at === slot.step ? { ...step, body } : step)) } : block));
  const slots = output.blocks.flatMap((block, index): Slot[] => (block.type === 'email_draft' ? [{ block: index, step: null }]
    : block.type === 'sequence' ? block.steps.map((_, step) => ({ block: index, step })) : []));

  const rewritten = await Promise.all(slots.map(async (slot) => {
    const email = emailAt(output.blocks, slot);
    if (!email || !spanish(email.body)) return null;
    const { greeting, content, signature } = splitCoworkEmail(email.body);
    const text = content.join('\n\n');
    const words = count(text);
    if (content.length === 0 || words < 12) return null;
    const total = slot.step === null ? 1 : (output.blocks[slot.block] as { steps: unknown[] }).steps.length;
    const step: VoiceStep = slot.step !== null && slot.step > 0
      ? (slot.step === total - 1 && LAST_EMAIL.test(text) ? 'close' : 'follow_up')
      : context.followUp ? 'follow_up' : 'initial';
    const questions = (text.match(/\?/g) || []).length;
    const assemble = (paragraphs: string[]) => [greeting, ...paragraphs, ...signature].filter(Boolean).join('\n\n');
    const before = issues(output.blocks).length;
    try {
      const result = await voicePass({
        subject: email.subject,
        paragraphs: content,
        step,
        treatment: voiceTreatmentOf(text),
        sender: { name: context.signer || user?.fullName || null, company: user?.companyName || null },
        recipient: { firstName: greeting && !greeting.includes('{{') ? greeting.replace(GREETING, '').replace(/[,:¿?][\s\S]*$/, '').trim() : null, company: null },
        keep: [
          'Las variables {{nombre}}, {{empresa}} y {{cargo}} van las mismas y en el mismo lugar de la frase.',
          'Una prueba o un resultado con cifras se cita con las mismas palabras, el mismo tiempo verbal y las mismas cifras.',
          'La primera oración sigue nombrando su empresa o su rubro, como ya lo hace.',
          ...(step === 'initial' ? [] : ['Es un correo posterior: entra directo con lo que trae, sin volver a presentar la oferta.']),
          ...(step === 'close' ? ['La oración que avisa que es el último correo queda como está.'] : []),
        ],
        // The Writer's lengths are its own rules: the rewrite stays within what it wrote, a little shorter at most.
        words: { min: Math.max(12, Math.round(words * 0.7)), max: words + 6 },
        questions: { min: Math.min(1, questions), max: Math.max(1, questions) },
        seed: `${(output.blocks[slot.block] as { to?: string[] | null }).to?.[0] || ''}|${email.subject}|${slot.step ?? ''}`,
        ownSamples,
        check: (version) => {
          const found = issues(withBody(output.blocks, slot, assemble(version.paragraphs)));
          return found.length > before ? found.slice(0, 2).map((issue) => `${issue.problem} ${issue.fix}`) : [];
        },
        generate: options.generate,
        signal: options.signal,
      });
      return result.rewritten ? { slot, body: assemble(result.paragraphs) } : null;
    } catch (error) {
      if (options.signal?.aborted) throw error;
      return null;
    }
  }));

  if (!rewritten.some(Boolean)) return output;
  // Each rewrite was checked alone against the Writer's draft: together they still may not leave more to fix than it had.
  const blocks = rewritten.reduce((current, item) => (item ? withBody(current, item.slot, item.body) : current), output.blocks);
  return issues(blocks).length > issues(output.blocks).length ? output : { ...output, blocks };
}
