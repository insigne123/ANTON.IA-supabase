import assert from 'node:assert/strict';
import test from 'node:test';
import { buildProfileUpdate, createEmptyProfileForm } from '@/lib/profile/profile-mappings';
import { CompanyProfileError, companyProfileSuggestions, readCompanyProfile, saveCompanyProfile } from './company-profile';

const ORG = 'org-1';
const OWNER = 'user-owner';
const MEMBER = 'user-member';

type Row = Record<string, any>;
/** A tiny Supabase: tables of rows, filters by equality and «in», and the writes it saw. */
function fakeClient(tables: Record<string, Row[]>, options: { missing?: boolean } = {}) {
  const writes: Array<{ table: string; kind: string; row: Row }> = [];
  const from = (table: string) => {
    const filters: Array<(row: Row) => boolean> = [];
    let write: { kind: 'update' | 'insert'; row: Row } | null = null;
    const rows = () => (tables[table] || []).filter(row => filters.every(filter => filter(row)));
    const missing = options.missing && table === 'organization_company_profile' ? { code: 'PGRST205', message: 'Could not find the table public.organization_company_profile in the schema cache' } : null;
    const chain: any = {
      select: () => chain,
      eq: (column: string, value: unknown) => { filters.push(row => row[column] === value); return chain; },
      in: (column: string, values: unknown[]) => { filters.push(row => values.includes(row[column])); return chain; },
      limit: () => chain,
      update: (row: Row) => { write = { kind: 'update', row }; return chain; },
      insert: (row: Row) => { write = { kind: 'insert', row }; return chain; },
      maybeSingle: async () => (missing ? { data: null, error: missing } : { data: rows()[0] ?? null, error: null }),
      then: (resolve: (value: unknown) => void) => {
        if (missing) return resolve({ data: null, error: missing });
        if (!write) return resolve({ data: rows(), error: null });
        const { kind, row } = write;
        if (kind === 'insert') {
          if ((tables[table] || []).some(existing => existing.organization_id === row.organization_id)) return resolve({ data: null, error: { code: '23505' } });
          (tables[table] ||= []).push(row);
          writes.push({ table, kind, row });
          return resolve({ data: [row], error: null });
        }
        const matched = rows();
        for (const existing of matched) Object.assign(existing, row);
        if (matched.length) writes.push({ table, kind, row });
        return resolve({ data: matched, error: null });
      },
    };
    return chain;
  };
  return { client: { from } as never, writes, tables };
}

const team = () => ({
  organization_members: [{ organization_id: ORG, user_id: OWNER, role: 'owner' }, { organization_id: ORG, user_id: MEMBER, role: 'member' }],
  profiles: [{ id: OWNER, full_name: 'Nicolás Y.' }, { id: MEMBER, full_name: 'Camila R.' }],
});
const offer = { companyName: 'Yago SpA', services: 'AXIS: consultas judiciales', valueProposition: 'Revisamos antecedentes en minutos.' };

test('an owner saves the company profile and saving is reviewing; a member cannot', async () => {
  const { client, writes, tables } = fakeClient(team());
  await assert.rejects(saveCompanyProfile(client, { organizationId: ORG, userId: MEMBER }, { fields: offer, revision: 0 }),
    (error: unknown) => error instanceof CompanyProfileError && error.status === 403);
  const now = new Date('2026-10-25T12:00:00Z');
  const saved = await saveCompanyProfile(client, { organizationId: ORG, userId: OWNER }, { fields: { ...offer, name: 'no viaja' }, revision: 0 }, now);
  assert.equal(saved.revision, 1);
  assert.equal(saved.reviewedAt, now.toISOString());
  assert.deepEqual(writes.map(write => write.kind), ['insert']);
  assert.equal(tables.organization_company_profile[0].reviewed_by, OWNER);
  assert.equal('name' in tables.organization_company_profile[0].fields, false);
  const read = await readCompanyProfile(client, ORG);
  assert.equal(read?.fields.services, 'AXIS: consultas judiciales');
  assert.equal(read?.revision, 1);
  assert.equal(read?.reviewedBy, 'Nicolás Y.');
});

test('a profile that changed since the page read it is not overwritten, and one without an offer is refused', async () => {
  const { client } = fakeClient({ ...team(), organization_company_profile: [{ organization_id: ORG, fields: offer, revision: 3, reviewed_at: null, reviewed_by: null }] });
  const scope = { organizationId: ORG, userId: OWNER };
  await assert.rejects(saveCompanyProfile(client, scope, { fields: offer, revision: 2 }), (error: unknown) => error instanceof CompanyProfileError && error.status === 409);
  await assert.rejects(saveCompanyProfile(client, scope, { fields: { companyName: 'Yago SpA', website: 'yago.cl' }, revision: 3 }),
    (error: unknown) => error instanceof CompanyProfileError && error.status === 400 && /qué vende la empresa/.test(error.message));
  const saved = await saveCompanyProfile(client, scope, { fields: { ...offer, services: 'AXIS\nCarga por archivo' }, revision: 3 });
  assert.equal(saved.revision, 4);
  assert.equal((await readCompanyProfile(client, ORG))?.fields.services, 'AXIS\nCarga por archivo');
});

test('before the migration the app reads no profile, and saving says it is not available yet', async () => {
  const { client } = fakeClient(team(), { missing: true });
  assert.equal(await readCompanyProfile(client, ORG), null);
  await assert.rejects(saveCompanyProfile(client, { organizationId: ORG, userId: OWNER }, { fields: offer, revision: 0 }),
    (error: unknown) => error instanceof CompanyProfileError && error.status === 503);
});

test('what the team wrote comes as suggestions: the offer confirmed in Oportunidades first, then each person once, never their contact data', async () => {
  const perfil = (fields: Partial<ReturnType<typeof createEmptyProfileForm>>) => buildProfileUpdate({ ...createEmptyProfileForm(), ...fields });
  const tables = {
    organization_members: [OWNER, MEMBER, 'user-3', 'user-4'].map(user_id => ({ organization_id: ORG, user_id })),
    profiles: [
      { id: OWNER, email: 'nico@yago.cl', ...perfil({ name: 'Nicolás Y.', role: 'Gerente', services: 'AXIS: consultas judiciales' }) },
      { id: MEMBER, email: 'camila@yago.cl', ...perfil({ name: 'Camila R.', services: 'SADT: registro de contratos en la DT', proofPoints: '500 contratos al día' }) },
      // The same offer from another person is not a second suggestion; a profile without an offer is none.
      { id: 'user-3', ...perfil({ name: 'Pedro S.', services: 'AXIS:  consultas judiciales' }) },
      { id: 'user-4', ...perfil({ name: 'Sin oferta', companyName: 'Yago SpA' }) },
    ],
    opportunity_company_context: [{ organization_id: ORG, offer: 'Servicios de RR. HH. para licitaciones', services: ['Selección', 'Outsourcing'], territories: ['Chile'] }],
  };
  const suggestions = await companyProfileSuggestions(fakeClient(tables).client, ORG);
  assert.deepEqual(suggestions.map(item => item.label), ['La oferta confirmada en Oportunidades', 'Nicolás Y.', 'Camila R.']);
  assert.deepEqual(suggestions[0].fields, { valueProposition: 'Servicios de RR. HH. para licitaciones', services: 'Selección\nOutsourcing', targetLocations: 'Chile' });
  assert.equal(suggestions[2].fields.proofPoints, '500 contratos al día');
  assert.doesNotMatch(JSON.stringify(suggestions), /@yago\.cl|Gerente/);
});
