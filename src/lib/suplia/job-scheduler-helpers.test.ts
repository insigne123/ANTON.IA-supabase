import test from 'node:test';
import assert from 'node:assert/strict';

import { countActiveSupliaJobsByOrganization, pickSupliaSchedulableJobsByOrganization } from './job-scheduler-helpers';

test('counts active jobs by organization', () => {
  assert.deepEqual(
    countActiveSupliaJobsByOrganization([
      { organization_id: 'org-a' },
      { organization_id: 'org-a' },
      { organization_id: 'org-b' },
    ]),
    { 'org-a': 2, 'org-b': 1 },
  );
});

test('scheduler picks jobs while respecting organization cap', () => {
  const jobs = [
    { id: 'job-1', organization_id: 'org-a' },
    { id: 'job-2', organization_id: 'org-a' },
    { id: 'job-3', organization_id: 'org-b' },
    { id: 'job-4', organization_id: 'org-c' },
  ];

  const selected = pickSupliaSchedulableJobsByOrganization(jobs, {}, 3, 1);
  assert.deepEqual(selected.map((job) => job.id), ['job-1', 'job-3', 'job-4']);
});

test('scheduler skips organizations that already reached active limit', () => {
  const jobs = [
    { id: 'job-1', organization_id: 'org-a' },
    { id: 'job-2', organization_id: 'org-b' },
    { id: 'job-3', organization_id: 'org-c' },
  ];

  const selected = pickSupliaSchedulableJobsByOrganization(jobs, { 'org-a': 1, 'org-b': 0 }, 3, 1);
  assert.deepEqual(selected.map((job) => job.id), ['job-2', 'job-3']);
});

test('scheduler allows more than one job per organization when configured', () => {
  const jobs = [
    { id: 'job-1', organization_id: 'org-a' },
    { id: 'job-2', organization_id: 'org-a' },
    { id: 'job-3', organization_id: 'org-a' },
  ];

  const selected = pickSupliaSchedulableJobsByOrganization(jobs, {}, 3, 2);
  assert.deepEqual(selected.map((job) => job.id), ['job-1', 'job-2']);
});
