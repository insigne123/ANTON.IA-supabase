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
