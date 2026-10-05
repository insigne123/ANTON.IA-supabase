import assert from 'node:assert/strict';
import test from 'node:test';
import { dailyOpportunityPlan, dailyTenderSearch } from './daily';
import { NO_ORGANIZATION_TICKET } from './tickets';

const done = (errors: Array<string | null> = [null, null]) => ({ status: 'done', matched: 3, created: 1,
  sources: errors.map((error, index) => ({ source: index ? 'compra_agil' : 'mercado_publico', error })) });

test('every organization with a profile gets its tender search; hiring only with the JSearch key', () => {
  const profiles = [{ organization_id: 'o1', created_by: 'u1' }, { organization_id: 'o1', created_by: 'u2' }, { organization_id: 'o2', created_by: 'u3' }];
  assert.deepEqual(dailyOpportunityPlan(profiles, { jsearch: false }), [
    { organizationId: 'o1', userId: 'u1', tenders: true, hiring: false }, { organizationId: 'o2', userId: 'u3', tenders: true, hiring: false }]);
  assert.deepEqual(dailyOpportunityPlan(profiles, { jsearch: true }).map(item => item.hiring), [true, true]);
});

test('with a member\'s ticket the organization searches; without any, both sources are recorded as skipped at no cost', async () => {
  const searched: string[] = [];
  const outcome = await dailyTenderSearch({
    resolveTicket: async () => ({ ticket: 'TICKET-A', userId: 'u1', source: 'own' }),
    search: async ticket => { searched.push(ticket); return done(); },
    skip: async () => assert.fail('not skipped'), markRejected: async () => assert.fail('not rejected'),
  });
  assert.deepEqual(searched, ['TICKET-A']);
  assert.deepEqual(outcome, { status: 'done', matched: 3, created: 1, ticket: 'own', errors: [] });
  assert.ok(!JSON.stringify(outcome).includes('TICKET-A'), 'the outcome of the cron never carries the ticket');

  const skipped: Array<[string, string]> = [];
  const none = await dailyTenderSearch({
    resolveTicket: async () => null, search: async () => assert.fail('no search without a ticket'),
    skip: async (source, error) => { skipped.push([source, error]); }, markRejected: async () => undefined,
  });
  assert.deepEqual(skipped, [['mercado_publico', NO_ORGANIZATION_TICKET], ['compra_agil', NO_ORGANIZATION_TICKET]]);
  assert.deepEqual(none, { skipped: NO_ORGANIZATION_TICKET });
});

test('a refused own ticket is marked for replacement; the shared ticket and other failures are not', async () => {
  const marked: string[] = [];
  const run = (source: 'own' | 'shared', errors: Array<string | null>) => dailyTenderSearch({
    resolveTicket: async () => ({ ticket: 'T', userId: `u-${source}`, source }), search: async () => done(errors),
    skip: async () => undefined, markRejected: async userId => { marked.push(userId); },
  });
  await run('own', ['Mercado Público rechazó el ticket.', null]);
  await run('shared', ['Mercado Público rechazó el ticket.', null]);
  await run('own', [null, '1 de 11 búsquedas fallaron: Compra Ágil respondió 500.']);
  assert.deepEqual(marked, ['u-own']);

  const failing = await dailyTenderSearch({
    resolveTicket: async () => { throw new Error('No se pudo buscar el ticket de Mercado Público.'); },
    search: async () => assert.fail('not searched'), skip: async () => assert.fail('a read error is not «nobody has a ticket»'), markRejected: async () => undefined,
  });
  assert.deepEqual(failing, { error: 'No se pudo buscar el ticket de Mercado Público.' });
});
