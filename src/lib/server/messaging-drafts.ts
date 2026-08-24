import { randomUUID } from 'node:crypto';

import {
  MessagingDraftV1Schema,
  canonicalJson,
  createChildMessagingDraftV1,
  hashMessagingDraftContent,
  type MessagingContentV1,
  type MessagingDraftV1,
  type MessagingChannel,
} from '@/lib/messaging-contracts';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';

export interface MessagingDraftRepository {
  createInitial(input: { draft: MessagingDraftV1; contentHash: string }): Promise<MessagingDraftV1>;
  appendRevision(input: {
    expectedParentVersionId: string;
    draft: MessagingDraftV1;
    contentHash: string;
  }): Promise<MessagingDraftV1>;
  findVersion(input: {
    organizationId: string;
    userId: string;
    draftId: string;
    versionId: string;
  }): Promise<MessagingDraftV1 | null>;
  findCurrentVersion(input: {
    organizationId: string;
    userId: string;
    draftId: string;
  }): Promise<MessagingDraftV1 | null>;
}

type SupabaseClientLike = ReturnType<typeof getSupabaseAdminClient>;

function parsePersistedPayload(data: unknown): MessagingDraftV1 {
  const row = Array.isArray(data) ? data[0] : data;
  const payload = row && typeof row === 'object' && 'payload' in row
    ? (row as { payload: unknown }).payload
    : row;
  return MessagingDraftV1Schema.parse(payload);
}

export function createSupabaseMessagingDraftRepository(
  client: SupabaseClientLike = getSupabaseAdminClient(),
): MessagingDraftRepository {
  async function findVersion(input: {
    organizationId: string;
    userId: string;
    draftId: string;
    versionId: string;
  }) {
    const { data, error } = await client
      .from('messaging_draft_versions')
      .select('payload')
      .eq('organization_id', input.organizationId)
      .eq('user_id', input.userId)
      .eq('draft_id', input.draftId)
      .eq('id', input.versionId)
      .maybeSingle();
    if (error) throw error;
    return data ? parsePersistedPayload(data) : null;
  }

  return {
    async createInitial({ draft, contentHash }) {
      const { data, error } = await client.rpc('create_messaging_draft_v1', {
        p_payload: draft,
        p_content_hash: contentHash,
      });
      if (error) throw error;
      return parsePersistedPayload(data);
    },

    async appendRevision({ expectedParentVersionId, draft, contentHash }) {
      const { data, error } = await client.rpc('append_messaging_draft_revision_v1', {
        p_draft_id: draft.draftId,
        p_expected_parent_version_id: expectedParentVersionId,
        p_payload: draft,
        p_content_hash: contentHash,
      });
      if (error) throw error;
      return parsePersistedPayload(data);
    },

    findVersion,

    async findCurrentVersion({ organizationId, userId, draftId }) {
      const { data, error } = await client
        .from('messaging_drafts')
        .select('current_version_id')
        .eq('organization_id', organizationId)
        .eq('user_id', userId)
        .eq('id', draftId)
        .maybeSingle();
      if (error) throw error;
      const versionId = String(data?.current_version_id || '').trim();
      if (!versionId) return null;
      return findVersion({ organizationId, userId, draftId, versionId });
    },
  };
}

export type MessagingDraftServiceDependencies = {
  repository?: MessagingDraftRepository;
  createId?: () => string;
  now?: () => string;
};

function repositoryFrom(dependencies?: MessagingDraftServiceDependencies) {
  return dependencies?.repository ?? createSupabaseMessagingDraftRepository();
}

function assertPersistedDraft(expected: MessagingDraftV1, persistedInput: MessagingDraftV1) {
  const persisted = MessagingDraftV1Schema.parse(persistedInput);
  if (canonicalJson(persisted) !== canonicalJson(expected)) {
    throw new Error('Persisted messaging draft does not match the requested immutable revision.');
  }
  return persisted;
}

