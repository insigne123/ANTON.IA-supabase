export type ManualEmailOperationInput = {
  scope: string;
  recipientId?: string | null;
  email: string;
  subject: string;
  body: string;
  provider: string;
  deliveryOptions?: {
    pixel?: boolean;
    links?: boolean;
    readReceipt?: boolean;
  };
};

export type ManualEmailOperation = {
  scope: string;
  operationId: string;
  payloadFingerprint: string;
  idempotencyKey: string;
  trackingId: string;
};

function stableHash(value: string, seed = 0x811c9dc5) {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function deterministicUuid(value: string) {
  const hex = [
    stableHash(value, 0x811c9dc5),
    stableHash(value, 0x9e3779b9),
    stableHash(value, 0x85ebca6b),
    stableHash(value, 0xc2b2ae35),
  ].join('').split('');
  hex[12] = '4';
  hex[16] = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const joined = hex.join('');
  return `${joined.slice(0, 8)}-${joined.slice(8, 12)}-${joined.slice(12, 16)}-${joined.slice(16, 20)}-${joined.slice(20, 32)}`;
}

export function fingerprintManualEmailPayload(input: ManualEmailOperationInput) {
  const payload = JSON.stringify([
    String(input.recipientId || '').trim(),
    String(input.email || '').trim().toLowerCase(),
    input.subject,
    input.body,
    String(input.provider || '').trim().toLowerCase(),
    Boolean(input.deliveryOptions?.pixel),
    Boolean(input.deliveryOptions?.links),
    Boolean(input.deliveryOptions?.readReceipt),
  ]);
  return [
    stableHash(payload, 0x811c9dc5),
    stableHash(payload, 0x9e3779b9),
    stableHash(payload, 0x85ebca6b),
    stableHash(payload, 0xc2b2ae35),
  ].join('');
}

export function buildManualEmailOperation(
  operationId: string,
  input: ManualEmailOperationInput,
): ManualEmailOperation {
  const normalizedOperationId = String(operationId || '').trim();
  const scope = String(input.scope || '').trim();
  if (!normalizedOperationId) throw new Error('A manual send operation ID is required.');
  if (!scope) throw new Error('A manual send scope is required.');
  if (!String(input.recipientId || '').trim() && !String(input.email || '').trim()) {
    throw new Error('A recipient identity is required for idempotent sending.');
  }

  const payloadFingerprint = fingerprintManualEmailPayload(input);
  const idempotencyKey = `${scope}:${normalizedOperationId}:${payloadFingerprint}`;
  return {
    scope,
    operationId: normalizedOperationId,
    payloadFingerprint,
    idempotencyKey,
    trackingId: deterministicUuid(`tracking:${idempotencyKey}`),
  };
}

export function resolveManualEmailOperation(
  current: ManualEmailOperation | null,
  input: ManualEmailOperationInput,
  createOperationId: () => string,
) {
  const scope = String(input.scope || '').trim();
  const payloadFingerprint = fingerprintManualEmailPayload(input);
  if (current?.scope === scope && current.payloadFingerprint === payloadFingerprint) return current;
  return buildManualEmailOperation(createOperationId(), input);
}
