import assert from 'node:assert/strict';
import test from 'node:test';

import { dropEmailSection } from '@/lib/lead-drops';
import { memory } from './goals-alerts-test-fixtures';
import { apolloDropEntries, dropDocument, keepDropLead, latestDrop, linkDropLead, planOrganizationDrops, pullStatus, saveDropLeads, writeDrop } from './lead-drops';

// «Contacto del día» with Apollo's free search (3 Nov 2026): the default provider.
delete process.env.LEAD_DROPS_PROVIDER;

const ORG = 'org-1';
const TUESDAY = new Date('2026-10-20T10:00:00.000Z');
const THURSDAY = new Date('2026-10-22T15:00:00.000Z');
const unique = { unique: { lead_drops: ['organization_id', 'user_id', 'drop_date'] } };
const id = (n: number) => `6accdbfcd5f5d80001cf69${String(n).padStart(2, '0')}`;
/** A person as Apollo's free search brings them: the surname hidden, whether it has an email, and little of the company. */
const person = (n: number, company: string, extra: Record<string, unknown> = {}) => ({
  id: id(n), first_name: `Nombre${n}`, last_name: `Ap***${n}`, name: `Nombre${n} Ap***${n}`, title: 'Gerente de Personas', has_email: true,
  has_direct_phone: true, organization_name: company, organization: { name: company }, ...extra,
});
const people = () => ['Ripley', 'Falabella', 'Paris', 'Lider', 'Tottus'].map((company, index) => person(index + 1, company, index === 0 ? { has_email: false } : {}));
const calls: any[] = [];
const apolloSearch = async (input: any) => { calls.push(input); return { results: apolloDropEntries(people()), costUsd: 0 }; };
const profile = (userId: string, extended: Record<string, unknown> = {}) => ({ id: userId, full_name: `Persona ${userId}`, email: `${userId}@axis.cl`, company_name: 'AXIS',
  job_title: 'Ejecutiva comercial', signatures: { profile_extended: { valueProposition: 'AXIS consulta antecedentes laborales en el PJUD.', ...extended } } });
const seed = () => ({
  organization_members: [{ organization_id: ORG, user_id: 'u-ana', role: 'admin' }],
  profiles: [profile('u-ana', { targetRoles: 'Gerente de Personas', targetIndustries: 'retail', targetLocations: 'Chile', targetCompanySize: '51-200' })],
  enriched_leads: [{ id: 'e-0', organization_id: ORG, user_id: 'u-ana', email: 'x@lider.cl', linkedin_url: null, source_provider_id: id(4), title: 'Gerente', organization_industry: 'Retail', created_at: '2026-10-01T00:00:00Z' }],
  contacted_leads: [] as any[], lead_drops: [] as any[], lead_search_vault: [] as any[], leads: [] as any[],
});

test('Apollo\'s free search: up to 100 people, nothing spent nor kept in the vault, only people with an email and nobody the team has', async () => {
  calls.length = 0;
  const { client, tables } = memory(seed(), unique);
  // Leads Finder spent the month's budget before: a free search is not refused for it.
  const planned = await planOrganizationDrops(client, ORG, ['u-ana'], { now: TUESDAY, search: apolloSearch as any, budgetUsd: 3, spentUsd: 5 });
  assert.equal(planned.planned, 1);
  assert.equal(planned.spentUsd, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].maxResults, 100);
  assert.deepEqual(calls[0].industryKeywords, ['retail']);
  assert.deepEqual(calls[0].employeeRanges, ['51,200']);
  const [drop] = tables.lead_drops;
  assert.equal(drop.cost_usd, 0);
  assert.equal(tables.lead_search_vault.length, 0, 'Apollo\'s people have no email to keep yet');
  const [item] = drop.items;
  assert.equal(item.provider, 'apollo');
  assert.ok(![id(1), id(4)].includes(item.leadId), 'not the one without an email (Ripley), nor the one the team has (Lider)');
  assert.equal(item.hasEmail, true);
  assert.equal(item.hasPhone, false, 'the phone is not offered: it would cost 8 credits');
  assert.equal(item.name.includes('***'), true, 'the name as the search shows it, until the lookup');
  // Apollo did not say the industry, the size nor the place: the search kept to them, so the contact is within them.
  assert.equal(item.industry, 'Retail');
  assert.deepEqual(item.fit.map((entry: any) => [entry.criterion, entry.match]), [['Cargo', 'yes'], ['Rubro', 'yes'], ['Lugar', 'yes'], ['Tamaño', 'yes']]);
  assert.equal(item.fit.find((entry: any) => entry.criterion === 'Tamaño').theirs, 'Dentro de lo que buscas');
  assert.equal(item.why, 'Calza con tu cliente ideal por su cargo y su rubro (retail).');
});

