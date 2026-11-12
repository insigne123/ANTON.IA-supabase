import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import type { HeldApolloMatch } from './apollo-provider/apollo';
import {
  addressNameWords, decideIdentityReview, holdIdentityReview, IdentityReviewError, judgeIdentityReview, publicIdentityReview, ruleVerdict,
} from './identity-reviews';
import { profileTargetId } from './profile-target';

/** A small table store that answers the few query shapes the reviews use, as PostgREST would. */
function memory() {
  const tables: Record<string, any[]> = { apollo_identity_reviews: [], people_search_leads: [] };
  const from = (table: string) => {
    const rows = tables[table] ||= [];
    const filters: Array<(row: any) => boolean> = [];
    let action: 'select' | 'insert' | 'update' | 'delete' = 'select';
    let payload: any = null;
    const run = () => {
      if (action === 'insert') {
        const row = { id: randomUUID(), verdict: null, decision: null, decided_at: null, ...payload };
        rows.push(row);
        return [row];
      }
      const matched = rows.filter((row) => filters.every((filter) => filter(row)));
      if (action === 'update') for (const row of matched) Object.assign(row, Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined)));
      if (action === 'delete') for (const row of matched) rows.splice(rows.indexOf(row), 1);
      return matched;
    };
    const query: any = {
      select: () => query,
      insert: (value: any) => { action = 'insert'; payload = value; return query; },
      update: (value: any) => { action = 'update'; payload = value; return query; },
      delete: () => { action = 'delete'; return query; },
      eq: (column: string, value: unknown) => { filters.push((row) => row[column] === value); return query; },
      lt: (column: string, value: string) => { filters.push((row) => String(row[column]) < value); return query; },
      is: (column: string, value: null) => { filters.push((row) => (row[column] ?? null) === value); return query; },
      maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
      then: (resolve: (value: { data: any[]; error: null }) => unknown) => Promise.resolve({ data: run(), error: null }).then(resolve),
    };
    return query;
  };
  return { client: { from }, tables };
}

const ORG = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const PASTED = 'https://www.linkedin.com/in/ana-pérez-soto-1a2b3c4d';
const held = (over: Partial<HeldApolloMatch['candidate']> = {}): HeldApolloMatch => ({
  candidate: {
    apolloId: 'apollo-1', fullName: 'Ana María Pérez Soto', firstName: 'Ana María', lastName: 'Pérez Soto', title: 'Jefa de Prevención de Riesgos',
    headline: null, linkedinUrl: 'https://www.linkedin.com/in/ana-maria-perez-soto-123456789', organizationName: 'Energía del Sur',
    organizationDomain: 'energiadelsur.example', organizationIndustry: null, photoUrl: null, city: 'Santiago', state: null, country: 'Chile', seniority: null, ...over,
  },
  contact: { email: 'ana.perez@energiadelsur.example', emailStatus: 'verified', primaryPhone: null, phoneNumbers: [] },
  confidence: 'high',
});

test('whom Apollo found is kept for the person who searched, with the contact sealed and never in what the screen gets', async () => {
  const { client, tables } = memory();
  const row = await holdIdentityReview(client, { organizationId: ORG, userId: USER, requestedLinkedinUrl: PASTED, held: held(), reason: 'url_differs:high' });
  assert.ok(row);
  const stored = tables.apollo_identity_reviews[0];
  assert.match(stored.contact_encrypted, /^enc:v1\./);
  assert.ok(!JSON.stringify(stored).includes('ana.perez@'));
  const shown = publicIdentityReview(row!);
  assert.equal(shown.candidate.fullName, 'Ana María Pérez Soto');
  assert.equal(shown.hasContact, true);
  assert.ok(!JSON.stringify(shown).includes('ana.perez@') && !('contact' in (shown as any)));
  // Nothing to review without a candidate, and an expired review of the team is cleared by the next one.
  assert.equal(await holdIdentityReview(client, { organizationId: ORG, userId: USER, requestedLinkedinUrl: PASTED, held: held({ fullName: null, linkedinUrl: null }) }), null);
  stored.expires_at = '2020-01-01T00:00:00.000Z';
  await holdIdentityReview(client, { organizationId: ORG, userId: USER, requestedLinkedinUrl: PASTED, held: held() });
  assert.equal(tables.apollo_identity_reviews.length, 1);
});

test('the rule compares the name in the pasted address with the name Apollo gave', () => {
  assert.deepEqual(addressNameWords(PASTED), ['ana', 'perez', 'soto']);
  assert.deepEqual(addressNameWords('https://www.linkedin.com/in/ana-maria-perez-soto-123456789'), ['ana', 'maria', 'perez', 'soto']);
  const review = { requestedLinkedinUrl: PASTED, candidate: held().candidate };
  assert.equal(ruleVerdict(review, 'high').verdict, 'probably_same');
  assert.equal(ruleVerdict(review, 'low').verdict, 'unsure');
  assert.equal(ruleVerdict({ ...review, candidate: held({ fullName: 'Carlos Rojas Díaz' }).candidate }, 'high').verdict, 'different');
  assert.equal(ruleVerdict({ ...review, requestedLinkedinUrl: 'https://www.linkedin.com/in/ap1987' }, 'high').verdict, 'unsure');
});

