import assert from 'node:assert/strict';
import test from 'node:test';

import { fitsMaskedName, lookupOf, maskedContactOf, repairMaskedNames, type MaskedLookup } from './masked-name-repair';

const SAVED_ID = '0b6a0d8e-6f1c-4c39-9d43-1f2a3b4c5d6e';

/** The masked contacts seen in production on 2 oct, in shape (fictional people): by id, by LinkedIn and with neither. */
function rows(): Array<Record<string, unknown>> {
  return [
    { id: 'e1', user_id: 'u1', organization_id: 'o1', full_name: 'Rafael Du***n', linkedin_url: null, title: null,
      source_provider: 'apollo', source_provider_id: null, data: { apolloId: 'ap-1', companyDomain: 'rydmontajes.com' } },
    { id: 'e2', user_id: 'u1', organization_id: 'o1', full_name: 'Marcela Ro***s', linkedin_url: 'https://www.linkedin.com/in/marcela-rojas', title: 'Gerente',
      source_provider: 'apollo', source_provider_id: 'ap-2', data: { sourceProvider: 'apollo', sourceProviderId: 'ap-2', sourceSavedLeadId: SAVED_ID } },
    { id: 'e3', user_id: 'u2', organization_id: 'o1', full_name: 'Felipe Mu***z', linkedin_url: 'https://www.linkedin.com/in/felipe-munoz', title: null,
      source_provider: null, source_provider_id: null, data: { companyDomain: 'acme.cl' } },
    { id: 'e4', user_id: 'u2', organization_id: 'o1', full_name: 'Susana Mo***a', linkedin_url: null, title: null,
      source_provider: 'fullenrich', source_provider_id: 'fe-9', data: { sourceProvider: 'fullenrich' } },
    { id: 'e5', user_id: 'u1', organization_id: 'o1', full_name: 'Carlos Godoy', linkedin_url: null, title: null,
      source_provider: 'apollo', source_provider_id: 'ap-5', data: {} },
  ];
}

/** enriched_leads and leads in memory: paged reads, guarded reads and updates, as the repair and applyEnrichedIdentity use them. */
function fakeClient(enriched = rows(), saved: Array<Record<string, unknown>> = [
  { id: SAVED_ID, user_id: 'u1', organization_id: 'o1', name: 'Marcela Ro***s', linkedin_url: null, title: 'Gerente', source_provider_id: 'ap-2', apollo_id: null },
]) {
  const tables: Record<string, Array<Record<string, unknown>>> = { enriched_leads: enriched, leads: saved };
  const updates: Array<{ table: string; id: unknown; values: Record<string, unknown> }> = [];
  let reads = 0;
  const client = {
    from(table: string) {
      const filters: Array<[string, string, unknown]> = [];
      let values: Record<string, unknown> | null = null;
      let range: [number, number] | null = null;
      const matches = (row: Record<string, unknown>) => filters.every(([kind, column, value]) =>
        kind === 'is' ? (row[column] ?? null) === value : row[column] === value);
      const builder: any = {
        select() { return builder; },
        order() { return builder; },
        range(from: number, to: number) { range = [from, to]; return builder; },
        update(next: Record<string, unknown>) { values = next; return builder; },
        eq(column: string, value: unknown) { filters.push(['eq', column, value]); return builder; },
        is(column: string, value: unknown) { filters.push(['is', column, value]); return builder; },
        maybeSingle: async () => ({ data: tables[table].find(matches) ?? null, error: null }),
        then(resolve: (value: unknown) => void) {
          if (values) {
            const target = tables[table].find(matches);
            if (target) { Object.assign(target, values); updates.push({ table, id: target.id, values }); }
            return resolve({ error: null });
          }
          reads += 1;
          const [from, to] = range || [0, tables[table].length - 1];
          resolve({ data: tables[table].slice(from, to + 1), error: null });
        },
      };
      return builder;
    },
  };
  return { client, tables, updates, reads: () => reads };
}

