/** Who decides or influences the purchase by their title goes first, junior and support roles last (round 10: Luna put the junior
 * recruiter first in «¿A quién le escribo hoy?» because the list came newest first). 0 decides, 1 unknown, 2 junior or support. */
const BUYING_ROLE = /\b(?:gerente|jef[ea]|director\w*|head|manager|l[ií]der|lead|vp|chief|subgerente)\b/i;
const SUPPORT_ROLE = /\b(?:junior|jr|analista|asistente|practicante|becari[oa]|trainee)\b/i;

export function coworkBuyingRoleRank(title: unknown) {
  const text = String(title || '');
  return SUPPORT_ROLE.test(text) ? 2 : BUYING_ROLE.test(text) ? 0 : 1;
}