test('an industry Apollo does not know by its tag is not claimed: the fit says it has no data', async () => {
  const data = seed();
  data.profiles = [profile('u-ana', { targetRoles: 'Gerente de Personas', targetIndustries: 'servicios transitorios' })];
  const { client, tables } = memory(data, unique);
  await planOrganizationDrops(client, ORG, ['u-ana'], { now: TUESDAY, search: apolloSearch as any, budgetUsd: 3, spentUsd: 0 });
  const [item] = tables.lead_drops[0].items;
  assert.equal(item.industry, null);
  assert.equal(item.fit.find((entry: any) => entry.criterion === 'Rubro').match, 'unknown');
  assert.equal(item.why, 'Calza con tu cliente ideal por su cargo.');
});

const sequence = (name: string) => ({ reply: `Le escribí a ${name}.`, question: null, suggestions: ['Sí'], blocks: [{ type: 'sequence', title: `Secuencia para ${name}`, steps: [
  { day: 1, subject: 'Ingresos en temporada alta', body: `Hola ${name},\n\nEn retail cada antecedente pendiente es un puesto vacío.\n\nAXIS consulta antecedentes laborales en el PJUD.\n\n¿Cuántos ingresos revisan al mes?\n\nPersona u-ana` },
  { day: 3, subject: 'Re: ingresos', body: `Hola ${name},\n\n¿Quién revisa hoy a quienes entran?\n\nPersona u-ana` },
  { day: 7, subject: 'Temporada alta', body: `Hola ${name},\n\nCuando la nómina llega encima de la fecha de ingreso, ¿cómo lo resuelven?\n\nPersona u-ana` },
  { day: 11, subject: 'Cierro aquí', body: `Hola ${name},\n\nEs mi último correo: ¿te sirve verlo con un caso tuyo?\n\nPersona u-ana` },
] }] });
const writerPrompts: any[] = [];
const fakeGenerate = async (options: any) => {
  if (options.prompt.includes('"companies"')) return { companies: [] };
  if (String(options.systemPrompt).startsWith('Le explicas a un vendedor')) return { contacts: [] };
  if (String(options.systemPrompt).startsWith('Eres la Revisora')) return { verdict: 'ok', issues: [] };
  const prompt = JSON.parse(options.prompt);
  writerPrompts.push(prompt);
  return sequence(prompt.brief.recipients[0]);
};

test('writing it: a first email and three follow-ups, to the first name while the surname is hidden', async () => {
  writerPrompts.length = 0;
  const { client, tables } = memory(seed(), unique);
  await planOrganizationDrops(client, ORG, ['u-ana'], { now: TUESDAY, search: apolloSearch as any, budgetUsd: 3, spentUsd: 0 });
  const written = await writeDrop(client, tables.lead_drops[0], { generate: fakeGenerate, now: TUESDAY });
  assert.equal(written.written, 1);
  const [item] = tables.lead_drops[0].items;
  assert.equal(writerPrompts[0].brief.kind, 'sequence');
  assert.equal(writerPrompts[0].brief.steps, 4);
  assert.match(writerPrompts[0].brief.recipients[0], /^Nombre\d$/, 'not «Nombre2 Ap***2»');
  assert.equal(item.draft.subject, 'Ingresos en temporada alta');
  assert.deepEqual(item.followUps.map((step: any) => [step.day, step.subject]), [[3, 'Re: ingresos'], [7, 'Temporada alta'], [11, 'Cierro aquí']]);

  // «Hoy», the email and the PDF say that seeing the email costs a credit, and carry the follow-ups.
  assert.equal((await latestDrop(client, { organizationId: ORG, userId: 'u-ana' }, TUESDAY))?.next.lookup, true);
  const email = dropEmailSection(tables.lead_drops[0].items, tables.lead_drops[0].id, 'https://app.test');
  assert.match(email.text, /Ver su correo y guardarlo usa 1 crédito\. En el PDF adjunto va [^\n]*un primer correo y tres seguimientos/);
  assert.doesNotMatch(email.html, /no gasta créditos|con su correo listo/);
  assert.match(email.html, /Nombre\d A\.</, 'the name without asterisks');
  const doc = JSON.stringify(dropDocument(tables.lead_drops[0].items, { name: 'Ana', date: '2026-10-20', link: 'https://app.test/x' }));
  assert.match(doc, /Ver su correo y guardarlo usa 1 crédito/);
  assert.match(doc, /tiene correo, que ves al enriquecerlo y guardarlo \(1 crédito\)/);
  assert.match(doc, /Si no responde: 3 seguimientos[\s\S]*Día 3 · [\s\S]*Re: ingresos[\s\S]*Día 11 · [\s\S]*Cierro aquí/);
});