const PEOPLE: Record<string, Record<string, unknown>> = {
  'ap-1': { apollo_id: 'ap-1', first_name: 'Rafael', last_name: 'Durán', full_name: 'Rafael Durán', linkedin_url: 'https://linkedin.com/in/rafael-duran', title: 'Jefe de Operaciones' },
  'ap-2': { apollo_id: 'ap-2', first_name: 'Marcela', last_name: 'Rojas', full_name: 'Marcela Rojas', linkedin_url: 'https://www.linkedin.com/in/marcela-rojas', title: 'Gerente General' },
  'https://www.linkedin.com/in/felipe-munoz': { apollo_id: 'ap-3', first_name: 'Felipe', last_name: 'Muñoz', full_name: 'Felipe Muñoz', linkedin_url: 'https://www.linkedin.com/in/felipe-munoz', title: 'CFO' },
};

function provider(people = PEOPLE) {
  const asked: MaskedLookup[] = [];
  const match = async (lookup: MaskedLookup) => {
    asked.push(lookup);
    const person = people[lookup.providerId || ''] || people[lookup.linkedinUrl || ''];
    return { found: Boolean(person), person: person ?? null, credits: 1 };
  };
  return { match, asked };
}

test('a contact to repair: only hidden names, the provider id only of that provider, and the saved contact it came from', () => {
  const [byId, linked, byLinkedin, otherProvider, complete] = rows().map(maskedContactOf);
  assert.equal(complete, null, 'a complete name is not touched');
  assert.equal(byId?.providerId, 'ap-1');
  assert.equal(linked?.savedLeadId, SAVED_ID);
  assert.equal(otherProvider?.providerId, null, 'another provider\'s id means nothing to this one');
  assert.deepEqual([byId, linked, byLinkedin, otherProvider].map(contact => lookupOf(contact!)), ['id', 'id', 'linkedin', null]);
  assert.equal(maskedContactOf({ id: 'x', full_name: 'Ana Pé***z', data: { sourceSavedLeadId: 'not-a-uuid' } })?.savedLeadId, null);
});

test('the provider\'s person has to fit the visible ends of the hidden name', () => {
  assert.equal(fitsMaskedName(PEOPLE['ap-1'], 'Rafael Du***n'), true);
  assert.equal(fitsMaskedName({ full_name: 'Rafael Godoy', first_name: 'Rafael', last_name: 'Godoy' }, 'Rafael Du***n'), false);
  assert.equal(fitsMaskedName({ full_name: 'Rafaela Durán' }, 'Rafael Du***n'), false, 'another first name');
  assert.equal(fitsMaskedName({ full_name: 'Rafael Durán Soto', first_name: 'Rafael', last_name: 'Durán Soto' }, 'Rafael Du***o'), true,
    'a two-word surname is hidden whole');
  assert.equal(fitsMaskedName({ full_name: 'Rafael Du***n' }, 'Rafael Du***n'), false, 'still hidden is no answer');
});

test('a dry run lists them and how each would be asked, without calling the provider or writing', async () => {
  const { client, updates } = fakeClient();
  const report = await repairMaskedNames({ client, apply: false });
  assert.equal(report.before, 4);
  assert.deepEqual(report.lookups, { byId: 2, byLinkedin: 1, none: 1 });
  assert.deepEqual(report.rows.map(row => [row.id, row.status]), [['e1', 'would_query'], ['e2', 'would_query'], ['e3', 'would_query'], ['e4', 'no_lookup']]);
  assert.equal(report.after, null);
  assert.deepEqual(updates, []);
  await assert.rejects(repairMaskedNames({ client, apply: true }), /proveedor/);
});

test('apply asks by id or LinkedIn, writes the real name to «Por escribir» and its saved contact, and measures again', async () => {
  const { client, tables, updates } = fakeClient();
  const { match, asked } = provider();
  const report = await repairMaskedNames({ client, match, apply: true });
  assert.deepEqual(asked, [
    { providerId: 'ap-1', linkedinUrl: null },
    { providerId: 'ap-2', linkedinUrl: 'https://www.linkedin.com/in/marcela-rojas' },
    { providerId: null, linkedinUrl: 'https://www.linkedin.com/in/felipe-munoz' },
  ], 'the one with neither is never asked');
  assert.deepEqual(report.rows.map(row => [row.id, row.status]), [['e1', 'fixed'], ['e2', 'fixed'], ['e3', 'fixed'], ['e4', 'no_lookup']]);
  assert.equal(report.credits, 3);
  assert.equal(report.before, 4);
  assert.equal(report.after, 1, 'only the one that could not be asked keeps the hidden name');
  assert.equal(tables.enriched_leads[0].full_name, 'Rafael Durán');
  assert.equal(tables.enriched_leads[0].linkedin_url, 'https://www.linkedin.com/in/rafael-duran', 'its gaps too');
  assert.equal(tables.enriched_leads[1].title, 'Gerente', 'a title someone had stays');
  assert.equal(tables.leads[0].name, 'Marcela Rojas', 'the saved contact it came from');
  assert.match(String(report.rows[1].detail), /contacto guardado/);
  assert.ok(updates.every(update => update.table === 'enriched_leads' || update.id === SAVED_ID));
});

