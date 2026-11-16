// What comes back to the person's inbox when they go on from the morning email of their contacts (15 Nov 2026, the owner: «si desea
// continuar desde el mail y le da a enriquecer, le debería llegar un mail en el mismo hilo con los leads enriquecidos y todo listo
// para iniciar el primer contacto y lanzar la campaña de seguimiento, o el guion listo para la llamada»). Two emails, both in the
// conversation of the morning one (src/lib/lead-drop-thread.ts):
//
// - «Listos»: the contacts whose email was found, each with its address, its first email in full and the days of its follow-ups,
//   and the way to approve its campaign. Approving is a button on the page, never the link: a mail scanner follows links.
// - «Para llamar»: the mobiles that were found, each with «Llamar», «WhatsApp» and the script of its call.
//
// Pure: the server reads the facts and sends (src/lib/server/lead-drop-ready.ts).
import { dialable, whatsappHref } from '@/lib/contact-calls';
import { EMAIL_AVATAR_TINTS, emailButton, emailCallout, emailLabel, emailPerson, emailShell } from '@/lib/email-shell';
import { splitTopic, type DropCallScript } from '@/lib/lead-drop-call';
import { dropCampaignMessages, dropEmailPreview, dropInitials, dropName, dropSchedule, dropTint, firstLines, shortDay, type DropItem } from '@/lib/lead-drops';

const escape = (text: string) => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
const tidy = (body: string) => body.replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
const listed = (values: string[]) => values.length <= 1 ? values.join('') : `${values.slice(0, -1).join(', ')} y ${values[values.length - 1]}`;
const role = (item: Pick<DropItem, 'title' | 'company'>) => [item.title, item.company].filter(Boolean).join(' · ');
const who = (item: DropItem) => [dropName(item), item.company].filter(Boolean).join(' de ');
/** A sentence that ends once: «Raúl P.» (a surname the search hid) already brings its full stop. */
const stop = (text: string) => text.endsWith('.') ? text : `${text}.`;
const greetingOf = (name?: string | null) => name?.trim() ? `Hola, ${name.trim().split(/\s+/)[0]}` : 'Hola';
const cardHref = (link: string, item: Pick<DropItem, 'leadId'>) => `${link}?c=${encodeURIComponent(item.leadId)}`;
/** The contact's card with «Para llamar» open, where the call starts (src/components/lead-drops/DropMailFlow.tsx). */
const callHref = (link: string, item: Pick<DropItem, 'leadId'>) => `${cardHref(link, item)}&llamar=1`;
const OFF = 'Te avisamos solo cuando hay algo que hacer. Los apagas en';

const P = 'margin:6px 0 0;font-size:14px;line-height:21px;color:#374151';
const CARD = 'margin:0 0 12px;padding:16px;border:1px solid #e5e7eb;border-radius:14px;background-color:#ffffff';
/** Who a card is about, as in the morning email: its initials on its own tint, its name and its role. */
const person = (item: DropItem) => emailPerson({ initials: escape(dropInitials(item)), tint: dropTint(item.leadId, EMAIL_AVATAR_TINTS), name: escape(dropName(item)), role: role(item) ? escape(role(item)) : null });
/** The top of a reply: the greeting small, what happened as the title, what to do next under it. */
const top = (name: string | null | undefined, lead: string, lines: Array<string | null>) => `<div style="margin:0 0 18px">${emailLabel(escape(greetingOf(name)))}`
  + `<p style="margin:4px 0 0;font-size:20px;line-height:27px;font-weight:600;color:#111827">${escape(lead)}</p>`
  + lines.filter((line): line is string => Boolean(line)).map(line => `<p style="margin:6px 0 0;font-size:14px;line-height:21px;color:#4b5563">${escape(line)}</p>`).join('') + `</div>`;
const footer = (settings: string) => `<p style="margin:20px 0 0;font-size:12px;line-height:18px;color:#6b7280">${escape(OFF)} <a href="${escape(settings)}" style="color:#6b7280">«Tu semana»</a>.</p>`;

export type DropReadyInput = {
  /** The drop's page that needs no session (server/lead-drop-link.ts). */
  link: string;
  /** Where the email's other links go: the same address the page is at. */
  appUrl: string;
  /** The person's own name, for the greeting. */
  name?: string | null;
  /** The mailbox the campaigns would leave from («Gmail», «Outlook»); null when the person has none connected. */
  mailbox: string | null;
  /** How many contacts the drop has. */
  total: number;
  /** Looked up, and no email came. */
  missed?: DropItem[];
  /** Their mobiles were asked too: they come later, in this conversation. */
  phones?: boolean;
  now?: Date;
};

