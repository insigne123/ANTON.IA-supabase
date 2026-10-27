import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AuthContext } from '@/lib/server/auth-utils';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { deterministicMessagingUuid } from '@/lib/messaging-contracts';
import { COWORK_FILE_UNREADABLE, coworkDecodeFile, coworkFileKind, coworkFileTable } from '@/lib/cowork/file-read';
import {
  COWORK_IMPORT_FIELD_LABEL, COWORK_IMPORT_LIMIT, COWORK_IMPORT_SHOWN, COWORK_TYPED_CONTACTS_SOURCE, coworkContactKeys, coworkContactsImportSchema, coworkImportColumns, coworkImportLabel, coworkImportPlan,
  coworkTypedContactsTable,
  type CoworkImportColumnMap, type CoworkImportContact, type CoworkImportField,
} from '@/lib/cowork/contacts-import';
import { requireCoworkWorkerAccess } from './access';
import { getCoworkRun } from './runs';
import { readLeadClaims } from '@/lib/server/team-locks';
import { leadClaimRefusal } from '@/lib/lead-claim';
import { normalizeLockEmail, normalizeLockLinkedin } from '@/lib/team-lock';
import { downloadCoworkUpload, findCoworkUpload, type CoworkUploadMatch } from './extended-reads';
import { coworkExcelTable } from './file-binary';

/**
 * Importing the contacts of an uploaded file (plan 2, F4), behind COWORK_CONTACTS_IMPORT_ENABLED and the
 * M3 migration. Staging reads the whole file, maps its columns, leaves out what is already saved and
 * keeps the result in cowork_contacts_import_proposals, pinned by a hash in the proposal target. The
 * approval card shows that row; the approved effect saves exactly those contacts in `leads`, the table
 * Cowork searches and campaigns use, with an id per contact so a retry never saves one twice.
 */

type Scope = { userId: string; organizationId: string };

/** On once the M3 migration (cowork_contacts_import_proposals and the contacts_import effect) is applied. */
export const coworkContactsImportEnabled = () => process.env.COWORK_CONTACTS_IMPORT_ENABLED === 'true';

const quote = (value: string) => `«${value}»`;
const TARGET = /^contactsimport:([a-f0-9]{64})$/;

export function parseCoworkContactsImportTarget(targetId: string) {
  const match = TARGET.exec(String(targetId || ''));
  if (!match) throw new Error('La propuesta de importación no es válida.');
  return { hash: match[1] };
}

export function hashCoworkContactsImport(runId: string, file: string, sheet: string | null, contacts: CoworkImportContact[]) {
  return createHash('sha256').update(JSON.stringify(['cowork|contacts-import', runId, file, sheet,
    contacts.map(contact => [contact.name, contact.email, contact.title, contact.company, contact.linkedinUrl, contact.location])])).digest('hex');
}

/** The whole table of the file, or why it cannot be imported, in words the model can pass on. */
async function importTable(client: SupabaseClient, scope: Scope, upload: CoworkUploadMatch) {
  const kind = coworkFileKind(upload.name);
  if (kind === 'excel' && !upload.name.endsWith('.xlsx')) throw new Error(COWORK_FILE_UNREADABLE.xls);
  if (kind !== 'csv' && kind !== 'json' && kind !== 'excel') throw new Error('Los contactos se importan desde un CSV, un Excel (.xlsx) o una lista JSON; este archivo no trae una tabla.');
  const bytes = await downloadCoworkUpload(client, scope, upload);
  if (kind === 'excel') {
    const opened = await coworkExcelTable(bytes, { sheet: upload.sheet });
    if ('unreadable' in opened) throw new Error(COWORK_FILE_UNREADABLE[opened.unreadable]);
    return { columns: opened.table.columns, body: opened.table.body, sheet: opened.table.sheet as string | null };
  }
  const table = coworkFileTable(upload.name, coworkDecodeFile(bytes));
  if (!table || !table.body.length) throw new Error('El archivo no trae filas para importar.');
  return { ...table, sheet: null as string | null };
}

