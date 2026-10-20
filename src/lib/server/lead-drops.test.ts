import assert from 'node:assert/strict';
import test from 'node:test';

import { deliverDailyAlert } from './daily-alerts';
import { memory } from './goals-alerts-test-fixtures';
import { dropPdf, latestDrop, pdfSafe, planOrganizationDrops, saveDropLeads, writeDrop } from './lead-drops';
import { splitLeadsFinderItems } from './leads-finder/client';

const ORG = 'org-1';
const TUESDAY = new Date('2026-10-20T10:00:00.000Z'); // 07:00 in Chile
const actorItem = (n: number, company: string, extra: Record<string, unknown> = {}) => ({
  first_name: `Nombre${n}`, last_name: `Apellido${n}`, full_name: `Nombre${n} Apellido${n}`, email: `p${n}@${company.toLowerCase()}.cl`,
  job_title: 'Gerente de Personas', company_name: company, company_domain: `${company.toLowerCase()}.cl`, industry: 'Retail', company_size: '500',
  city: 'Santiago', linkedin: `linkedin.com/in/p${n}`, company_description: `${company} vende productos para el hogar en Chile.`, ...extra,
});
const POOL = ['Ripley', 'Falabella', 'Paris', 'Lider', 'Tottus', 'Unimarc', 'Jumbo', 'Hites', 'Abcdin', 'Easy', 'Sodimac', 'Corona'];
const searchCalls: any[] = [];
const fakeSearch = async (input: any) => {
  searchCalls.push(input);
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

test('saving puts the contacts in «Por escribir» with their email, once, and the vault forgets them', async () => {
  const { client, tables } = memory(seed(), { unique: { lead_drops: ['organization_id', 'user_id', 'drop_date'] } });
  await planOrganizationDrops(client, ORG, ['u-ana'], { now: TUESDAY, search: fakeSearch as any, budgetUsd: 3, spentUsd: 0 });
  await writeDrop(client, tables.lead_drops[0], { generate: fakeGenerate, now: TUESDAY });
  const scope = { organizationId: ORG, userId: 'u-ana' };
  const drop = tables.lead_drops[0];
  await assert.rejects(saveDropLeads(client, { organizationId: ORG, userId: 'u-leo' }, drop.id), { status: 404 }, 'never another person\'s drop');
  const first = drop.items[0].leadId;
  const one = await saveDropLeads(client, scope, drop.id, [first]);
  assert.equal(one.saved.length, 1);
  const row = tables.enriched_leads.find(lead => lead.id === one.saved[0].savedLeadId);
  assert.ok(row.email && row.email.endsWith('.cl'));
  assert.equal(row.source_provider, 'leads_finder');
  assert.equal(row.data.leadDrop.dropId, drop.id);
  assert.equal(row.data.leadDrop.draft.subject, 'Ingresos en temporada alta');
  assert.equal(tables.lead_search_vault.length, drop.items.length - 1);
  assert.deepEqual(await latestDrop(client, scope, TUESDAY), { id: drop.id, dropDate: '2026-10-20', total: drop.items.length, left: drop.items.length - 1 });
  const rest = await saveDropLeads(client, scope, drop.id);
  assert.equal(rest.saved.length, drop.items.length - 1);
  assert.equal(await latestDrop(client, scope, TUESDAY), null, 'nothing left to save');
  assert.equal(tables.lead_search_vault.length, 0);
});

test('the morning alert carries the ready drop, with its PDF, and marks it sent', async () => {
  const data = seed();
  const { client, tables } = memory(data, { unique: { lead_drops: ['organization_id', 'user_id', 'drop_date'], daily_alerts: ['organization_id', 'user_id', 'alert_date'] } });
  await planOrganizationDrops(client, ORG, ['u-ana'], { now: TUESDAY, search: fakeSearch as any, budgetUsd: 3, spentUsd: 0 });
  await writeDrop(client, tables.lead_drops[0], { generate: fakeGenerate, now: TUESDAY });
  const sent: any[] = [];
  const outcome = await deliverDailyAlert(client, { organizationId: ORG, userId: 'u-ana' }, {
    send: async (input: any) => { sent.push(input); return { ok: true as const }; }, appUrl: 'https://app.antonia.ai', now: new Date('2026-10-20T11:30:00.000Z'),
    opportunities: 'none', goalReminders: false,
  });
  assert.deepEqual(outcome, { status: 'sent' });
  assert.equal(sent[0].subject, `${tables.lead_drops[0].items.length} contactos nuevos para ti`);
  assert.match(sent[0].html, /Contactos de la semana/);
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
