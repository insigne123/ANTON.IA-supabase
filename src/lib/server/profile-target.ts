import { createHash } from 'node:crypto';

/** The row of a LinkedIn profile search in people_search_leads: one per team, person who searched and address. */
export function profileTargetId(userId: string, organizationId: string, linkedinUrl: string) {
  return `profile:${createHash('sha256').update(`${organizationId}\n${userId}\n${linkedinUrl}`).digest('hex')}`;
}
