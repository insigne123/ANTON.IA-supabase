import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
    assignField, csvImportSummary, csvRowDestination, csvRowProblem, csvRowToEnrichedLead, csvRowToLead, guessMapping,
    mappingHasName, planCsvImport, rowsFromMapping, type CsvLeadInput,
} from './csv-import-utils';

const fields = (headers: string[]) => guessMapping(headers).map((item) => item.leadField);

test('a LinkedIn connections export maps by itself, first and last name included', () => {
    assert.deepEqual(fields(['First Name', 'Last Name', 'URL', 'Email Address', 'Company', 'Position', 'Connected On']),
        ['firstName', 'lastName', 'linkedinUrl', 'email', 'company', 'title', 'ignore']);
});

test('Spanish headers map too, and «Nombre de la empresa» is the company, not the name', () => {
    assert.deepEqual(fields(['Nombre', 'Correo electrónico', 'Nombre de la empresa', 'Cargo', 'Teléfono', 'Ciudad']),
        ['name', 'email', 'company', 'title', 'phone', 'location']);
    assert.deepEqual(fields(['Nombre', 'Apellido', 'Mail']), ['firstName', 'lastName', 'email']);
    assert.deepEqual(fields(['Company Name', 'Full Name']), ['company', 'name']);
    assert.deepEqual(fields(['Fecha de contacto', 'Nombre']), ['ignore', 'name']);
});

test('each field goes to one column: a second email column is not imported, and picking a field frees it elsewhere', () => {
    assert.deepEqual(fields(['Email', 'Email 2']), ['email', 'ignore']);
    const mapping = assignField(guessMapping(['Nombre', 'Correo', 'Otro correo']), 'Otro correo', 'email');
    assert.deepEqual(mapping.map((item) => item.leadField), ['name', 'ignore', 'email']);
    assert.equal(mappingHasName(assignField(mapping, 'Nombre', 'ignore')), false);
});

test('rows are trimmed, emails lowercased and the name built from first and last name', () => {
    const mapping = guessMapping(['First Name', 'Last Name', 'Email Address', 'Company']);
    const [row] = rowsFromMapping([{ 'First Name': '  Ana ', 'Last Name': 'Pérez\n', 'Email Address': ' Ana.Perez@Empresa.CL ', Company: 'Empresa  SpA' }], mapping);
    assert.equal(row.name, 'Ana Pérez');
    assert.equal(row.email, 'ana.perez@empresa.cl');
    assert.equal(row.company, 'Empresa SpA');
});

test('a row needs a name, a valid email if it has one, and without email or phone something to search with', () => {
    const base = { name: 'Ana Pérez' } as CsvLeadInput;
    assert.equal(csvRowProblem({ ...base, email: 'ana@empresa.cl' }), null);
    assert.equal(csvRowProblem({ ...base, email: '', company: 'Empresa SpA' }), null);
    assert.equal(csvRowProblem({ ...base, email: '', linkedinUrl: 'https://www.linkedin.com/in/ana' }), null);
    assert.equal(csvRowProblem({ ...base, email: '', phone: '+56 9 1234 5678' }), null);
    assert.equal(csvRowProblem({ ...base, email: 'ana@' }), 'Correo inválido');
    assert.equal(csvRowProblem({ name: '', email: 'ana@empresa.cl' } as CsvLeadInput), 'Falta el nombre');
    assert.match(String(csvRowProblem({ ...base, email: '' })), /agrega la empresa o el LinkedIn/);
    assert.match(String(csvRowProblem({ ...base, email: '', company: 'X', linkedinUrl: 'linkedin.com/in/ana' })), /LinkedIn inválido/);
});

test('with an email or a phone a row goes to «Por escribir», without both to «Por completar»', () => {
    assert.equal(csvRowDestination({ email: 'ana@empresa.cl', phone: '' }), 'por-escribir');
    assert.equal(csvRowDestination({ email: '', phone: '+56 9 1234 5678' }), 'por-escribir');
    assert.equal(csvRowDestination({ email: '', phone: '' }), 'por-completar');
});

test('an imported email is not marked verified, and the phone comes along', () => {
    const row = { name: 'Ana Pérez', email: 'ana@empresa.cl', company: 'Empresa SpA', title: 'Gerenta', phone: '+56 9 1234 5678', location: 'Santiago' } as CsvLeadInput;
    const enriched = csvRowToEnrichedLead(row, 'id-1', '2026-10-04T00:00:00.000Z');
    assert.equal(enriched.emailStatus, 'unknown');
    assert.equal(enriched.enrichmentStatus, undefined);
    assert.equal(enriched.primaryPhone, '+56 9 1234 5678');
    assert.equal(enriched.companyName, 'Empresa SpA');
    const lead = csvRowToLead({ ...row, email: '', phone: '' }, 'id-2');
    assert.equal(lead.email, null);
    assert.equal(lead.status, 'saved');
    assert.equal(lead.company, 'Empresa SpA');
});

test('the plan leaves out rows with problems and people already contacted', () => {
    const rows = [
        { name: 'Ana', email: 'ana@empresa.cl' },
        { name: 'Beto', email: 'BETO@empresa.cl'.toLowerCase() },
        { name: 'Carla', email: '', company: 'Otra' },
        { name: '', email: 'sin-nombre@empresa.cl' },
    ] as CsvLeadInput[];
    const plan = planCsvImport(rows, new Set(['beto@empresa.cl']));
    assert.deepEqual(plan.porEscribir.map((row) => row.name), ['Ana']);
    assert.deepEqual(plan.porCompletar.map((row) => row.name), ['Carla']);
    assert.deepEqual(plan.alreadyContacted.map((row) => row.name), ['Beto']);
});

test('the summary counts what was really added', () => {
    assert.deepEqual(csvImportSummary({ porEscribir: 3, porCompletar: 1, duplicates: 2, alreadyContacted: 1 }), {
        title: 'Importaste 4 contactos',
        notes: ['2 contactos ya estaban guardados.', '1 contacto ya fue contactado y no se importó.'],
    });
    assert.equal(csvImportSummary({ porEscribir: 0, porCompletar: 0, duplicates: 5, alreadyContacted: 0 }).title, 'No se agregó nadie nuevo');
});

test('the import page saves each row where it belongs, checks who was contacted and has no raw colors', () => {
    const page = readFileSync('src/app/(app)/leads/import/page.tsx', 'utf8');
    assert.match(page, /contactedLeadsStorage\.get\(\)/);
    assert.match(page, /enrichedLeadsStorage\.addDedup\(plan\.porEscribir/);
    assert.match(page, /supabaseService\.addLeadsDedup\(plan\.porCompletar/);
    assert.doesNotMatch(page, /'verified'/);
    assert.match(page, /back=\{\{ href: '\/sheet', label: 'Tabla de datos' \}\}/);
    const uploader = readFileSync('src/components/csv-importer/csv-uploader.tsx', 'utf8');
    assert.match(uploader, /<Button type="button" onClick=\{\(\) => inputRef\.current\?\.click\(\)\}/, 'a real button picks the file');
    assert.doesNotMatch(uploader, /document\.getElementById/);
    for (const file of ['src/app/(app)/leads/import/page.tsx', 'src/components/csv-importer/csv-uploader.tsx',
        'src/components/csv-importer/column-mapper.tsx', 'src/components/csv-importer/data-review-grid.tsx']) {
        assert.doesNotMatch(readFileSync(file, 'utf8'), /\b(red|green|amber|emerald|yellow|rose)-\d{2,3}\b/, `${file} has no raw colors`);
    }
});
