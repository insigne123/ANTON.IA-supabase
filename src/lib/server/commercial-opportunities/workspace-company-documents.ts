// «Documentos de la empresa»: kept by admins with their expiry, downloaded by the team, read by the AI as what is current.
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AuthError } from '@/lib/server/auth-utils';
import { OPPORTUNITY_BUCKET, type WorkScope } from '@/lib/commercial-opportunities/workspace';
import { companyDocumentAlerts, companyDocumentInputSchema, type CompanyDocument } from '@/lib/commercial-opportunities/company-documents';
import { opportunityDb } from './workspace-store';
import { assertOpportunityAdmin } from './workspace-access';
import { opportunityStorageName } from './document-files';

const TABLE = 'opportunity_company_documents';
const COLUMNS = 'id,kind,label,file_name,expires_at,created_at';
/** What the bucket accepts and a certificate comes as. */
const MIMES: Record<string, string> = { pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
const MAX_BYTES = 20 * 1024 * 1024;

const toDocument = (row: any): CompanyDocument => ({ id: row.id, kind: row.kind, label: row.label, fileName: row.file_name, expiresAt: row.expires_at ?? null, createdAt: row.created_at });

/** The folder, soonest to lapse first; `available` is false before the migration. */
export async function listCompanyDocuments(client: SupabaseClient, organizationId: string) {
  const result = await client.from(TABLE).select(COLUMNS).eq('organization_id', organizationId).order('expires_at', { ascending: true, nullsFirst: false }).limit(100);
  if (result.error) return { available: false, documents: [] as CompanyDocument[] };
  return { available: true, documents: (result.data || []).map(toDocument) };
}
/** Lapsed or about to lapse, for the admins' bar; nothing when the folder does not exist yet. */
export async function companyDocumentAlertsFor(client: SupabaseClient, organizationId: string) {
  const { documents } = await listCompanyDocuments(client, organizationId);
  return companyDocumentAlerts(documents);
}

/** A file and its expiry, checked by its first bytes (a PDF starts «%PDF-», a Word file is a ZIP). */
export async function addCompanyDocument(client: SupabaseClient, scope: WorkScope, input: { kind: unknown; label: unknown; expiresAt: unknown; file: { name: string; bytes: Uint8Array } }) {
  assertOpportunityAdmin(scope);
  const meta = companyDocumentInputSchema.parse({ kind: input.kind, label: input.label, expiresAt: input.expiresAt || null });
  const ext = input.file.name.toLowerCase().split('.').pop() || '';
  const mime = MIMES[ext];
  const head = input.file.bytes.subarray(0, 5);
  const valid = ext === 'pdf' ? Buffer.from(head).toString('latin1') === '%PDF-' : ext === 'docx' ? head[0] === 0x50 && head[1] === 0x4b : false;
  if (!mime || !valid) throw new AuthError('Sube el documento en PDF o Word (.docx).', 400);
  if (!input.file.bytes.length || input.file.bytes.length > MAX_BYTES) throw new AuthError('Adjunta un documento de hasta 20 MB.', 400);
  const path = `company/${scope.organizationId}/${randomUUID()}-${opportunityStorageName(input.file.name)}`;
  const upload = await client.storage.from(OPPORTUNITY_BUCKET).upload(path, input.file.bytes, { contentType: mime, upsert: false });
  if (upload.error) throw new AuthError('No se pudo guardar el archivo. Intenta de nuevo.', 503);
  const saved = await client.from(TABLE).insert({ organization_id: scope.organizationId, kind: meta.kind, label: meta.label, file_name: input.file.name.slice(0, 255),
    storage_path: path, mime, size_bytes: input.file.bytes.length, expires_at: meta.expiresAt, uploaded_by: scope.userId }).select(COLUMNS).maybeSingle();
  if (saved.error || !saved.data) {
    // A row that could not be written leaves no orphan file behind.
    await client.storage.from(OPPORTUNITY_BUCKET).remove([path]).catch(() => undefined);
    throw new AuthError('No se pudo guardar el documento. Intenta de nuevo.', 503);
  }
  return toDocument(saved.data);
}

/** A new expiry or name, for when the same certificate is renewed without a new file. */
export async function updateCompanyDocument(client: SupabaseClient, scope: WorkScope, id: string, input: { kind: unknown; label: unknown; expiresAt: unknown }) {
  assertOpportunityAdmin(scope);
  const meta = companyDocumentInputSchema.parse({ kind: input.kind, label: input.label, expiresAt: input.expiresAt || null });
  const row = opportunityDb(await client.from(TABLE).update({ kind: meta.kind, label: meta.label, expires_at: meta.expiresAt, updated_at: new Date().toISOString() })
    .eq('organization_id', scope.organizationId).eq('id', id).select(COLUMNS).maybeSingle());
  if (!row) throw new AuthError('Ese documento ya no está.', 404);
  return toDocument(row);
}

export async function deleteCompanyDocument(client: SupabaseClient, scope: WorkScope, id: string) {
  assertOpportunityAdmin(scope);
  const row = opportunityDb(await client.from(TABLE).select('storage_path').eq('organization_id', scope.organizationId).eq('id', id).maybeSingle());
  if (!row) throw new AuthError('Ese documento ya no está.', 404);
  opportunityDb(await client.from(TABLE).delete().eq('organization_id', scope.organizationId).eq('id', id));
  await client.storage.from(OPPORTUNITY_BUCKET).remove([row.storage_path]).catch(() => undefined);
}

/** Anyone of the workspace may download them: they go into every offer. */
export async function downloadCompanyDocument(client: SupabaseClient, scope: WorkScope, id: string) {
  const row = opportunityDb(await client.from(TABLE).select('storage_path,file_name,mime').eq('organization_id', scope.organizationId).eq('id', id).maybeSingle());
  if (!row) throw new AuthError('Ese documento ya no está.', 404);
  const file = await client.storage.from(OPPORTUNITY_BUCKET).download(row.storage_path);
  if (file.error || !file.data) throw new AuthError('No se pudo descargar el archivo.', 503);
  return { bytes: await file.data.arrayBuffer(), name: String(row.file_name), mime: String(row.mime) };
}
