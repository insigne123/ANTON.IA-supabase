import assert from 'node:assert/strict';
import test from 'node:test';

import { autoSavedMessage, paidLeadKey, paidLeadsToSave } from './auto-save';

const lead = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: `Persona ${id}`, title: 'Gerente', company: 'Minera Sur', ...extra }) as any;
const nobody = { isSaved: () => false, isContacted: () => false, isClaimed: () => false };

test('a paid profile is saved once its data arrived, with an email or a mobile, and only once', () => {
  const leads = [
    lead('a', { email: 'a@sur.cl', sourceProviderId: 'apollo-a' }),
    lead('b', { primaryPhone: '+56912345678', enrichmentStatus: 'completed' }),
    lead('c', { email: 'c@sur.cl', enrichmentStatus: 'pending_phone' }), // the mobile is on its way: wait for it
    lead('d', {}), // nothing came back
    lead('e', { email: 'email_not_unlocked@domain.com' }), // a locked email is not an email
  ];
  const done = new Set<string>(['apollo-a']);
  assert.deepEqual(paidLeadsToSave(leads, { ...nobody, revealed: true, done }).map(item => item.id), ['b']);
  assert.deepEqual(paidLeadsToSave(leads, { ...nobody, revealed: false, done: new Set() }), [], 'nothing paid, nothing saved');
});

test('someone saved, contacted or held by a teammate is never saved again', () => {
  const leads = [lead('a', { email: 'a@sur.cl' }), lead('b', { email: 'b@sur.cl' }), lead('c', { email: 'c@sur.cl' }), lead('d', { email: 'd@sur.cl' })];
  const picked = paidLeadsToSave(leads, {
    revealed: true, done: new Set(),
    isSaved: (item) => item.id === 'a', isContacted: (item) => item.id === 'b', isClaimed: (item) => item.id === 'c',
  });
  assert.deepEqual(picked.map(item => item.id), ['d']);
});

test('the key is the provider\'s person when there is one', () => {
  assert.equal(paidLeadKey({ id: 'profile-search:x', sourceProviderId: 'p1' }), 'p1');
  assert.equal(paidLeadKey({ id: 'profile-search:x', apolloId: 'p2' }), 'p2');
  assert.equal(paidLeadKey({ id: ' x ' }), 'x');
});

test('the message names the person, and «Ver» opens «Por llamar» when there is a mobile', () => {
  assert.deepEqual(autoSavedMessage([lead('a', { primaryPhone: '+56912345678', name: 'Ana Rojas' })], 1), {
    title: 'Ana Rojas quedó guardado',
    description: 'Lo pagaste, así que queda a tu nombre en «Por escribir»: desde ahí lo llamas o le escribes por WhatsApp.',
    href: '/saved/leads/enriched?etapa=to_call',
  });
  const many = autoSavedMessage([lead('a', { email: 'a@sur.cl' }), lead('b', { email: 'b@sur.cl' })], 2);
  assert.equal(many.title, '2 contactos quedaron guardados');
  assert.equal(many.href, '/saved/leads/enriched');
});
