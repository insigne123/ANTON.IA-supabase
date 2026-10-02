import assert from 'node:assert/strict';
import test from 'node:test';
import { ICP_SMALL_SAMPLE, analyzeIcp, icpConfidence, icpRate, icpRoleArea, icpRoleLevel, type IcpTouch } from './icp';

const NOW = '2026-10-02T12:00:00Z';
const touch = (id: string, overrides: Partial<IcpTouch> = {}): IcpTouch => ({
  id, leadId: null, email: `${id}@acme.cl`, role: null, industry: null, country: null, city: null,
  sentAt: '2026-09-01T12:00:00Z', repliedAt: null, replyIntent: null, bouncedAt: null, ...overrides,
});
const lead = (id: string, title: string, industry: string) => ({ id, title, industry, country: 'Chile', city: 'Santiago' });

test('titles land in their area and level, the function before general management', () => {
  assert.equal(icpRoleArea('Gerente de Personas'), 'Personas y RR. HH.');
  assert.equal(icpRoleArea('Jefa de RR. HH.'), 'Personas y RR. HH.');
  assert.equal(icpRoleArea('Gerente de Operaciones'), 'Operaciones y logística');
  assert.equal(icpRoleArea('Gerente General'), 'Gerencia general');
  assert.equal(icpRoleArea('Subgerente de Selección'), 'Personas y RR. HH.');
  assert.equal(icpRoleArea(' '), 'Sin cargo');
  assert.equal(icpRoleArea('Arquitecta'), 'Otra área');
  assert.equal(icpRoleLevel('Gerente de Personas'), 'Dirección');
  assert.equal(icpRoleLevel('Subgerente de Selección'), 'Jefatura', '«subgerente» is not «gerente»');
  assert.equal(icpRoleLevel('Analista de Remuneraciones'), 'Profesional');
  assert.equal(icpRoleLevel(null), 'Sin cargo');
});

test('rates come with their probable range, and few sends are a lead to test, not a conclusion', () => {
  assert.equal(icpRate(0, 0), null);
  assert.deepEqual(icpRate(2, 10), { pct: 20, low: 5.7, high: 51 }, 'Wilson at 95 %');
  assert.equal(icpConfidence(ICP_SMALL_SAMPLE - 1), 'muestra chica: no concluyas');
  assert.equal(icpConfidence(ICP_SMALL_SAMPLE), 'indicio');
  assert.equal(icpConfidence(150), 'suficiente');
});

test('each person counts once, an out-of-office is not a reply and meetings come from the pipeline', () => {
  const leads = [lead('l1', 'Gerente de Personas', 'Retail'), lead('l2', 'Jefa de RR. HH.', 'retail'), lead('l3', 'Gerente de Operaciones', 'Minería'), lead('l4', 'Jefe de Selección', 'Retail')];
  const touches = [
    touch('t1', { leadId: 'l1', role: 'Gerente de Personas', industry: 'Retail', repliedAt: '2026-09-03T10:00:00Z', replyIntent: 'positive' }),
    touch('t1b', { leadId: 'l1', role: 'Gerente de Personas', industry: 'Retail', sentAt: '2026-09-08T12:00:00Z' }),
    touch('t2', { leadId: 'l2', role: 'Jefa de RR. HH.', industry: 'retail', repliedAt: '2026-09-03T10:00:00Z', replyIntent: 'auto_reply' }),
    touch('t3', { leadId: 'l3', role: 'Gerente de Operaciones', industry: 'Minería', bouncedAt: '2026-09-02T10:00:00Z' }),
    touch('t4', { email: 'ana@b.cl', sentAt: null }),
  ];
  const declared = { roles: ['RR. HH.', 'Selección', 'Personas'], industries: ['Retail'], companySize: null, locations: [], painPoints: [], differentiators: [], referenceClients: [] };
  const result = analyzeIcp({ declared, touches, leads, stages: new Map([['lead_saved|l1', 'meeting']]), now: NOW });
  assert.equal(result.totals.people, 3, 'a follow-up is the same person and a contact never sent is nobody');
  assert.equal(result.totals.replied, 1, 'the out-of-office is not a reply');
  assert.deepEqual([result.totals.positive, result.totals.meetings, result.totals.bounced], [1, 1, 1]);
  assert.deepEqual([result.totals.firstSend, result.totals.lastSend], ['2026-09-01', '2026-09-08']);
  const hr = result.segments.area.groups.find(group => group.value === 'Personas y RR. HH.')!;
  assert.deepEqual([hr.sent, hr.replied, hr.positive, hr.meetings], [2, 1, 1, 1]);
  assert.equal(hr.confidence, 'muestra chica: no concluyas');
  assert.equal(result.segments.industry.groups.find(group => group.value === 'Retail')?.sent, 2, '«Retail» and «retail» are one industry');
  assert.equal(result.segments.location.groups[0].value, 'Santiago');
  assert.deepEqual(result.coverage, { savedContacts: 4, fitDeclared: 3, fitNotContacted: 1, notContactedByArea: [{ area: 'Personas y RR. HH.', people: 1 }] });
  assert.ok(result.gaps.some(gap => /muy pocas para concluir/.test(gap)));
  assert.ok(result.gaps.some(gap => /falta el tamaño de empresa/.test(gap)));
});

test('without a declared customer the analysis starts from the results and says what is missing', () => {
  const result = analyzeIcp({ declared: null, touches: [touch('t1', { role: 'Gerente General' })], leads: [], stages: new Map(), now: NOW });
  assert.equal(result.coverage, null);
  assert.match(result.gaps[0], /no están los cargos ni las industrias/);
  assert.equal(result.segments.area.groups[0].value, 'Gerencia general');
  assert.equal(result.segments.industry.groups[0].value, 'Sin industria');
});

test('only the six biggest groups are listed; the rest are summed apart', () => {
  const touches = Array.from({ length: 9 }, (_, index) => touch(`t${index}`, { industry: `Industria ${index}` }));
  const result = analyzeIcp({ declared: null, touches, leads: [], stages: new Map(), now: NOW });
  assert.equal(result.segments.industry.groups.length, 6);
  assert.deepEqual([result.segments.industry.otherGroups, result.segments.industry.otherSent], [3, 3]);
});
