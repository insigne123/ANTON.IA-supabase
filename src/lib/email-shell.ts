/**
 * The app's own emails (the morning alert, the contacts of the day and their replies, Monday's report, the notices to whoever runs the
 * app). Each one is a page of its own: a quiet grey background, the name of the app over it and white cards on it. A mail client in
 * dark mode that paints its background but keeps our dark text made them unreadable; every text here sits on a colour the email sets
 * itself (as an attribute too, for the clients that drop styles), so it reads the same everywhere, and the clients that invert colours
 * invert the whole page together.
 *
 * Built with tables (17 Nov 2026, the owner: «sigamos mejorando el cómo se ven los mails que le llegan a los usuarios»): the desktop
 * Outlook ignores `max-width`, padding and margins on a `div`, so a card drawn with one lost its air and ran the width of the window.
 */
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const PAGE = '#f5f5f7';
const EDGE = '#e5e7eb';
/** What the inbox shows after the subject. Padded, so the client does not go on with the first words of the email itself. */
const preheaderOf = (text: string) => `<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:${PAGE}">${text}${'&nbsp;&zwnj;'.repeat(40)}</div>`;
const spacer = (height: number) => `<div style="height:${height}px;line-height:${height}px;font-size:${height}px">&nbsp;</div>`;

/**
 * A white card of an email: its edge, its rounded corners (where the client draws them) and its air, in a table so they hold in
 * Outlook. `blue`: the one that carries the email's main choice.
 */
export function emailCard(inner: string, options: { tone?: 'white' | 'blue'; padding?: string; gap?: number } = {}) {
  const [fill, edge] = options.tone === 'blue' ? ['#eff6ff', '#bfdbfe'] : ['#ffffff', EDGE];
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${fill}" style="width:100%;border-collapse:separate;border-spacing:0;background-color:${fill};border:1px solid ${edge};border-radius:16px"><tr>`
    + `<td style="padding:${options.padding ?? '18px'};color:#111827">${inner}</td></tr></table>${options.gap === 0 ? '' : spacer(options.gap ?? 12)}`;
}

/** Something laid on the page between the cards (a button, a title of a part): a row with the air of the cards' own text. */
export function emailRow(inner: string, options: { padding?: string; align?: 'left' | 'center' } = {}) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="${options.align ?? 'left'}" style="padding:${options.padding ?? '2px 4px 10px'}">${inner}</td></tr></table>`;
}

/** A quiet grey block inside a card: the email that would leave, read apart from what is said about it. Already escaped. */
export function emailInset(inner: string) {
  return `${spacer(12)}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f9fafb" style="width:100%;border-collapse:separate;background-color:#f9fafb;border-radius:10px"><tr>`
    + `<td style="padding:12px 14px">${inner}</td></tr></table>`;
}

/**
 * The page of an email. `label`: what this email is, said quietly next to the name of the app («Contactos de hoy»). `preheader`: the
 * line of the inbox, already escaped. Without `bare` everything goes in one white card (a notice, a report); with it the caller lays
 * its own cards on the page.
 */
export function emailShell(inner: string, options: { label?: string | null; preheader?: string | null; bare?: boolean } = {}) {
  const brand = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>`
    + `<td style="padding:0 4px 14px;font-size:13px;line-height:18px;font-weight:700;letter-spacing:.08em;color:#111827">ANTON.IA</td>`
    + (options.label ? `<td align="right" style="padding:0 4px 14px;font-size:12px;line-height:18px;color:#6b7280">${options.label}</td>` : '')
    + `</tr></table>`;
  return (options.preheader ? preheaderOf(options.preheader) : '')
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${PAGE}" style="width:100%;background-color:${PAGE};color:#111827;color-scheme:light;font-family:${FONT}"><tr>`
    + `<td align="center" style="padding:24px 10px 28px">`
    + `<!--[if mso]><table role="presentation" width="600" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;margin:0 auto;text-align:left;font-family:${FONT}"><tr><td>`
    + brand + (options.bare ? inner : emailCard(inner, { padding: '24px', gap: 0 }))
    + `</td></tr></table>`
    + `<!--[if mso]></td></tr></table><![endif]-->`
    + `</td></tr></table>`;
}

/**
 * The top of an email laid on the page: who it greets, small; what happened, as the title; what to do next, under it. Everything
 * given is already escaped.
 */
export function emailHeadline(input: { kicker?: string | null; title: string; lines?: Array<string | null | undefined> }) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding:4px 4px 18px">`
    + (input.kicker ? emailLabel(input.kicker) : '')
    + `<p style="margin:${input.kicker ? 4 : 0}px 0 0;font-size:24px;line-height:30px;font-weight:700;letter-spacing:-.01em;color:#111827">${input.title}</p>`
    + (input.lines ?? []).filter((line): line is string => Boolean(line)).map(line => `<p style="margin:6px 0 0;font-size:15px;line-height:22px;color:#4b5563">${line}</p>`).join('')
    + `</td></tr></table>`;
}

/** The small print under the cards, on the page itself. Already escaped; links keep its colour. */
export const emailNote = (html: string) => `<p style="margin:0;padding:6px 4px 0;font-size:12px;line-height:18px;color:#6b7280">${html}</p>`;

