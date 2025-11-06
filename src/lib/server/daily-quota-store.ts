
// Control de cuota diaria por usuario/recurso en Firestore.
// Estructura: daily_quotas/{resource}/users/{userId}/days/{YYYY-MM-DD}
//
// Exporta nombres "comunes" para maximizar compatibilidad con imports existentes.

import { db } from './firebase-admin';
import { Timestamp, FieldValue } from 'firebase-admin/firestore';

export type DailyQuotaResult = {
  allowed: boolean;
  count: number;
  limit: number;
  dayKey: string;
  resetAtISO: string; // inicio del siguiente día UTC
};

function todayKeyUTC(): string {
  // YYYY-MM-DD (UTC)
  return new Date().toISOString().slice(0, 10);
}

function nextDayStartISOUTC(): string {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0));
  return next.toISOString();
}

function dayDocRef(resource: string, userId: string, dayKey: string) {
  return db
    .collection('daily_quotas')
    .doc(resource)
    .collection('users')
    .doc(userId)
    .collection('days')
    .doc(dayKey);
}

/**
 * Incrementa 1 la cuota del día si no supera el límite.
 * Retorna estado final (permitido o no) y contador.
 */
export async function checkAndConsumeDailyQuota(
  params: { userId: string; resource: string; limit: number }
): Promise<DailyQuotaResult> {
  const { userId, resource, limit } = params;
  if (!resource || !Number.isFinite(limit) || limit <= 0) {
    const err = new Error('[daily-quota] Parámetros inválidos');
    (err as any).code = 'INVALID_ARGUMENT';
    throw err;
  }

  if(!userId || !userId.trim()){
      const err = new Error('missing user id');
      (err as any).code = 'MISSING_USER';
      throw err;
  }


  const dayKey = todayKeyUTC();
  const ref = dayDocRef(resource, userId, dayKey);

  const res = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const now = Timestamp.now();

    let count = 0;
    if (!snap.exists) {
      // Primer uso del día
      if (limit < 1) {
        return { allowed: false, count: 0 };
      }
      tx.set(ref, {
        count: 1,
        dayKey,
        createdAt: now,
        updatedAt: now,
      });
      return { allowed: true, count: 1 };
    } else {
      const data = snap.data() as { count?: number };
      count = Number(data?.count ?? 0);
      if (count >= limit) {
        // Límite alcanzado
        tx.update(ref, { updatedAt: now });
        return { allowed: false, count };
      }
      const nextCount = count + 1;
      tx.update(ref, { count: nextCount, updatedAt: now });
      return { allowed: true, count: nextCount };
    }
  });

  return {
    allowed: res.allowed,
    count: res.count,
    limit,
    dayKey,
    resetAtISO: nextDayStartISOUTC(),
  };
}

/** Solo consulta el estado actual (sin consumir). */
export async function getDailyQuotaStatus(
  params: { userId: string; resource: string; limit: number }
): Promise<DailyQuotaResult> {
  const { userId, resource, limit } = params;
  if (!userId || !userId.trim()) {
    return {
      allowed: false,
      count: 0,
      limit,
      dayKey: todayKeyUTC(),
      resetAtISO: nextDayStartISOUTC(),
    };
  }
  const dayKey = todayKeyUTC();
  const snap = await dayDocRef(resource, userId, dayKey).get();
  const count = snap.exists ? Number((snap.data() as any)?.count ?? 0) : 0;
  return {
    allowed: count < limit,
    count,
    limit,
    dayKey,
    resetAtISO: nextDayStartISOUTC(),
  };
}

/**
 * API alternativa usada a veces en proyectos:
 * - Lanza error si no hay cuota disponible.
 */
export async function consumeDailyQuotaOrThrow(
  params: { userId: string; resource: string; limit: number }
): Promise<DailyQuotaResult> {
  const r = await checkAndConsumeDailyQuota(params);
  if (!r.allowed) {
    const msg = `[daily-quota] Límite diario alcanzado para "${params.resource}" (${r.count}/${r.limit})`;
    throw Object.assign(new Error(msg), { code: 'DAILY_QUOTA_EXCEEDED', meta: r });
  }
  return r;
}

/** Aliases frecuentes para compatibilidad con imports existentes */
export const tryConsumeDailyQuota = checkAndConsumeDailyQuota;
export const ensureDailyQuota = checkAndConsumeDailyQuota;
export const canConsumeDailyQuota = getDailyQuotaStatus;
