import assert from 'node:assert/strict';
import test from 'node:test';
import { coworkArtifactCampaigns, coworkArtifactContacts, coworkArtifactDataPreview, coworkArtifactPipeline, coworkArtifactTableSummary } from './artifact-data';

const leads = [
  { id: 'a', name: 'Ana Pérez', company: 'Minera Norte', title: 'Gerente de Operaciones', email: 'ana@norte.cl', city: 'Antofagasta', country: 'Chile', created_at: '2026-09-20T10:00:00Z' },
  { id: 'b', name: 'Luis Soto', company: 'Retail Sur', title: 'Jefe de RR. HH.', email: null, linkedin_url: 'https://www.linkedin.com/in/luis', created_at: '2026-09-21T10:00:00Z' },
  { id: 'c', name: 'Eva Díaz', company: 'Logística Centro', title: 'COO', created_at: 'no es fecha' },
];

test('the pipeline puts each saved contact in its stage, in the order of the process, and Nuevos when it has none', () => {
  const custom = [
    { id: 'lead_saved|a', stage: 'meeting', owner: 'Nicolás', next_action: 'Enviar propuesta', next_action_due_at: '2026-10-08', updated_at: '2026-10-01T12:00:00Z' },
    { id: 'lead_saved|b', stage: 'no-existe' },
  ];
  const pipeline = coworkArtifactPipeline(leads, custom);
  assert.deepEqual(pipeline.rows.map(row => [row.name, row.stage, row.stage_order]), [['Ana Pérez', 'Reunión', 5], ['Luis Soto', 'Nuevos', 1], ['Eva Díaz', 'Nuevos', 1]]);
  assert.equal(pipeline.rows[0].next_action_due, '2026-10-08');
  assert.equal(pipeline.rows[0].stage_changed_at, '2026-10-01T12:00:00Z');
  assert.equal(pipeline.rows[2].created_at, null);
  // Without the deal value (its migration not applied) there is no amount column at all, never zeros.
  assert.equal(pipeline.columns.some(column => column.key === 'value'), false);
  const valued = coworkArtifactPipeline(leads, [{ ...custom[0], deal_value: '1500000' }, { id: 'lead_saved|b', deal_value: null }]);
  assert.deepEqual(valued.rows.map(row => row.value), [1500000, null, null]);
  assert.equal(valued.columns.find(column => column.key === 'value')?.type, 'money');
});

test('contacts carry whether there is an email or a LinkedIn, never the address; campaigns count recipients and emails', () => {
  const contacts = coworkArtifactContacts(leads, 40);
  assert.deepEqual(contacts.rows.map(row => [row.has_email, row.has_linkedin, row.location]), [['Sí', 'No', 'Antofagasta, Chile'], ['No', 'Sí', null], ['No', 'No', null]]);
  assert.equal(JSON.stringify(contacts).includes('ana@norte.cl'), false);
  assert.equal(contacts.total, 40);
  assert.equal(contacts.truncated, true);
  const campaigns = coworkArtifactCampaigns([{ definition: { name: 'Minería Q4', steps: [{}, {}, {}] }, status: 'paused', recipients: [1, 2], created_at: '2026-09-01T00:00:00Z' }, { status: 'draft' }]);
  assert.deepEqual(campaigns.rows, [
    { name: 'Minería Q4', status: 'Pausada', recipients: 2, steps: 3, created_at: '2026-09-01T00:00:00Z' },
    { name: 'Campaña', status: 'Borrador', recipients: 0, steps: null, created_at: null },
  ]);
});

test('the Designer sees each table’s columns, its size and five short rows, never the whole table', () => {
  const many = Array.from({ length: 12 }, (_, index) => ({ id: String(index), name: `Persona ${index} ${'x'.repeat(60)}`, company: 'Empresa' }));
  const preview = coworkArtifactDataPreview({ tables: { contacts: coworkArtifactContacts(many) } });
  assert.equal(preview.contacts.rows, 12);
  assert.equal(preview.contacts.sample.length, 5);
  assert.ok(preview.contacts.sample.every(row => String(row.name).length <= 40));
  assert.ok(preview.contacts.columns.includes('has_email (text): Con correo'));
});

test('the summary counts the few-valued columns, adds the numbers and spans the dates, for the chat reply', () => {
  const pipeline = coworkArtifactPipeline(leads, [{ id: 'lead_saved|a', stage: 'meeting', deal_value: 2_000_000 }, { id: 'lead_saved|b', deal_value: 500_000 }]);
  const summary = coworkArtifactTableSummary(pipeline) as Record<string, Record<string, unknown>>;
  assert.deepEqual(summary.stage, { Nuevos: 2, Reunión: 1 });
  assert.deepEqual(summary.value, { sum: 2_500_000, min: 500_000, max: 2_000_000, empty: 1 });
  assert.deepEqual(summary.created_at, { first: '2026-09-20', last: '2026-09-21', empty: 1 });
  assert.equal(summary.owner, undefined);
  // Many different names: no counts for them.
  const many = coworkArtifactContacts(Array.from({ length: 20 }, (_, index) => ({ name: `Persona ${index}`, email: index % 2 ? 'a@b.cl' : null })));
  const contacts = coworkArtifactTableSummary(many) as Record<string, unknown>;
  assert.equal(contacts.name, undefined);
  assert.deepEqual(contacts.has_email, { No: 10, Sí: 10 });
});
