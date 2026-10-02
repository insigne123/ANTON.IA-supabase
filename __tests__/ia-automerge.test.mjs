import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Execute the real inline workflow against a fake GitHub API. No credentials or network.
const workflow = readFileSync('.github/workflows/ia-automerge.yml', 'utf8').replace(/\r\n/g, '\n');
const raw = workflow.split("node --input-type=module <<'NODE'\n")[1]?.split('\n          NODE')[0];
assert.ok(raw, 'the Node workflow script must be present');
const source = raw.split('\n').map(line => line.replace(/^          /, '')).join('\n')
  .replace("import { readFileSync } from 'node:fs';", '');
const runScript = new (Object.getPrototypeOf(async function () {}).constructor)('readFileSync', 'process', 'fetch', 'console', 'setTimeout', source);
const repo = 'owner/repo';
const sha = 'a'.repeat(40);
const pr = (patch = {}) => ({ number: 56, state: 'open', draft: false, base: { ref: 'main', repo: { full_name: repo } },
  head: { ref: 'claude/topic', sha, repo: { full_name: repo } }, user: { login: 'owner' }, labels: [{ name: 'ia-automerge' }],
  mergeable: true, mergeable_state: 'clean', ...patch });
const checks = () => ({ check_runs: ['verify', 'Unit, database, and integration tests'].map((name, index) => ({
  name, id: index + 1, head_sha: sha, app: { slug: 'github-actions' }, status: 'completed', conclusion: 'success',
})) });

async function harness({ pull = pr(), runs = checks(), reviews = [], permission = 'admin', onGet, eventName = 'workflow_dispatch', event, mergeStatus = 200 } = {}) {
  const calls = [];
  const logs = [];
  const process = { env: { GH_TOKEN: 'not-a-real-token', GITHUB_REPOSITORY: repo, GITHUB_EVENT_PATH: 'event.json',
    GITHUB_EVENT_NAME: eventName, PR_NUMBER: '56' }, exitCode: 0 };
  let reads = 0;
  const fetch = async (url, options) => {
    const path = String(url).split(`/repos/${repo}/`)[1];
    const body = options.body ? JSON.parse(options.body) : undefined;
    calls.push({ path, method: options.method, body });
    if (path === 'pulls/56' && options.method === 'GET') return Response.json(onGet?.(++reads) ?? pull);
    if (path.includes('/permission')) return Response.json({ permission });
    if (path.startsWith(`commits/${sha}/check-runs`)) return Response.json(runs);
    if (path.startsWith('pulls/56/reviews?')) return Response.json(reviews);
    if (path === 'pulls/56/reviews') return Response.json({ state: 'APPROVED' });
    if (path === 'pulls/56/merge') return Response.json({ merged: mergeStatus === 200, sha: 'b'.repeat(40) }, { status: mergeStatus });
    if (path.startsWith('pulls?state=open&head=')) return Response.json([{ number: 56 }]);
    throw new Error(`Unexpected API ${options.method} ${path}`);
  };
  await runScript(() => JSON.stringify(event ?? {}), process, fetch, { log: (...items) => logs.push(items.join(' ')), error: (...items) => logs.push(items.join(' ')) }, callback => callback());
  return { calls, logs, process, writes: calls.filter(call => call.method !== 'GET') };
}

test('automated integration requires opt-in, same repository, main, permitted branch and a non-draft PR', async () => {
  for (const pull of [pr({ labels: [] }), pr({ draft: true }), pr({ state: 'closed' }),
    pr({ head: { ref: 'claude/topic', sha, repo: { full_name: 'fork/repo' } } }),
    pr({ base: { ref: 'other', repo: { full_name: repo } } }), pr({ head: { ref: 'main', sha, repo: { full_name: repo } } })]) {
    assert.deepEqual((await harness({ pull })).writes, []);
  }
  assert.deepEqual((await harness({ permission: 'read' })).writes, []);
});

test('failed, missing, untrusted or superseded checks cannot grant approval', async () => {
  for (const runs of [{ check_runs: [] }, { check_runs: [{ ...checks().check_runs[0], conclusion: 'failure' }] },
    { check_runs: checks().check_runs.map(check => ({ ...check, app: { slug: 'other-app' } })) },
    { check_runs: [...checks().check_runs, { ...checks().check_runs[0], id: 100, status: 'in_progress', conclusion: null }] },
    { check_runs: checks().check_runs.map(check => ({ ...check, head_sha: 'c'.repeat(40) })) }]) {
    assert.deepEqual((await harness({ runs })).writes, []);
  }
});

test('a ready trusted PR gets a commit-bound bot review and a protected merge with the same SHA', async () => {
  const result = await harness();
  assert.equal(result.process.exitCode, 0);
  assert.deepEqual(result.writes.map(call => call.method), ['POST', 'PUT']);
  assert.equal(result.writes[0].body.commit_id, sha);
  assert.equal(result.writes[0].body.event, 'APPROVE');
  assert.match(result.writes[0].body.body, /no una revisión humana/);
  assert.deepEqual(result.writes[1].body, { sha, merge_method: 'merge' });
});

test('new pushes and withdrawn opt-in prevent review or merge', async () => {
  const changed = await harness({ onGet: count => count >= 3 ? pr({ head: { ...pr().head, sha: 'd'.repeat(40) } }) : pr() });
  assert.deepEqual(changed.writes, []);
  const afterReview = await harness({ onGet: count => count >= 4 ? pr({ labels: [] }) : pr() });
  assert.equal(afterReview.writes.length, 1);
  assert.equal(afterReview.writes[0].method, 'POST');
});

test('stale branches, requested changes and GitHub refusal are never bypassed', async () => {
  assert.deepEqual((await harness({ pull: pr({ mergeable_state: 'behind' }) })).writes, []);
  assert.deepEqual((await harness({ pull: pr({ mergeable: false, mergeable_state: 'dirty' }) })).writes, []);
  assert.deepEqual((await harness({ reviews: [{ id: 1, state: 'CHANGES_REQUESTED', user: { login: 'reviewer' }, commit_id: sha }] })).writes, []);
  const refused = await harness({ mergeStatus: 405 });
  assert.equal(refused.process.exitCode, 1);
  assert.equal(refused.writes.length, 2, 'there is no admin fallback, direct push or second merge');
});

test('an existing bot review for the tested commit is reused', async () => {
  const result = await harness({ reviews: [{ id: 1, state: 'APPROVED', user: { login: 'github-actions[bot]' }, commit_id: sha }] });
  assert.deepEqual(result.writes.map(call => call.method), ['PUT']);
});

test('workflow completion ignores forks, main pushes and superseded commits', async () => {
  for (const workflow_run of [{ event: 'push', head_repository: { full_name: repo } },
    { event: 'pull_request', head_repository: { full_name: 'fork/repo' } },
    { event: 'pull_request', head_repository: { full_name: repo }, head_sha: 'e'.repeat(40), pull_requests: [{ number: 56 }] }]) {
    assert.deepEqual((await harness({ eventName: 'workflow_run', event: { workflow_run } })).writes, []);
  }
  const resumed = await harness({ eventName: 'workflow_run', event: { workflow_run: {
    event: 'pull_request', head_repository: { full_name: repo }, head_sha: sha, head_branch: 'claude/topic', pull_requests: [],
  } } });
  assert.equal(resumed.writes.length, 2);
});

test('privileged workflow never checks out or executes the pull request contents', () => {
  assert.doesNotMatch(workflow, /actions\/checkout|download-artifact|pull_request_target/);
  assert.match(workflow, /node-version: 22/);
  assert.match(workflow, /pull-requests: write/);
});
