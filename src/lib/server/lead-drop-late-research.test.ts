import assert from 'node:assert/strict';
import test from 'node:test';

import { LATE_RESEARCH_RETRY_MS, lacksResearch } from '@/lib/lead-drops';
import { memory } from './goals-alerts-test-fixtures';
import { LATE_RESEARCH_MAX, researchDropLate, withLateResearch } from './lead-drop-late-research';

const ORG = 'org-1', USER = 'u-ana', DROP = '11111111-1111-4111-8111-111111111111';
const scope = { organizationId: ORG, userId: USER };
const NOW = new Date('2026-11-19T15:00:00.000Z');
const id = (n: number) => `6accdbfcd5f5d80001cf69${String(n).padStart(2, '0')}`;
const item = (n: number, company: string | null, extra: Record<string, unknown> = {}) => ({ leadId: id(n), name: `Persona ${n}`, title: 'Gerente de Personas', company, domain: null, industry: null,
  size: null, city: 'Santiago', country: 'Chile', hasEmail: true, hasPhone: false, why: 'Calza con tu cliente ideal por su cargo.', research: ['Retail'], provider: 'apollo',
  draft: { subject: 'Ingresos en temporada alta', body: 'Hola {{nombre}}' }, followUps: [{ day: 3, subject: 'Re', body: 'Hola' }], ...extra });
const brief = (company: string) => ({ company: `${company} vende en tiendas de todo Chile.`, news: { text: 'Abrirá un centro de distribución', date: '3 nov 2026', source: 'Diario Financiero', url: 'https://diario.example/cd' },
  fit: 'Un centro nuevo suma ingresos que revisar.', role: 'Responde por contratar a tiempo.', opener: 'Pregúntale por el centro nuevo.' });
const seed = (items: any[], extra: Record<string, unknown> = {}) => memory({
  lead_drops: [{ id: DROP, organization_id: ORG, user_id: USER, drop_date: '2026-11-19', status: 'sent', criteria: {}, items, ...extra }],
  profiles: [], organization_members: [{ organization_id: ORG, user_id: USER }],
});

test('a contact lacks its research when it has a company, no brief, and was not tried in the last hours', () => {
  const tried = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
  assert.equal(lacksResearch({ company: 'Ripley' }, NOW), true);
  assert.equal(lacksResearch({ company: 'Ripley', brief: brief('Ripley') }, NOW), false);
  assert.equal(lacksResearch({ company: ' ' }, NOW), false, 'nothing to look for');
  assert.equal(lacksResearch({ company: null }, NOW), false);
  assert.equal(lacksResearch({ company: 'Ripley', researchedAt: tried(60_000) }, NOW), false, 'tried a minute ago');
  assert.equal(lacksResearch({ company: 'Ripley', researchedAt: tried(LATE_RESEARCH_RETRY_MS + 60_000) }, NOW), true, 'the search may have been down: once more the next day');
  assert.equal(lacksResearch({ company: 'Ripley', researchedAt: 'ayer' }, NOW), true);
});