/** The ways each of this user's saved contacts can be recognized (email, and name with company); in id order, so no page repeats or skips one. */
async function savedContactKeys(client: SupabaseClient, scope: Scope) {
  const keys = new Set<string>();
  for (let from = 0; from < 20_000; from += 1000) {
    const { data, error } = await client.from('leads').select('name,email,company')
      .eq('organization_id', scope.organizationId).eq('user_id', scope.userId).order('id').range(from, from + 999);
    if (error) throw new Error('No se pudieron revisar tus contactos guardados.');
    for (const row of data || []) coworkContactKeys(row as { name?: string; email?: string; company?: string }).forEach(key => keys.add(key));
    if (!data || data.length < 1000) break;
  }
  return keys;
}

/**
 * Stage the import of a file: the whole file read, its columns mapped, the rows that are already saved
 * or have no name left out, and at most COWORK_IMPORT_LIMIT contacts kept. Nothing is saved in the
 * contacts here. Every refusal says why, so the model can tell the person what to do.
 */
export async function stageCoworkContactsImport(scope: Scope, runId: string, input: unknown) {
  const request = coworkContactsImportSchema.parse(input);
  const client = getSupabaseAdminClient();
  await requireCoworkWorkerAccess(client, scope);
  const state = await client.from('cowork_runs').select('status').eq('id', runId)
    .eq('user_id', scope.userId).eq('organization_id', scope.organizationId).maybeSingle();
  if (state.error || !state.data || (state.data.status !== 'running' && state.data.status !== 'waiting_approval')) {
    throw new Error('El trabajo ya no admite propuestas.');
  }
  // People the user wrote in the message: the same plan, card and approved effect as a file, without one.
  const typed = request.people?.length ? coworkTypedContactsTable(request.people) : null;
  let fileName: string, table: { columns: string[]; body: unknown[][]; sheet: string | null }, columns: CoworkImportColumnMap;
  if (typed) {
    fileName = COWORK_TYPED_CONTACTS_SOURCE; table = { ...typed.table, sheet: null }; columns = typed.columns;
  } else {
    const found = await findCoworkUpload(client, scope, String(request.file));
    if (!found.found) throw new Error(`No encontré ${quote(String(request.file))} entre los archivos que subiste: léelo primero con files.read y usa su nombre exacto.`);
    const { upload } = found;
    fileName = upload.name;
    table = await importTable(client, scope, upload);
    const mapped = coworkImportColumns(table.columns, request.columns);
    const headers = table.columns.map(quote).join(', ');
    if (mapped.unknown.length) throw new Error(`El archivo no tiene ${mapped.unknown.length === 1 ? 'la columna' : 'las columnas'} ${mapped.unknown.map(quote).join(', ')}; sus columnas son ${headers}.`);
    if (!mapped.columns.name) throw new Error(`No encontré la columna con el nombre de cada persona; las columnas del archivo son ${headers}. Indica cuál es en columns.name.`);
    columns = mapped.columns;
  }
  const plan = coworkImportPlan(table, columns, await savedContactKeys(client, scope));
  if (!plan.contacts.length) {
    throw new Error(plan.duplicates
      ? `No hay contactos nuevos: ${plan.duplicates === 1 ? `la persona ${typed ? 'que me diste' : 'del archivo'} ya está` : `las ${plan.duplicates} personas ${typed ? 'que me diste' : 'del archivo'} ya están`} en tus contactos.`
      : typed ? 'Falta el nombre de la persona para guardarla.' : 'Ninguna fila del archivo trae un nombre para importar.');
  }
  const hash = hashCoworkContactsImport(runId, fileName, table.sheet, plan.contacts);
  const cap = (value: number) => Math.min(value, 1_000_000);
  const staged = await client.from('cowork_contacts_import_proposals').upsert({
    run_id: runId, user_id: scope.userId, organization_id: scope.organizationId,
    file_name: fileName, sheet: table.sheet, column_map: typed ? {} : columns, contacts: plan.contacts,
    total_rows: cap(plan.total), duplicates: cap(plan.duplicates), skipped: cap(plan.skipped), patch_hash: hash,
  }, { onConflict: 'run_id', ignoreDuplicates: true }).select('run_id').maybeSingle();
  if (staged.error) throw new Error('No se pudo preparar la importación.');
  if (!staged.data) {
    const existing = await client.from('cowork_contacts_import_proposals').select('patch_hash')
      .eq('run_id', runId).eq('user_id', scope.userId).eq('organization_id', scope.organizationId).maybeSingle();
    if (existing.error || !existing.data || existing.data.patch_hash !== hash) throw new Error('Este trabajo ya tiene otra importación propuesta.');
  }
  return { hash, label: coworkImportLabel(fileName, plan), plan };
}

