/** How long a proposal waits for approval before it stops by itself (audit C1). Shared by the worker and the conversation. */
export const COWORK_APPROVAL_EXPIRY_DAYS = 7;

/** The line a stopped run shows when it stopped because nobody approved it in time. */
export function coworkExpiredApprovalText(days = COWORK_APPROVAL_EXPIRY_DAYS) {
  return `Venció: pasaron ${days} días sin aprobación. Lo consultado quedó guardado; si aún lo necesitas, pídelo de nuevo.`;
}
