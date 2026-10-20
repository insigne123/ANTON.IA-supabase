import assert from 'node:assert/strict';
import test from 'node:test';

import { deliverDailyAlert } from './daily-alerts';
import { memory } from './goals-alerts-test-fixtures';
import { dropPdf, homeDrop, latestDrop, pdfSafe, planOrganizationDrops, pullDrop, pullStatus, saveDropLeads, writeDrop } from './lead-drops';
import { splitLeadsFinderItems } from './leads-finder/client';

const ORG = 'org-1';
const TUESDAY = new Date('2026-10-20T10:00:00.000Z'); // 07:00 in Chile
const WEDNESDAY_MORNING = new Date('2026-10-21T10:00:00.000Z');
const actorItem = (n: number, company: string, extra: Record<string, unknown> = {}) => ({
  first_name: `Nombre${n}`, last_name: `Apellido${n}`, full_name: `Nombre${n} Apellido${n}`, email: `p${n}@${company.toLowerCase()}.cl`,
  job_title: 'Gerente de Personas', company_name: company, company_domain: `${company.toLowerCase()}.cl`, industry: 'Retail', company_size: '500',
  city: 'Santiago', linkedin: `linkedin.com/in/p${n}`, company_description: `${company} vende productos para el hogar en Chile.`, ...extra,
});
const POOL = ['Ripley', 'Falabella', 'Paris', 'Lider', 'Tottus', 'Unimarc', 'Jumbo', 'Hites', 'Abcdin', 'Easy', 'Sodimac', 'Corona'];
const searchCalls: any[] = [];
const searchCaps: number[] = [];
const fakeSearch = async (input: any, deps?: { maxRunUsd?: number }) => {
  searchCalls.push(input);
  searchCaps.push(Number(deps?.maxRunUsd));
  return { results: splitLeadsFinderItems(POOL.map((company, index) => actorItem(index + 1, company)), ['validated']), fetched: POOL.length, notApplied: [], costUsd: 0.04 };
};
const profile = (id: string, extended: Record<string, unknown> = {}) => ({ id, full_name: `Persona ${id}`, email: `${id}@axis.cl`, company_name: 'AXIS',
  job_title: 'Ejecutiva comercial', signatures: { profile_extended: { valueProposition: 'AXIS consulta antecedentes laborales en el PJUD.', ...extended } } });
const seed = () => ({
  organization_members: [{ organization_id: ORG, user_id: 'u-ana', role: 'admin' }, { organization_id: ORG, user_id: 'u-leo', role: 'member' }, { organization_id: ORG, user_id: 'u-sin', role: 'member' }],
  profiles: [profile('u-ana', { targetRoles: 'Gerente de Personas', targetIndustries: 'retail' }), profile('u-leo'), profile('u-sin')],
  enriched_leads: [{ id: 'e-1', organization_id: ORG, user_id: 'u-ana', email: 'p3@paris.cl', linkedin_url: null, source_provider_id: null, title: 'Gerente de Personas', organization_industry: 'Retail', created_at: '2026-10-01T00:00:00Z' }],
  contacted_leads: [] as any[],
  lead_drops: [] as any[],
  lead_search_vault: [] as any[],
});
const writerDraft = (name: string) => ({ reply: `Le escribí a ${name}.`, question: null, suggestions: ['Sí'],
  blocks: [{ type: 'email_draft', title: `Correo para ${name}`, to: [name], subject: 'Ingresos en temporada alta',
    body: `Hola ${name.split(' ')[0]},\n\nEn retail, cuando entra un grupo grande antes de la temporada, cada antecedente pendiente es un puesto que sigue vacío.\n\nAXIS consulta antecedentes laborales en el PJUD.\n\n¿Cuántos ingresos revisan al mes?\n\nPersona u-ana` }] });
const fakeGenerate = async (options: any) => {
  if (options.prompt.includes('"companies"')) return { companies: JSON.parse(options.prompt).companies.map((item: any) => ({ leadId: item.leadId, about: `${item.company} vende productos para el hogar.` })) };
  if (String(options.systemPrompt).startsWith('Eres la Revisora')) return { verdict: 'ok', issues: [] };
  const name = JSON.parse(options.prompt).brief.recipients[0];
  return writerDraft(name);
};

