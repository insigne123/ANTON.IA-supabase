import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import { createCoworkGateway, type CoworkCapability, type CoworkGatewayDependencies } from './capabilities';

const scope = { userId: 'owner', organizationId: 'org', runId: 'run' };
const invocation = { capability: 'example.update', input: { value: 1 }, operationId: 'op-1' };

function fixture() {
  let calls = 0;
  const capability: CoworkCapability = {
    name: 'example.update', version: 1, description: 'Test only', effect: 'write',
    input: z.object({ value: z.number() }).strict(), output: z.object({ saved: z.boolean() }).strict(),
    execute: async () => { calls++; return { saved: true }; },
  };
  const dependencies: CoworkGatewayDependencies = {
    authorize: async () => {}, hasGrant: async () => true,
    withOperation: async (_scope, _operation, execute) => execute(),
  };
  return { capability, dependencies, calls: () => calls };
}

test('gateway rejects forged input, unknown tools and missing grants before any effect', async () => {
  const f = fixture();
  const gateway = createCoworkGateway([f.capability], f.dependencies);
  const signal = new AbortController().signal;
  await assert.rejects(gateway.invoke(scope, { ...invocation, input: { value: 1, userId: 'other' } }, signal));
  await assert.rejects(gateway.invoke(scope, { ...invocation, capability: 'sql.execute' }, signal));
  f.dependencies.hasGrant = async () => false;
  await assert.rejects(gateway.invoke(scope, invocation, signal), /permission required/);
  assert.equal(f.calls(), 0);
});

test('revocation after admission stops an operation before execution', async () => {
  const f = fixture();
  let checks = 0;
  f.dependencies.authorize = async () => { if (++checks > 1) throw new Error('revoked'); };
  await assert.rejects(createCoworkGateway([f.capability], f.dependencies)
    .invoke(scope, invocation, new AbortController().signal), /revoked/);
  assert.equal(f.calls(), 0);
});

test('cancellation while reserving stops the pending effect', async () => {
  const f = fixture();
  const controller = new AbortController();
  f.dependencies.withOperation = async (_scope, _operation, execute) => {
    controller.abort();
    return execute();
  };
  await assert.rejects(createCoworkGateway([f.capability], f.dependencies).invoke(scope, invocation, controller.signal));
  assert.equal(f.calls(), 0);
});

test('gateway validates output and passes exact scoped identity to operation store', async () => {
  const f = fixture();
  f.dependencies.withOperation = async (actualScope, operation, execute) => {
    assert.deepEqual(actualScope, scope);
    assert.equal(operation.version, 1);
    assert.equal(operation.id, invocation.operationId);
    return execute();
  };
  const gateway = createCoworkGateway([f.capability], f.dependencies);
  assert.deepEqual(await gateway.invoke(scope, invocation, new AbortController().signal), { saved: true });
  f.capability.execute = async () => ({ fabricated: 'success' });
  await assert.rejects(gateway.invoke(scope, invocation, new AbortController().signal));
});

test('replayed results are validated and never bypass revocation or cancellation', async () => {
  for (const mode of ['revoked', 'cancelled', 'invalid', 'grant']) {
    const f = fixture();
    const controller = new AbortController();
    let replayed = false;
    f.dependencies.authorize = async () => {
      if (replayed && mode === 'revoked') throw new Error('revoked');
    };
    f.dependencies.hasGrant = async () => !(replayed && mode === 'grant');
    f.dependencies.withOperation = async () => {
      replayed = true;
      if (mode === 'cancelled') controller.abort();
      return mode === 'invalid' ? { fabricated: true } : { saved: true };
    };
    await assert.rejects(createCoworkGateway([f.capability], f.dependencies)
      .invoke(scope, invocation, controller.signal));
    assert.equal(f.calls(), 0);
  }
});

test('revocation after executing prevents passing output to durable completion', async () => {
  const f = fixture();
  let allowed = true;
  let completed = false;
  f.capability.execute = async () => { allowed = false; return { saved: true }; };
  f.dependencies.authorize = async () => { if (!allowed) throw new Error('revoked'); };
  f.dependencies.withOperation = async (_scope, _operation, execute) => {
    const result = await execute(); completed = true; return result;
  };
  await assert.rejects(createCoworkGateway([f.capability], f.dependencies)
    .invoke(scope, invocation, new AbortController().signal), /revoked/);
  assert.equal(completed, false);
});
