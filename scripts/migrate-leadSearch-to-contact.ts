/**
 * Copia el contador del día UTC desde daily_quotas/leadSearch → daily_quotas/contact
 * solo si `contact` no existe o tiene menor conteo. Úsalo una sola vez si te interesa
 * conservar el progreso de "Contactos" que quedó grabado en leadSearch.
 *
 * Ejecutar:
 *  pnpm ts-node scripts/migrate-leadSearch-to-contact.ts
 *   o
 *  pnpm tsx scripts/migrate-leadSearch-to-contact.ts
 */

import { db } from '@/lib/server/firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';

function dayKeyUTC() {
  return new Date().toISOString().slice(0, 10);
}

async function run() {
  const dayKey = dayKeyUTC();
  const srcUsers = await db.collection('daily_quotas').doc('leadSearch').collection('users').get();

  console.log(`[migrate] day=${dayKey} users=${srcUsers.size}`);

  for (const userDoc of srcUsers.docs) {
    const userId = userDoc.id;
    const srcRef = userDoc.ref.collection('days').doc(dayKey);
    const dstRef = db.collection('daily_quotas').doc('contact').collection('users').doc(userId).collection('days').doc(dayKey);

    const [srcSnap, dstSnap] = await Promise.all([srcRef.get(), dstRef.get()]);
    const srcCount = srcSnap.exists ? Number((srcSnap.data() as any)?.count ?? 0) : 0;
    const dstCount = dstSnap.exists ? Number((dstSnap.data() as any)?.count ?? 0) : 0;

    if (srcCount > 0 && srcCount > dstCount) {
      await dstRef.set(
        {
          count: srcCount,
          dayKey,
          migratedFrom: 'leadSearch',
          updatedAt: Timestamp.now(),
          ...(dstSnap.exists ? {} : { createdAt: Timestamp.now() }),
        },
        { merge: true }
      );
      console.log(`[migrate] user=${userId} ${dstCount}→${srcCount}`);
    }
  }

  console.log('[migrate] done.');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
