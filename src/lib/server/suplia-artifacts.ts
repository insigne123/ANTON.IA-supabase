import type { AuthContext } from '@/lib/server/auth-utils';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { buildSupliaArtifactRestoreSummary } from '@/lib/suplia/artifacts';
import type { SupliaArtifact, SupliaArtifactType, SupliaArtifactVersion } from '@/lib/suplia/types';

export type SupliaArtifactDraft = {
  type: SupliaArtifactType | string;
  title: string;
  content?: string | null;
  data?: Record<string, unknown> | null;
};

export type SupliaArtifactInsertInput = SupliaArtifactDraft & {
  conversationId: string;
  jobId?: string | null;
  sourceMessageId?: string | null;
  changeSummary?: string | null;
};

export type SupliaArtifactUpdateInput = SupliaArtifactDraft & {
  artifactId: string;
  conversationId: string;
  jobId?: string | null;
  sourceMessageId?: string | null;
  changeSummary?: string | null;
};

function hasStructuredData(data: Record<string, unknown> | null | undefined) {
  return Boolean(data && Object.keys(data).length > 0);
}

function unwrapJsonContent(content: string) {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced?.[1]?.trim() || trimmed;
}

function parseJsonObjectContent(content?: string | null): Record<string, unknown> | null {
  if (!content) return null;
  const normalized = unwrapJsonContent(content);
  if (!normalized.startsWith('{') || !normalized.endsWith('}')) return null;
  try {
    const parsed = JSON.parse(normalized);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

export function normalizeSupliaArtifactDraft<T extends SupliaArtifactDraft>(artifact: T): T {
  const parsedContent = parseJsonObjectContent(artifact.content);
  if (!parsedContent) return artifact;

  return {
    ...artifact,
    content: null,
    data: hasStructuredData(artifact.data) ? { ...parsedContent, ...artifact.data } : parsedContent,
  };
}

export function mapSupliaArtifactRow(row: any): SupliaArtifact {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    organizationId: row.organization_id,
    userId: row.user_id,
    jobId: row.job_id,
    sourceMessageId: row.source_message_id,
    type: row.type,
    artifactKind: row.artifact_kind,
    status: row.status,
    versionNumber: row.version_number == null ? null : Number(row.version_number),
    title: row.title,
    content: row.content,
    data: row.data,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapSupliaArtifactVersionRow(row: any): SupliaArtifactVersion {
  return {
    id: row.id,
    artifactId: row.artifact_id,
    conversationId: row.conversation_id,
    organizationId: row.organization_id,
    userId: row.user_id,
    sourceMessageId: row.source_message_id,
    jobId: row.job_id,
    versionNumber: Number(row.version_number || 1),
    title: row.title,
    content: row.content,
    data: row.data,
    changeSummary: row.change_summary,
    createdAt: row.created_at,
  };
}

function versionRowFromArtifact(row: any, changeSummary?: string | null) {
  return {
    artifact_id: row.id,
    conversation_id: row.conversation_id,
    organization_id: row.organization_id,
    user_id: row.user_id || null,
    source_message_id: row.source_message_id || null,
    job_id: row.job_id || null,
    version_number: Number(row.version_number || 1),
    title: row.title,
    content: row.content ?? null,
    data: row.data || {},
    change_summary: changeSummary || null,
  };
}

export async function insertSupliaArtifacts(auth: AuthContext, artifacts: SupliaArtifactInsertInput[]) {
  if (artifacts.length === 0) return [];
  const admin = getSupabaseAdminClient();
  const now = new Date().toISOString();
  const normalizedArtifacts = artifacts.map(normalizeSupliaArtifactDraft);

  const { data, error } = await admin
    .from('suplia_artifacts')
    .insert(normalizedArtifacts.map((artifact) => ({
      conversation_id: artifact.conversationId,
      organization_id: auth.organizationId,
      user_id: auth.user.id,
      job_id: artifact.jobId || null,
      source_message_id: artifact.sourceMessageId || null,
      type: artifact.type,
      artifact_kind: artifact.type,
      status: 'active',
      version_number: 1,
      title: artifact.title,
      content: artifact.content || null,
      data: artifact.data || {},
      updated_at: now,
    })))
    .select('*');
  if (error) throw error;

  const rows = data || [];
  if (rows.length > 0) {
    const { error: versionError } = await admin
      .from('suplia_artifact_versions')
      .insert(rows.map((row: any, index: number) => versionRowFromArtifact(row, normalizedArtifacts[index]?.changeSummary || 'Version inicial.')));
    if (versionError) throw versionError;
  }

  return rows.map(mapSupliaArtifactRow);
}

export async function updateSupliaArtifact(auth: AuthContext, input: SupliaArtifactUpdateInput) {
  const admin = getSupabaseAdminClient();
  const parsedContentInput = parseJsonObjectContent(input.content);
  const normalizedInput = normalizeSupliaArtifactDraft(input);
  const { data: existing, error: existingError } = await admin
    .from('suplia_artifacts')
    .select('*')
    .eq('id', input.artifactId)
    .eq('conversation_id', input.conversationId)
    .eq('organization_id', auth.organizationId)
    .maybeSingle();
  if (existingError) throw existingError;
  if (!existing) throw new Error('Artifact no encontrado para actualizar.');

  const nextVersion = Number(existing.version_number || 1) + 1;
  const now = new Date().toISOString();
  const patch = {
    type: normalizedInput.type || existing.type,
    artifact_kind: normalizedInput.type || existing.artifact_kind || existing.type,
    title: normalizedInput.title || existing.title,
    content: parsedContentInput ? null : input.content ?? existing.content ?? null,
    data: normalizedInput.data || existing.data || {},
    source_message_id: normalizedInput.sourceMessageId || existing.source_message_id || null,
    job_id: normalizedInput.jobId || existing.job_id || null,
    version_number: nextVersion,
    status: 'active',
    updated_at: now,
  };

  const { data: updated, error: updateError } = await admin
    .from('suplia_artifacts')
    .update(patch)
    .eq('id', input.artifactId)
    .eq('organization_id', auth.organizationId)
    .select('*')
    .single();
  if (updateError) throw updateError;

  const { error: versionError } = await admin
    .from('suplia_artifact_versions')
    .insert(versionRowFromArtifact(updated, input.changeSummary || 'Actualizacion solicitada desde el chat.'));
  if (versionError) throw versionError;

  return mapSupliaArtifactRow(updated);
}

export async function listSupliaArtifactVersions(auth: AuthContext, artifactId: string) {
  const admin = getSupabaseAdminClient();
  const { data, error } = await admin
    .from('suplia_artifact_versions')
    .select('*')
    .eq('artifact_id', artifactId)
    .eq('organization_id', auth.organizationId)
    .order('version_number', { ascending: false });
  if (error) throw error;
  return (data || []).map(mapSupliaArtifactVersionRow);
}

export async function restoreSupliaArtifactVersion(auth: AuthContext, input: { artifactId: string; versionId: string }) {
  const admin = getSupabaseAdminClient();
  const [{ data: artifact, error: artifactError }, { data: version, error: versionError }] = await Promise.all([
    admin
      .from('suplia_artifacts')
      .select('*')
      .eq('id', input.artifactId)
      .eq('organization_id', auth.organizationId)
      .maybeSingle(),
    admin
      .from('suplia_artifact_versions')
      .select('*')
      .eq('id', input.versionId)
      .eq('artifact_id', input.artifactId)
      .eq('organization_id', auth.organizationId)
      .maybeSingle(),
  ]);
  if (artifactError) throw artifactError;
  if (versionError) throw versionError;
  if (!artifact) throw new Error('Artifact no encontrado.');
  if (!version) throw new Error('Version de artifact no encontrada.');

  const nextVersion = Number(artifact.version_number || 1) + 1;
  const now = new Date().toISOString();
  const patch = {
    title: version.title || artifact.title,
    content: version.content ?? null,
    data: version.data || {},
    version_number: nextVersion,
    status: 'active',
    updated_at: now,
  };

  const { data: updated, error: updateError } = await admin
    .from('suplia_artifacts')
    .update(patch)
    .eq('id', input.artifactId)
    .eq('organization_id', auth.organizationId)
    .select('*')
    .single();
  if (updateError) throw updateError;

  const { data: restoredVersion, error: insertError } = await admin
    .from('suplia_artifact_versions')
    .insert({
      artifact_id: updated.id,
      conversation_id: updated.conversation_id,
      organization_id: updated.organization_id,
      user_id: auth.user.id,
      source_message_id: updated.source_message_id || null,
      job_id: updated.job_id || null,
      version_number: nextVersion,
      title: updated.title,
      content: updated.content ?? null,
      data: updated.data || {},
      change_summary: buildSupliaArtifactRestoreSummary(Number(version.version_number || 1)),
    })
    .select('*')
    .single();
  if (insertError) throw insertError;

  return {
    artifact: mapSupliaArtifactRow(updated),
    version: mapSupliaArtifactVersionRow(restoredVersion),
  };
}
