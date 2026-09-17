import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  createCoworkGateway,
  type CoworkCapability,
  type CoworkGatewayDependencies,
  type CoworkScope,
} from '@/lib/cowork/capabilities';

export const coworkOperationSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  organization_id: z.string().uuid(),
  run_id: z.string().uuid(),
  capability: z.string().min(1).max(80),
  version: z.number().int().positive(),
  input: z.unknown(),
  input_hash: z.string().min(16).max(128),
  status: z.enum(['reserved', 'executing', 'completed', 'failed', 'cancelled']),
  lease_token: z.string().uuid(),
  result: z.unknown().nullable().optional(),
  error_code: z.string().nullable().optional(),
});
export type CoworkOperation = z.infer<typeof coworkOperationSchema>;

/** Stable stringify so identical inputs always hash identically. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

export function coworkOperationHash(input: unknown): string {
  return createHash('sha256').update(stableStringify(input)).digest('hex');
}

/** Deterministic v4 UUID for idempotent follow-ups derived from a seed string. */
export function deterministicCoworkUuid(seed: string): string {
  const digest = createHash('sha256').update(seed).digest('hex');
  const chars = digest.slice(0, 32).split('');
  chars[12] = '4';
  chars[16] = (['8', '9', 'a', 'b'] as const)[parseInt(digest.slice(16, 17), 16) % 4];
  const hex = chars.join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function serviceClient(client: SupabaseClient) {
  return client;
}

export async function reserveCoworkOperation(
  client: SupabaseClient,
  scope: { userId: string; organizationId: string; runId: string },
  capability: Pick<CoworkCapability, 'name' | 'version'>,
  input: unknown,
  lease = randomUUID(),
): Promise<CoworkOperation> {
  const { data, error } = await serviceClient(client).rpc('cowork_reserve_operation', {
    p_user_id: scope.userId, p_organization_id: scope.organizationId, p_run_id: scope.runId,
    p_capability: capability.name, p_version: capability.version,
    p_input: JSON.parse(stableStringify(input)) as unknown, p_input_hash: coworkOperationHash(input), p_lease: lease,
  });
  if (error) throw error;
  return coworkOperationSchema.parse(data);
}

export async function completeCoworkOperation(
  client: SupabaseClient, operationId: string, lease: string, result: unknown,
): Promise<boolean> {
  const { data, error } = await serviceClient(client).rpc('cowork_complete_operation', {
    p_id: operationId, p_lease: lease, p_result: JSON.parse(stableStringify(result)) as unknown,
  });
  if (error) throw error;
  return data === true;
}

export async function failCoworkOperation(
  client: SupabaseClient, operationId: string, lease: string, errorCode: string,
): Promise<boolean> {
  const { data, error } = await serviceClient(client).rpc('cowork_fail_operation', {
    p_id: operationId, p_lease: lease, p_error_code: errorCode,
  });
  if (error) throw error;
  return data === true;
}

/**
 * Gateway dependencies backed by the durable ledger. Reads replay completed
 * results without re-executing. Writes and external effects fail closed until
 * a per-operation approval record exists; the caller supplies the check.
 */
export function createCoworkOperationDependencies(
  client: SupabaseClient,
  options: {
    isApproved?: (scope: CoworkScope, capability: CoworkCapability, input: unknown) => Promise<boolean>;
    authorize?: (scope: CoworkScope) => Promise<void>;
  } = {},
): CoworkGatewayDependencies {
  const authorize = options.authorize || (async (scope: CoworkScope) => {
    // Deferred so unit tests never load the Next.js auth runtime.
    const { requireCoworkWorkerAccess } = await import('./access');
    await requireCoworkWorkerAccess(client, { userId: scope.userId, organizationId: scope.organizationId });
  });
  const hasGrant = async (scope: CoworkScope, capability: CoworkCapability, input: unknown) => {
    if (capability.effect === 'read') return true;
    if (!options.isApproved) return false;
    return options.isApproved(scope, capability, input);
  };
  const withOperation = async (
    scope: CoworkScope,
    operation: { id: string; capability: string; version: number; input: unknown },
    execute: () => Promise<unknown>,
  ) => {
    const reserved = await reserveCoworkOperation(client, scope,
      { name: operation.capability, version: operation.version }, operation.input);
    if (reserved.status === 'completed') return reserved.result ?? null;
    if (reserved.status === 'failed' || reserved.status === 'cancelled') {
      throw new Error(reserved.status === 'failed' ? 'Cowork operation failed before' : 'Cowork operation cancelled');
    }
    try {
      const result = await execute();
      await completeCoworkOperation(client, reserved.id, reserved.lease_token, result);
      return result;
    } catch (error) {
      await failCoworkOperation(client, reserved.id, reserved.lease_token,
        error instanceof Error ? error.message : 'operation_failed');
      throw error;
    }
  };
  return { authorize, hasGrant, withOperation };
}

export function createCoworkOperationGateway(
  client: SupabaseClient,
  capabilities: readonly CoworkCapability[],
  options?: {
    isApproved?: (scope: CoworkScope, capability: CoworkCapability, input: unknown) => Promise<boolean>;
    authorize?: (scope: CoworkScope) => Promise<void>;
  },
) {
  return createCoworkGateway(capabilities, createCoworkOperationDependencies(client, options));
}