test('one search for people with the same customer; each gets different contacts and nobody the team has', async () => {
  searchCalls.length = 0;
  const { client, tables } = memory(seed(), { unique: { lead_drops: ['organization_id', 'user_id', 'drop_date'] } });
  const planned = await planOrganizationDrops(client, ORG, ['u-ana', 'u-leo', 'u-sin'], { now: TUESDAY, search: fakeSearch as any, budgetUsd: 3, spentUsd: 0, usdPerLead: 0.0035 });
  assert.equal(searchCalls.length, 1, 'Leo and the one without a profile follow Ana, the admin');
  assert.deepEqual(searchCalls[0].titles, ['Gerente de Personas']);
  assert.equal(planned.planned, 3);
  const drops = tables.lead_drops;
  const ids = drops.flatMap(drop => drop.items.map((item: any) => item.leadId));
  assert.equal(new Set(ids).size, ids.length, 'nobody twice');
  assert.ok(!drops.some(drop => drop.items.some((item: any) => item.company === 'Paris')), 'the team already has the one at Paris');
  assert.deepEqual(drops.map(drop => [drop.user_id, drop.status, drop.criteria.source]), [['u-ana', 'pending', 'perfil'], ['u-leo', 'pending', 'equipo'], ['u-sin', 'pending', 'equipo']]);
  assert.match(drops[0].items[0].why, /calza con tu cliente ideal\.$/);
  assert.match(drops[1].items[0].why, /calza con el cliente ideal de tu equipo\.$/, 'one search, but each says whose customer it is');
  assert.ok(drops.every(drop => drop.items.every((item: any) => !('email' in item) && item.hasEmail)), 'the email stays in the vault');
  assert.equal(tables.lead_search_vault.length, ids.length);
  assert.match(tables.lead_search_vault[0].contact_encrypted, /^enc:v1\./);
  // A second run the same morning finds the drops and plans nothing again.
  await planOrganizationDrops(client, ORG, ['u-ana'], { now: TUESDAY, search: fakeSearch as any, budgetUsd: 3, spentUsd: 0, usdPerLead: 0.0035 });
  assert.equal(tables.lead_drops.length, 3);
});

test('the title, the company and the industry as people say them: linking words in lower case, «S.A.», the industry in Spanish', async () => {
  const { client, tables } = memory(seed(), { unique: { lead_drops: ['organization_id', 'user_id', 'drop_date'] } });
  const person = actorItem(1, 'Rutas', { job_title: 'Jefe De Reclutamiento Y Selección', industry: 'logistics & supply chain', company_name: 'Rutas S.a.' });
  const search = async () => ({ results: splitLeadsFinderItems([person], ['validated']), fetched: 1, notApplied: [], costUsd: 0.01 });
  await planOrganizationDrops(client, ORG, ['u-ana'], { now: TUESDAY, search: search as any, budgetUsd: 3, spentUsd: 0, usdPerLead: 0.0035 });
  const [item] = tables.lead_drops[0].items;
  assert.deepEqual([item.title, item.company, item.industry], ['Jefe de Reclutamiento y Selección', 'Rutas S.A.', 'Logística']);
  assert.equal(item.why, 'Jefe de Reclutamiento y Selección en logística en Santiago: calza con tu cliente ideal.');
  assert.deepEqual(item.research, ['Logística · 500 personas · Santiago']);
});

test('without a customer to go by, or without budget, the drop is empty and says why', async () => {
  const data = seed();
  data.profiles = [profile('u-ana'), profile('u-leo'), profile('u-sin')];
  data.enriched_leads = [];
  const { client, tables } = memory(data, { unique: { lead_drops: ['organization_id', 'user_id', 'drop_date'] } });
  await planOrganizationDrops(client, ORG, ['u-leo'], { now: TUESDAY, search: fakeSearch as any, budgetUsd: 3, spentUsd: 0 });
  assert.equal(tables.lead_drops[0].status, 'empty');
  assert.match(tables.lead_drops[0].error, /Sin cliente ideal/);
  const broke = memory(seed(), { unique: { lead_drops: ['organization_id', 'user_id', 'drop_date'] } });
  await planOrganizationDrops(broke.client, ORG, ['u-ana'], { now: TUESDAY, search: fakeSearch as any, budgetUsd: 0.01, spentUsd: 0, usdPerLead: 0.0035 });
  assert.match(broke.tables.lead_drops[0].error, /presupuesto/);
});

