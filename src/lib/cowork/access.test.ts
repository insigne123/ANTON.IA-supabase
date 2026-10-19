import assert from 'node:assert/strict';
import test from 'node:test';
import { COWORK_OWNER_EMAIL, isCoworkIdentityAllowed } from './access';

const id = '00000000-0000-4000-8000-000000000001';
const config = { enabled: 'true', ownerId: id };
const user = { id, email: COWORK_OWNER_EMAIL, email_confirmed_at: '2026-09-15T00:00:00Z' };

test('Cowork requires the pinned UUID and verified exact email', () => {
  assert.equal(isCoworkIdentityAllowed(user, config), true);
  assert.equal(isCoworkIdentityAllowed({ ...user, email: ` ${COWORK_OWNER_EMAIL.toUpperCase()} ` }, config), true);
  for (const candidate of [null, { ...user, id: 'another-id' }, { ...user, email: 'admin@yago.cl' },
    { ...user, email: `${COWORK_OWNER_EMAIL}.example.com` }, { ...user, email_confirmed_at: null },
    { ...user, email_confirmed_at: 'invalid' }]) {
    assert.equal(isCoworkIdentityAllowed(candidate, config), false);
  }
});

test('Cowork fails closed on missing configuration and kill switch', () => {
  for (const settings of [{}, { enabled: 'true' }, { ...config, enabled: 'false' },
    { ...config, enabled: 'TRUE' }, { ...config, ownerId: '*' }]) {
    assert.equal(isCoworkIdentityAllowed(user, settings), false);
  }
});

test('the QA account is let in by its own id and email; configuration only narrows the fixed list', async () => {
  const { coworkUserIds, isCoworkEmailAllowed } = await import('./access');
  const qa = { id: '00000000-0000-4000-8000-0000000000aa', email: 'nicolas.yarur.g+qa@yago.cl', email_confirmed_at: '2026-10-16T00:00:00Z' };
  const both = { ...config, allowedIds: ` ${qa.id.toUpperCase()} , not-a-uuid,${id}` };
  assert.deepEqual(coworkUserIds(both), [id, qa.id]);
  assert.equal(isCoworkIdentityAllowed(qa, both), true);
  assert.equal(isCoworkIdentityAllowed(user, both), true, 'the owner keeps access');
  assert.equal(isCoworkIdentityAllowed(qa, config), false, 'without its id configured the QA account stays out');
  for (const candidate of [{ ...qa, email: 'nicolas.yarur.g+otro@yago.cl' }, { ...qa, id: 'another-id' }, { ...qa, email_confirmed_at: null }]) {
    assert.equal(isCoworkIdentityAllowed(candidate, both), false);
  }
  assert.equal(isCoworkIdentityAllowed({ ...qa, id: '00000000-0000-4000-8000-0000000000bb', email: 'intruso@yago.cl' },
    { ...both, allowedIds: '00000000-0000-4000-8000-0000000000bb' }), false, 'an id in the configuration does not add an email');
  assert.equal(isCoworkEmailAllowed(' Nicolas.Yarur.G+QA@yago.cl '), true);
  assert.equal(isCoworkIdentityAllowed(qa, { ...both, enabled: 'false' }), false);
});

test('open to everyone (COWORK_OPEN_TO_ALL), any confirmed account passes; the kill switch and the confirmed email still rule', () => {
  const open = { enabled: 'true', openToAll: 'true' };
  const seller = { id: '00000000-0000-4000-8000-0000000000cc', email: 'vendedora@grupoexpro.cl', email_confirmed_at: '2026-10-01T00:00:00Z' };
  assert.equal(isCoworkIdentityAllowed(seller, open), true);
  assert.equal(isCoworkIdentityAllowed(user, open), true, 'the owner too');
  assert.equal(isCoworkIdentityAllowed(seller, { ...open, enabled: 'false' }), false);
  assert.equal(isCoworkIdentityAllowed(seller, { ...open, openToAll: 'TRUE' }), false, 'only the exact value opens it');
  for (const candidate of [null, { ...seller, id: 'not-a-uuid' }, { ...seller, email_confirmed_at: null }, { ...seller, email: ' ' },
    { ...seller, email_confirmed_at: 'ayer' }]) {
    assert.equal(isCoworkIdentityAllowed(candidate, open), false);
  }
});