test('someone else\'s answer is never written: another id, a name that does not fit, or a LinkedIn the provider rejects', async () => {
  const { client, tables, updates } = fakeClient();
  const people = {
    'ap-1': { ...PEOPLE['ap-1'], apollo_id: 'ap-77' },
    'ap-2': { ...PEOPLE['ap-2'], full_name: 'Marcela Soto', last_name: 'Soto' },
  };
  const match = async (lookup: MaskedLookup) => {
    if (lookup.linkedinUrl && !lookup.providerId) throw Object.assign(new Error('mismatch'), { code: 'APOLLO_PERSON_IDENTITY_MISMATCH' });
    const person = people[lookup.providerId as keyof typeof people];
    return { found: true, person, credits: 1 };
  };
  const report = await repairMaskedNames({ client, match, apply: true });
  assert.deepEqual(report.rows.slice(0, 3).map(row => row.status), ['mismatch', 'mismatch', 'mismatch']);
  assert.match(String(report.rows[0].detail), /otro id/);
  assert.match(String(report.rows[1].detail), /no calza/);
  assert.match(String(report.rows[2].detail), /LinkedIn/);
  assert.deepEqual(updates, []);
  assert.equal(tables.enriched_leads[0].full_name, 'Rafael Du***n');
  assert.equal(report.after, 4);
});

test('a name edited meanwhile wins, and --limit and an empty provider stop the calls', async () => {
  const edited = rows();
  edited[0].full_name = 'Rafael Du***n';
  const { client, tables } = fakeClient(edited);
  // Someone renames e1 while the provider answers: their name stays; only the gaps (its LinkedIn) are filled.
  const { match } = provider();
  const racing = async (lookup: MaskedLookup) => {
    if (lookup.providerId === 'ap-1') tables.enriched_leads[0].full_name = 'Rafa Durán (cliente)';
    return match(lookup);
  };
  const report = await repairMaskedNames({ client, match: racing, apply: true, limit: 1 });
  assert.deepEqual(report.rows.map(row => row.status), ['unchanged', 'skipped', 'skipped', 'no_lookup']);
  assert.equal(tables.enriched_leads[0].full_name, 'Rafa Durán (cliente)');

  const empty = fakeClient();
  let calls = 0;
  const exhausted = async () => { calls += 1; throw Object.assign(new Error('credits'), { code: 'APOLLO_CREDITS_EXHAUSTED' }); };
  const stopped = await repairMaskedNames({ client: empty.client, match: exhausted, apply: true });
  assert.equal(calls, 1, 'without credits the rest are not asked');
  assert.deepEqual(stopped.rows.map(row => row.status), ['error', 'skipped', 'skipped', 'no_lookup']);
  assert.match(String(stopped.rows[1].detail), /sin créditos/);

  const missing = fakeClient();
  const none = await repairMaskedNames({ client: missing.client, match: async () => ({ found: false, credits: 0 }), apply: true });
  assert.deepEqual(none.rows.map(row => row.status), ['not_found', 'not_found', 'not_found', 'no_lookup']);
});

test('reads every page of «Por escribir»', async () => {
  const many = Array.from({ length: 1203 }, (_, index) => ({
    id: `e${String(index).padStart(4, '0')}`, user_id: 'u1', organization_id: 'o1',
    full_name: index % 400 === 0 ? 'Ana Pé***z' : 'Ana Pérez', linkedin_url: null, source_provider: 'apollo', source_provider_id: `ap-${index}`, data: {},
  }));
  const { client, reads } = fakeClient(many, []);
  const report = await repairMaskedNames({ client, apply: false });
  assert.equal(report.before, 4, 'rows 0, 400, 800 and 1200');
  assert.equal(reads(), 3);
});