test('writing a drop: what each company does and a first email by the Writer', async () => {
  const { client, tables } = memory(seed(), { unique: { lead_drops: ['organization_id', 'user_id', 'drop_date'] } });
  await planOrganizationDrops(client, ORG, ['u-ana'], { now: TUESDAY, search: fakeSearch as any, budgetUsd: 3, spentUsd: 0 });
  const drop = tables.lead_drops[0];
  const written = await writeDrop(client, drop, { generate: fakeGenerate, now: TUESDAY });
  assert.equal(written.written, drop.items.length);
  const saved = tables.lead_drops[0];
  assert.equal(saved.status, 'ready');
  assert.match(saved.items[0].research[0], /vende productos para el hogar\.$/);
  assert.ok(saved.items.every((item: any) => !('description' in item)), 'the raw description stays out');
  assert.equal(saved.items[0].draft.subject, 'Ingresos en temporada alta');
  assert.match(saved.items[0].draft.body, /^Hola Nombre\d+,/);
});

test('saving puts the contact in «Por escribir» with its email, once, and the vault forgets it', async () => {
  const { client, tables } = memory(seed(), { unique: { lead_drops: ['organization_id', 'user_id', 'drop_date'] } });
  await planOrganizationDrops(client, ORG, ['u-ana'], { now: TUESDAY, search: fakeSearch as any, budgetUsd: 3, spentUsd: 0 });
  await writeDrop(client, tables.lead_drops[0], { generate: fakeGenerate, now: TUESDAY });
  const scope = { organizationId: ORG, userId: 'u-ana' };
  const drop = tables.lead_drops[0];
  assert.equal(drop.items.length, 1, 'one contact a day');
  await assert.rejects(saveDropLeads(client, { organizationId: ORG, userId: 'u-leo' }, drop.id), { status: 404 }, 'never another person\'s drop');
  const { name, company, why } = drop.items[0];
  assert.deepEqual(await latestDrop(client, scope, TUESDAY), { id: drop.id, dropDate: '2026-10-20', total: 1, left: 1, next: { name, company, why } });
  const saved = await saveDropLeads(client, scope, drop.id, [drop.items[0].leadId]);
  assert.equal(saved.saved.length, 1);
  const row = tables.enriched_leads.find(lead => lead.id === saved.saved[0].savedLeadId);
  assert.ok(row.email && row.email.endsWith('.cl'));
  assert.equal(row.source_provider, 'leads_finder');
  assert.equal(row.data.leadDrop.dropId, drop.id);
  assert.equal(row.data.leadDrop.draft.subject, 'Ingresos en temporada alta');
  assert.equal(tables.lead_search_vault.length, 0);
  assert.equal(await latestDrop(client, scope, TUESDAY), null, 'nothing left to save');
  assert.equal((await saveDropLeads(client, scope, drop.id)).saved.length, 0, 'saving again saves nobody twice');
});

