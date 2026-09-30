import type { CoworkIconKey } from './presentation';

/**
 * Who does each read of a turn, as the person sees it (plan 2, G4). Cowork's work splits into
 * specialties, each with a name, like the Writer and the Reviewer (G1): the numbers go to the
 * Analyst, audiences and lists to the Strategist, what is known about a contact to the Researcher,
 * and LinkedIn to its own agent. The name comes from the read itself, never from the model, so it
 * costs nothing and cannot be wrong about what ran. Plain lookups (a contact, the profile, the
 * account) stay with Cowork and carry no name.
 */
export type CoworkSpecialist = 'analyst' | 'strategist' | 'researcher' | 'linkedin';
export type CoworkSpecialistInfo = { id: CoworkSpecialist; name: string; icon: CoworkIconKey };

export const COWORK_SPECIALISTS: Record<CoworkSpecialist, CoworkSpecialistInfo> = {
  analyst: { id: 'analyst', name: 'Analista', icon: 'chart' },
  strategist: { id: 'strategist', name: 'Estratega', icon: 'target' },
  researcher: { id: 'researcher', name: 'Investigadora', icon: 'research' },
  linkedin: { id: 'linkedin', name: 'LinkedIn', icon: 'linkedin' },
};

/** Exact reads first, then families (the part before the dot). */
const EXACT: Record<string, CoworkSpecialist> = {
  'campaigns.batch_report': 'analyst', 'campaigns.list': 'analyst', 'files.read': 'analyst', 'files.list': 'analyst',
  'campaigns.company_plan': 'strategist', 'campaigns.next_touch': 'strategist', 'campaigns.retry_review': 'strategist',
  'campaigns.plan': 'strategist', 'privacy.contactability_batch': 'strategist', 'privacy.contactability': 'strategist',
};
const FAMILIES: Record<string, CoworkSpecialist> = {
  metrics: 'analyst', deliverability: 'analyst',
  audience: 'strategist', saved_searches: 'strategist', lists: 'strategist',
  research: 'researcher', crm: 'researcher', contacted: 'researcher', replies: 'researcher', gmail: 'researcher', compliance: 'researcher',
  linkedin: 'linkedin',
};

/** The agent that does a read, or null when Cowork does it itself. */
export function coworkSpecialistFor(action: string | null | undefined): CoworkSpecialistInfo | null {
  if (!action) return null;
  const id = EXACT[action] ?? FAMILIES[action.split('.')[0]];
  return id ? COWORK_SPECIALISTS[id] : null;
}