test('opening the contacts researches those that came without it and keeps what it found, leaving the emails and the rest as they were', async () => {
  const { client, tables } = seed([item(1, 'Ripley'), item(2, 'Falabella', { brief: brief('Falabella'), summary: 'Ya investigada.' }), item(3, 'Paris', { savedLeadId: 'e-3', edited: true }), item(4, null)]);
  const asked: any[] = [];
  const research = async (input: any) => {
    asked.push(input);
    if (input.contact.company === 'Paris') return null;
    return { domain: 'ripley.cl', brief: brief('Ripley') };
  };
  const result = await researchDropLate(client, scope, DROP, { research, now: NOW });
  assert.deepEqual(asked.map(input => [input.organizationId, input.contact]), [
    [ORG, { title: 'Gerente de Personas', company: 'Ripley', domain: null, country: 'Chile', industry: null }],
    [ORG, { title: 'Gerente de Personas', company: 'Paris', domain: null, country: 'Chile', industry: null }],
  ], 'only the two with a company and no brief, at once');
  assert.equal(result.researched, 1);
  const [ripley, falabella, paris, nobody] = tables.lead_drops[0].items as any[];
  assert.deepEqual(result.items, tables.lead_drops[0].items, 'the answer is the drop as it is now');
  assert.equal(ripley.brief.opener, 'Pregúntale por el centro nuevo.');
  assert.equal(ripley.summary, 'Ripley vende en tiendas de todo Chile.');
  assert.deepEqual(ripley.research, ['Ripley vende en tiendas de todo Chile.', 'Abrirá un centro de distribución (Diario Financiero, 3 nov 2026).', 'Retail']);
  assert.deepEqual([ripley.domain, ripley.website, ripley.researchedAt], ['ripley.cl', 'https://ripley.cl', NOW.toISOString()]);
  assert.deepEqual([ripley.draft, ripley.followUps.length, ripley.why], [{ subject: 'Ingresos en temporada alta', body: 'Hola {{nombre}}' }, 1, 'Calza con tu cliente ideal por su cargo.'], 'the emails are the person\'s to change');
  // Nothing found: marked as tried, and nothing else of the contact changes.
  assert.deepEqual([paris.brief, paris.researchedAt, paris.savedLeadId, paris.edited, paris.research], [undefined, NOW.toISOString(), 'e-3', true, ['Retail']]);
  assert.deepEqual([falabella.summary, falabella.researchedAt], ['Ya investigada.', undefined], 'the one with its research is not touched');
  assert.equal(nobody.researchedAt, undefined);

  // The next visit asks for nothing: one has its research, the other was tried just now.
  asked.length = 0;
  assert.equal((await researchDropLate(client, scope, DROP, { research, now: new Date(NOW.getTime() + 60_000) })).researched, 0);
  assert.equal(asked.length, 0);
  // A day later the one with nothing found is tried once more.
  await researchDropLate(client, scope, DROP, { research, now: new Date(NOW.getTime() + 21 * 3_600_000) });
  assert.deepEqual(asked.map(input => input.contact.company), ['Paris']);
});

test('a research that fails leaves the contact to be tried later, an old drop is left alone, and somebody else\'s drop is not found', async () => {
  const failing = seed([item(1, 'Ripley'), item(2, 'Paris')]);
  const result = await researchDropLate(failing.client, scope, DROP, { now: NOW, research: async (input: any) => { if (input.contact.company === 'Ripley') throw new Error('down'); return { domain: null, brief: brief('Paris') }; } });
  assert.equal(result.researched, 1);
  assert.deepEqual((failing.tables.lead_drops[0].items as any[]).map(entry => [entry.company, Boolean(entry.brief), entry.domain]), [['Ripley', false, null], ['Paris', true, null]]);

  // Two weeks old: its news would be stale.
  const old = seed([item(1, 'Ripley')], { drop_date: '2026-11-03' });
  let calls = 0;
  assert.deepEqual(await researchDropLate(old.client, scope, DROP, { now: NOW, research: async () => { calls++; return null; } }), { researched: 0, items: old.tables.lead_drops[0].items });
  assert.equal(calls, 0);

  // A drop of many is researched up to the cap in one visit.
  const many = seed(Array.from({ length: LATE_RESEARCH_MAX + 2 }, (_, index) => item(index + 1, `Empresa ${index + 1}`)));
  await researchDropLate(many.client, scope, DROP, { now: NOW, research: async () => { calls++; return null; } });
  assert.equal(calls, LATE_RESEARCH_MAX);

  const mine = seed([item(1, 'Ripley')]);
  await assert.rejects(researchDropLate(mine.client, { organizationId: ORG, userId: 'u-otro' }, DROP, { now: NOW, research: async () => null }), (error: any) => error.status === 404);
});

test('what the late research found is kept once: a contact researched meanwhile is left as it is', () => {
  const at = NOW.toISOString();
  const done = item(1, 'Ripley', { brief: brief('Ripley') }) as any;
  assert.equal(withLateResearch(done, { domain: 'otra.cl', brief: brief('Otra') }, at), done);
  const kept = withLateResearch(item(1, 'Ripley', { domain: 'ripley.com', website: 'https://ripley.com', research: ['Ripley vende en tiendas de todo Chile.'] }) as any, { domain: 'ripley.cl', brief: { ...brief('Ripley'), news: null } }, at);
  assert.deepEqual([kept.domain, kept.website, kept.research], ['ripley.com', 'https://ripley.com', ['Ripley vende en tiendas de todo Chile.']], 'the site the search brought stays, and a fact is not said twice');
});
