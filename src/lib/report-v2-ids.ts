import { createHash } from 'node:crypto';

const idPrefixes = ['f', 'src', 'sig', 'gap', 'asm', 'est', 'del'] as const;

export type StableReportV2IdPrefix = typeof idPrefixes[number];

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => [key, canonicalize(item)]));
}

export function buildStableReportV2Id(prefix: StableReportV2IdPrefix, value: unknown) {
  const digest = createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex').slice(0, 10);
  return `${prefix}_${digest}`;
}
