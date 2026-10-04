import { z } from 'zod';
import type { EnrichedLead, Lead } from '@/lib/types';

/**
 * «Importar contactos» (Plan 9): a CSV row becomes a contact in «Por escribir» when it brings an email or a phone, like a
 * contact saved from Búsqueda, or in «Por completar» when it does not, so its email can be searched. An imported email is
 * not verified: the file says nothing about whether it works.
 */
export const CSV_IMPORT_MAX_ROWS = 2000;

const optionalUrl = z.string().url('LinkedIn inválido: pega la dirección completa, con https://').optional().or(z.literal(''));

export const CsvLeadSchema = z.object({
    id: z.string().optional(),
    name: z.string().min(1, 'Falta el nombre'),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    email: z.string().email('Correo inválido').optional().or(z.literal('')),
    title: z.string().optional(),
    company: z.string().optional(),
    linkedinUrl: optionalUrl,
    location: z.string().optional(),
    phone: z.string().optional(),
}).superRefine((row, ctx) => {
    if (!row.email && !row.phone && !row.company && !row.linkedinUrl) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['company'], message: 'Sin correo ni teléfono: agrega la empresa o el LinkedIn para buscar su correo' });
    }
});

export type CsvLeadInput = z.infer<typeof CsvLeadSchema>;
export type CsvLeadField = Exclude<keyof CsvLeadInput, 'id'>;

export type ColumnMapping = {
    csvHeader: string;
    leadField: CsvLeadField | 'ignore';
};

export const AVAILABLE_FIELDS: { value: CsvLeadField; label: string }[] = [
    { value: 'name', label: 'Nombre completo' },
    { value: 'firstName', label: 'Nombre (sin apellido)' },
    { value: 'lastName', label: 'Apellido' },
    { value: 'email', label: 'Correo' },
    { value: 'phone', label: 'Teléfono' },
    { value: 'company', label: 'Empresa' },
    { value: 'title', label: 'Cargo' },
    { value: 'linkedinUrl', label: 'LinkedIn' },
    { value: 'location', label: 'Ubicación' },
];

const normalizeHeader = (header: string) => header.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const hasAny = (header: string, words: string[]) => words.some((word) => header.includes(word));
const LAST_NAME_WORDS = ['last name', 'lastname', 'surname', 'apellido'];

function guessField(header: string, hasLastNameColumn: boolean): CsvLeadField | 'ignore' {
    if (hasAny(header, ['email', 'e-mail', 'correo', 'mail'])) return 'email';
    if (hasAny(header, ['linkedin']) || header === 'url' || header === 'perfil') return 'linkedinUrl';
    // Before the name: «Company Name» and «Nombre de la empresa» are the company.
    if (hasAny(header, ['company', 'empresa', 'organizacion', 'organization', 'compania'])) return 'company';
    if (hasAny(header, ['phone', 'telefono', 'celular', 'mobile', 'movil', 'whatsapp'])) return 'phone';
    if (hasAny(header, ['title', 'cargo', 'puesto', 'role', 'position', 'posicion'])) return 'title';
    if (hasAny(header, LAST_NAME_WORDS)) return 'lastName';
    if (hasAny(header, ['first name', 'firstname', 'given name', 'primer nombre']) || (header === 'nombre' && hasLastNameColumn)) return 'firstName';
    if (hasAny(header, ['name', 'nombre', 'persona'])) return 'name';
    if (hasAny(header, ['location', 'ubicacion', 'ciudad', 'city', 'pais', 'country', 'region'])) return 'location';
    return 'ignore';
}

/** A first guess for each column; each field goes to one column only (the first that looks like it). */
export function guessMapping(headers: string[]): ColumnMapping[] {
    const normalized = headers.map(normalizeHeader);
    const hasLastNameColumn = normalized.some((header) => hasAny(header, LAST_NAME_WORDS));
    const used = new Set<CsvLeadField>();
    return headers.map((header, index) => {
        const field = guessField(normalized[index], hasLastNameColumn);
        if (field === 'ignore' || used.has(field)) return { csvHeader: header, leadField: 'ignore' };
        used.add(field);
        return { csvHeader: header, leadField: field };
    });
}

/** Picking a field for one column takes it away from any other column. */
export function assignField(mapping: ColumnMapping[], csvHeader: string, field: CsvLeadField | 'ignore'): ColumnMapping[] {
    return mapping.map((item) => {
        if (item.csvHeader === csvHeader) return { ...item, leadField: field };
        if (field !== 'ignore' && item.leadField === field) return { ...item, leadField: 'ignore' };
        return item;
    });
}

/** Whether the rows can get a name: a full name column, or first and/or last name columns. */
export function mappingHasName(mapping: ColumnMapping[]) {
    return mapping.some((item) => item.leadField === 'name' || item.leadField === 'firstName' || item.leadField === 'lastName');
}

