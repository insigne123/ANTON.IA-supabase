// When a conversation reaches its limit of the assistant's use (COW-14): the first message of a new one that picks it up. It is
// written into the new conversation's box, for the person to read, add what comes next and send: what was asked at the start, the
// last answer, and the files that went with it (they are named, so they can be attached again).
import { coworkMessageAttachments } from './attachments';
import { coworkDisplayMessage, coworkTurnOutput } from './presentation';
import type { CoworkEvent, CoworkRun } from './contracts';

const cut = (text: string, max: number) => {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const part = clean.slice(0, max - 1);
  const space = part.lastIndexOf(' ');
  return `${(space > max / 2 ? part.slice(0, space) : part).replace(/[,;:]$/u, '')}…`;
};

/** Whether a failed turn stopped at the limit of its conversation: there, «Reintentar» does not help and a new one does. */
export const coworkHitConversationLimit = (failure: { category?: unknown; message?: unknown } | null | undefined) =>
  failure?.category === 'model_budget_conversation' || /^Esta conversación llegó a su máximo de uso del asistente/.test(String(failure?.message || ''));

export function coworkHandoffMessage(title: string, turns: Array<{ run: CoworkRun; events: CoworkEvent[] }>): string {
  const first = turns[0] ? coworkMessageAttachments(turns[0].run.message) : { text: '', files: [] };
  const files = [...new Set(turns.flatMap(turn => coworkMessageAttachments(turn.run.message).files))];
  const reply = turns.slice().reverse().map(turn => coworkTurnOutput(turn.events)?.reply || '').find(Boolean) || '';
  return [
    `Sigo desde la conversación «${cut(title, 90)}», que llegó a su máximo.`,
    first.text && `Lo que pedí al comienzo: «${cut(coworkDisplayMessage(first.text), 400)}».`,
    reply && `Lo último que respondiste: «${cut(reply, 700)}».`,
    files.length ? `Archivos que usamos: ${files.slice(0, 8).join(', ')} (los adjunto de nuevo si los necesitas).` : '',
    'Ahora necesito: ',
  ].filter(Boolean).join('\n\n');
}

/**
 * The conversation as a Markdown file to keep or show a colleague (COW-10): each message, each answer with its closing question,
 * and the document it delivered. What a card proposed stays in Cowork, where it can be approved.
 */
export function coworkConversationMarkdown(title: string, turns: Array<{ run: CoworkRun; events: CoworkEvent[] }>, now = new Date()): string {
  const when = new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'America/Santiago' }).format(now);
  const parts = [`# ${title.replace(/\s+/g, ' ').trim() || 'Conversación con Cowork'}`, `_Conversación con Cowork en ANTON.IA · descargada el ${when}_`];
  for (const turn of turns) {
    const { text, files } = coworkMessageAttachments(turn.run.message);
    const asked = coworkDisplayMessage(text);
    if (asked || files.length) parts.push(`## Tú\n\n${[asked, files.length ? `Adjuntos: ${files.join(', ')}` : ''].filter(Boolean).join('\n\n')}`);
    const output = coworkTurnOutput(turn.events);
    if (!output) continue;
    parts.push(`## Cowork\n\n${[output.reply.trim(), output.question?.trim() || '', output.document ? `### ${output.document.title}\n\n${output.document.content.trim()}` : ''].filter(Boolean).join('\n\n')}`);
  }
  return `${parts.join('\n\n')}\n`;
}
