import test from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { draftSnapshotFixture } from '../draft-v2-test-fixtures';
import { coworkResearchReport, readCoworkResearch, summarizeCoworkResearch } from './research-read';

test('research summary preserves evidence links, classification and expiration without exposing request metadata', () => {
  const snapshot = draftSnapshotFixture();
  const scope = { userId: snapshot.scope.ownerUserId, organizationId: snapshot.scope.organizationId! };
  const result = summarizeCoworkResearch(snapshot, scope, snapshot.subject.leadId!, Date.parse('2027-01-01T00:00:00Z'));
  assert.ok(result.claims.length > 0);
  assert.ok(result.claims.every(claim => claim.expired));
  const sources = new Set(result.sources.map(source => source.id));
  assert.ok(result.evidence.every(item => sources.has(item.sourceId)));
  assert.deepEqual(result.claims.map(claim => claim.classification), snapshot.claims.map(claim => claim.classification));
  assert.equal('request' in result, false);
  assert.throws(() => summarizeCoworkResearch(snapshot, { ...scope, userId: 'other' }, snapshot.subject.leadId!), /identity/);
  assert.throws(() => summarizeCoworkResearch(snapshot, scope, 'other-lead'), /identity/);
});

test('lookup distinguishes no report from pending research and scopes every table', async () => {
  const filters: Array<Record<string, unknown>> = [];
  let job: unknown = null;
  const client = { from(table: string) {
    const filter: Record<string, unknown> = {}; filters.push(filter);
    const chain = {
      select: () => chain, order: () => chain, limit: () => chain,
      eq: (key: string, value: unknown) => { filter[key] = value; return chain; },
      maybeSingle: async () => ({ data: table === 'leads' ? { id: 'lead' } : job, error: null }),
    }; return chain;
  } } as unknown as SupabaseClient;
  const scope = { userId: 'owner', organizationId: 'org' };
  const id = '00000000-0000-4000-8000-000000000001';
  assert.equal((await readCoworkResearch(client, scope, id)).availability, 'not_found');
  job = { status: 'running', research_snapshot_id: null, updated_at: '2026-09-15T00:00:00Z' };
  const pending = await readCoworkResearch(client, scope, id);
  assert.equal(pending.availability, 'without_snapshot');
  assert.ok(filters.every(filter => filter.user_id === 'owner' && filter.organization_id === 'org'));
});

const LEAD = '00000000-0000-4000-8000-0000000000aa';

/** A V2 report as stored: the editor's prose sections, the blocks the app composes, the review's notes. */
function storedReport(overrides: Record<string, unknown> = {}) {
  const section = (key: string, title: string, ...texts: string[]) => ({ key, title, paragraphs: texts.map(text => ({ text, claimIds: [] })), blocks: [] });
  return {
    sections: [
      section('sources', 'Fuentes y lecturas'),
      section('risks', 'Riesgos', 'No hay urgencia confirmada.'),
      section('verdict', 'Resumen y decisión', 'Encaje potencial alto para conciliación.', 'Siguiente paso: una llamada de 20 minutos.'),
      section('angle', 'Cómo abrir la conversación', 'Abrir por el cierre mensual.'),
      section('committee', 'Personas a involucrar'),
      section('company', 'La empresa', 'Distribuidora con 3 sucursales.'),
      section('contact', 'La persona', 'Gerenta de Finanzas desde 2021.'),
      section('discovery', 'Preguntas', '¿Cuántos días toma el cierre?'),
    ],
    audit: { issues: [
      { section: 'sources', severity: 'warn', fragment: 'Informe con salvedades: se retiró 1 afirmación.' },
      { section: 'company', severity: 'warn', fragment: 'Informe con salvedades: se retiró 1 afirmación.' },
      { section: 'fit', severity: 'info', fragment: 'Nota interna.' },
    ] },
    synthesis: { status: 'completed' },
    ...overrides,
  };
}

test('the written report reads whole, in reading order, without the blocks the app composes', () => {
  const report = coworkResearchReport(storedReport(), '2026-10-01T12:00:00Z');
  assert.ok(report);
  assert.deepEqual(report.sections.map(section => section.key), ['verdict', 'contact', 'company', 'angle', 'discovery', 'risks']);
  assert.equal(report.sections[0].title, 'Resumen y decisión');
  assert.equal(report.sections[0].text, 'Encaje potencial alto para conciliación.\n\nSiguiente paso: una llamada de 20 minutos.');
  assert.deepEqual(report.caveats, ['Informe con salvedades: se retiró 1 afirmación.'], 'warnings once, notes out');
  assert.equal(report.status, 'completed');
  assert.equal(report.truncated, false);
  assert.equal(coworkResearchReport(storedReport({ synthesis: { status: 'partial' } }))?.status, 'partial');
  assert.equal(coworkResearchReport({ sections: [{ key: 'sources', title: 'Fuentes', paragraphs: [] }] }), null, 'no prose, no report');
  assert.equal(coworkResearchReport('not a report'), null);
});

