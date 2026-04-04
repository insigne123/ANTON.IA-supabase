import type { StyleProfile } from '@/lib/types';

type RestyleDraftInput = {
  mode: 'leads' | 'opportunities';
  baseSubject: string;
  baseBody: string;
  styleProfile: StyleProfile;
  lead?: any;
  report?: any;
  companyProfile?: any;
};

type RestyleDraftOutput = {
  subject: string;
  body: string;
};

export async function restyleDraftWithProfile(input: RestyleDraftInput): Promise<RestyleDraftOutput> {
  const res = await fetch('/api/email/style/apply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || 'No se pudo aplicar el estilo al borrador');
  }

  return {
    subject: String(data?.subject || input.baseSubject || ''),
    body: String(data?.body || input.baseBody || ''),
  };
}