const PILLS = { violet: ['#ede9fe', '#5b21b6'], teal: ['#ccfbf1', '#115e59'], gray: ['#f3f4f6', '#4b5563'], green: ['#d1fae5', '#065f46'] } as const;
export type EmailPillTone = keyof typeof PILLS;
/** A word about a contact, next to their name («Puede derivarte»): a pill, so it is not read as part of the name. */
export function emailPill(text: string, tone: EmailPillTone = 'gray') {
  const [fill, ink] = PILLS[tone];
  return `<span style="display:inline-block;padding:1px 8px;border-radius:999px;background-color:${fill};color:${ink};font-size:11px;line-height:18px;font-weight:600;white-space:nowrap;vertical-align:middle">${text}</span>`;
}

const attr = (text: string) => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));

/**
 * A button of the app's emails (15 Nov 2026). Its colour is the cell's own attribute and its `background-color`, with a border of the
 * same colour: a mail client or a relay that drops the `background` shorthand left white text on a white card, a button nobody could
 * see (seen that day in an example sent through a connector). `quiet` is the outlined one, for the second choice of an email.
 */
export function emailButton(href: string, label: string, options: { quiet?: boolean; color?: string } = {}) {
  const color = options.color ?? '#2563eb';
  const fill = options.quiet ? '#ffffff' : color;
  const ink = options.quiet ? '#111827' : '#ffffff';
  const edge = options.quiet ? '#d1d5db' : color;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;display:inline-table;vertical-align:top;margin:0 8px 8px 0"><tr>`
    + `<td bgcolor="${fill}" style="border-radius:10px;background-color:${fill};border:1px solid ${edge}">`
    + `<a href="${attr(href)}" style="display:inline-block;padding:9px 14px;border-radius:10px;background-color:${fill};color:${ink};text-decoration:none;font-size:14px;line-height:20px">${attr(label)}</a>`
    + `</td></tr></table>`;
}

/** The tints of a contact's initials, in the order the app uses (src/components/lead-drops/drop-contact-parts.tsx). */
const AVATAR_TINTS: Array<[string, string]> = [['#e0e7ff', '#3730a3'], ['#e0f2fe', '#075985'], ['#d1fae5', '#065f46'], ['#fef3c7', '#92400e'], ['#ede9fe', '#5b21b6'], ['#ffe4e6', '#9f1239']];
export const EMAIL_AVATAR_TINTS = AVATAR_TINTS.length;

/**
 * Who a card of an email is about: its initials on a tint of its own, its name and its role, in one row (16 Nov 2026, the redesign:
 * a card is recognised by its person before any of its text is read). `tag`: a word about them after the name («Para explorar»),
 * as a pill.
 * Everything given is already escaped by the caller.
 */
export function emailPerson(input: { initials: string; tint: number; name: string; role?: string | null; tag?: string | null; tagTone?: EmailPillTone }) {
  const [fill, ink] = AVATAR_TINTS[Math.abs(input.tint) % AVATAR_TINTS.length];
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>`
    + `<td width="40" valign="top" style="width:40px"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>`
    + `<td width="40" height="40" align="center" valign="middle" bgcolor="${fill}" style="width:40px;height:40px;border-radius:20px;background-color:${fill};color:${ink};font-size:14px;font-weight:600;line-height:40px;text-align:center">${input.initials}</td></tr></table></td>`
    + `<td valign="top" style="padding:0 0 0 12px">`
    + `<p style="margin:0;font-size:16px;line-height:22px;font-weight:600;color:#111827">${input.name}${input.tag ? ` ${emailPill(input.tag, input.tagTone)}` : ''}</p>`
    + (input.role ? `<p style="margin:1px 0 0;font-size:14px;line-height:20px;color:#4b5563">${input.role}</p>` : '')
    + `</td></tr></table>`;
}

/** The small uppercase word over a block of an email («Ahora», «Al contestar»): the only place a label is in capitals. */
export const emailLabel = (text: string, color = '#6b7280') =>
  `<p style="margin:0;font-size:11px;line-height:16px;letter-spacing:.06em;text-transform:uppercase;font-weight:600;color:${color}">${text}</p>`;

const CALLOUTS = { amber: ['#fffbeb', '#f59e0b', '#92400e'], blue: ['#eff6ff', '#2563eb', '#1d4ed8'], quiet: ['#f9fafb', '#d1d5db', '#6b7280'] } as const;

/**
 * The one thing of a card that is read first: what is happening at the company, or what to say when the call is answered. A tinted
 * block with a rule on its left, its label over its text and, under it, a quiet line (the source). Everything given is already escaped.
 */
export function emailCallout(input: { label: string; body: string; foot?: string | null; tone?: keyof typeof CALLOUTS; size?: number; /** The air over it. */ gap?: number }) {
  const [fill, rule, ink] = CALLOUTS[input.tone ?? 'amber'];
  const size = input.size ?? 14;
  return `${spacer(input.gap ?? 12)}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${fill}" style="width:100%;border-collapse:separate;background-color:${fill};border-radius:8px"><tr>`
    + `<td style="padding:10px 12px;border-left:3px solid ${rule};border-radius:8px">`
    + emailLabel(input.label, ink)
    + `<p style="margin:3px 0 0;font-size:${size}px;line-height:${size + 7}px;color:#1f2937">${input.body}</p>`
    + (input.foot ? `<p style="margin:3px 0 0;font-size:12px;line-height:18px;color:${ink}">${input.foot}</p>` : '')
    + `</td></tr></table>`;
}
