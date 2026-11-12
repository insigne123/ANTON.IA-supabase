// The email a person gets once a contact's email is found (12 Nov 2026, docs/contacto-del-dia.md): the campaign as it would go, to
// read wherever they are. The first email and each follow-up in full, with the day each would leave if approved today, and the way
// to the contact's card, where it is approved or changed. Pure: the server reads the facts (server/lead-drop-campaign.ts).
import { emailShell } from '@/lib/email-shell';
import { dropCampaignMessages, dropEmailPreview, dropHref, dropName, dropSchedule, shortDay, type DropItem } from '@/lib/lead-drops';

export type DropCampaignEmailInput = {
  dropId: string;
  appUrl: string;
  /** The contact's address, just found. */
  contactEmail: string;
  /** The mailbox the campaign would leave from («Gmail», «Outlook»); null when the person has none connected. */
  mailbox: string | null;
  /** The person's own name, for the greeting. */
  name?: string | null;
  now?: Date;
};

const escape = (text: string) => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
/** A body with its paragraphs, as a mail client shows it: no runs of empty lines, no spaces at the end of a line. */
const tidy = (body: string) => body.replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

/**
 * Null when the contact has no email written. Approving is done on the page, never by opening the link: a mail scanner that follows
 * links must not send anything, so the button leads to the card with «Aprobar y programar» in it.
 */
export function dropCampaignEmail(item: DropItem, input: DropCampaignEmailInput) {
  const messages = dropCampaignMessages(item);
  if (!messages.length) return null;
  const now = input.now ?? new Date();
  const base = input.appUrl.replace(/\/$/, '');
  const link = `${base}${dropHref(input.dropId)}?c=${encodeURIComponent(item.leadId)}`;
  const settings = `${base}/dashboard?vista=semana`;
  const contact = dropName(item);
  const role = [item.title, item.company].filter(Boolean).join(' · ');
  const days = dropSchedule(item, now).map(shortDay);
  const greeting = input.name?.trim() ? `Hola, ${input.name.trim().split(/\s+/)[0]}` : 'Hola';
  const subject = `Campaña lista para aprobar: ${[contact, item.company].filter(Boolean).join(' · ')}`.slice(0, 120);
  const found = `Encontramos el correo de ${contact}: ${input.contactEmail}.`;
  const next = input.mailbox
    ? `Esta es la campaña que le escribimos. Si te parece, apruébala: sale desde tu ${input.mailbox} y se detiene si responde.`
    : 'Esta es la campaña que le escribimos. Para aprobarla, conecta Gmail u Outlook en «Conexiones».';
  const emails = messages.map((message, index) => ({
    label: index === 0 ? 'Primer correo · sale al aprobar' : `Seguimiento ${index}${days[index] ? ` · ${days[index]}` : ''}, si no responde`,
    subject: dropEmailPreview(message.subject, item), body: tidy(dropEmailPreview(message.body, item)),
  }));
  const note = `Ahí mismo puedes cambiar los correos antes de aprobar.${messages.length > 1 ? ' Los seguimientos salen solo si no hay respuesta.' : ''}`;
  const off = 'Te avisamos solo cuando hay algo que hacer. Los apagas en';

  const text = [
    `${greeting}. ${found}`, next, '', role ? `${contact}, ${role}` : contact,
    ...emails.flatMap(email => ['', `— ${email.label} —`, `Asunto: ${email.subject}`, '', email.body]),
    '', `Revisar y aprobar: ${link}`, note, `${off} «Tu semana»: ${settings}`,
  ].join('\n');

  const block = (email: typeof emails[number]) => `<div style="margin:0 0 12px;padding:14px 16px;border:1px solid #e5e7eb;border-radius:14px;background:#ffffff">`
    + `<p style="margin:0;font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:#6b7280">${escape(email.label)}</p>`
    + `<p style="margin:6px 0 0;font-size:15px;line-height:22px;font-weight:600;color:#111827">${escape(email.subject)}</p>`
    + email.body.split(/\n{2,}/).map(paragraph => `<p style="margin:8px 0 0;font-size:14px;line-height:21px;color:#374151">${escape(paragraph).replace(/\n/g, '<br>')}</p>`).join('')
    + '</div>';
  const html = emailShell(`<h1 style="margin:0 0 4px;font-size:20px;line-height:28px">${escape(greeting)}</h1>`
    + `<p style="margin:0 0 4px;font-size:15px;line-height:22px;color:#111827">${escape(found)}</p>`
    + `<p style="margin:0 0 16px;font-size:15px;line-height:22px;color:#6b7280">${escape(next)}</p>`
    + `<p style="margin:0;font-size:16px;line-height:24px;font-weight:600;color:#111827">${escape(contact)}</p>`
    + (role ? `<p style="margin:2px 0 14px;font-size:14px;line-height:20px;color:#374151">${escape(role)}</p>` : '<div style="height:14px"></div>')
    + emails.map(block).join('')
    + `<p style="margin:20px 0 0"><a href="${escape(link)}" style="display:inline-block;padding:10px 16px;border-radius:10px;background:#2563eb;color:#ffffff;text-decoration:none;font-size:14px">Revisar y aprobar</a></p>`
    + `<p style="margin:10px 0 0;font-size:13px;line-height:19px;color:#6b7280">${escape(note)}</p>`
    + `<p style="margin:20px 0 0;font-size:12px;line-height:18px;color:#6b7280">${escape(off)} <a href="${escape(settings)}" style="color:#6b7280">«Tu semana»</a>.</p>`);
  return { subject, text, html, link };
}
