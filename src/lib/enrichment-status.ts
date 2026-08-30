export type PendingEnrichmentKind = 'email' | 'phone' | 'contact' | 'unknown';
export type PendingEnrichmentStatus = 'pending_email' | 'pending_phone' | 'pending_contact';

export function pendingEnrichmentStatus(input: {
  revealEmail: boolean;
  revealPhone: boolean;
}): PendingEnrichmentStatus {
  if (input.revealEmail && input.revealPhone) return 'pending_contact';
  return input.revealEmail ? 'pending_email' : 'pending_phone';
}

export function pendingEnrichmentKind(status?: string | null): PendingEnrichmentKind | null {
  const normalized = String(status || '').trim().toLowerCase();
  if (!normalized.startsWith('pending')) return null;
  if (normalized === 'pending_email') return 'email';
  if (normalized === 'pending_phone') return 'phone';
  if (normalized === 'pending_contact') return 'contact';
  return 'unknown';
}

export function isPendingEnrichmentStatus(status?: string | null): boolean {
  return pendingEnrichmentKind(status) !== null;
}
