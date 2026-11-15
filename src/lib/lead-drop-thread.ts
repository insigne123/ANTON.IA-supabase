/**
 * One conversation per drop in the person's inbox (15 Nov 2026, the owner: «le debería llegar un mail en el mismo hilo con los leads
 * enriquecidos y todo listo»). The morning email and every answer to what the person does from it (their contacts enriched, the
 * campaigns to approve, the mobiles with the script of each call) carry the same subject and the same thread headers, so Gmail and
 * Outlook show them as one conversation:
 *
 * - `References` and `In-Reply-To` name a root that belongs to the drop. The sender (Resend) writes each email's own Message-ID, so
 *   no email can name another; all of them name the same root, which is how notification emails are threaded.
 * - `Thread-Topic` and `Thread-Index` are Outlook's: the index carries a conversation id, here the drop's own id.
 *
 * Pure: the headers of an email are a function of the drop, its day and the moment the email leaves.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROOT_DOMAIN = 'contactos.anton-ia.yago.cl';
/** 100-nanosecond ticks between 1601 (a Windows file time) and 1970. */
const FILETIME_EPOCH = BigInt('116444736000000000');

/** The first six bytes of a moment's file time, as a conversation index wants them. */
function fileTimeHead(ms: number) {
  const ticks = BigInt(Math.max(0, Math.floor(ms))) * BigInt(10000) + FILETIME_EPOCH;
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64BE(ticks);
  return bytes.subarray(0, 6);
}

export type DropThread = { subject: string; headers: Record<string, string> };

/**
 * The subject and the headers of one email of a drop's conversation. `reply` is every email after the morning one: «Re:» before the
 * same subject, and its place in the conversation after the first. An id that is not a drop's gives the subject alone.
 */
export function dropThread(input: { dropId: string; date: string; subject: string; reply?: boolean; now?: Date }): DropThread {
  const subject = input.reply ? `Re: ${input.subject}` : input.subject;
  if (!UUID.test(input.dropId)) return { subject, headers: {} };
  const root = `<contactos.${input.dropId.toLowerCase()}@${ROOT_DOMAIN}>`;
  const started = Date.parse(`${input.date}T12:00:00Z`);
  const start = Number.isFinite(started) ? started : 0;
  const head = Buffer.concat([fileTimeHead(start), Buffer.from(input.dropId.replace(/-/g, ''), 'hex')]);
  // A reply's block: how long after the first email it leaves, in a 31-bit count of minutes, and a closing byte.
  const child = Buffer.alloc(5);
  if (input.reply) child.writeUInt32BE(Math.min(0x7fffffff, Math.max(1, Math.floor(((input.now ?? new Date()).getTime() - start) / 60_000))));
  const index = input.reply ? Buffer.concat([head, child]) : head;
  return { subject, headers: { 'In-Reply-To': root, References: root, 'Thread-Topic': input.subject.replace(/[\r\n]+/g, ' ').slice(0, 200), 'Thread-Index': index.toString('base64') } };
}
