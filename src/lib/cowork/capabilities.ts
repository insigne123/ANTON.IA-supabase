import { z } from 'zod';

export type CoworkScope = Readonly<{ userId: string; organizationId: string; runId: string }>;
export type CoworkEffect = 'read' | 'write' | 'external';
export type CoworkCapability = {
  name: string;
  version: number;
  description: string;
  effect: CoworkEffect;
  input: z.ZodTypeAny;
  output: z.ZodTypeAny;
  execute: (input: unknown, scope: CoworkScope, signal: AbortSignal) => Promise<unknown>;
};

export type CoworkInvocation = {
  capability: string;
  input: unknown;
  operationId: string;
};

export type CoworkGatewayDependencies = {
  /** Fresh server authorization, including database revocation. */
  authorize: (scope: CoworkScope) => Promise<void>;
  /** Durable grant tied to the exact input/version; not an LLM decision. */
  hasGrant: (scope: CoworkScope, capability: CoworkCapability, input: unknown) => Promise<boolean>;
  /** Implement atomically in the store: reservation, claim, result/replay and events. */
  withOperation: (
    scope: CoworkScope,
    operation: { id: string; capability: string; version: number; input: unknown },
    execute: () => Promise<unknown>,
  ) => Promise<unknown>;
};

/** Runtime-independent boundary. No free-form HTTP or SQL capability is implicit. */
export function createCoworkGateway(capabilities: readonly CoworkCapability[], dependencies: CoworkGatewayDependencies) {
  const registry = new Map<string, CoworkCapability>();
  for (const capability of capabilities) {
    if (registry.has(capability.name)) throw new Error(`Duplicate capability: ${capability.name}`);
    registry.set(capability.name, capability);
  }

  return {
    async invoke(scope: CoworkScope, invocation: CoworkInvocation, signal: AbortSignal) {
      signal.throwIfAborted();
      await dependencies.authorize(scope);
      const capability = registry.get(invocation.capability);
      if (!capability) throw new Error('Unknown Cowork capability');
      if (!invocation.operationId.trim()) throw new Error('An operation ID is required');
      const input = capability.input.parse(invocation.input);
      if (!await dependencies.hasGrant(scope, capability, input)) throw new Error('Cowork permission required');
      const result = await dependencies.withOperation(scope, {
        id: invocation.operationId,
        capability: capability.name,
        version: capability.version,
        input,
      }, async () => {
        // A queued/reserved operation must not retain access after revocation.
        signal.throwIfAborted();
        await dependencies.authorize(scope);
        if (!await dependencies.hasGrant(scope, capability, input)) throw new Error('Cowork permission revoked');
        signal.throwIfAborted();
        const output = capability.output.parse(await capability.execute(input, scope, signal));
        signal.throwIfAborted();
        await dependencies.authorize(scope);
        if (!await dependencies.hasGrant(scope, capability, input)) throw new Error('Cowork permission revoked');
        signal.throwIfAborted();
        return output;
      });
      // A replay bypasses execute(), so it needs the same publication checks.
      signal.throwIfAborted();
      await dependencies.authorize(scope);
      if (!await dependencies.hasGrant(scope, capability, input)) throw new Error('Cowork permission revoked');
      signal.throwIfAborted();
      return capability.output.parse(result);
    },
  };
}
