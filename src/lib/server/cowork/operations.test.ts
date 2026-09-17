import test from 'node:test';
import assert from 'node:assert/strict';
import {
  coworkOperationHash,
  createCoworkOperationGateway,
  deterministicCoworkUuid,
  stableStringify,
  type CoworkOperation,
} from './operations';
import type { CoworkCapability } from '@/lib/cowork/capabilities';

test('identical inputs hash identically regardless of key order', () => {
  assert.equal(
    coworkOperationHash({ b: 2, a: 1, nested: { y: [3, 2], x: 1 } }),
    coworkOperationHash({ a: 1, b: 2, nested: { x: 1, y: [3, 2] } }),
  );
  assert.notEqual(coworkOperationHash({ a: 1 }), coworkOperationHash({ a: 2 }));
  assert.equal(stableStringify({ b: 1, a: 2 }), '{"a":2,"b":1}');
});

test('deterministic uuids are stable v4 ids per seed', () => {
  const first = deterministicCoworkUuid('cowork:search-continuation:run');
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(first, deterministicCoworkUuid('cowork:search-continuation:run'));
  assert.notEqual(first, deterministicCoworkUuid('cowork:search-continuation:other'));
});

const baseCapability: CoworkCapability = {
  name: 'leads.search', version: 1, description: 'read', effect: 'read',
  input: { parse: (value: unknown) => value } as never,
  output: { parse: (value: unknown) => value } as never,
  execute: async () => ({ items: [] }),
};
const writeCapability: CoworkCapability = {
  ...baseCapability, name: 'crm.update_note', version: 1, description: 'write', effect: 'write',
};

function operationStore() {
  const stored: { operation: CoworkOperation | null } = { operation: null };
  const client = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === 'cowork_reserve_operation') {
        if (!stored.operation) {
          stored.operation = {
            id: '00000000-0000-4000-8000-000000000001', user_id: '00000000-0000-4000-8000-000000000010', organization_id: '00000000-0000-4000-8000-000000000011',
            run_id: '00000000-0000-4000-8000-000000000002', capability: String(args.p_capability),
            version: Number(args.p_version), input: args.p_input, input_hash: String(args.p_input_hash),
            status: 'reserved', lease_token: '00000000-0000-4000-8000-000000000003',
            result: null, error_code: null,
          };
        }
        return { data: stored.operation, error: null };
      }
      if (name === 'cowork_complete_operation') {
        if (stored.operation) stored.operation = { ...stored.operation, status: 'completed', result: args.p_result };
        return { data: true, error: null };
      }
      if (name === 'cowork_fail_operation') {
        if (stored.operation) stored.operation = { ...stored.operation, status: 'failed', error_code: String(args.p_error_code) };
        return { data: true, error: null };
      }
      throw new Error(`unexpected rpc ${name}`);
    },
  };
  return { stored, client };
}

const scope = { userId: '00000000-0000-4000-8000-000000000010', organizationId: '00000000-0000-4000-8000-000000000011', runId: '00000000-0000-4000-8000-000000000002' };
const testOptions = { authorize: async () => undefined, isApproved: async () => true };

test('reads execute once and replay completed results without re-executing', async () => {
  const { stored, client } = operationStore();
  let executions = 0;
  const gateway = createCoworkOperationGateway(client as never,
    [{ ...baseCapability, execute: async () => { executions++; return { items: [1] }; } }], testOptions);
  const invocation = { capability: 'leads.search', input: { query: 'acme' }, operationId: 'op-1' };
  assert.deepEqual(await gateway.invoke(scope, invocation, new AbortController().signal), { items: [1] });
  assert.equal(executions, 1);
  assert.equal(stored.operation?.status, 'completed');
  assert.deepEqual(await gateway.invoke(scope, invocation, new AbortController().signal), { items: [1] });
  assert.equal(executions, 1);
});

test('failed operations are not silently re-executed', async () => {
  const { stored, client } = operationStore();
  let executions = 0;
  const gateway = createCoworkOperationGateway(client as never,
    [{ ...baseCapability, execute: async () => { executions++; throw new Error('provider down'); } }], testOptions);
  const invocation = { capability: 'leads.search', input: {}, operationId: 'op-1' };
  await assert.rejects(gateway.invoke(scope, invocation, new AbortController().signal), /provider down/);
  assert.equal(executions, 1);
  await assert.rejects(gateway.invoke(scope, invocation, new AbortController().signal), /failed before/);
  assert.equal(executions, 1);
  assert.equal(stored.operation?.status, 'failed');
});

test('writes fail closed without an approval check', async () => {
  const { client } = operationStore();
  let executions = 0;
  const gateway = createCoworkOperationGateway(client as never,
    [{ ...writeCapability, execute: async () => { executions++; return {}; } }],
    { authorize: async () => undefined });
  await assert.rejects(
    gateway.invoke(scope, { capability: 'crm.update_note', input: {}, operationId: 'op-1' }, new AbortController().signal),
    /permission required/,
  );
  assert.equal(executions, 0);
});

test('writes execute once an approval check passes', async () => {
  const { client } = operationStore();
  let executions = 0;
  const gateway = createCoworkOperationGateway(client as never,
    [{ ...writeCapability, execute: async () => { executions++; return { ok: true }; } }], testOptions);
  assert.deepEqual(
    await gateway.invoke(scope, { capability: 'crm.update_note', input: {}, operationId: 'op-1' }, new AbortController().signal),
    { ok: true },
  );
  assert.equal(executions, 1);
});

