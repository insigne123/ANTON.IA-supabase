/**
 * The app's own emails (the morning alert, Monday's report, the Apify balance) sit on a white card of their own. A mail
 * client in dark mode that paints its background but keeps our dark text made them unreadable; on a white card they read the
 * same everywhere, and the clients that invert colors invert the whole card together.
 */
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export const emailShell = (inner: string) =>
  `<div style="background:#ffffff;color:#111827;color-scheme:light;font-family:${FONT};max-width:560px;margin:0 auto;padding:24px">${inner}</div>`;
