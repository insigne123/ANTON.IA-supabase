/** Shared declarations keep agent input validation and the server registry aligned. */
export const COWORK_DOMAIN_FIXED_READS = ['missions.list', 'exceptions.list', 'campaigns.inbox', 'audience.analyze', 'message.context'] as const;
export const COWORK_DOMAIN_ENTITY_READS = ['crm.collaboration', 'privacy.contactability', 'campaigns.plan', 'campaigns.step_context', 'crm.record', 'gmail.contact_history', 'lists.review_contact', 'message.check_terms', 'message.check_evidence'] as const;
export type CoworkDomainRead = typeof COWORK_DOMAIN_FIXED_READS[number] | typeof COWORK_DOMAIN_ENTITY_READS[number];
export function isCoworkDomainRead(action: string): action is CoworkDomainRead {
  return [...COWORK_DOMAIN_FIXED_READS, ...COWORK_DOMAIN_ENTITY_READS].some(item => item === action);
}
