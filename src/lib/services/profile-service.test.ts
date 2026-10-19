import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const compiled = ts.transpileModule(readFileSync('src/lib/services/profile-service.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;

/** The service over a fake client that counts its calls; `fail` makes the next profile read fail once. */
function load() {
  const calls = { user: 0, profiles: 0 };
  let fail = false;
  const tick = () => new Promise(resolve => setTimeout(resolve, 5));
  const supabase = {
    auth: { getUser: async () => { calls.user++; await tick(); return { data: { user: { id: 'u-1' } }, error: null }; } },
    from: (table: string) => {
      assert.equal(table, 'profiles');
      const query = {
        select: () => query,
        eq: () => query,
        maybeSingle: async () => {
          calls.profiles++; await tick();
          if (fail) { fail = false; return { data: null, error: new Error('timeout') }; }
          return { data: { id: 'u-1', full_name: 'Ana', signatures: { gmail: { enabled: true } } }, error: null };
        },
      };
      return query;
    },
  };
  const exports: any = {};
  new Function('require', 'exports', compiled)((name: string) => {
    assert.equal(name, '@/lib/supabase', `Unexpected dependency ${name}`);
    return { supabase };
  }, exports);
  return { service: exports.profileService, calls, failNext: () => { fail = true; } };
}

test('the reads of «Firmas y estilo» that arrive together share one: one getUser and one query instead of five', async () => {
  const { service, calls } = load();
  const [profile, signatures, again, gmail, booking] = await Promise.all([
    service.getCurrentProfile(), service.getSignatures(), service.getProfile(), service.getSignatures(), service.getSignatures(),
  ]);
  assert.deepEqual(calls, { user: 1, profiles: 1 });
  assert.equal(profile.full_name, 'Ana');
  assert.deepEqual(again, profile);
  assert.deepEqual(signatures, { gmail: { enabled: true } });
  // Each caller has its own copy: the signature storage changes what it read before saving it.
  gmail.outlook = { enabled: false };
  assert.equal(booking.outlook, undefined);
  assert.notEqual(profile, again);
});

test('nothing is kept once a read settles, so a later read sees what was saved', async () => {
  const { service, calls } = load();
  await service.getProfile();
  await service.getProfile();
  assert.deepEqual(calls, { user: 2, profiles: 2 });
});

test('a failed read fails everyone who was waiting for it, and the next one reads again', async () => {
  const { service, calls, failNext } = load();
  failNext();
  const results = await Promise.allSettled([service.getProfile(), service.getSignatures()]);
  assert.deepEqual(results.map(result => result.status), ['rejected', 'rejected']);
  assert.equal(calls.profiles, 1);
  assert.equal((await service.getProfile()).id, 'u-1');
  assert.equal(calls.profiles, 2);
});

test('a read of someone else is not shared with the signed-in person', async () => {
  const { service, calls } = load();
  await Promise.all([service.getProfile('u-2'), service.getProfile()]);
  assert.equal(calls.profiles, 2);
});