const contactSchema = z.object({
  name: z.string().min(1).max(300), email: z.string().max(320).nullable(), title: z.string().max(300).nullable(),
  company: z.string().max(300).nullable(), linkedinUrl: z.string().max(2048).nullable(), location: z.string().max(300).nullable(),
}).strict();

/** What the approval card shows: the file, which column is which, the contacts and what was left out. */
export async function readCoworkContactsImportPreview(auth: AuthContext, runId: string, targetId: string) {
  const client = getSupabaseAdminClient();
  const row = await client.from('cowork_contacts_import_proposals')
    .select('file_name,sheet,column_map,contacts,total_rows,duplicates,skipped,patch_hash').eq('run_id', runId)
    .eq('user_id', auth.user.id).eq('organization_id', auth.organizationId).maybeSingle();
  if (row.error || !row.data) return null;
  const contacts = z.array(contactSchema).safeParse(row.data.contacts);
  if (!contacts.success) return null;
  const columnMap = (row.data.column_map || {}) as CoworkImportColumnMap;
  const count = contacts.data.length;
  const total = Number(row.data.total_rows) || 0;
  const duplicates = Number(row.data.duplicates) || 0;
  const skipped = Number(row.data.skipped) || 0;
  return {
    file: String(row.data.file_name), sheet: row.data.sheet ? String(row.data.sheet) : null,
    columns: (Object.keys(COWORK_IMPORT_FIELD_LABEL) as CoworkImportField[]).filter(field => columnMap[field])
      .map(field => ({ field, label: COWORK_IMPORT_FIELD_LABEL[field], header: String(columnMap[field]) })),
    // Only the rows the card shows travel to the page; the rest are counted.
    contacts: contacts.data.slice(0, COWORK_IMPORT_SHOWN), count, total, duplicates, skipped,
    withoutEmail: contacts.data.filter(contact => !contact.email).length,
    overLimit: Math.max(0, total - skipped - duplicates - count),
    limit: COWORK_IMPORT_LIMIT,
    matches: `contactsimport:${String(row.data.patch_hash)}` === String(targetId || '')
      && hashCoworkContactsImport(runId, String(row.data.file_name), row.data.sheet ? String(row.data.sheet) : null, contacts.data) === String(row.data.patch_hash),
  };
}

/**
 * Save the approved import in the person's contacts. Contacts saved meanwhile are left out again; each
 * contact has an id made from its email (or name and company), so running it twice saves nothing new.
 * The flag is also the switch that stops an import already approved.
 */
