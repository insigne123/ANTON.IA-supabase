import { createHash } from 'node:crypto';

import { z } from 'zod';

import { stripHtmlToText } from '@/lib/email-outbound';

const NullableUuidSchema = z.string().uuid().nullable();
const NullableShortTextSchema = z.string().trim().min(1).max(500).nullable();

export const MessagingChannelSchema = z.enum(['email', 'linkedin']);
export type MessagingChannel = z.infer<typeof MessagingChannelSchema>;

export const MessagingRecipientV1Schema = z.object({
  leadRef: NullableShortTextSchema,
  displayName: z.string().trim().min(1).max(300).nullable(),
  email: z.string().trim().email().max(320).nullable(),
  linkedinUrl: z.string().trim().url().max(2_048).nullable(),
}).strict();
export type MessagingRecipientV1 = z.infer<typeof MessagingRecipientV1Schema>;

export const MessagingDeliveryOptionsV1Schema = z.object({
  requestReceipts: z.boolean(),
}).strict();
export type MessagingDeliveryOptionsV1 = z.infer<typeof MessagingDeliveryOptionsV1Schema>;

export const MessagingContentV1Schema = z.object({
  subject: z.string().trim().min(1).max(998).nullable(),
  text: z.string().trim().min(1).max(100_000).nullable(),
  html: z.string().trim().min(1).max(500_000).nullable(),
  deliveryOptions: MessagingDeliveryOptionsV1Schema.optional(),
}).strict();
export type MessagingContentV1 = z.infer<typeof MessagingContentV1Schema>;

export const MessagingApprovalV1Schema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('pending'),
    decidedBy: z.null(),
    decidedAt: z.null(),
    reason: z.null(),
  }).strict(),
  z.object({
    status: z.literal('approved'),
    decidedBy: z.string().uuid(),
    decidedAt: z.string().datetime({ offset: true }),
    reason: z.null(),
  }).strict(),
  z.object({
    status: z.literal('rejected'),
    decidedBy: z.string().uuid(),
    decidedAt: z.string().datetime({ offset: true }),
    reason: z.string().trim().min(1).max(2_000),
  }).strict(),
]);
export type MessagingApprovalV1 = z.infer<typeof MessagingApprovalV1Schema>;

export const MessagingPreflightV1Schema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('pending'),
    checkedAt: z.null(),
    errors: z.array(z.string()).length(0),
    warnings: z.array(z.string().trim().min(1).max(2_000)).max(100),
  }).strict(),
  z.object({
    status: z.literal('passed'),
    checkedAt: z.string().datetime({ offset: true }),
    errors: z.array(z.string()).length(0),
    warnings: z.array(z.string().trim().min(1).max(2_000)).max(100),
  }).strict(),
  z.object({
    status: z.literal('failed'),
    checkedAt: z.string().datetime({ offset: true }),
    errors: z.array(z.string().trim().min(1).max(2_000)).min(1).max(100),
    warnings: z.array(z.string().trim().min(1).max(2_000)).max(100),
  }).strict(),
]);
export type MessagingPreflightV1 = z.infer<typeof MessagingPreflightV1Schema>;

export const PendingMessagingApprovalV1: MessagingApprovalV1 = {
  status: 'pending',
  decidedBy: null,
  decidedAt: null,
  reason: null,
};

export const PendingMessagingPreflightV1: MessagingPreflightV1 = {
  status: 'pending',
  checkedAt: null,
  errors: [],
  warnings: [],
};

