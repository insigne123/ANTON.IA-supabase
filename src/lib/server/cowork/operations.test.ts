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
            status: 'reserved', lease_token: String(args.p_lease),
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

test('concurrent invocation cannot execute using the first reservation token', async () => {
  const { client } = operationStore();
  let executions = 0;
  let release!: () => void;
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const gateway = createCoworkOperationGateway(client as never, [{ ...baseCapability,
    execute: async () => { executions++; started(); await gate; return { ok: true }; },
  }], testOptions);
  const invocation = { capability: 'leads.search', input: {}, operationId: 'same' };
  const first = gateway.invoke(scope, invocation, new AbortController().signal);
  await ready;
  try {
    await assert.rejects(gateway.invoke(scope, invocation, new AbortController().signal), /already reserved/);
    assert.equal(executions, 1);
  } finally { release(); }
  assert.deepEqual(await first, { ok: true });
});

test('completion rejection never becomes a successful result', async () => {
  const { client } = operationStore();
  const rpc = client.rpc;
  client.rpc = async (name, args) => name === 'cowork_complete_operation'
    ? { data: false, error: null } as never : rpc(name, args);
  const gateway = createCoworkOperationGateway(client as never, [baseCapability], testOptions);
  await assert.rejects(gateway.invoke(scope, {
    capability: 'leads.search', input: {}, operationId: 'rejected',
  }, new AbortController().signal), /completion rejected/);
});

test('identical queries in different runs reserve distinct fingerprints', async () => {
  const hashes: unknown[] = [];
  const { reserveCoworkOperation } = await import('./operations');
  const client = { rpc: async (_: string, args: Record<string, unknown>) => {
    hashes.push(args.p_input_hash);
    return { error: null, data: {
      id: scope.runId, user_id: args.p_user_id, organization_id: args.p_organization_id,
      run_id: args.p_run_id, capability: args.p_capability, version: args.p_version,
      input: args.p_input, input_hash: args.p_input_hash, status: 'reserved', lease_token: args.p_lease,
    } };
  } };
  await reserveCoworkOperation(client as never, scope, baseCapability, '');
  await reserveCoworkOperation(client as never, { ...scope, runId: '00000000-0000-4000-8000-000000000099' }, baseCapability, '');
  assert.notEqual(hashes[0], hashes[1]);
});

test('lease-aware gateway carries the current worker attempt to reservation and finish', async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const runLease = '00000000-0000-4000-8000-000000000088';
  const client = { rpc: async (name: string, args: Record<string, unknown>) => {
    calls.push({ name, args });
    if (name === 'cowork_reserve_operation_v2') return { error: null, data: {
      id: scope.runId, user_id: scope.userId, organization_id: scope.organizationId,
      run_id: scope.runId, capability: args.p_capability, version: args.p_version,
      input: args.p_input, input_hash: args.p_input_hash, status: 'executing', lease_token: args.p_lease,
    } };
    if (name === 'cowork_finish_operation_v2') return { error: null, data: true };
    throw new Error('Unexpected legacy RPC');
  } };
  const gateway = createCoworkOperationGateway(client as never, [baseCapability], { ...testOptions, runLease });
  assert.deepEqual(await gateway.invoke(scope, { capability: 'leads.search', input: '', operationId: 'v2' }, new AbortController().signal), { items: [] });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].args.p_run_lease, runLease);
  assert.equal(calls[1].args.p_run_lease, runLease);
  assert.equal(calls[1].args.p_lease, calls[0].args.p_lease);
  assert.equal(calls[1].args.p_success, true);
});