function assertPersistedDraftIdentity(expected: MessagingDraftV1, persistedInput: MessagingDraftV1) {
  const persisted = MessagingDraftV1Schema.parse(persistedInput);
  const sameIdentity = persisted.draftId === expected.draftId
    && persisted.versionId === expected.versionId
    && persisted.organizationId === expected.organizationId
    && persisted.userId === expected.userId
    && persisted.revision === expected.revision
    && canonicalJson(persisted.recipient) === canonicalJson(expected.recipient)
    && canonicalJson(persisted.content) === canonicalJson(expected.content);
  if (!sameIdentity) {
    throw new Error('Persisted messaging draft identity or content conflicts with this retry.');
  }
  return persisted;
}

export async function persistMessagingDraftV1(
  draftInput: MessagingDraftV1,
  dependencies?: MessagingDraftServiceDependencies,
): Promise<MessagingDraftV1> {
  const draft = MessagingDraftV1Schema.parse(draftInput);
  if (draft.revision !== 1 || draft.parentVersionId !== null) {
    throw new Error('Initial messaging drafts must be revision 1 without a parent version.');
  }

  const persisted = await repositoryFrom(dependencies).createInitial({
    draft,
    contentHash: hashMessagingDraftContent(draft),
  });
  return assertPersistedDraft(draft, persisted);
}

export async function ensureMessagingDraftV1(
  draftInput: MessagingDraftV1,
  dependencies?: MessagingDraftServiceDependencies,
): Promise<MessagingDraftV1> {
  const draft = MessagingDraftV1Schema.parse(draftInput);
  const repository = repositoryFrom(dependencies);
  const existing = await repository.findVersion({
    organizationId: draft.organizationId,
    userId: draft.userId,
    draftId: draft.draftId,
    versionId: draft.versionId,
  });
  if (existing) return assertPersistedDraftIdentity(draft, existing);

  try {
    return await persistMessagingDraftV1(draft, { ...dependencies, repository });
  } catch (error) {
    const raced = await repository.findVersion({
      organizationId: draft.organizationId,
      userId: draft.userId,
      draftId: draft.draftId,
      versionId: draft.versionId,
    });
    if (!raced) throw error;
    return assertPersistedDraftIdentity(draft, raced);
  }
}

export async function appendMessagingDraftRevisionV1(
  parentInput: MessagingDraftV1,
  changes: {
    researchSnapshotId?: string | null;
    channel?: MessagingChannel;
    content?: MessagingContentV1;
  },
  dependencies?: MessagingDraftServiceDependencies,
): Promise<MessagingDraftV1> {
  const parent = MessagingDraftV1Schema.parse(parentInput);
  const child = createChildMessagingDraftV1(parent, {
    ...changes,
    versionId: dependencies?.createId?.() ?? randomUUID(),
    createdAt: dependencies?.now?.() ?? new Date().toISOString(),
  });
  const persisted = await repositoryFrom(dependencies).appendRevision({
    expectedParentVersionId: parent.versionId,
    draft: child,
    contentHash: hashMessagingDraftContent(child),
  });
  return assertPersistedDraft(child, persisted);
}

export async function getMessagingDraftVersionV1(
  input: { organizationId: string; userId: string; draftId: string; versionId: string },
  dependencies?: MessagingDraftServiceDependencies,
): Promise<MessagingDraftV1 | null> {
  const draft = await repositoryFrom(dependencies).findVersion(input);
  return draft ? MessagingDraftV1Schema.parse(draft) : null;
}

export async function getCurrentMessagingDraftVersionV1(
  input: { organizationId: string; userId: string; draftId: string },
  dependencies?: MessagingDraftServiceDependencies,
): Promise<MessagingDraftV1 | null> {
  const draft = await repositoryFrom(dependencies).findCurrentVersion(input);
  return draft ? MessagingDraftV1Schema.parse(draft) : null;
}
