type SupliaSchedulableJobLike = {
  id: string;
  organization_id?: string | null;
};

export function pickSupliaSchedulableJobsByOrganization(
  jobs: SupliaSchedulableJobLike[],
  activeJobsByOrganization: Record<string, number>,
  limit: number,
  maxJobsPerOrganization = 1,
) {
  const selected: SupliaSchedulableJobLike[] = [];
  const counts = new Map<string, number>(Object.entries(activeJobsByOrganization));

  for (const job of jobs) {
    if (selected.length >= limit) break;
    const organizationId = String(job.organization_id || 'unknown');
    const current = counts.get(organizationId) || 0;
    if (current >= maxJobsPerOrganization) continue;
    selected.push(job);
    counts.set(organizationId, current + 1);
  }

  return selected;
}

export function countActiveSupliaJobsByOrganization(jobs: Array<{ organization_id?: string | null }>) {
  return jobs.reduce<Record<string, number>>((acc, job) => {
    const organizationId = String(job.organization_id || 'unknown');
    acc[organizationId] = (acc[organizationId] || 0) + 1;
    return acc;
  }, {});
}
