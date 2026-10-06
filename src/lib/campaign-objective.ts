import type { ProfileFormValues } from '@/lib/profile/profile-mappings';

/** The objective field holds at most this (CampaignSequenceEditor and the assist schema). */
const OBJECTIVE_MAX = 2000;
const SERVICES_SHOWN = 3;

const clip = (value: string, max: number) => (value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value);

/**
 * The objective a new campaign starts from: what the company offers, from «Perfil» (propuesta de valor, or the description,
 * and up to three services). The campaign AI only knows the offer through this field, so starting from it saves typing it
 * and grounds the emails in the real offer. Empty when «Perfil» says nothing about the offer.
 */
export function campaignObjectiveFromProfile(form: Pick<ProfileFormValues, 'valueProposition' | 'description' | 'services'>) {
  const offer = (form.valueProposition || '').trim() || (form.description || '').trim();
  const services = (form.services || '').split('\n').map(line => line.trim().replace(/^[-•*]\s*/, '')).filter(Boolean);
  const lines = [
    offer ? `Ofrecemos: ${clip(offer.replace(/\s+/g, ' '), 600)}` : '',
    services.length ? `Servicios: ${services.slice(0, SERVICES_SHOWN).map(service => clip(service, 200)).join('; ')}` : '',
  ].filter(Boolean);
  return clip(lines.join('\n'), OBJECTIVE_MAX);
}
