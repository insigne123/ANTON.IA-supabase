import { db } from './firebase-admin';

type LockStatus = 'queued' | 'done' | 'error';
const COL = 'researchLocks';

function refFor(leadRef: string) {
  return db.collection(COL).doc(encodeURIComponent(leadRef));
}

/** Crea locks atómicamente y devuelve cuáles se pueden enviar y cuáles se omiten. */
export async function filterAndLock(leadRefs: string[]) {
  const allowed: string[] = [];
  const skipped: string[] = [];

  await db.runTransaction(async (tx) => {
    for (const r of leadRefs) {
      const d = refFor(r);
      const snap = await tx.get(d);
      const status = snap.exists ? (snap.data()?.status as LockStatus) : null;

      if (status === 'queued' || status === 'done') {
        skipped.push(r);
        continue;
      }
      allowed.push(r);
      tx.set(d, { status: 'queued', updatedAt: new Date() }, { merge: true });
    }
  });

  return { allowed, skipped };
}

export async function markDone(leadRefs: string[]) {
  const batch = db.batch();
  for (const r of leadRefs) batch.set(refFor(r), { status: 'done', updatedAt: new Date() }, { merge: true });
  await batch.commit();
}

export async function markError(leadRefs: string[]) {
  const batch = db.batch();
  for (const r of leadRefs) batch.set(refFor(r), { status: 'error', updatedAt: new Date() }, { merge: true });
  await batch.commit();
}
