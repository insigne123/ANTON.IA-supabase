import { z } from 'zod';

/**
 * Contacts from a file the person uploaded, ready to save in their contacts (plan 2, F4). Only the
 * rules live here: which column holds each field, how a row becomes a contact and when two contacts
 * are the same person. The server reads the whole file, looks up what is already saved and stages the
 * import for the approval card (server/cowork/contacts-import.ts); the approved effect saves exactly
 * the staged contacts. Nothing in the file is ever run: it is data.
 */

/** Contacts one import saves at most; more wait for another import. */
export const COWORK_IMPORT_LIMIT = 500;

export const COWORK_IMPORT_FIELDS = ['name', 'lastName', 'email', 'title', 'company', 'linkedinUrl', 'location'] as const;
export type CoworkImportField = typeof COWORK_IMPORT_FIELDS[number];
export type CoworkImportColumnMap = Partial<Record<CoworkImportField, string>>;

export const COWORK_IMPORT_FIELD_LABEL: Record<CoworkImportField, string> = {
  name: 'Nombre', lastName: 'Apellido', email: 'Correo', title: 'Cargo', company: 'Empresa', linkedinUrl: 'LinkedIn', location: 'Ubicación',
};

const header = z.string().trim().min(1).max(200).nullable().optional();

/** What the model may say about the columns: the header that holds each field, as the file writes it; null for «none». */
export const coworkImportColumnsSchema = z.object({
  name: header, lastName: header, email: header, title: header, company: header, linkedinUrl: header, location: header,
}).strict();

/** contacts.import: the uploaded file (with «#Hoja» for an Excel sheet other than the first) and, if the guess would miss, its columns. */
export const coworkContactsImportSchema = z.object({
  file: z.string().trim().min(1).max(160),
  columns: coworkImportColumnsSchema.nullable().optional(),
}).strict();
export type CoworkContactsImportInput = z.infer<typeof coworkContactsImportSchema>;

export type CoworkImportContact = {
  name: string; email: string | null; title: string | null; company: string | null; linkedinUrl: string | null; location: string | null;
};

/** Lowercase, without accents or signs (letters of any alphabet stay): how headers and names are compared. */
export const coworkPlainText = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
  .replace(/[^\p{L}\p{N}@.]+/gu, ' ').trim();

/**
 * What a header holds, most specific first: «Nombre de la empresa» is a company, «Correo de contacto» an
 * email and «Teléfono de contacto» none of them (contacts have no phone). A header that says nothing
 * known is left out.
 */
const GUESS: Array<[CoworkImportField | 'ignore', RegExp]> = [
  ['ignore', /\b(telefono|fono|celular|movil|phone|mobile|whatsapp|rut|dni)\b/],
  ['email', /\b(correo|email|e mail|mail)\b/],
  ['linkedinUrl', /\b(linkedin|perfil)\b/],
  ['company', /\b(empresa|compania|company|organizacion|organization|cuenta|account|razon social)\b/],
  ['title', /\b(cargo|puesto|titulo|title|job|rol|role|posicion|position)\b/],
  ['location', /\b(ubicacion|ciudad|city|pais|country|region|comuna|location)\b/],
  ['lastName', /\b(apellido|apellidos|last name|surname)\b/],
  ['name', /\b(nombre|nombres|name|full name|first name|contacto|persona)\b/],
];

/** Each field in the first header that says it holds it; a header holds one field. */
export function coworkGuessImportColumns(headers: string[]): CoworkImportColumnMap {
  const columns: CoworkImportColumnMap = {};
  for (const title of headers) {
    const field = GUESS.find(([, pattern]) => pattern.test(coworkPlainText(title)))?.[0];
    if (field && field !== 'ignore' && !columns[field]) columns[field] = title;
  }
  return columns;
}

/**
 * The columns to import from: those the model named (each must be a header of the file, written in any
 * case and with or without accents; null leaves a field out) and the guess for the rest. `unknown` lists
 * the names that are not headers, so the proposal says which ones instead of importing the wrong column.
 */
export function coworkImportColumns(headers: string[], asked?: z.infer<typeof coworkImportColumnsSchema> | null) {
  const byPlain = new Map(headers.map(title => [coworkPlainText(title), title]));
  const columns: CoworkImportColumnMap = {};
  const unknown: string[] = [];
  const named = new Set<CoworkImportField>();
  for (const field of COWORK_IMPORT_FIELDS) {
    const value = asked?.[field];
    if (value === undefined) continue;
    named.add(field);
    if (value === null) continue;
    const title = byPlain.get(coworkPlainText(value));
    if (title) columns[field] = title; else unknown.push(value);
  }
  const taken = new Set(Object.values(columns));
  for (const [field, title] of Object.entries(coworkGuessImportColumns(headers)) as Array<[CoworkImportField, string]>) {
    if (!named.has(field) && !taken.has(title)) { columns[field] = title; taken.add(title); }
  }
  return { columns, unknown };
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const LINKEDIN = /^(https?:\/\/)?([a-z0-9-]+\.)*linkedin\.com\/\S+$/i;

const cellText = (value: unknown, max = 300) => {
  const text = value === null || value === undefined ? '' : String(value).replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, max) : null;
};

/** The first valid address of a cell («mailto:», several separated by «;» or «,»); null if none is valid. */
function emailOf(value: string | null) {
  if (!value) return null;
  return value.toLowerCase().replace(/mailto:/g, ' ').split(/[\s;,]+/).find(part => EMAIL.test(part)) ?? null;
}

