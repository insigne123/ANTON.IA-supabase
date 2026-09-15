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