export function mappingHasEmail(mapping: ColumnMapping[]) {
    return mapping.some((item) => item.leadField === 'email');
}

const cell = (value: unknown) => (value === null || value === undefined ? '' : String(value).replace(/\s+/g, ' ').trim());

/** The rows as contacts: trimmed, with the name built from first and last name when there is no full name column. */
export function rowsFromMapping(rawRows: Array<Record<string, unknown>>, mapping: ColumnMapping[]): CsvLeadInput[] {
    return rawRows.map((raw) => {
        const row: Record<string, string> = {};
        for (const item of mapping) {
            if (item.leadField === 'ignore') continue;
            row[item.leadField] = cell(raw[item.csvHeader]);
        }
        const name = row.name || [row.firstName, row.lastName].filter(Boolean).join(' ');
        return { ...row, name, email: (row.email || '').toLowerCase() } as CsvLeadInput;
    });
}

/** The first message of what is wrong with a row, or null when it can be imported. */
export function csvRowProblem(row: CsvLeadInput): string | null {
    const result = CsvLeadSchema.safeParse(row);
    return result.success ? null : result.error.issues[0]?.message || 'Revisa esta fila';
}

export type CsvImportDestination = 'por-escribir' | 'por-completar';

/** Like a contact saved from Búsqueda: with an email or a phone it can be written to or called now. */
export function csvRowDestination(row: Pick<CsvLeadInput, 'email' | 'phone'>): CsvImportDestination {
    return row.email || row.phone ? 'por-escribir' : 'por-completar';
}

export function csvRowToEnrichedLead(row: CsvLeadInput, id: string, now: string): EnrichedLead {
    return {
        id,
        fullName: row.name,
        email: row.email || undefined,
        // The file says nothing about whether the address works.
        emailStatus: 'unknown',
        title: row.title || undefined,
        companyName: row.company || undefined,
        linkedinUrl: row.linkedinUrl || undefined,
        city: row.location || undefined,
        primaryPhone: row.phone || null,
        createdAt: now,
    };
}

export function csvRowToLead(row: CsvLeadInput, id: string): Lead {
    return {
        id,
        name: row.name,
        title: row.title || '',
        company: row.company || '',
        email: null,
        avatar: '',
        status: 'saved',
        linkedinUrl: row.linkedinUrl || null,
        location: row.location || undefined,
    };
}

export type CsvImportPlan = { porEscribir: CsvLeadInput[]; porCompletar: CsvLeadInput[]; alreadyContacted: CsvLeadInput[] };

/** Splits the valid rows by destination and leaves out the people already contacted (by email), so nobody is written twice. */
export function planCsvImport(rows: CsvLeadInput[], contactedEmails: Set<string>): CsvImportPlan {
    const plan: CsvImportPlan = { porEscribir: [], porCompletar: [], alreadyContacted: [] };
    for (const row of rows) {
        if (csvRowProblem(row)) continue;
        if (row.email && contactedEmails.has(row.email.toLowerCase())) plan.alreadyContacted.push(row);
        else if (csvRowDestination(row) === 'por-escribir') plan.porEscribir.push(row);
        else plan.porCompletar.push(row);
    }
    return plan;
}

export type CsvImportResult = { porEscribir: number; porCompletar: number; duplicates: number; alreadyContacted: number };

const contacts = (count: number) => `${count} contacto${count === 1 ? '' : 's'}`;

/** What the import did, in words. */
export function csvImportSummary(result: CsvImportResult) {
    const added = result.porEscribir + result.porCompletar;
    const notes: string[] = [];
    if (result.duplicates > 0) notes.push(`${contacts(result.duplicates)} ya ${result.duplicates === 1 ? 'estaba guardado' : 'estaban guardados'}.`);
    if (result.alreadyContacted > 0) {
        notes.push(`${contacts(result.alreadyContacted)} ya ${result.alreadyContacted === 1 ? 'fue contactado y no se importó' : 'fueron contactados y no se importaron'}.`);
    }
    return { title: added === 0 ? 'No se agregó nadie nuevo' : `Importaste ${contacts(added)}`, notes };
}

/** An example file with the columns the import recognizes, ready to fill in a spreadsheet (UTF-8 with BOM for Excel). */
export const CSV_TEMPLATE = '﻿nombre,correo,empresa,cargo,linkedin,ubicación,teléfono\n'
    + 'Ana Pérez,ana.perez@empresa.cl,Empresa SpA,Gerenta de Personas,https://www.linkedin.com/in/ana-perez,Santiago,+56 9 1234 5678\n'
    + 'Jorge Soto,,Otra Empresa,Jefe de Operaciones,https://www.linkedin.com/in/jorge-soto,Valparaíso,\n';
