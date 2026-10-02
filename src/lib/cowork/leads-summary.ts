/**
 * «Revisa mis leads» (Plan 5, PR-7): the person's saved contacts by state, with exact figures and the next step of each
 * group. In the test of 1 oct Cowork listed the 20 most recent (16) instead. Pure: the read and its tests share it.
 * Each contact is in exactly one group, the most advanced one: replied, contacted, ready to write (researched, with an
 * email), with an email, without an email.
 */
export type CoworkLeadsSummaryInput = {
  leads: Array<{ id: string; email?: string | null; linkedin_url?: string | null }>;
  contacted: Array<{ lead_id?: string | null; email?: string | null; replied_at?: string | null }>;
  researched: Array<{ lead_id?: string | null }>;
};

export type CoworkLeadsGroup = { id: 'replied' | 'contacted' | 'ready' | 'with_email' | 'no_email'; label: string; count: number; next: string };

const email = (value: unknown) => String(value || '').trim().toLowerCase();
const LINKEDIN_PROFILE = /linkedin\.com\/in\//i;

export function coworkLeadsSummary(input: CoworkLeadsSummaryInput, options: { truncated?: boolean } = {}) {
  const contactedIds = new Set<string>();
  const contactedEmails = new Set<string>();
  const repliedIds = new Set<string>();
  const repliedEmails = new Set<string>();
  for (const row of input.contacted) {
    const address = email(row.email);
    if (row.lead_id) contactedIds.add(row.lead_id);
    if (address) contactedEmails.add(address);
    if (row.replied_at) {
      if (row.lead_id) repliedIds.add(row.lead_id);
      if (address) repliedEmails.add(address);
    }
  }
  const researchedIds = new Set(input.researched.map(row => row.lead_id).filter((id): id is string => Boolean(id)));
  const counts = { replied: 0, contacted: 0, ready: 0, with_email: 0, no_email: 0 };
  let withLinkedinProfile = 0;
  for (const lead of input.leads) {
    const address = email(lead.email);
    if (LINKEDIN_PROFILE.test(String(lead.linkedin_url || ''))) withLinkedinProfile++;
    if (repliedIds.has(lead.id) || (address && repliedEmails.has(address))) counts.replied++;
    else if (contactedIds.has(lead.id) || (address && contactedEmails.has(address))) counts.contacted++;
    else if (!address) counts.no_email++;
    else if (researchedIds.has(lead.id)) counts.ready++;
    else counts.with_email++;
  }
  const groups: CoworkLeadsGroup[] = [
    { id: 'replied', label: 'Respondieron', count: counts.replied, next: 'Contestarles en su mismo hilo: te propongo la respuesta.' },
    { id: 'contacted', label: 'Contactados sin respuesta', count: counts.contacted, next: 'Un seguimiento con un ángulo nuevo a quienes llevan 5 días o más.' },
    { id: 'ready', label: 'Investigados, con correo y sin contactar', count: counts.ready, next: 'Escribirles: el primer correo sale de su investigación.' },
    { id: 'with_email', label: 'Con correo, sin investigar ni contactar', count: counts.with_email, next: 'Investigarlos para escribirles mejor, o escribirles ya con una campaña.' },
    { id: 'no_email', label: 'Sin correo', count: counts.no_email, next: 'Buscar su correo: 1 crédito por persona.' },
  ];
  return {
    scope: 'own_saved_contacts' as const,
    total: input.leads.length,
    exact: !options.truncated,
    groups,
    withLinkedinProfile,
    note: options.truncated
      ? 'Cuenta los 5.000 contactos guardados más recientes: las cifras son mínimos.'
      : 'Cada contacto está en un solo grupo, el más avanzado. Contactado cuenta cualquier envío registrado en ANTON.IA.',
  };
}