test('a long report keeps every section within its budget and says it was cut', () => {
  const long = (key: string) => ({ key, title: key, paragraphs: [{ text: 'x'.repeat(5_000) }] });
  const report = coworkResearchReport({ sections: ['verdict', 'contact', 'company', 'fit', 'angle', 'discovery', 'risks'].map(long) });
  assert.ok(report);
  assert.ok(report.truncated);
  assert.ok(report.sections.every(section => section.text.length <= 3_001));
  assert.ok(report.sections.reduce((sum, section) => sum + section.text.length, 0) <= 16_010);
  assert.equal(report.sections[0].key, 'verdict', 'the decision comes first, whatever is cut');
});

/** Every table Cowork reads for research, scoped: the contact (saved or «Por escribir»), the job, the snapshot, the report. */
function researchClient(input: { saved?: boolean; enriched?: boolean; document?: unknown; state?: { status: string; retryable?: boolean } | null }) {
  const snapshot = draftSnapshotFixture();
  const payload = { ...snapshot, subject: { ...snapshot.subject, leadId: LEAD } };
  const scope = { userId: snapshot.scope.ownerUserId, organizationId: snapshot.scope.organizationId! };
  const reads: Array<{ table: string; filters: Record<string, unknown> }> = [];
  const rows: Record<string, unknown> = {
    leads: input.saved ? { id: LEAD } : null,
    enriched_leads: input.enriched ? { id: LEAD } : null,
    lead_research_jobs: { status: 'completed', research_snapshot_id: 'snap-1', updated_at: '2026-10-01T12:00:00Z' },
    research_snapshots: { payload },
    research_report_documents: input.document ? { document: input.document, generated_at: '2026-10-01T12:05:00Z' } : null,
    research_report_synthesis_states: input.state ?? null,
  };
  const client = { from(table: string) {
    const filters: Record<string, unknown> = {};
    reads.push({ table, filters });
    const chain = {
      select: () => chain, order: () => chain, limit: () => chain,
      eq: (key: string, value: unknown) => { filters[key] = value; return chain; },
      maybeSingle: async () => ({ data: rows[table] ?? null, error: null }),
    };
    return chain;
  } } as unknown as SupabaseClient;
  return { client, scope, reads };
}

test('research.get_existing brings the written report, scoped to the person and only when it is visible', async () => {
  const { client, scope, reads } = researchClient({ saved: true, document: storedReport() });
  const result = await readCoworkResearch(client, scope, LEAD) as Record<string, any>;
  assert.equal(result.availability, 'available');
  assert.equal(result.reportStatus, 'ready');
  assert.equal(result.report.sections[0].key, 'verdict');
  assert.equal(result.report.generatedAt, '2026-10-01T12:05:00Z');
  assert.ok(result.research.evidence.length > 0, 'the evidence still comes, with its sources');
  const documentRead = reads.find(read => read.table === 'research_report_documents')!;
  assert.deepEqual([documentRead.filters.user_id, documentRead.filters.organization_id, documentRead.filters.delivery_state, documentRead.filters.research_snapshot_id],
    [scope.userId, scope.organizationId, 'visible', 'snap-1']);
  assert.ok(reads.every(read => read.filters.user_id === scope.userId && read.filters.organization_id === scope.organizationId),
    'every table is read as the person, in their organization');
});

test('without a visible report it says why: still being written, failed or none', async () => {
  const cases: Array<[{ status: string; retryable?: boolean } | null, string]> = [
    [{ status: 'running' }, 'writing'],
    [{ status: 'retry_scheduled' }, 'writing'],
    [{ status: 'partial', retryable: true }, 'writing'],
    [{ status: 'partial', retryable: false }, 'none'],
    [{ status: 'failed_permanent' }, 'failed'],
    [null, 'none'],
  ];
  for (const [state, expected] of cases) {
    const { client, scope } = researchClient({ saved: true, state });
    const result = await readCoworkResearch(client, scope, LEAD) as Record<string, any>;
    assert.equal(result.reportStatus, expected, JSON.stringify(state));
    assert.equal(result.report, null);
    assert.match(result.reportMessage, /informe|evidencia/);
  }
});

test('a contact of «Por escribir» reads its research too; someone else\'s does not', async () => {
  const enriched = researchClient({ enriched: true, document: storedReport() });
  assert.equal((await readCoworkResearch(enriched.client, enriched.scope, LEAD) as Record<string, any>).reportStatus, 'ready');
  const nobody = researchClient({});
  await assert.rejects(readCoworkResearch(nobody.client, nobody.scope, LEAD), /Contact unavailable/);
});