/** The ways a contact is the same person as another: its email, and its name with its company. */
export function coworkContactKeys(contact: { name?: string | null; email?: string | null; company?: string | null }) {
  const keys: string[] = [];
  const email = (contact.email || '').trim().toLowerCase();
  if (email) keys.push(`email:${email}`);
  const name = coworkPlainText(contact.name || '');
  if (name) keys.push(`name:${name}|${coworkPlainText(contact.company || '')}`);
  return keys;
}

export type CoworkImportPlan = {
  contacts: CoworkImportContact[];
  /** Rows read from the file. */
  total: number;
  /** Already saved, or repeated in the file. */
  duplicates: number;
  /** Rows without a name. */
  skipped: number;
  /** Contacts kept without their email because it was not a valid address. */
  invalidEmails: number;
  /** New contacts beyond the limit of one import. */
  overLimit: number;
};

/** Each row as a contact: without a name it is skipped; already saved or repeated, it is a duplicate; the rest, up to the limit, are imported. */
export function coworkImportPlan(table: { columns: string[]; body: unknown[][] }, columns: CoworkImportColumnMap, saved: Set<string>): CoworkImportPlan {
  const at = (field: CoworkImportField) => columns[field] ? table.columns.indexOf(columns[field]!) : -1;
  const index = Object.fromEntries(COWORK_IMPORT_FIELDS.map(field => [field, at(field)])) as Record<CoworkImportField, number>;
  const seen = new Set<string>();
  const plan: CoworkImportPlan = { contacts: [], total: table.body.length, duplicates: 0, skipped: 0, invalidEmails: 0, overLimit: 0 };
  for (const row of table.body) {
    const cell = (field: CoworkImportField) => index[field] >= 0 ? cellText(row[index[field]]) : null;
    const name = [cell('name'), cell('lastName')].filter(Boolean).join(' ').slice(0, 300);
    if (!name) { plan.skipped++; continue; }
    const written = cell('email');
    const email = emailOf(written);
    if (written && !email) plan.invalidEmails++;
    const linkedin = cell('linkedinUrl');
    const contact: CoworkImportContact = {
      name, email, title: cell('title'), company: cell('company'),
      linkedinUrl: linkedin && LINKEDIN.test(linkedin) ? (/^https?:\/\//i.test(linkedin) ? linkedin : `https://${linkedin}`) : null,
      location: cell('location'),
    };
    const keys = coworkContactKeys(contact);
    if (keys.some(key => seen.has(key) || saved.has(key))) { plan.duplicates++; continue; }
    keys.forEach(key => seen.add(key));
    if (plan.contacts.length >= COWORK_IMPORT_LIMIT) { plan.overLimit++; continue; }
    plan.contacts.push(contact);
  }
  return plan;
}

/** «Importar 12 contactos de feria.csv (3 ya estaban)»: the proposal as the person reads it. */
export function coworkImportLabel(file: string, plan: Pick<CoworkImportPlan, 'contacts' | 'duplicates'>) {
  const count = plan.contacts.length;
  const already = plan.duplicates ? ` (${plan.duplicates} ya ${plan.duplicates === 1 ? 'estaba' : 'estaban'})` : '';
  return `Importar ${count} contacto${count === 1 ? '' : 's'} de ${file}${already}`.slice(0, 280);
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** Rows the review card shows; the rest are counted. */
export const COWORK_IMPORT_SHOWN = 8;

/** A staged import as the review card receives it (contactsimport-preview). */
export type CoworkImportPreview = {
  file: string; sheet: string | null; columns: Array<{ field: string; label: string; header: string }>;
  contacts: Array<Pick<CoworkImportContact, 'name' | 'email' | 'title' | 'company'>>;
  count: number; total: number; duplicates: number; skipped: number; withoutEmail: number; overLimit: number; limit: number;
};

/** What the review card says, word for word: the card draws it and the corpus shows it to the judge. */
export function coworkImportSummary(preview: Omit<CoworkImportPreview, 'contacts' | 'total'>) {
  const without = preview.withoutEmail;
  return {
    headline: plural(preview.count, 'contacto nuevo', 'contactos nuevos'),
    source: `de ${preview.file}${preview.sheet ? ` · hoja ${preview.sheet}` : ''}`,
    leftOut: [
      preview.duplicates ? `${plural(preview.duplicates, 'ya estaba', 'ya estaban')} en tus contactos` : '',
      preview.skipped ? plural(preview.skipped, 'fila sin nombre', 'filas sin nombre') : '',
    ].filter(Boolean),
    columns: preview.columns.map(column => `${column.label} ← ${column.header}`),
    more: preview.count > COWORK_IMPORT_SHOWN ? `y ${plural(preview.count - COWORK_IMPORT_SHOWN, 'contacto más', 'contactos más')}` : null,
    notes: [
      without ? `${plural(without, 'contacto no trae', 'contactos no traen')} correo: se ${without === 1 ? 'guarda' : 'guardan'} igual, y para ${without === 1 ? 'escribirle' : 'escribirles'} hay que buscar su correo primero.` : '',
      preview.overLimit ? `Se importan los primeros ${preview.limit}; ${preview.overLimit === 1 ? 'queda 1' : `quedan ${preview.overLimit}`} para otra importación.` : '',
    ].filter(Boolean),
    approve: `Importar ${plural(preview.count, 'contacto', 'contactos')}`,
  };
}