test('the AI judges once, with what the web shows of both profiles, and the rule stands when it fails', async () => {
  const { client } = memory();
  const row = await holdIdentityReview(client, { organizationId: ORG, userId: USER, requestedLinkedinUrl: PASTED, held: held(), reason: 'url_differs:high' });
  const asked: any[] = [];
  const queries: string[] = [];
  const deps = {
    search: async (request: any) => {
      queries.push(request.query);
      return { items: [{ title: 'Ana Pérez Soto - Jefa de Prevención de Riesgos - Energía del Sur | LinkedIn', link: 'https://cl.linkedin.com/in/ana-perez', snippet: 'Santiago', source: null, date: null, position: 1 }] } as any;
    },
    generate: async (options: any) => {
      asked.push(JSON.parse(options.prompt));
      return { veredicto: 'misma', resumen: 'El nombre y la empresa coinciden.', senales: [{ tema: 'nombre', estado: 'ok', texto: 'Los nombres coinciden.' }, { tema: 'empresa', estado: 'ok', texto: 'La web muestra la misma empresa.' }] };
    },
  };
  const judged = await judgeIdentityReview(client, { id: row!.id, organizationId: ORG, userId: USER }, deps);
  assert.equal(judged.verdict?.verdict, 'same');
  assert.equal(judged.verdict?.by, 'ai');
  assert.deepEqual(judged.verdict?.checks.map((check) => [check.topic, check.status]), [['name', 'ok'], ['company', 'ok']]);
  assert.equal(queries.length, 2);
  assert.ok(queries.every((query) => query.startsWith('site:linkedin.com/in/')));
  assert.equal(asked[0].devuelto_por_el_proveedor.certeza_del_proveedor, 'high');
  // The contact never goes to the model.
  assert.ok(!JSON.stringify(asked).includes('ana.perez@'));
  // The second look reads the verdict kept.
  await judgeIdentityReview(client, { id: row!.id, organizationId: ORG, userId: USER }, { ...deps, generate: async () => { throw new Error('asked again'); } });
  assert.equal(asked.length, 1);

  const other = await holdIdentityReview(client, { organizationId: ORG, userId: USER, requestedLinkedinUrl: PASTED, held: held(), reason: 'url_differs:high' });
  const fallback = await judgeIdentityReview(client, { id: other!.id, organizationId: ORG, userId: USER },
    { search: async () => { throw new Error('down'); }, generate: async () => { throw new Error('down'); } });
  assert.equal(fallback.verdict?.by, 'rule');
  assert.equal(fallback.verdict?.verdict, 'probably_same');
});

test('«Es la misma persona» shows the contact already paid for and binds the pasted address to that person; it is decided once', async () => {
  const { client, tables } = memory();
  const row = await holdIdentityReview(client, { organizationId: ORG, userId: USER, requestedLinkedinUrl: PASTED, held: held(), reason: 'url_differs:high' });
  const { review, profile } = await decideIdentityReview(client, { id: row!.id, organizationId: ORG, userId: USER, decision: 'same' });
  assert.equal(review.decision, 'same');
  assert.equal(review.hasContact, false);
  assert.equal(profile?.email, 'ana.perez@energiadelsur.example');
  assert.equal(profile?.fullName, 'Ana María Pérez Soto');
  const saved = tables.people_search_leads[0];
  assert.equal(saved.id, profileTargetId(USER, ORG, 'https://www.linkedin.com/in/ana-p%C3%A9rez-soto-1a2b3c4d'));
  assert.equal(saved.apollo_person_id, 'apollo-1');
  assert.equal(saved.email, 'ana.perez@energiadelsur.example');
  assert.equal(saved.enrichment_status, 'completed');
  assert.equal(tables.apollo_identity_reviews[0].contact_encrypted, null);
  await assert.rejects(() => decideIdentityReview(client, { id: row!.id, organizationId: ORG, userId: USER, decision: 'different' }),
    (error: unknown) => error instanceof IdentityReviewError && error.code === 'IDENTITY_REVIEW_DECIDED');
});

test('«No es» forgets the contact, and nobody else, no expired review and no address bound to another person gets through', async () => {
  const { client, tables } = memory();
  const row = await holdIdentityReview(client, { organizationId: ORG, userId: USER, requestedLinkedinUrl: PASTED, held: held() });
  await assert.rejects(() => decideIdentityReview(client, { id: row!.id, organizationId: ORG, userId: '33333333-3333-4333-8333-333333333333', decision: 'same' }),
    (error: unknown) => error instanceof IdentityReviewError && error.code === 'IDENTITY_REVIEW_NOT_FOUND');
  const refused = await decideIdentityReview(client, { id: row!.id, organizationId: ORG, userId: USER, decision: 'different' });
  assert.equal(refused.profile, null);
  assert.equal(tables.apollo_identity_reviews[0].contact_encrypted, null);
  assert.equal(tables.people_search_leads.length, 0);

  const late = await holdIdentityReview(client, { organizationId: ORG, userId: USER, requestedLinkedinUrl: PASTED, held: held() });
  await assert.rejects(() => decideIdentityReview(client, { id: late!.id, organizationId: ORG, userId: USER, decision: 'same', now: Date.now() + 8 * 24 * 60 * 60 * 1_000 }),
    (error: unknown) => error instanceof IdentityReviewError && error.code === 'IDENTITY_REVIEW_NOT_FOUND');

  tables.people_search_leads.push({ id: profileTargetId(USER, ORG, 'https://www.linkedin.com/in/ana-p%C3%A9rez-soto-1a2b3c4d'), user_id: USER, organization_id: ORG, apollo_person_id: 'apollo-9' });
  await assert.rejects(() => decideIdentityReview(client, { id: late!.id, organizationId: ORG, userId: USER, decision: 'same' }),
    (error: unknown) => error instanceof IdentityReviewError && error.code === 'IDENTITY_REVIEW_BOUND_TO_OTHER');
  assert.match(tables.apollo_identity_reviews.find((entry) => entry.id === late!.id).contact_encrypted, /^enc:v1\./);
});