export async function executeCoworkContactsImport(auth: AuthContext, runId: string, targetId: string) {
  if (!coworkContactsImportEnabled()) throw new Error('La importación de contactos está desactivada por ahora: no se guardó ningún contacto.');
  const target = parseCoworkContactsImportTarget(targetId);
  const scope = { userId: auth.user.id, organizationId: auth.organizationId };
  const client = getSupabaseAdminClient();
  const state = await getCoworkRun(auth, runId);
  if (!state || (state.run.status !== 'completed' && state.run.status !== 'waiting_approval')) {
    throw new Error('La propuesta aprobada ya no está disponible en este trabajo.');
  }
  await requireCoworkWorkerAccess(client, scope);
  const row = await client.from('cowork_contacts_import_proposals').select('file_name,sheet,contacts,patch_hash')
    .eq('run_id', runId).eq('user_id', scope.userId).eq('organization_id', scope.organizationId).maybeSingle();
  if (row.error || !row.data) throw new Error('La propuesta aprobada ya no está disponible.');
  const contacts = z.array(contactSchema).max(COWORK_IMPORT_LIMIT).parse(row.data.contacts);
  const sheet = row.data.sheet ? String(row.data.sheet) : null;
  if (row.data.patch_hash !== target.hash || hashCoworkContactsImport(runId, String(row.data.file_name), sheet, contacts) !== target.hash) {
    throw new Error('La importación cambió desde tu revisión. Pide una nueva revisión.');
  }
  const saved = await savedContactKeys(client, scope);
  const unsaved = contacts.filter(contact => !coworkContactKeys(contact).some(key => saved.has(key)));
  // Whoever another member saved in the last 30 days is theirs: left out here, or the database refuses the whole batch.
  const claims = [];
  for (let start = 0; start < unsaved.length; start += 200) {
    const part = unsaved.slice(start, start + 200);
    claims.push(...await readLeadClaims(client, scope, {
      emails: part.flatMap(contact => contact.email ? [contact.email] : []),
      linkedinUrls: part.flatMap(contact => contact.linkedinUrl ? [contact.linkedinUrl] : []),
    }));
  }
  const heldEmails = new Set(claims.filter(claim => claim.match_kind === 'email').map(claim => normalizeLockEmail(claim.match_key)));
  const heldLinkedins = new Set(claims.filter(claim => claim.match_kind === 'linkedin').map(claim => `linkedin.com/in/${claim.match_key}`));
  const fresh = unsaved.filter(contact => !heldEmails.has(normalizeLockEmail(contact.email)) && !heldLinkedins.has(normalizeLockLinkedin(contact.linkedinUrl)));
  const claimed = unsaved.length - fresh.length;
  let imported = 0;
  for (let start = 0; start < fresh.length; start += 100) {
    const rows = fresh.slice(start, start + 100).map(contact => ({
      id: deterministicMessagingUuid(`cowork-import:${scope.organizationId}:${scope.userId}:${coworkContactKeys(contact)[0]}`),
      user_id: scope.userId, organization_id: scope.organizationId,
      name: contact.name, title: contact.title || '', company: contact.company || '', email: contact.email,
      linkedin_url: contact.linkedinUrl, location: contact.location, status: 'saved', source_provider: 'cowork_import',
    }));
    const result = await client.from('leads').upsert(rows, { onConflict: 'id', ignoreDuplicates: true }).select('id');
    if (result.error) {
      const held = leadClaimRefusal(result.error);
      if (held) throw new Error(`${imported ? `Se guardaron ${imported} contactos y el resto no: ` : 'No se guardaron los contactos: '}alguien del archivo quedó adjudicado a otra persona del equipo mientras tanto (${held.message}). Propón de nuevo la importación de los pendientes.`);
      throw new Error(imported ? `Se guardaron ${imported} contactos y el resto falló; revisa tus contactos antes de proponer otra importación para los pendientes.` : 'No se pudieron guardar los contactos.');
    }
    imported += (result.data || []).length;
  }
  const alreadySaved = contacts.length - imported - claimed;
  const file = String(row.data.file_name);
  const held = claimed ? ` ${claimed} ${claimed === 1 ? 'quedó fuera porque está adjudicado' : 'quedaron fuera porque están adjudicados'} a otra persona del equipo, que ${claimed === 1 ? 'lo' : 'los'} guardó en los últimos 30 días.` : '';
  return {
    reply: imported
      ? `Importé ${imported} contacto${imported === 1 ? '' : 's'} de ${file} a tus contactos${alreadySaved ? ` (${alreadySaved} ya ${alreadySaved === 1 ? 'estaba' : 'estaban'})` : ''}.${held}`
      : claimed ? `No importé contactos de ${file}.${held}` : `No hubo contactos nuevos que importar de ${file}: ya estaban en tus contactos.`,
    result: { file, imported, alreadySaved, claimed, withoutEmail: fresh.filter(contact => !contact.email).length },
  };
}
