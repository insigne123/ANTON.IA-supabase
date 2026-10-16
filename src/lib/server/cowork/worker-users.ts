import { coworkUserIds } from '@/lib/cowork/access';

/** The people whose Cowork work the scheduled workers take: the owner and COWORK_ALLOWED_USER_IDS. */
export function coworkWorkerUserIds() {
  return coworkUserIds({ ownerId: process.env.COWORK_OWNER_USER_ID, allowedIds: process.env.COWORK_ALLOWED_USER_IDS });
}

/**
 * Each queue is claimed per person (the claim functions take p_user_id): asks for each one in turn and returns the first
 * job. The starting person rotates with the minute, so one person's queue never keeps another waiting.
 */
export async function claimForCoworkUsers<T>(claim: (userId: string) => Promise<T | null | undefined>, now = Date.now()): Promise<T | null> {
  const ids = coworkWorkerUserIds();
  const start = ids.length ? Math.floor(now / 60_000) % ids.length : 0;
  for (let index = 0; index < ids.length; index++) {
    const job = await claim(ids[(start + index) % ids.length]);
    if (job) return job;
  }
  return null;
}
