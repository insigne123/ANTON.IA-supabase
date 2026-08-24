export type SupliaApprovalValidationInput = {
  approvalKind?: string | null;
  toolName: string;
  payload?: Record<string, unknown> | null;
  confirmationText?: unknown;
};

export type SupliaApprovedActionPayloadInput = {
  toolName: string;
  payload?: Record<string, unknown> | null;
  requiredText?: string | null;
};

function normalizeConfirmationText(value: unknown) {
  return String(value || '').trim().toUpperCase();
}

export function requiresSupliaStrongConfirmation(approvalKind?: string | null) {
  return approvalKind === 'strong';
}

export function getSupliaStrongConfirmationPhrase(toolName: string, payload: Record<string, unknown> = {}) {
  return 'APROBAR';
}

export function validateSupliaStrongConfirmation(input: SupliaApprovalValidationInput) {
  if (!requiresSupliaStrongConfirmation(input.approvalKind)) {
    return { valid: true, requiredText: null as string | null };
  }

  const payload = input.payload || {};
  const requiredText = getSupliaStrongConfirmationPhrase(input.toolName, payload);
  const valid = normalizeConfirmationText(input.confirmationText) === requiredText;

  return { valid, requiredText };
}

export function buildSupliaApprovedActionPayload(input: SupliaApprovedActionPayloadInput) {
  return input.payload || {};
}