export const MessagingDraftV1Schema = z.object({
  schemaVersion: z.literal(1),
  draftId: z.string().uuid(),
  versionId: z.string().uuid(),
  organizationId: z.string().uuid(),
  userId: z.string().uuid(),
  researchSnapshotId: NullableUuidSchema,
  revision: z.number().int().positive(),
  parentVersionId: NullableUuidSchema,
  lifecycle: z.enum(['draft', 'ready', 'archived']),
  channel: MessagingChannelSchema,
  recipient: MessagingRecipientV1Schema,
  content: MessagingContentV1Schema,
  approval: MessagingApprovalV1Schema,
  preflight: MessagingPreflightV1Schema,
  createdAt: z.string().datetime({ offset: true }),
}).strict().superRefine((draft, context) => {
  if (draft.revision === 1 && draft.parentVersionId !== null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['parentVersionId'],
      message: 'The first revision cannot have a parent version.',
    });
  }

  if (draft.revision > 1 && draft.parentVersionId === null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['parentVersionId'],
      message: 'A child revision must reference its parent version.',
    });
  }

  if (draft.channel === 'email') {
    if (!draft.recipient.email) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['recipient', 'email'],
        message: 'Email drafts require a recipient email address.',
      });
    }
    if (!draft.content.subject) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['content', 'subject'],
        message: 'Email drafts require a subject.',
      });
    }
    if (!draft.content.text && !draft.content.html) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['content'],
        message: 'Email drafts require text or HTML content.',
      });
    }
  }

  if (draft.channel === 'linkedin') {
    if (!draft.recipient.linkedinUrl) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['recipient', 'linkedinUrl'],
        message: 'LinkedIn drafts require a recipient profile URL.',
      });
    }
    if (!draft.content.text) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['content', 'text'],
        message: 'LinkedIn drafts require text content.',
      });
    }
    if (draft.content.subject !== null || draft.content.html !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['content'],
        message: 'LinkedIn drafts cannot contain an email subject or HTML.',
      });
    }
  }

  if (
    draft.lifecycle === 'ready'
    && (draft.approval.status !== 'approved' || draft.preflight.status !== 'passed')
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['lifecycle'],
      message: 'Ready drafts must be approved and pass preflight.',
    });
  }
});
export const MessagingDraftV1 = MessagingDraftV1Schema;
export type MessagingDraftV1 = z.infer<typeof MessagingDraftV1Schema>;

export const MessagingSendMetadataV1Schema = z.object({
  schemaVersion: z.literal(1),
  organizationId: z.string().uuid(),
  userId: z.string().uuid(),
  draftId: z.string().uuid(),
  versionId: z.string().uuid(),
  revision: z.number().int().positive(),
  channel: MessagingChannelSchema,
  recipient: MessagingRecipientV1Schema,
  contentHash: z.string().regex(/^[a-f0-9]{64}$/, 'Expected a lowercase SHA-256 hash.'),
  idempotencyKey: z.string().trim().min(1).max(200),
  provider: z.string().trim().min(1).max(100),
  requestedAt: z.string().datetime({ offset: true }),
}).strict();
export const MessagingSendMetadataV1 = MessagingSendMetadataV1Schema;
export type MessagingSendMetadataV1 = z.infer<typeof MessagingSendMetadataV1Schema>;

function canonicalize(value: unknown, inArray: boolean): string | undefined {
  if (value === null) return 'null';
  if (value === undefined) return inArray ? 'null' : undefined;
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Canonical JSON cannot contain non-finite numbers.');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item, true) ?? 'null').join(',')}]`;
  }
  if (typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('Canonical JSON only supports plain objects.');
    }
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .flatMap(([key, item]) => {
        const serialized = canonicalize(item, false);
        return serialized === undefined ? [] : [`${JSON.stringify(key)}:${serialized}`];
      });
    return `{${entries.join(',')}}`;
  }
  throw new TypeError(`Canonical JSON cannot contain ${typeof value} values.`);
}

export function canonicalJson(value: unknown): string {
  const serialized = canonicalize(value, false);
  if (serialized === undefined) throw new TypeError('Canonical JSON cannot serialize undefined.');
  return serialized;
}

