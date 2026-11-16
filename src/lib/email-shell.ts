/**
 * The app's own emails (the morning alert, Monday's report, the Apify balance) sit on a white card of their own. A mail
 * client in dark mode that paints its background but keeps our dark text made them unreadable; on a white card they read the
 * same everywhere, and the clients that invert colors invert the whole card together.
 */
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export const emailShell = (inner: string) =>
  `<div style="background:#ffffff;color:#111827;color-scheme:light;font-family:${FONT};max-width:560px;margin:0 auto;padding:24px">${inner}</div>`;

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
 * a card is recognised by its person before any of its text is read). `tag`: a quiet word after the name («para explorar»).
 * Everything given is already escaped by the caller.
 */
export function emailPerson(input: { initials: string; tint: number; name: string; role?: string | null; tag?: string | null }) {
  const [fill, ink] = AVATAR_TINTS[Math.abs(input.tint) % AVATAR_TINTS.length];
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>`
    + `<td width="40" valign="top" style="width:40px"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>`
    + `<td width="40" height="40" align="center" valign="middle" bgcolor="${fill}" style="width:40px;height:40px;border-radius:20px;background-color:${fill};color:${ink};font-size:14px;font-weight:600;line-height:40px;text-align:center">${input.initials}</td></tr></table></td>`
    + `<td valign="top" style="padding:0 0 0 12px">`
    + `<p style="margin:0;font-size:16px;line-height:22px;font-weight:600;color:#111827">${input.name}${input.tag ? ` <span style="font-size:12px;font-weight:400;color:#6b7280">· ${input.tag}</span>` : ''}</p>`
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
export function emailCallout(input: { label: string; body: string; foot?: string | null; tone?: keyof typeof CALLOUTS; size?: number }) {
  const [fill, rule, ink] = CALLOUTS[input.tone ?? 'amber'];
  const size = input.size ?? 14;
  return `<div style="margin:12px 0 0;padding:10px 12px;border-left:3px solid ${rule};border-radius:8px;background-color:${fill}">`
    + emailLabel(input.label, ink)
    + `<p style="margin:3px 0 0;font-size:${size}px;line-height:${size + 7}px;color:#1f2937">${input.body}</p>`
    + (input.foot ? `<p style="margin:3px 0 0;font-size:12px;line-height:18px;color:${ink}">${input.foot}</p>` : '')
    + `</div>`;
}
