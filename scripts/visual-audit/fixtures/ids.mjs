// Stable ids and time helpers for the audit fixtures. Dates are relative to the run's start so «hace 2 días» reads true for
// both the browser and the server, which keeps its own clock.
export const uid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export function makeContext({ ownerEmail, now = Date.now(), pageGuideIds = [] }) {
  const at = ms => new Date(now - ms).toISOString();
  return {
    now,
    ORG: uid(1),
    OWNER: uid(11),
    MEMBER: uid(12),
    ownerEmail,
    pageGuideIds,
    memberEmail: 'diego.fuentes@yago-qa.cl',
    uid,
    minutesAgo: n => at(n * 60_000),
    hoursAgo: n => at(n * 3_600_000),
    daysAgo: n => at(n * 86_400_000),
    daysAhead: n => new Date(now + n * 86_400_000).toISOString(),
    today: new Date(now).toISOString().slice(0, 10),
  };
}
