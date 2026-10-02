/**
 * Which organizations the daily sync visits and what it asks for each: one visit per organization (its first active
 * profile's creator acts as the scope), tenders when the Mercado Público ticket exists, hiring when JSearch has its key.
 */
export function dailyOpportunityPlan(profiles: Array<{ organization_id: string; created_by: string }>, keys: { ticket: boolean; jsearch: boolean }) {
  const seen = new Set<string>();
  return profiles.flatMap(profile => {
    if (!profile.organization_id || !profile.created_by || seen.has(profile.organization_id)) return [];
    seen.add(profile.organization_id);
    if (!keys.ticket && !keys.jsearch) return [];
    return [{ organizationId: profile.organization_id, userId: profile.created_by, tenders: keys.ticket, hiring: keys.jsearch }];
  });
}
