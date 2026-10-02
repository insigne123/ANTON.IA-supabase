import type { AuthContext } from '@/lib/server/auth-utils';
import type { ExtensionProfile } from '@/lib/extension-contracts';
import { findExtensionLead, saveExtensionLead } from '@/lib/server/extension-leads';
import { readTeamLocks } from '@/lib/server/team-locks';
import { normalizeLockLinkedin, teamLockNotice } from '@/lib/team-lock';

/** At most this many people per batch: one approval-free save of what is on screen, never a page-by-page harvest. */
export const SAVE_BATCH_LIMIT = 25;

type Person = { linkedinUrl: string; fullName: string };
type Deps = { readTeamLocks: typeof readTeamLocks; findExtensionLead: typeof findExtensionLead; saveExtensionLead: typeof saveExtensionLead };

/**
 * save-batch (plan 8, phase 4, PR-4c): the people the person chose from a LinkedIn search, saved with what the results show
 * (name, title and company). Someone another member is working is not saved (the team locks that block, with collaboration on);
 * someone already saved in the organization is left as it is, so a richer record is never overwritten by a search snippet.
 * One at a time, in the order chosen; a failure is reported and the rest go on.
 */
export async function saveExtensionBatch(auth: AuthContext, profiles: ExtensionProfile[], deps: Deps = { readTeamLocks, findExtensionLead, saveExtensionLead }) {
  const unique = [...new Map(profiles.map(profile => [profile.linkedinUrl, profile])).values()].slice(0, SAVE_BATCH_LIMIT);
  const person = (profile: ExtensionProfile): Person => ({ linkedinUrl: profile.linkedinUrl, fullName: profile.fullName || 'Perfil de LinkedIn' });
  const result = { saved: [] as Person[], already: [] as Person[], blocked: [] as Array<Person & { reason: string }>, failed: [] as Array<Person & { error: string }> };
  if (!unique.length) return result;
  const locks = await deps.readTeamLocks(auth.supabase, { userId: auth.user.id, organizationId: auth.organizationId },
    { linkedinUrls: unique.map(profile => profile.linkedinUrl) });
  for (const profile of unique) {
    const notice = teamLockNotice(locks.byLinkedin[normalizeLockLinkedin(profile.linkedinUrl)] ?? null);
    if (notice?.blocks) { result.blocked.push({ ...person(profile), reason: notice.text }); continue; }
    try {
      if (await deps.findExtensionLead(auth, profile)) { result.already.push(person(profile)); continue; }
      await deps.saveExtensionLead(auth, profile, false);
      result.saved.push(person(profile));
    } catch (error) {
      result.failed.push({ ...person(profile), error: error instanceof Error ? error.message.slice(0, 200) : 'No se pudo guardar.' });
    }
  }
  return result;
}
