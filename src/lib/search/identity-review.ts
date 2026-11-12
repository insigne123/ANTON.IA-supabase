/**
 * A profile search Apollo answered with someone at another LinkedIn address, as the screen sees it (src/lib/server/identity-reviews.ts):
 * whom Apollo found and what the AI makes of it. Never the contact: it comes only once the person says it is the same person.
 */
export type IdentityReviewVerdict = 'same' | 'probably_same' | 'unsure' | 'different';
export type IdentityReviewCheck = { topic: 'name' | 'company' | 'title' | 'address' | 'web'; status: 'ok' | 'doubt' | 'no'; text: string };

export type IdentityReviewView = {
  id: string;
  requestedLinkedinUrl: string;
  candidate: {
    apolloId: string | null; fullName: string | null; title: string | null; headline: string | null; linkedinUrl: string | null;
    organizationName: string | null; organizationDomain: string | null; photoUrl: string | null; city: string | null; country: string | null;
  };
  reason: string | null;
  verdict: { verdict: IdentityReviewVerdict; summary: string; checks: IdentityReviewCheck[]; by: 'ai' | 'rule' } | null;
  decision: 'same' | 'different' | null;
  hasContact: boolean;
};

export const IDENTITY_VERDICT_LABEL: Record<IdentityReviewVerdict, string> = {
  same: 'La IA cree que es la misma persona',
  probably_same: 'La IA cree que probablemente es la misma persona',
  unsure: 'La IA no está segura',
  different: 'La IA cree que es otra persona',
};

/** A review as the server sent it, or null when it is not one. */
export function identityReviewFrom(value: unknown): IdentityReviewView | null {
  const raw = value && typeof value === 'object' ? value as Record<string, any> : null;
  if (!raw || typeof raw.id !== 'string' || typeof raw.requestedLinkedinUrl !== 'string' || !raw.candidate || typeof raw.candidate !== 'object') return null;
  return raw as IdentityReviewView;
}
