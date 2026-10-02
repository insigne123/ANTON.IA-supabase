import test from 'node:test';
import assert from 'node:assert/strict';
import { isOpportunitiesUserAllowed, opportunitiesAllowedEmails } from './access';

const confirmed = '2026-01-10T12:00:00Z';

test('the list takes commas, spaces and capitals, and drops what is not an address', () => {
  assert.deepEqual([...opportunitiesAllowedEmails(' Ana@Acme.cl, ,luis@acme.cl,no-es-correo ')], ['ana@acme.cl', 'luis@acme.cl']);
  assert.equal(opportunitiesAllowedEmails(undefined).size, 0);
});

test('only a confirmed account of the list gets in; an empty list lets nobody in', () => {
  const list = 'nicolas.yarur.g@yago.cl';
  assert.equal(isOpportunitiesUserAllowed({ email: 'Nicolas.Yarur.G@yago.cl', email_confirmed_at: confirmed }, list), true);
  assert.equal(isOpportunitiesUserAllowed({ email: 'nicolas.yarur.g@yago.cl', email_confirmed_at: null }, list), false);
  assert.equal(isOpportunitiesUserAllowed({ email: 'otra@grupoexpro.com', email_confirmed_at: confirmed }, list), false);
  assert.equal(isOpportunitiesUserAllowed({ email: 'nicolas.yarur.g@yago.cl', email_confirmed_at: confirmed }, ''), false);
  assert.equal(isOpportunitiesUserAllowed(null, list), false);
});
