import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { enrichmentCreditReceipt, partitionEnrichmentLeads } from './enrichment-provider';

// Execute the real component handler with isolated services. No rendering,
// credentials or network: verifies routing, receipts and canonical-row handling.
const source = ts.createSourceFile('Client.tsx', readFileSync('src/app/(app)/saved/leads/enriched/Client.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let handler: ts.FunctionDeclaration | undefined;
function visit(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'handleConfirmEnrich') handler = node;
  ts.forEachChild(node, visit);
}
visit(source); assert.ok(handler);
const compiled = ts.transpileModule(handler.getText(source), {compilerOptions: {target: ts.ScriptTarget.ES2022}}).outputText;
const lf = {id: '11111111-1111-4111-8111-111111111111', sourceProvider: 'leads_finder', sourceProviderId: 'lf_' + 'a'.repeat(24), fullName: 'Cached person', email: 'work@demo.test'};
const apollo = {id: '22222222-2222-4222-8222-222222222222', sourceProvider: 'apollo', sourceProviderId: 'apollo-person', fullName: 'Other person'};

function fixture(selected: any[], options: {replay?: boolean; failApollo?: boolean} = {}) {
  const calls = {finder: [] as any[], apollo: [] as any[], updates: [] as any[], added: [] as any[], toasts: [] as any[], credits: 0, fresh: [] as any[]};
  const canonical = {...lf, primaryPhone: '+56 9 1111 2222', enrichmentStatus: 'completed'};
  const deps: Record<string, any> = {
    leadsToEnrich: selected, enriched: selected, partitionEnrichmentLeads, enrichmentCreditReceipt,
    setEnriching: () => {}, setLeadsToEnrich: () => {}, uuid: () => 'operation',
    enrichWithLeadsFinder: async (request: any) => {
      calls.finder.push(request);
      return {enriched: options.replay ? [{id: lf.id, clientRef: lf.id, enrichmentStatus: 'completed'}] : [{...canonical, clientRef: lf.id}], expired: [], usage: {consumed: 1}};
    },
    fetch: async (endpoint: string, init: any) => {
      assert.equal(endpoint, '/api/opportunities/enrich-apollo'); calls.apollo.push(JSON.parse(init.body));
      return Response.json(options.failApollo ? {error: 'Provider unavailable'} : {enriched: [{...apollo, clientRef: apollo.id, email: 'other@demo.test'}], usage: {consumed: 1}}, {status: options.failApollo ? 503 : 200});
    },
    getQuotaTicket: () => '', setQuotaTicket: () => {},
    Quota: {incClientQuota: (_resource: string, count: number) => {calls.credits += count;}},
    enrichedLeadsStorage: {update: async (rows: any[]) => {calls.updates.push(...rows);}, addDedup: async (rows: any[]) => {calls.added.push(...rows);}},
    enrichedLeadsStorageGet: async () => [canonical], setEnriched: (rows: any[]) => {calls.fresh = rows;},
    toast: (value: any) => {calls.toasts.push(value);},
  };
  const run = new Function(...Object.keys(deps), compiled + '\nreturn handleConfirmEnrich;')(...Object.values(deps));
  return {calls, run};
}

test('updating a LF phone uses the cached provider, updates no browser copy and reloads the persisted canonical contact', async () => {
  for (const replay of [false, true]) {
    const {calls, run} = fixture([lf], {replay}); await run({revealEmail: false, revealPhone: true});
    assert.equal(calls.finder.length, 1); assert.equal(calls.apollo.length, 0);
    assert.equal(calls.finder[0].leads[0].existingRecordId, lf.id);
    assert.equal(calls.updates.length + calls.added.length, 0, 'neither normal result nor metadata-only replay overwrites canonical LF bytes');
    assert.equal(calls.fresh[0].email, lf.email); assert.equal(calls.fresh[0].primaryPhone, '+56 9 1111 2222');
    assert.equal(calls.credits, 1); assert.match(calls.toasts.at(-1).description, /1 crédito de ANTON\.IA/);
  }
});

test('mixed origins charge the received internal usage and preserve a completed LF update when Apollo fails', async () => {
  for (const failApollo of [false, true]) {
    const {calls, run} = fixture([lf, apollo], {failApollo}); await run({revealEmail: true, revealPhone: true});
    assert.deepEqual(calls.apollo[0].leads.map((l: any) => l.sourceProviderId), ['apollo-person']);
    assert.equal(calls.finder.length, 1); assert.ok(calls.updates.every(row => row.id !== lf.id));
    assert.equal(calls.credits, failApollo ? 1 : 2);
    assert.equal(calls.fresh[0].email, lf.email);
    assert.match(calls.toasts.at(-1).description, failApollo ? /contactos pendientes/ : /2 créditos de ANTON\.IA/);
  }
});
