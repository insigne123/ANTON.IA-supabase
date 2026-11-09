import { EMPTY_SIGNATURE_FIELDS, type SignatureFields } from '@/lib/email-studio/signature-builder';
import type { EmailChannel, SignatureConfig } from '@/lib/email-signature-storage';

/**
 * The signature the person already uses in Outlook or Gmail, put on their emails without asking them to (9 Nov 2026): «que los
 * mails lleven automáticamente la firma configurada por el Outlook o Gmail, como si los mandaran por Outlook». Until now it was
 * only brought when the person opened «Firmas y estilo», and still had to be saved there: 4 of 43 people had one.
 *
 * It runs only for someone who has no signature at all, so a signature the person made, edited or turned off is never touched.
 * Pure: the screen gives it the reads and the writes, and the tests give it fakes.
 */
export type AutoImportOutcome =
  | { kind: 'imported'; provider: EmailChannel }
  | { kind: 'has_signature' | 'not_connected' | 'not_found' | 'unavailable' | 'failed' };

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** When to look again: soon while there is no mailbox (it is usually connected next), rarely once there is an answer. */
export const AUTO_IMPORT_RETRY_MS: Record<AutoImportOutcome['kind'], number> = {
  imported: 30 * DAY,
  has_signature: 30 * DAY,
  not_connected: HOUR,
  not_found: 7 * DAY,
  unavailable: DAY,
  failed: DAY,
};

type MailboxAnswer = { provider?: string | null; html?: string | null; reason?: string | null } | null;
type Sender = { name?: string; title?: string; company?: string; phone?: string; website?: string };

export type AutoImportDependencies = {
  /** The signatures saved in the profile, or null when the profile cannot be read. */
  readSignatures: () => Promise<Record<string, unknown> | null>;
  /** What the mailbox has (GET /api/email-studio/mailbox-signature); null when it could not be asked. */
  readMailbox: () => Promise<MailboxAnswer>;
  /** The mailbox signature cleaned, with its images uploaded; null when nothing usable is left. */
  prepare: (html: string) => Promise<string | null>;
  /** The person's details, so the other designs start filled if they ever switch. */
  sender: () => Promise<Sender>;
  save: (configs: SignatureConfig[]) => Promise<void>;
  now?: () => Date;
};

/** Any saved signature, even an empty or disabled one, is the person's decision. */
export function hasOwnSignature(signatures: Record<string, unknown> | null | undefined) {
  if (!signatures || typeof signatures !== 'object') return false;
  return (['gmail', 'outlook'] as const).some(channel => {
    const config = signatures[channel];
    return Boolean(config && typeof config === 'object');
  });
}

export async function autoImportSignature(deps: AutoImportDependencies): Promise<AutoImportOutcome> {
  const before = await deps.readSignatures().catch(() => null);
  if (before === null) return { kind: 'unavailable' };
  if (hasOwnSignature(before)) return { kind: 'has_signature' };

  const found = await deps.readMailbox().catch(() => null);
  if (!found) return { kind: 'unavailable' };
  if (!found.html) {
    return { kind: found.reason === 'not_connected' ? 'not_connected' : found.reason === 'not_found' ? 'not_found' : 'unavailable' };
  }
  const provider: EmailChannel = found.provider === 'gmail' ? 'gmail' : 'outlook';
  const html = await deps.prepare(found.html).catch(() => null);
  if (!html) return { kind: 'failed' };

  // The person may have saved one in another tab while the mailbox was read: theirs wins.
  const latest = await deps.readSignatures().catch(() => null);
  if (latest === null) return { kind: 'unavailable' };
  if (hasOwnSignature(latest)) return { kind: 'has_signature' };

  const sender = await deps.sender().catch(() => ({} as Sender));
  const fields: SignatureFields = {
    ...EMPTY_SIGNATURE_FIELDS,
    name: sender.name || '', title: sender.title || '', company: sender.company || '', phone: sender.phone || '', website: sender.website || '',
    customHtml: html,
  };
  const updatedAt = (deps.now?.() || new Date()).toISOString();
  // One signature for every account, as «Firmas y estilo» saves by default: the mailbox that sends always finds it.
  const configs = (['gmail', 'outlook'] as const).map(channel => ({
    channel, enabled: true, html, text: '', separatorPlaintext: true, updatedAt, builder: { design: 'propia' as const, fields },
  }) satisfies SignatureConfig);
  await deps.save(configs);
  return { kind: 'imported', provider };
}
