import test from 'node:test';
import assert from 'node:assert/strict';
import { AI_RANK_CANDIDATE_LIMIT, buildCandidatesCsv, buildRecipientHistory, defaultAudience, isCampaignMessageLocked, matchAudience, renderCampaignMessage, nextCampaignMessage, validateRanking, CampaignInputSchema, type AudiencePerson, type CampaignRecipient, type EnrichedCandidate } from './bulk-campaigns';

const person: AudiencePerson = { email: 'ana@example.com', name: 'Ana Pérez', company: 'Empresa', title: 'Operaciones', country: 'Chile', industry: '', size: '11-50', seniority: 'Manager', leadRef: 'lead', contacted: false, lastSentAt: null, replied: false, blockedReason: null, reasons: [], enriched: true };
test('audience excludes prior contacts and missing industry evidence', () => {
  assert.ok(matchAudience(person, defaultAudience));
  assert.equal(matchAudience({ ...person, contacted: true }, defaultAudience), null);
  assert.equal(matchAudience(person, { ...defaultAudience, industries: ['logística'] }), null);
  assert.ok(matchAudience(person, { ...defaultAudience, titles: ['operaciones'], countries: ['chile'] }));
});
test('reactivation requires a valid last send date and respects replies', () => {
  const criteria = { ...defaultAudience, relationship: 'previously_contacted' as const, minimumDaysSinceSent: 90 };
  assert.equal(matchAudience({ ...person, contacted: true }, criteria), null);
  assert.equal(matchAudience({ ...person, contacted: true, lastSentAt: 'invalid' }, criteria), null);
  const old = { ...person, contacted: true, lastSentAt: '2026-01-01T00:00:00Z' };
  assert.ok(matchAudience(old, criteria, Date.parse('2026-09-01')));
  assert.equal(matchAudience({ ...old, replied: true }, criteria, Date.parse('2026-09-01')), null);
});
test('render only supported variables; reject missing facts and subject injection', () => {
  assert.equal(renderCampaignMessage({ subject: 'Hola {{nombre}}', body: '{{empresa}}', delayDays: 0 }, person).subject, 'Hola Ana');
  assert.throws(() => renderCampaignMessage({ subject: 'Hola', body: '{{facturacion}}', delayDays: 0 }, person));
  assert.throws(() => renderCampaignMessage({ subject: 'Hola', body: '{{empresa}}', delayDays: 0 }, { ...person, company: '' }));
  assert.throws(() => renderCampaignMessage({ subject: 'Hola\nBcc: evil@example.com', body: 'Texto', delayDays: 0 }, person));
});
const recipient: CampaignRecipient = { ...person, messages: [
  { subject: 'Hola', body: 'Mensaje', delayDays: 0, draftId: 'first', versionId: 'v1' },
  { subject: 'Seguimiento', body: 'Segundo', delayDays: 3, draftId: 'second', versionId: 'v2' },
] };
test('followups wait from confirmed send, not campaign approval', () => {
  const sent = [{ draft_id: 'first', status: 'sent', completed_at: '2026-09-05T00:00:00Z', error_message: null }];
  assert.equal(nextCampaignMessage(recipient, sent, '2026-09-01T00:00:00Z', Date.parse('2026-09-07'))?.state, 'waiting');
  assert.equal(nextCampaignMessage(recipient, sent, '2026-09-01T00:00:00Z', Date.parse('2026-09-08'))?.state, 'ready');
});
test('unknown, failed and in-flight outcomes never advance or automatically retry', () => {
  for (const status of ['unknown', 'failed', 'pending', 'sending']) {
    const next = nextCampaignMessage(recipient, [{ draft_id: 'first', status, completed_at: null, error_message: null }], '2026-09-01T00:00:00Z');
    assert.equal(next?.index, 0); assert.equal(next?.state, status);
  }
});
test('duplicate recipients and zero-day followups fail validation', () => {
  const input = { name: 'Test', description: '', objective: '', criteria: defaultAudience, provider: 'google', emails: [person.email, person.email], messages: [{ subject: 'Hola', body: 'Mensaje', delayDays: 0 }] };
  assert.equal(CampaignInputSchema.safeParse(input).success, false);
  const valid = { ...input, emails: [person.email] };
  const override = { email: person.email, messageIndex: 0, subject: 'Personalizado', body: 'Mensaje individual' };
  assert.equal(CampaignInputSchema.safeParse({ ...valid, overrides: [override] }).success, true);
  assert.equal(CampaignInputSchema.safeParse({ ...valid, overrides: [override, override] }).success, false);
  assert.equal(CampaignInputSchema.safeParse({ ...valid, overrides: [{ ...override, email: 'outside@example.com' }] }).success, false);
  assert.equal(CampaignInputSchema.safeParse({ ...valid, overrides: [{ ...override, messageIndex: 4 }] }).success, false);
  assert.equal(CampaignInputSchema.safeParse({ ...input, emails: [person.email], messages: [...input.messages, ...input.messages] }).success, false);
});
test('size and seniority narrow the audience without inventing evidence', () => {
  assert.ok(matchAudience(person, { ...defaultAudience, sizes: ['11-50'], seniorities: ['manager'] }));
  assert.equal(matchAudience(person, { ...defaultAudience, sizes: ['1000+'] }), null);
  assert.equal(matchAudience(person, { ...defaultAudience, seniorities: ['director'] }), null);
  assert.equal(matchAudience({ ...person, size: '' }, { ...defaultAudience, sizes: ['11-50'] }), null);
});
test('only untouched or deferred messages can be revised', () => {
  const deliveries = [
    { draft_id: 'sent', status: 'sent', completed_at: '2026-09-01T00:00:00Z', error_message: null },
    { draft_id: 'deferred', status: 'deferred', completed_at: '2026-09-01T00:00:00Z', error_message: 'quota' },
    { draft_id: 'failed', status: 'failed', completed_at: '2026-09-01T00:00:00Z', error_message: 'bounced' },
  ];
  assert.equal(isCampaignMessageLocked('sent', deliveries), true);
  assert.equal(isCampaignMessageLocked('failed', deliveries), true);
  assert.equal(isCampaignMessageLocked('missing', deliveries), false);
  assert.equal(isCampaignMessageLocked('deferred', deliveries), false);
});
test('enrichedOnly drops saved leads without Apollo enrichment', () => {
  assert.ok(matchAudience(person, defaultAudience));
  assert.equal(matchAudience({ ...person, enriched: false }, defaultAudience), null);
  assert.ok(matchAudience({ ...person, enriched: false }, { ...defaultAudience, enrichedOnly: false }));
});
const candidate: EnrichedCandidate = {
  email: 'ana@example.com', name: 'Ana Pérez', company: 'Falabella', title: 'Jefa de Reclutamiento',
  seniority: 'Manager', departments: ['Recursos Humanos'], industry: 'Retail', size: '1000+',
  country: 'Chile', city: 'Santiago', headline: 'Lidero talento', emailStatus: 'verified', leadRef: 'lead-1',
  contacted: false, replied: false, blockedReason: null, lastSentAt: null,
};
test('candidates CSV is compact, escaped and bounded', () => {
  const tricky = { ...candidate, email: 'a,b@example.com', company: 'Acme "Corp"' };
  const { csv, included, total } = buildCandidatesCsv([candidate, tricky]);
  assert.equal(total, 2);
  assert.equal(included, 2);
  const lines = csv.split('\n');
  assert.equal(lines.length, 3);
  assert.ok(lines[0].startsWith('email,name,title,'));
  assert.ok(lines[2].includes('"Acme ""Corp"""'));
  const many = Array.from({ length: AI_RANK_CANDIDATE_LIMIT + 50 }, (_, index) => ({ ...candidate, email: `lead${index}@example.com` }));
  const capped = buildCandidatesCsv(many);
  assert.equal(capped.included, AI_RANK_CANDIDATE_LIMIT);
  assert.equal(capped.total, many.length);
});
test('ranking validation only accepts known emails, dedupes, sorts and caps', () => {
  const others = { ...candidate, email: 'beto@example.com' };
  const items = [
    { email: 'inventado@example.com', score: 99, reason: 'No existe' },
    { email: 'ANA@example.com', score: 60, reason: 'Aceptable' },
    { email: 'ana@example.com', score: 90, reason: 'La mejor opción' },
    { email: 'beto@example.com', score: 70, reason: 'Buena opción' },
    { email: 'mal', score: 50, reason: 'Correo inválido' },
  ];
  const ranked = validateRanking(items, [candidate, others], 10);
  assert.deepEqual(ranked.map(item => item.email), ['ana@example.com', 'beto@example.com']);
  assert.equal(ranked[0].score, 90);
  assert.deepEqual(validateRanking(items, [candidate, others], 1).map(item => item.email), ['ana@example.com']);
  assert.deepEqual(validateRanking('no-es-lista', [candidate], 10), []);
});
test('recipient history merges legacy contact, replies and campaign steps in order', () => {
  const events = buildRecipientHistory({
    recipient, approvedAt: '2026-09-01T00:00:00Z', now: Date.parse('2026-09-10T00:00:00Z'),
    deliveries: [{ draft_id: 'first', status: 'sent', completed_at: '2026-09-05T00:00:00Z', error_message: null }],
    attempts: [{ draft_id: 'second', state: 'retry_wait', message: 'Cuota alcanzada', retry_at: null }],
    contactedRows: [
      { status: 'sent', sent_at: '2026-01-10T00:00:00Z', replied_at: null, subject: 'Anterior' },
      { status: 'replied', sent_at: '2026-01-10T00:00:00Z', replied_at: '2026-01-12T00:00:00Z', subject: null },
    ],
  });
  assert.equal(events[0].kind, 'campaign_sent');
  assert.equal(events[1].kind, 'reply');
  assert.equal(events[2].kind, 'contacted');
  assert.equal(events[events.length - 1].kind, 'campaign_attention');
});
