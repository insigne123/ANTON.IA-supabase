import { createHash } from 'node:crypto';

/** Deterministic v4 UUID for idempotent follow-ups derived from a seed string. */
export function deterministicCoworkUuid(seed: string): string {
  const digest = createHash('sha256').update(seed).digest('hex');
  const chars = digest.slice(0, 32).split('');
  chars[12] = '4';
  chars[16] = (['8', '9', 'a', 'b'] as const)[parseInt(digest.slice(16, 17), 16) % 4];
  const hex = chars.join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