test('«Enriquecer y guardar»: kept as a saved contact once, then tied to the contact the lookup put in «Por escribir»', async () => {
  const { client, tables } = memory(seed(), unique);
  await planOrganizationDrops(client, ORG, ['u-ana'], { now: TUESDAY, search: apolloSearch as any, budgetUsd: 3, spentUsd: 0 });
  await writeDrop(client, tables.lead_drops[0], { generate: fakeGenerate, now: TUESDAY });
  const drop = tables.lead_drops[0];
  drop.status = 'ready';
  const [item] = drop.items;
  const scope = { organizationId: ORG, userId: 'u-ana' };
  // Saving it for free does nothing with an Apollo contact: it has no email in the vault.
  assert.deepEqual((await saveDropLeads(client, scope, drop.id)).saved, []);
  const auth = { supabase: client, user: { id: 'u-ana' }, organizationId: ORG };
  const kept = await keepDropLead(auth, client, drop.id, item.leadId, TUESDAY);
  assert.equal(tables.leads.length, 1);
  assert.deepEqual([tables.leads[0].source_provider, tables.leads[0].source_provider_id, tables.leads[0].company, tables.leads[0].email],
    ['apollo', item.leadId, item.company, null]);
  assert.equal(kept.keptLeadId, tables.leads[0].id);
  assert.equal(tables.lead_drops[0].items[0].keptLeadId, kept.keptLeadId);
  assert.equal((await keepDropLead(auth, client, drop.id, item.leadId, TUESDAY)).keptLeadId, kept.keptLeadId, 'again: the same saved contact');
  assert.equal(tables.leads.length, 1);
  // Before the lookup found anything there is nothing to tie.
  assert.equal((await linkDropLead(client, scope, drop.id, item.leadId, TUESDAY)).linked, false);
  // The lookup (completeSavedContacts) put them in «Por escribir» with their real name.
  tables.enriched_leads.push({ id: 'e-9', organization_id: ORG, user_id: 'u-ana', email: 'n@paris.cl', full_name: 'Nombre Apellido', source_provider_id: item.leadId, data: { sourceProvider: 'apollo' } });
  const linked = await linkDropLead(client, scope, drop.id, item.leadId, TUESDAY);
  assert.equal(linked.savedLeadId, 'e-9');
  const enriched = tables.enriched_leads.find(row => row.id === 'e-9');
  assert.equal(enriched.data.sourceProvider, 'apollo', 'what the lookup kept stays');
  assert.equal(enriched.data.leadDrop.draft.subject, 'Ingresos en temporada alta');
  assert.equal(enriched.data.leadDrop.followUps.length, 3);
  assert.equal(tables.lead_drops[0].items[0].savedLeadId, 'e-9');
  assert.equal(tables.lead_drops[0].items[0].name, 'Nombre Apellido');
  assert.ok(tables.lead_drops[0].saved_at);
  await assert.rejects(keepDropLead(auth, client, drop.id, id(99)), { status: 404 }, 'only a contact of the drop');
});

test('«Hoy» offers today\'s contact though Leads Finder spent the month\'s budget: Apollo\'s search is free', async () => {
  const data = seed();
  data.lead_drops = [{ id: 'd-x', organization_id: 'org-otra', user_id: 'u-otro', drop_date: '2026-10-20', status: 'sent', criteria: {}, items: [], cost_usd: 5 }];
  assert.equal(await pullStatus(memory(data, unique).client, { organizationId: ORG, userId: 'u-ana' }, THURSDAY), 'first');
});
