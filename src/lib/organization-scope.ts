export type OrganizationMembership = {
  organizationId: string;
  role: 'owner' | 'admin' | 'member';
  createdAt: string;
};

export function selectActiveOrganizationMembership(
  memberships: OrganizationMembership[],
  requestedOrganizationId?: string | null,
  storedOrganizationId?: string | null,
) {
  const requested = String(requestedOrganizationId || '').trim();
  const stored = String(storedOrganizationId || '').trim();
  if (requested) {
    return memberships.find((membership) => membership.organizationId === requested) || null;
  }
  return memberships.find((membership) => membership.organizationId === stored)
    || memberships[0]
    || null;
}