/** The contacts whose email was found, ready to approve. Null without any that has an email written. */
export function dropReadyEmail(entries: Array<{ item: DropItem; email: string }>, input: DropReadyInput) {
  const now = input.now ?? new Date();
  const ready = entries.flatMap(({ item, email }) => {
    const messages = dropCampaignMessages(item, now);
    if (!messages.length) return [];
    const days = dropSchedule(item, now).slice(1).map(shortDay);
    return [{ item, email, subject: dropEmailPreview(messages[0].subject, item), body: tidy(dropEmailPreview(messages[0].body, item)),
      followUps: days.length ? `${days.length === 1 ? 'Seguimiento' : `${days.length} seguimientos`} si no responde: ${listed(days)}.` : null }];
  });
  if (!ready.length) return null;
  const settings = `${input.appUrl.replace(/\/$/, '')}/dashboard?vista=semana`;
  const missed = input.missed ?? [];
  const found = ready.length === 1 ? stop(`Encontramos el correo de ${who(ready[0].item)}`)
    : ready.length === input.total ? `Encontramos el correo de tus ${ready.length} contactos.` : `Encontramos el correo de ${ready.length} de tus ${input.total} contactos.`;
  const campaigns = ready.length === 1 ? 'Su campaña está lista' : 'La campaña de cada uno está lista';
  const next = input.mailbox ? `${campaigns}: léela y apruébala. Sale desde tu ${input.mailbox} y se detiene si responde.`
    : `${campaigns}. Para aprobarla, conecta tu Gmail u Outlook ahí mismo: es una sola vez.`;
  const phones = input.phones ? `${ready.length === 1 ? 'Su teléfono llega' : 'Sus teléfonos llegan'} en unos minutos, en esta misma conversación, con el guion de ${ready.length === 1 ? 'la' : 'cada'} llamada.` : null;
  const none = missed.length ? stop(`No encontramos un correo para ${listed(missed.map(who))}`) : null;
  const note = `En la página puedes cambiar los correos antes de aprobar.${ready.some(entry => entry.followUps) ? ' Los seguimientos salen solo si no hay respuesta.' : ''}`;
  const open = ready.length === 1 ? 'Revisar y aprobar' : `Revisar y aprobar las ${ready.length} campañas`;

  const text = [
    `${greetingOf(input.name)}. ${found}`, next, ...(phones ? [phones] : []), ...(none ? [none] : []), '', `${open}: ${input.link}`,
    ...ready.flatMap(entry => ['', `${dropName(entry.item)}${role(entry.item) ? `, ${role(entry.item)}` : ''}`, `Correo: ${entry.email}`,
      `— Primer correo · sale al aprobar —`, `Asunto: ${entry.subject}`, '', entry.body, ...(entry.followUps ? ['', entry.followUps] : []),
      `Revisar y aprobar: ${cardHref(input.link, entry.item)}`]),
    '', note, `${OFF} «Tu semana»: ${settings}`,
  ].join('\n');

  // One contact: its first email in full, as it will leave. Several: the start of each, since six emails in full is a wall nobody
  // reads (16 Nov 2026, the owner: «se siente como mucho texto»); each is read whole on its page before approving.
  const whole = ready.length === 1;
  const card = (entry: typeof ready[number]) => `<div style="${CARD}">${person(entry.item)}`
    + `<p style="margin:12px 0 0;font-size:14px;line-height:20px;color:#065f46"><span style="font-weight:600">Correo encontrado</span> · <a href="mailto:${escape(entry.email)}" style="color:#065f46;text-decoration:none">${escape(entry.email)}</a></p>`
    + `<div style="margin:12px 0 0;padding:12px 14px;border-radius:10px;background-color:#f9fafb">`
    + emailLabel('Primer correo · sale al aprobar')
    + `<p style="margin:4px 0 0;font-size:15px;line-height:21px;font-weight:600;color:#111827">${escape(entry.subject)}</p>`
    + (whole ? entry.body.split(/\n{2,}/).map(paragraph => `<p style="${P}">${escape(paragraph).replace(/\n/g, '<br>')}</p>`).join('')
      : `<p style="${P}">${escape(firstLines(entry.body, 180))}</p>`)
    + '</div>'
    + (entry.followUps ? `<p style="margin:10px 0 0;font-size:13px;line-height:19px;color:#6b7280">${escape(entry.followUps)}</p>` : '')
    + `<div style="margin:14px 0 0">${emailButton(cardHref(input.link, entry.item), whole ? 'Revisar y aprobar' : 'Leer completo y aprobar', { quiet: !whole })}</div></div>`;
  const html = emailShell(top(input.name, found, [next, phones, none])
    + (whole ? '' : `<div style="margin:0 0 10px">${emailButton(input.link, open)}</div>`)
    + ready.map(card).join('')
    + `<p style="margin:4px 0 0;font-size:12px;line-height:18px;color:#6b7280">${escape(note)}</p>`
    + footer(settings));
  return { text, html, count: ready.length };
}

export type DropCallsInput = {
  link: string;
  appUrl: string;
  name?: string | null;
  /** Asked, and no mobile came. */
  missed?: DropItem[];
};
export type DropCallEntry = { item: DropItem; number: string; script: DropCallScript | null };