test('the morning alert carries the ready contact of the day, with its PDF, and marks it sent', async () => {
  const data = seed();
  const { client, tables } = memory(data, { unique: { lead_drops: ['organization_id', 'user_id', 'drop_date'], daily_alerts: ['organization_id', 'user_id', 'alert_date'] } });
  await planOrganizationDrops(client, ORG, ['u-ana'], { now: WEDNESDAY_MORNING, search: fakeSearch as any, budgetUsd: 3, spentUsd: 0 });
  await writeDrop(client, tables.lead_drops[0], { generate: fakeGenerate, now: WEDNESDAY_MORNING });
  const sent: any[] = [];
  const outcome = await deliverDailyAlert(client, { organizationId: ORG, userId: 'u-ana' }, {
    send: async (input: any) => { sent.push(input); return { ok: true as const }; }, appUrl: 'https://app.antonia.ai', now: new Date('2026-10-21T11:30:00.000Z'),
    opportunities: 'none', goalReminders: false,
  });
  assert.deepEqual(outcome, { status: 'sent' });
  assert.equal(sent[0].subject, `Tu contacto de hoy: Gerente de Personas en ${tables.lead_drops[0].items[0].company}`);
  assert.match(sent[0].html, /Contacto del día/);
  assert.equal(sent[0].attachments[0].filename, 'contacto-del-dia-2026-10-21.pdf');
  assert.match(sent[0].html, /\/search\/contactos\//);
  assert.equal(sent[0].attachments[0].contentType, 'application/pdf');
  assert.equal(sent[0].attachments[0].content.subarray(0, 4).toString(), '%PDF');
  assert.equal(tables.lead_drops[0].status, 'sent');
});

test('the PDF draws plain Latin text', async () => {
  assert.equal(pdfSafe('Ñuñoa «Gerente» — 50 % ✓'), 'Ñuñoa "Gerente" - 50 % ');
  const pdf = await dropPdf([{ leadId: 'lf_1', name: 'Ana Pérez', title: 'Gerente', company: 'Ripley', domain: null, industry: null, size: null, city: null,
    hasEmail: true, hasPhone: false, why: 'Calza.', research: ['Vende ropa.'], draft: { subject: 'Hola', body: 'Hola Ana,\n\n¿Cuántos?' } }], { name: 'Ana', date: '2026-10-20', link: 'https://app.antonia.ai/x' });
  assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
});

// ─── From «Hoy», for whoever gets no email ─────────────────────────────────────────────────────────────────────────

const WEDNESDAY = new Date('2026-10-21T15:00:00.000Z');
const THURSDAY = new Date('2026-10-22T15:00:00.000Z');
const FRIDAY = new Date('2026-10-23T15:00:00.000Z');
const SATURDAY = new Date('2026-10-24T15:00:00.000Z');
const ANA = { organizationId: ORG, userId: 'u-ana' };
const dropRow = (extra: Record<string, unknown>) => ({ id: 'drop-old', organization_id: ORG, user_id: 'u-ana', drop_date: '2026-10-20', status: 'ready',
  criteria: { titles: ['Gerente de Personas'], industries: ['retail'], locations: ['Chile'], sizes: [], source: 'perfil' }, items: [], cost_usd: 0.02, error: null,
  created_at: '2026-10-20T10:00:00.000Z', updated_at: '2026-10-20T10:05:00.000Z', ...extra });
const withoutCustomer = () => {
  const data = seed();
  data.profiles = [profile('u-ana'), profile('u-leo'), profile('u-sin')];
  data.enriched_leads = [];
  return data;
};
const unique = { unique: { lead_drops: ['organization_id', 'user_id', 'drop_date'] } };
const contact = { leadId: 'lf_1', name: 'Nombre1 Apellido1', title: 'Gerente de Personas', company: 'Ripley', domain: 'ripley.cl', industry: 'Retail', size: 500,
  city: 'Santiago', hasEmail: true, hasPhone: false, why: 'Calza.', research: ['Retail.'], draft: null };

test('«Hoy» offers the first contact any day, then on Tuesdays, Wednesdays and Fridays, and the way back while it is written', async () => {
  assert.equal(await pullStatus(memory(seed(), unique).client, ANA, THURSDAY), 'first');
  const after = (row: Record<string, unknown>, now: Date) => {
    const data = seed();
    data.lead_drops = [dropRow(row)];
    return pullStatus(memory(data, unique).client, ANA, now);
  };
  assert.equal(await after({}, WEDNESDAY), 'today', 'after Tuesday\'s, Wednesday\'s');
  assert.equal(await after({ drop_date: '2026-10-21' }, THURSDAY), null, 'nothing on Thursday');
  assert.equal(await after({ drop_date: '2026-10-21', status: 'pending' }, WEDNESDAY), 'preparing');
  assert.equal(await after({ drop_date: '2026-10-21' }, WEDNESDAY), null, 'today\'s is done');
  assert.equal(await after({ drop_date: '2026-10-21', status: 'empty', error: 'Se acabó el presupuesto del mes para el contacto del día.' }, WEDNESDAY), null);
  // One that came empty for lack of a customer is made again as soon as there is one, any day.
  assert.equal(await after({ status: 'empty', criteria: {}, cost_usd: 0 }, THURSDAY), 'first');
  assert.equal(await pullStatus(memory(withoutCustomer(), unique).client, ANA, THURSDAY), 'profile');
  // Nothing when the month's budget would not pay a search, or when drops are off.
  const broke = seed();
  broke.lead_drops = [dropRow({ organization_id: 'org-otra', user_id: 'u-otro', cost_usd: 3 })];
  assert.equal(await pullStatus(memory(broke, unique).client, ANA, THURSDAY), null);
  process.env.LEAD_DROPS_ENABLED = 'off';
  try { assert.equal(await pullStatus(memory(seed(), unique).client, ANA, THURSDAY), null); }
  finally { delete process.env.LEAD_DROPS_ENABLED; }
});

test('opening it from «Hoy» makes today\'s contact once: one search, its first email, and the same contact after', async () => {
  searchCalls.length = 0;
  const { client, tables } = memory(seed(), unique);
  const made = await pullDrop(client, ANA, { now: THURSDAY, generate: fakeGenerate, search: fakeSearch as any });
  assert.equal(made.status, 'ready');
  assert.equal(made.reason, null);
  assert.equal(searchCalls.length, 1);
  assert.equal(searchCalls[0].maxResults, 10, 'a small search for one person');
  assert.equal(searchCaps.at(-1), 0.5, 'its cap is an ordinary search\'s: Apify refuses one of US$0.03');
  assert.deepEqual(searchCalls[0].industryKeywords, ['retail'], 'industries as the actor names them');
  const drop = tables.lead_drops.find(row => row.id === made.id);
  assert.equal(drop.drop_date, '2026-10-22');
  assert.equal(drop.items.length, 1);
  assert.equal(drop.items[0].draft.subject, 'Ingresos en temporada alta');
  assert.deepEqual(await pullDrop(client, ANA, { now: THURSDAY, generate: fakeGenerate, search: fakeSearch as any }), made);
  assert.equal(searchCalls.length, 1, 'never searched twice');
  assert.equal(await pullStatus(client, ANA, THURSDAY), null);
  await assert.rejects(pullDrop(client, ANA, { now: SATURDAY, generate: fakeGenerate, search: fakeSearch as any }),
    { status: 409, message: 'Tu próximo contacto llega el martes.' }, 'Saturday, after Thursday\'s first one');
});

test('without a customer nothing is searched nor kept; once there is one, today\'s is made', async () => {
  searchCalls.length = 0;
  const { client, tables } = memory(withoutCustomer(), unique);
  const none = await pullDrop(client, ANA, { now: THURSDAY, generate: fakeGenerate, search: fakeSearch as any });
  assert.equal(none.id, null);
  assert.equal(none.status, 'empty');
  assert.equal(none.reason?.profile, 'Completar mi cliente ideal');
  assert.equal(searchCalls.length, 0);
  assert.equal(tables.lead_drops.length, 0);
  // The morning run left an empty one for lack of a customer; Ana fills «Perfil» and opens it again the same day.
  const data = seed();
  data.lead_drops = [dropRow({ id: 'drop-empty', drop_date: '2026-10-21', status: 'empty', criteria: {}, cost_usd: 0, error: 'Sin cliente ideal en «Perfil» ni contactos guardados para inferirlo.' })];
  const filled = memory(data, unique);
  const made = await pullDrop(filled.client, ANA, { now: WEDNESDAY, generate: fakeGenerate, search: fakeSearch as any });
  assert.equal(made.status, 'ready');
  assert.notEqual(made.id, 'drop-empty');
  assert.deepEqual(filled.tables.lead_drops.map(row => row.status), ['ready'], 'the empty one is replaced');
});

test('an empty drop says why; one being written answers «pending», and one left half written is finished', async () => {
  searchCalls.length = 0;
  const broke = seed();
  broke.lead_drops = [dropRow({ drop_date: '2026-10-21', status: 'empty', error: 'Se acabó el presupuesto del mes para el contacto del día.' })];
  const empty = await pullDrop(memory(broke, unique).client, ANA, { now: WEDNESDAY, generate: fakeGenerate, search: fakeSearch as any });
  assert.equal(empty.status, 'empty');
  assert.equal(empty.reason?.title, 'Por este mes no quedan contactos');
  assert.equal(empty.reason?.profile, null);
  const failed = seed();
  failed.lead_drops = [dropRow({ drop_date: '2026-10-21', status: 'empty', error: 'La búsqueda falló: timeout' })];
  assert.match((await pullDrop(memory(failed, unique).client, ANA, { now: WEDNESDAY, generate: fakeGenerate, search: fakeSearch as any })).reason!.text, /El próximo llega el viernes/);
  const writing = seed();
  writing.lead_drops = [dropRow({ drop_date: '2026-10-21', status: 'pending', items: [contact], updated_at: '2026-10-21T14:59:00.000Z' })];
  assert.deepEqual(await pullDrop(memory(writing, unique).client, ANA, { now: WEDNESDAY, generate: fakeGenerate, search: fakeSearch as any }),
    { id: 'drop-old', status: 'pending', reason: null });
  const stalled = seed();
  stalled.lead_drops = [dropRow({ drop_date: '2026-10-21', status: 'pending', items: [contact], updated_at: '2026-10-21T14:00:00.000Z' })];
  const finished = memory(stalled, unique);
  assert.equal((await pullDrop(finished.client, ANA, { now: WEDNESDAY, generate: fakeGenerate, search: fakeSearch as any })).status, 'ready');
  assert.equal(finished.tables.lead_drops[0].items[0].draft.subject, 'Ingresos en temporada alta');
  assert.equal(searchCalls.length, 0, 'none of them searched');
});

test('today\'s row is taken before searching: a second request waits, and a search that died is made again', async () => {
  searchCalls.length = 0;
  const searching = seed();
  searching.lead_drops = [dropRow({ id: 'drop-claim', drop_date: '2026-10-21', status: 'pending', criteria: {}, items: [], cost_usd: 0, updated_at: '2026-10-21T14:59:00.000Z' })];
  const busy = memory(searching, unique);
  assert.equal(await pullStatus(busy.client, ANA, WEDNESDAY), 'preparing');
  assert.deepEqual(await pullDrop(busy.client, ANA, { now: WEDNESDAY, generate: fakeGenerate, search: fakeSearch as any }), { id: 'drop-claim', status: 'pending', reason: null });
  assert.equal(searchCalls.length, 0, 'the first request is searching');
  const died = seed();
  died.lead_drops = [dropRow({ id: 'drop-claim', drop_date: '2026-10-21', status: 'pending', criteria: {}, items: [], cost_usd: 0, updated_at: '2026-10-21T14:00:00.000Z' })];
  const again = memory(died, unique);
  const made = await pullDrop(again.client, ANA, { now: WEDNESDAY, generate: fakeGenerate, search: fakeSearch as any });
  assert.deepEqual([made.id, made.status], ['drop-claim', 'ready']);
  assert.equal(searchCalls.length, 1);
  assert.equal(again.tables.lead_drops[0].items.length, 1);
});

test('«Hoy» keeps the contact left to save, until a new one is due', async () => {
  const data = seed();
  data.lead_drops = [dropRow({ status: 'sent', items: [contact] })];
  const { client } = memory(data, unique);
  assert.deepEqual(await homeDrop(client, ANA, THURSDAY),
    { drop: { id: 'drop-old', dropDate: '2026-10-20', total: 1, left: 1, next: { name: 'Nombre1 Apellido1', company: 'Ripley', why: 'Calza.' } }, pull: null });
  assert.deepEqual(await homeDrop(client, ANA, FRIDAY), { drop: null, pull: 'today' }, 'the new one does not wait for the old one to be saved');
});

test('an industry the actor does not know is left out, and nobody found means one broader search, then saying so', async () => {
  const data = seed();
  data.profiles = [profile('u-ana', { targetRoles: 'Gerente de Personas', targetIndustries: 'Retail, Seguridad privada, Cosas varias', targetCompanySize: '51-200' }), profile('u-leo'), profile('u-sin')];
  const calls: any[] = [];
  const picky = async (input: any) => {
    calls.push(input);
    if (input.industryKeywords.length || input.employeeRanges.length) return { results: [], fetched: 0, notApplied: [], costUsd: 0 };
    return fakeSearch(input);
  };
  const { client, tables } = memory(data, unique);
  await planOrganizationDrops(client, ORG, ['u-ana'], { now: TUESDAY, search: picky as any, budgetUsd: 3, spentUsd: 0 });
  assert.deepEqual(calls[0].industryKeywords, ['retail', 'security & investigations'], '«Cosas varias» is left out instead of searching as a keyword');
  assert.deepEqual(calls[0].companyKeywords, []);
  assert.deepEqual([calls.length, calls[1].industryKeywords, calls[1].employeeRanges], [2, [], []], 'then the titles and places only');
  assert.equal(tables.lead_drops[0].status, 'pending');
  const nobody = memory(seed(), unique);
  await planOrganizationDrops(nobody.client, ORG, ['u-ana'], { now: TUESDAY, search: (async () => ({ results: [], fetched: 0, notApplied: [], costUsd: 0 })) as any, budgetUsd: 3, spentUsd: 0 });
  const drop = nobody.tables.lead_drops[0];
  assert.equal(drop.status, 'empty');
  assert.equal((await pullDrop(nobody.client, ANA, { now: new Date('2026-10-20T15:00:00.000Z'), generate: fakeGenerate, search: fakeSearch as any })).reason?.title,
    'Esta vez no encontramos a nadie', 'not «tu equipo ya los tiene» when the search found nobody');
});