export function canonicalSha256(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

export function deterministicMessagingUuid(scope: string): string {
  const hash = canonicalSha256(scope).slice(0, 32).split('');
  hash[12] = '4';
  hash[16] = '8';
  const value = hash.join('');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20, 32)}`;
}

export function createLegacyReadyEmailDraftV1(input: {
  organizationId: string;
  userId: string;
  idempotencyKey: string;
  requestedAt: string;
  researchSnapshotId?: string | null;
  leadRef?: string | null;
  displayName?: string | null;
  to: string;
  subject: string;
  text?: string | null;
  html?: string | null;
  deliveryOptions?: MessagingDeliveryOptionsV1;
}): MessagingDraftV1 {
  const identity = `${input.organizationId}:${input.userId}:${input.idempotencyKey}`;
  return MessagingDraftV1Schema.parse({
    schemaVersion: 1,
    draftId: deterministicMessagingUuid(`draft:${identity}`),
    versionId: deterministicMessagingUuid(`version:${identity}`),
    organizationId: input.organizationId,
    userId: input.userId,
    researchSnapshotId: input.researchSnapshotId || null,
    revision: 1,
    parentVersionId: null,
    lifecycle: 'ready',
    channel: 'email',
    recipient: {
      leadRef: String(input.leadRef || '').trim() || null,
      displayName: String(input.displayName || '').trim() || null,
      email: String(input.to || '').trim(),
      linkedinUrl: null,
    },
    content: {
      subject: String(input.subject || '').trim(),
      text: String(input.text || '').trim() || null,
      html: String(input.html || '').trim() || null,
      ...(input.deliveryOptions ? {
        deliveryOptions: MessagingDeliveryOptionsV1Schema.parse(input.deliveryOptions),
      } : {}),
    },
    approval: {
      status: 'approved',
      decidedBy: input.userId,
      decidedAt: input.requestedAt,
      reason: null,
    },
    preflight: {
      status: 'passed',
      checkedAt: input.requestedAt,
      errors: [],
      warnings: [],
    },
    createdAt: input.requestedAt,
  });
}

export function messagingContentEnvelope(draftInput: MessagingDraftV1) {
  const draft = MessagingDraftV1Schema.parse(draftInput);
  return {
    channel: draft.channel,
    recipient: draft.recipient,
    content: draft.content,
  };
}

export function hashMessagingDraftContent(draft: MessagingDraftV1): string {
  return canonicalSha256(messagingContentEnvelope(draft));
}

export function assertMessagingDraftSendable(draftInput: MessagingDraftV1): MessagingDraftV1 {
  const draft = MessagingDraftV1Schema.parse(draftInput);
  if (draft.lifecycle !== 'ready') throw new Error('Messaging draft is not ready to send.');
  if (draft.approval.status !== 'approved') throw new Error('Messaging draft is not approved.');
  if (draft.preflight.status !== 'passed') throw new Error('Messaging draft has not passed preflight.');
  return draft;
}

export type CanonicalEmailSendV1 = {
  draft: MessagingDraftV1;
  to: string;
  subject: string;
  text: string | null;
  html: string | null;
  deliveryOptions?: MessagingDeliveryOptionsV1;
};

export type CanonicalEmailSendCompatibilityV1 = {
  to?: unknown;
  subject?: unknown;
  text?: unknown;
  html?: unknown;
};

function normalizedCompatibilityText(value: unknown) {
  return String(value || '').replace(/\r\n?/g, '\n').trim();
}

function assertCompatibilityString(value: unknown, message: string) {
  if (typeof value !== 'string') throw new Error(message);
  return value.trim();
}

export function resolveApprovedEmailSendV1(draftInput: MessagingDraftV1): CanonicalEmailSendV1 {
  const draft = assertMessagingDraftSendable(draftInput);
  if (draft.channel !== 'email') throw new Error('Messaging draft is not an email draft.');
  if (!draft.recipient.email || !draft.content.subject) {
    throw new Error('Approved email draft is missing recipient or subject.');
  }
  if (!draft.content.text && !draft.content.html) {
    throw new Error('Approved email draft is missing content.');
  }

  return {
    draft,
    to: draft.recipient.email,
    subject: draft.content.subject,
    text: draft.content.text,
    html: draft.content.html,
    ...(draft.content.deliveryOptions ? { deliveryOptions: draft.content.deliveryOptions } : {}),
  };
}

export function assertCanonicalEmailSendCompatibilityV1(
  canonical: CanonicalEmailSendV1,
  input: CanonicalEmailSendCompatibilityV1,
) {
  if (input.to !== undefined && input.to !== null) {
    const recipient = assertCompatibilityString(input.to, 'Browser recipient is invalid.').toLowerCase();
    if (recipient !== canonical.to.trim().toLowerCase()) {
      throw new Error('Browser recipient does not match the approved draft.');
    }
  }
  if (input.subject !== undefined && input.subject !== null) {
    const subject = assertCompatibilityString(input.subject, 'Browser subject is invalid.');
    if (subject !== canonical.subject.trim()) {
      throw new Error('Browser subject does not match the approved draft.');
    }
  }

  // Request content can only prove compatibility; delivery always uses the draft above.
  const canonicalText = normalizedCompatibilityText(canonical.text ?? stripHtmlToText(canonical.html || ''));
  if (input.text !== undefined && input.text !== null) {
    const text = assertCompatibilityString(input.text, 'Browser text body is invalid.');
    if (normalizedCompatibilityText(text) !== canonicalText) {
      throw new Error('Browser text body does not match the approved draft.');
    }
  }
  if (input.html !== undefined && input.html !== null) {
    const html = assertCompatibilityString(input.html, 'Browser HTML body is invalid.');
    if (normalizedCompatibilityText(stripHtmlToText(html)) !== canonicalText) {
      throw new Error('Browser HTML body does not match the approved draft.');
    }
  }
}

export function createChildMessagingDraftV1(
  parentInput: MessagingDraftV1,
  input: {
    versionId: string;
    createdAt: string;
    researchSnapshotId?: string | null;
    channel?: MessagingChannel;
    recipient?: MessagingRecipientV1;
    content?: MessagingContentV1;
  },
): MessagingDraftV1 {
  const parent = MessagingDraftV1Schema.parse(parentInput);
  const recipient = input.recipient ? MessagingRecipientV1Schema.parse(input.recipient) : parent.recipient;
  const sameRecipientIdentity = recipient.leadRef === parent.recipient.leadRef
    && recipient.email === parent.recipient.email
    && recipient.linkedinUrl === parent.recipient.linkedinUrl;
  if (!sameRecipientIdentity) {
    throw new Error('Messaging draft recipient is immutable across revisions.');
  }
  return MessagingDraftV1Schema.parse({
    schemaVersion: 1,
    draftId: parent.draftId,
    versionId: input.versionId,
    organizationId: parent.organizationId,
    userId: parent.userId,
    researchSnapshotId: input.researchSnapshotId === undefined
      ? parent.researchSnapshotId
      : input.researchSnapshotId,
    revision: parent.revision + 1,
    parentVersionId: parent.versionId,
    lifecycle: 'draft',
    channel: input.channel ?? parent.channel,
    recipient,
    content: input.content ?? parent.content,
    approval: PendingMessagingApprovalV1,
    preflight: PendingMessagingPreflightV1,
    createdAt: input.createdAt,
  });
}

export function createMessagingSendMetadataV1(
  draftInput: MessagingDraftV1,
  input: { idempotencyKey: string; provider: string; requestedAt: string },
): MessagingSendMetadataV1 {
  const draft = assertMessagingDraftSendable(draftInput);
  return MessagingSendMetadataV1Schema.parse({
    schemaVersion: 1,
    organizationId: draft.organizationId,
    userId: draft.userId,
    draftId: draft.draftId,
    versionId: draft.versionId,
    revision: draft.revision,
    channel: draft.channel,
    recipient: draft.recipient,
    contentHash: hashMessagingDraftContent(draft),
    idempotencyKey: input.idempotencyKey,
    provider: input.provider,
    requestedAt: input.requestedAt,
  });
}

export function assertMessagingSendMetadataMatchesDraft(
  draftInput: MessagingDraftV1,
  metadataInput: MessagingSendMetadataV1,
): MessagingSendMetadataV1 {
  const draft = assertMessagingDraftSendable(draftInput);
  const metadata = MessagingSendMetadataV1Schema.parse(metadataInput);
  const expected = createMessagingSendMetadataV1(draft, {
    idempotencyKey: metadata.idempotencyKey,
    provider: metadata.provider,
    requestedAt: metadata.requestedAt,
  });

  for (const key of ['organizationId', 'userId', 'draftId', 'versionId', 'revision', 'channel', 'contentHash'] as const) {
    if (metadata[key] !== expected[key]) {
      throw new Error(`Messaging send metadata does not match draft field: ${key}.`);
    }
  }
  if (canonicalJson(metadata.recipient) !== canonicalJson(expected.recipient)) {
    throw new Error('Messaging send metadata does not match the draft recipient.');
  }
  return metadata;
}
