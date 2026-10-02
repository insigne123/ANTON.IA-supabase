import test from 'node:test';
import assert from 'node:assert/strict';
import { saveExtensionBatch } from './extension-batch';

const auth = { supabase: {}, organizationId: 'org', user: { id: 'me' } } as any;
const profile = (handle: string, fullName = handle) => ({ linkedinUrl: `https://www.linkedin.com/in/${handle}`, fullName, title: 'Gerente', companyName: 'Acme',
  email: '', companyDomain: '', primaryPhone: '', emailStatus: 'unknown' });

test('saves the new ones, leaves the saved ones as they are and skips the ones another member is working', async () => {
  const saved: string[] = [];
  const result = await saveExtensionBatch(auth, [profile('ana'), profile('bruno'), profile('carla'), profile('ana'), profile('diego')], {
    readTeamLocks: (async () => ({ enabled: true, byEmail: {}, byProviderId: {}, byLinkedin: {
      'linkedin.com/in/carla': { status: 'active', ownerName: 'Ana', mine: false, replied: true, lastContactedAt: null },
      // Saved by someone else is a notice, not a lock: she is found as already saved.
      'linkedin.com/in/bruno': { status: 'saved', ownerName: 'Ana', mine: false, replied: false, lastContactedAt: null },
    } })) as any,
    findExtensionLead: (async (_auth: unknown, p: any) => (p.linkedinUrl.endsWith('/bruno') ? { id: 'b' } : null)) as any,
    saveExtensionLead: (async (_auth: unknown, p: any, replace: boolean) => {
      assert.equal(replace, false, 'a batch never replaces fields');
      if (p.linkedinUrl.endsWith('/diego')) throw new Error('timeout');
      saved.push(p.linkedinUrl); return { lead: {}, disposition: 'saved' };
    }) as any,
  });
  assert.deepEqual(result.saved.map(item => item.fullName), ['ana'], 'ana once, despite the repeat');
  assert.deepEqual(result.already.map(item => item.fullName), ['bruno']);
  assert.deepEqual(result.blocked, [{ linkedinUrl: 'https://www.linkedin.com/in/carla', fullName: 'carla', reason: 'En conversación con Ana' }]);
  assert.deepEqual(result.failed, [{ linkedinUrl: 'https://www.linkedin.com/in/diego', fullName: 'diego', error: 'timeout' }]);
  assert.deepEqual(saved, ['https://www.linkedin.com/in/ana']);
});

test('at most 25 per batch', async () => {
  let asked = 0;
  const many = Array.from({ length: 30 }, (_, index) => profile(`p${index}`));
  const result = await saveExtensionBatch(auth, many, {
    readTeamLocks: (async (_c: unknown, _s: unknown, input: { linkedinUrls: string[] }) => { asked = input.linkedinUrls.length; return { enabled: false, byEmail: {}, byProviderId: {}, byLinkedin: {} }; }) as any,
    findExtensionLead: (async () => null) as any,
    saveExtensionLead: (async () => ({ lead: {}, disposition: 'saved' })) as any,
  });
  assert.equal(asked, 25);
  assert.equal(result.saved.length, 25);
});
