export type ConnectedEmailProvider = 'google' | 'outlook';

export function normalizeConnectedEmailProvider(value?: string | null): ConnectedEmailProvider | null {
  const normalized = String(value || '').trim().toLowerCase();

  if (!normalized) return null;
  if (normalized === 'google' || normalized === 'gmail') return 'google';
  if (normalized === 'outlook') return 'outlook';

  return null;
}
