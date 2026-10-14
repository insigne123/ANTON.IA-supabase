import test from 'node:test';
import assert from 'node:assert/strict';

test('each contact is looked up with what was chosen for it: email only by default, email and mobile when asked', async () => {
  const { groupByLookup } = await import('./complete-contacts');
  const leads = [{ id: 'a', name: 'Ana' }, { id: 'b', name: 'Beto' }, { id: 'c', name: 'Cata' }] as any[];
  assert.deepEqual(groupByLookup(leads, { b: 'email_phone' }).map(group => [group.revealPhone, group.leads.map(lead => lead.id)]),
    [[false, ['a', 'c']], [true, ['b']]]);
  assert.deepEqual(groupByLookup(leads, { a: 'email_phone', b: 'email_phone', c: 'email_phone' }).map(group => group.revealPhone), [true]);
  assert.deepEqual(groupByLookup([], {}), []);
});

test('the summary says who reached «Por escribir», who is still on its way and who has no email, with the credits', async () => {
  const { completionSummary } = await import('./complete-contacts');
  const summary = completionSummary({
    moved: [{ id: 'a', email: 'a@x.test' }, { id: 'b', email: 'b@x.test' }, { id: 'c', enrichmentStatus: 'pending_phone' }] as any[],
    notFound: ['d'], expired: 0, failures: [], consumed: 4, markedNotFound: true,
  });
  assert.equal(summary.title, 'Datos de contacto listos');
  assert.match(summary.description, /2 con correo pasan a «Por escribir»/);
  assert.match(summary.description, /1 sigue en búsqueda y aparecerá en «Por escribir»/);
  assert.match(summary.description, /1 quedó sin correo: lo verás al final de «Por escribir»/);
  assert.equal(completionSummary({ moved: [], notFound: ['a'], expired: 0, failures: [], consumed: 1, markedNotFound: true }).title, 'No encontramos correos');
});
