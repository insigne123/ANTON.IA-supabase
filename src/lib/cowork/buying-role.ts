/** Who decides or influences the purchase by their title goes first, junior and support roles last (round 10: Luna put the junior
 * recruiter first in «¿A quién le escribo hoy?» because the list came newest first). Who runs the area comes before who leads a
 * team (round 12: «el orden no se basa en quién decide», with the Jefa de Selección before the Gerente de Personas).
 * 0 runs the area, 1 leads a team, 2 unknown, 3 junior or support. */
const AREA_ROLE = /\b(?:gerente|subgerente|director\w*|head|vp|chief|ceo|coo|cfo|chro|due[ñn][oa]|fundador\w*|socio)\b/i;
const TEAM_ROLE = /\b(?:jef[ea]|manager|l[ií]der|lead)\b/i;
const SUPPORT_ROLE = /\b(?:junior|jr|analista|asistente|practicante|becari[oa]|trainee)\b/i;

export function coworkBuyingRoleRank(title: unknown) {
  const text = String(title || '');
  return SUPPORT_ROLE.test(text) ? 3 : AREA_ROLE.test(text) ? 0 : TEAM_ROLE.test(text) ? 1 : 2;
}

/** Decides or influences the purchase: runs the area or leads a team. */
export function coworkDecidesPurchase(title: unknown) {
  return coworkBuyingRoleRank(title) <= 1;
}
