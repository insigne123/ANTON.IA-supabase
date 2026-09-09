type Bucket = { count: number; limit: number };

export type CreditStatus = Bucket & {
  resetAtISO?: string;
  mode?: 'user' | 'team' | 'hybrid';
  binding?: 'user' | 'team';
  user?: Bucket | null;
  team?: Bucket | null;
};

function validBucket(value: unknown): value is Bucket {
  if (!value || typeof value !== 'object') return false;
  const bucket = value as Bucket;
  return Number.isInteger(bucket.count) && bucket.count >= 0
    && Number.isInteger(bucket.limit) && bucket.limit >= 0;
}

export function parseCreditStatus(value: unknown): CreditStatus {
  if (!validBucket(value)) throw new Error('INVALID_CREDIT_STATUS');
  const status = value as CreditStatus;
  if ((status.user != null && !validBucket(status.user))
    || (status.team != null && !validBucket(status.team))
    || (status.mode != null && !['user', 'team', 'hybrid'].includes(status.mode))
    || (status.binding != null && !['user', 'team'].includes(status.binding))
    || (status.resetAtISO != null && (typeof status.resetAtISO !== 'string' || !Number.isFinite(Date.parse(status.resetAtISO))))) {
    throw new Error('INVALID_CREDIT_STATUS');
  }
  return status;
}

export function personalCreditSummary(status: CreditStatus) {
  // Never substitute a shared team balance for a personal allowance.
  const bucket = status.mode === 'team' ? null : status.user
    ?? (status.binding !== 'team' && status.mode !== 'hybrid' ? status : null);
  if (!bucket) return null;
  return {
    used: bucket.count,
    limit: bucket.limit,
    remaining: Math.max(0, bucket.limit - bucket.count),
  };
}