/** The mobiles that were found, each ready to call. Null when there is nothing to say: none found and none missed. */
export function dropCallsEmail(entries: DropCallEntry[], input: DropCallsInput) {
  const found = entries.filter(entry => dialable(entry.number));
  const missed = input.missed ?? [];
  if (!found.length && !missed.length) return null;
  const settings = `${input.appUrl.replace(/\/$/, '')}/dashboard?vista=semana`;
  const scripted = found.some(entry => entry.script);
  const lead = !found.length ? stop(`No encontramos un teléfono para ${listed(missed.map(who))}`)
    : found.length === 1 ? stop(`Ya tienes el teléfono de ${who(found[0].item)}${found[0].script ? ', con el guion de su llamada' : ''}`)
    : `Ya tienes el teléfono de ${found.length} de tus contactos${scripted ? ', con el guion de cada llamada' : ''}.`;
  const none = found.length && missed.length ? stop(`No encontramos un teléfono para ${listed(missed.map(who))}`) : null;
  const next = found.length ? '«Llamar» abre su ficha y marca el número; ahí mismo tienes el guion y su campaña de correos.'
    : 'Sus campañas de correo siguen listas en la página.';
  const list = (label: string, values: string[]) => values.length ? [label, ...values.map(value => `- ${value}`)] : [];

  const text = [
    `${greetingOf(input.name)}. ${lead}`, ...(none ? [none] : []), next,
    ...found.flatMap(({ item, number, script }) => ['', `${dropName(item)}${role(item) ? `, ${role(item)}` : ''}`, `Teléfono: ${number}`,
      ...(whatsappHref(number, script?.whatsapp) ? [`WhatsApp: ${whatsappHref(number, script?.whatsapp)}`] : []),
      ...(script ? [...list('Puntos de interés', script.points), 'Al contestar', script.opening, ...list('Preguntas', script.questions),
        ...list('Si te dice…', script.objections.map(entry => `«${entry.objection}»: ${entry.answer}`)), 'Si no contesta', script.voicemail] : []),
      `Llamar y anotar cómo te fue: ${callHref(input.link, item)}`]),
    '', `Ver todos: ${input.link}`, `${OFF} «Tu semana»: ${settings}`,
  ].join('\n');

  // The call, as it is read with the phone in the hand (16 Nov 2026, the redesign): the number and its two buttons, what to say when
  // they answer, what matters to that person by theme and what to ask. Objections, the voicemail and the first WhatsApp stay on the
  // card «Llamar» opens, and in the text version of this email.
  const points = (values: string[]) => values.length ? `<div style="margin:14px 0 0">${emailLabel('Puntos de interés')}`
    + values.map(value => { const { topic, rest } = splitTopic(value);
      return `<p style="${P}">${topic ? `<strong style="color:#111827">${escape(topic)}:</strong> ` : ''}${escape(rest)}</p>`; }).join('') + `</div>` : '';
  const questions = (values: string[]) => values.length ? `<div style="margin:14px 0 0">${emailLabel('Preguntas')}`
    + `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">`
    + values.map((value, index) => `<tr><td width="22" valign="top" style="width:22px;padding:6px 0 0;font-size:14px;line-height:21px;font-weight:600;color:#2563eb">${index + 1}</td>`
      + `<td valign="top" style="padding:6px 0 0;font-size:14px;line-height:21px;color:#374151">${escape(value)}</td></tr>`).join('') + `</table></div>` : '';
  const card = ({ item, number, script }: DropCallEntry) => {
    const whatsapp = whatsappHref(number, script?.whatsapp);
    const rest = script ? [script.objections.length ? 'cómo responder si objeta' : null, script.voicemail ? 'qué dejar en el buzón' : null].filter(Boolean) : [];
    // The number is plain text, which a phone's mail app makes tappable by itself; «Llamar» opens its card and dials from there,
    // since mail clients drop `tel:` links (seen on 15 Nov 2026: Gmail turned one into a dead link).
    return `<div style="${CARD}">${person(item)}`
      + `<p style="margin:14px 0 10px;font-size:22px;line-height:28px;font-weight:600;letter-spacing:.01em;color:#111827">${escape(number)}</p>`
      + emailButton(callHref(input.link, item), 'Llamar') + (whatsapp ? emailButton(whatsapp, 'WhatsApp', { quiet: true }) : '')
      + (script ? emailCallout({ label: 'Al contestar', body: escape(script.opening), tone: 'blue', size: 15 }).replace('margin:12px 0 0', 'margin:6px 0 0')
        + points(script.points) + questions(script.questions)
        + (rest.length ? `<p style="margin:14px 0 0;padding:10px 0 0;border-top:1px solid #f3f4f6;font-size:13px;line-height:19px;color:#6b7280">En su ficha: ${rest.join(' y ')}. <a href="${escape(callHref(input.link, item))}" style="color:#2563eb">Abrir el guion completo</a></p>` : '') : '')
      + '</div>';
  };
  const html = emailShell(top(input.name, lead, [none, next])
    + found.map(card).join('')
    + `<p style="margin:4px 0 0;font-size:14px;line-height:20px"><a href="${escape(input.link)}" style="color:#2563eb">Ver todos tus contactos</a></p>`
    + footer(settings));
  return { text, html, count: found.length };
}
