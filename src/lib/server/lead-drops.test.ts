import assert from 'node:assert/strict';
import test from 'node:test';

import { deliverDailyAlert } from './daily-alerts';
import { memory } from './goals-alerts-test-fixtures';
import { dropDocument, dropPdf, homeDrop, latestDrop, planOrganizationDrops, pullDrop, pullStatus, saveDropLeads, writeDrop } from './lead-drops';
import { splitLeadsFinderItems } from './leads-finder/client';

const ORG = 'org-1';
const TUESDAY = new Date('2026-10-20T10:00:00.000Z'); // 07:00 in Chile
const WEDNESDAY_MORNING = new Date('2026-10-21T10:00:00.000Z');
const actorItem = (n: number, company: string, extra: Record<string, unknown> = {}) => ({
  first_name: `Nombre${n}`, last_name: `Apellido${n}`, full_name: `Nombre${n} Apellido${n}`, email: `p${n}@${company.toLowerCase()}.cl`,
  job_title: 'Gerente de Personas', company_name: company, company_domain: `${company.toLowerCase()}.cl`, industry: 'Retail', company_size: '500',
  city: 'Santiago', state: 'Santiago Metropolitan Region', country: 'Chile', seniority_level: 'manager', functional_level: 'human_resources',
  company_website: `www.${company.toLowerCase()}.cl`, company_linkedin: `linkedin.com/company/${company.toLowerCase()}`,
  linkedin: `linkedin.com/in/p${n}`, company_description: `${company} vende productos para el hogar en Chile.`, ...extra,
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
const adviceCalls: any[] = [];
const fakeGenerate = async (options: any) => {
  if (options.prompt.includes('"companies"')) return { companies: JSON.parse(options.prompt).companies.map((item: any) => ({ leadId: item.leadId, about: `${item.company} vende productos para el hogar.` })) };
  if (String(options.systemPrompt).startsWith('Le explicas a un vendedor')) {
    adviceCalls.push(JSON.parse(options.prompt));
    return { contacts: JSON.parse(options.prompt).contacts.map((item: any) => ({ leadId: item.leadId,
      reasons: [`- ${item.firstName} decide cómo se revisa a quien entra en ${item.company}: AXIS lo hace en el PJUD.`, 'Baja la rotación un 30%.', 'Una razón larga. '.repeat(20), `Con ${item.employees} personas, cada ingreso cuenta.`],
      approach: 'Pregúntale cuántos ingresos revisan al mes.' })) };
  }
  if (String(options.systemPrompt).startsWith('Eres la Revisora')) return { verdict: 'ok', issues: [] };
  const name = JSON.parse(options.prompt).brief.recipients[0];
  return writerDraft(name);
};

test('one search for people with the same customer; each gets different contacts and nobody the team has', async () => {
  searchCalls.length = 0;
  const { client, tables } = memory(seed(), { unique: { lead_drops: ['organization_id', 'user_id', 'drop_date'] } });
  const planned = await planOrganizationDrops(client, ORG, ['u-ana', 'u-leo', 'u-sin'], { now: TUESDAY, search: fakeSearch as any, budgetUsd: 3, spentUsd: 0, usdPerLead: 0.0035 });
  assert.equal(searchCalls.length, 1, 'Leo and Sin, without a customer of their own, take the team\'s, which is Ana\'s');
  assert.deepEqual(searchCalls[0].titles, ['Gerente de Personas']);
  assert.equal(planned.planned, 3);
  const drops = tables.lead_drops;
  const ids = drops.flatMap(drop => drop.items.map((item: any) => item.leadId));
  assert.equal(new Set(ids).size, ids.length, 'nobody twice');
  assert.ok(!drops.some(drop => drop.items.some((item: any) => item.company === 'Paris')), 'the team already has the one at Paris');
  assert.deepEqual(drops.map(drop => [drop.user_id, drop.status, drop.criteria.source]), [['u-ana', 'pending', 'perfil'], ['u-leo', 'pending', 'equipo'], ['u-sin', 'pending', 'equipo']]);
  assert.match(drops[0].items[0].why, /^Calza con tu cliente ideal por su cargo/, 'Ana\'s own');
  assert.ok(drops.slice(1).every(drop => /^Calza con el cliente ideal de tu equipo por su cargo/.test(drop.items[0].why)), 'the team\'s, for whoever has none');
  assert.ok(drops.every(drop => drop.items.every((item: any) => !('email' in item) && item.hasEmail)), 'the email stays in the vault');
  assert.equal(tables.lead_search_vault.length, ids.length);
  assert.match(tables.lead_search_vault[0].contact_encrypted, /^enc:v1\./);
  // A second run the same morning finds the drops and plans nothing again.
  await planOrganizationDrops(client, ORG, ['u-ana'], { now: TUESDAY, search: fakeSearch as any, budgetUsd: 3, spentUsd: 0, usdPerLead: 0.0035 });
  assert.equal(tables.lead_drops.length, 3);
});

test('similar customers share a search; a different one gets its own, and the ficha is for whoever declared none (29 oct)', async () => {
  searchCalls.length = 0;
  const own = () => ({ ...seed(), profiles: [profile('u-ana', { targetRoles: 'Gerente de Personas', targetIndustries: 'retail' }),
    profile('u-leo', { targetRoles: 'Jefe de Operaciones', targetIndustries: 'logística' }), profile('u-sin', { targetRoles: 'Jefes de operaciones, Gerente de Operaciones', targetIndustries: 'Logística' })] });
  const first = memory(own(), { unique: { lead_drops: ['organization_id', 'user_id', 'drop_date'] } });
  await planOrganizationDrops(first.client, ORG, ['u-ana', 'u-leo', 'u-sin'], { now: TUESDAY, search: fakeSearch as any, budgetUsd: 3, spentUsd: 0, usdPerLead: 0.0035 });
  assert.equal(searchCalls.length, 2, 'Leo and Sin look for the same people, Ana for others');
  assert.deepEqual(searchCalls[0].titles, ['Jefe de Operaciones', 'Gerente de Operaciones'], 'the larger group first, with the titles of both');
  assert.deepEqual(searchCalls[1].titles, ['Gerente de Personas']);
  assert.ok(first.tables.lead_drops.every(drop => drop.status === 'pending' && drop.criteria.source === 'perfil'));
  assert.deepEqual(first.tables.lead_drops.find(drop => drop.user_id === 'u-sin').criteria.titles, ['Jefes de operaciones', 'Gerente de Operaciones'], 'each keeps their own customer');

  searchCalls.length = 0;
  const withFicha = memory({ ...own(), profiles: [...own().profiles.slice(0, 2), profile('u-sin')],
    organization_company_profile: [{ organization_id: ORG, fields: { services: 'AXIS: consultas judiciales', targetRoles: 'Jefe de Seguridad', targetIndustries: 'minería' } }] },
  { unique: { lead_drops: ['organization_id', 'user_id', 'drop_date'] } });
  await planOrganizationDrops(withFicha.client, ORG, ['u-ana', 'u-leo', 'u-sin'], { now: TUESDAY, search: fakeSearch as any, budgetUsd: 3, spentUsd: 0, usdPerLead: 0.0035 });
  assert.equal(searchCalls.length, 3);
  assert.ok(searchCalls.some(call => call.titles[0] === 'Jefe de Seguridad'));
  const sin = withFicha.tables.lead_drops.find(drop => drop.user_id === 'u-sin');
  assert.equal(sin.criteria.source, 'empresa');
  assert.match(sin.items[0].why, /^Calza con el cliente ideal de tu empresa/);
});

test('at most LEAD_DROPS_MAX_GROUPS searches: past that, a group joins the one most like it', async () => {
  searchCalls.length = 0;
  const previous = process.env.LEAD_DROPS_MAX_GROUPS;
  process.env.LEAD_DROPS_MAX_GROUPS = '1';
  try {
    const data = { ...seed(), profiles: [profile('u-ana', { targetRoles: 'Gerente de Personas', targetIndustries: 'retail' }),
      profile('u-leo', { targetRoles: 'Jefe de Operaciones', targetIndustries: 'logística' }), profile('u-sin', { targetRoles: 'Jefe de Operaciones', targetIndustries: 'logística' })] };
    const { client, tables } = memory(data, { unique: { lead_drops: ['organization_id', 'user_id', 'drop_date'] } });
    await planOrganizationDrops(client, ORG, ['u-ana', 'u-leo', 'u-sin'], { now: TUESDAY, search: fakeSearch as any, budgetUsd: 3, spentUsd: 0, usdPerLead: 0.0035 });
    assert.equal(searchCalls.length, 1);
    assert.deepEqual(searchCalls[0].titles, ['Jefe de Operaciones']);
    assert.equal(tables.lead_drops.filter(drop => drop.status === 'pending').length, 3, 'Ana still gets a contact, from that search');
    assert.equal(tables.lead_drops.find(drop => drop.user_id === 'u-ana').criteria.titles[0], 'Gerente de Personas');
  } finally {
    if (previous === undefined) delete process.env.LEAD_DROPS_MAX_GROUPS; else process.env.LEAD_DROPS_MAX_GROUPS = previous;
  }
});

test('the title, the company and the industry as people say them: linking words in lower case, «S.A.», the industry in Spanish', async () => {
  const { client, tables } = memory(seed(), { unique: { lead_drops: ['organization_id', 'user_id', 'drop_date'] } });
  const person = actorItem(1, 'Rutas', { job_title: 'Jefe De Reclutamiento Y Selección', industry: 'logistics & supply chain', company_name: 'Rutas S.a.' });
  const search = async () => ({ results: splitLeadsFinderItems([person], ['validated']), fetched: 1, notApplied: [], costUsd: 0.01 });
  await planOrganizationDrops(client, ORG, ['u-ana'], { now: TUESDAY, search: search as any, budgetUsd: 3, spentUsd: 0, usdPerLead: 0.0035 });
  const [item] = tables.lead_drops[0].items;
  assert.deepEqual([item.title, item.company, item.industry], ['Jefe de Reclutamiento y Selección', 'Rutas S.A.', 'Logística']);
  assert.equal(item.why, 'Calza con tu cliente ideal por su cargo y su rubro (logística), en Santiago.', 'what matched, with the industry in Spanish, not the role again');
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
  assert.match(saved.items[0].summary, /vende productos para el hogar\.$/);
});

test('planning keeps who the person is and how they fit; the reasons connect them with what the person sells, and only with an offer', async () => {
  const { client, tables } = memory(seed(), { unique: { lead_drops: ['organization_id', 'user_id', 'drop_date'] } });
  await planOrganizationDrops(client, ORG, ['u-ana'], { now: TUESDAY, search: fakeSearch as any, budgetUsd: 3, spentUsd: 0 });
  const [item] = tables.lead_drops[0].items;
  assert.deepEqual([item.seniority, item.department, item.state, item.country], ['Gerencia o jefatura', 'Recursos humanos', 'Santiago Metropolitan Region', 'Chile']);
  assert.equal(item.website, `https://www.${item.domain}/`);
  assert.equal(item.companyLinkedin, `https://linkedin.com/company/${item.domain.replace('.cl', '')}`);
  assert.ok(!JSON.stringify(item).includes('linkedin.com/in/'), 'the person\'s LinkedIn stays in the vault');
  assert.deepEqual(item.fit.map((entry: any) => [entry.criterion, entry.match]), [['Cargo', 'yes'], ['Rubro', 'yes'], ['Lugar', 'yes']]);

  // The person's offer is read as Cowork reads it, which takes a real user id.
  const ANA_ID = '00000000-0000-4000-8000-00000000a0a0';
  const withId = (data: ReturnType<typeof seed>) => JSON.parse(JSON.stringify(data).replaceAll('u-ana', ANA_ID)) as ReturnType<typeof seed>;
  const advised = memory(withId(seed()), { unique: { lead_drops: ['organization_id', 'user_id', 'drop_date'] } });
  await planOrganizationDrops(advised.client, ORG, [ANA_ID], { now: TUESDAY, search: fakeSearch as any, budgetUsd: 3, spentUsd: 0 });
  adviceCalls.length = 0;
  await writeDrop(advised.client, advised.tables.lead_drops[0], { generate: fakeGenerate, now: TUESDAY });
  const [ready] = advised.tables.lead_drops[0].items;
  assert.equal(adviceCalls.length, 1);
  assert.equal(adviceCalls[0].seller.offer, 'AXIS consulta antecedentes laborales en el PJUD.');
  assert.deepEqual(adviceCalls[0].contacts[0].fit, ['Cargo: Sí', 'Rubro: Sí', 'Lugar: Sí']);
  assert.ok(!JSON.stringify(adviceCalls[0]).includes('@'), 'never the email');
  assert.deepEqual(ready.reasons, [`${ready.name.split(' ')[0]} decide cómo se revisa a quien entra en ${ready.company}: AXIS lo hace en el PJUD.`,
    'Con 500 personas, cada ingreso cuenta.'], 'a figure that is not in the data («30%») is left out, one too long to read at a glance too, and the bullet the model wrote');
  assert.equal(ready.approach, 'Pregúntale cuántos ingresos revisan al mes.');
  assert.ok(ready.draft, 'the first email too');
  // Without an offer there is nothing to connect: no reasons are asked for.
  const data = withId(seed());
  data.profiles = data.profiles.map(row => ({ ...row, signatures: { profile_extended: { ...row.signatures.profile_extended, valueProposition: '' } } }));
  const quiet = memory(data, { unique: { lead_drops: ['organization_id', 'user_id', 'drop_date'] } });
  await planOrganizationDrops(quiet.client, ORG, [ANA_ID], { now: TUESDAY, search: fakeSearch as any, budgetUsd: 3, spentUsd: 0 });
  adviceCalls.length = 0;
  await writeDrop(quiet.client, quiet.tables.lead_drops[0], { generate: fakeGenerate, now: TUESDAY });
  assert.equal(adviceCalls.length, 0);
  assert.equal(quiet.tables.lead_drops[0].items[0].reasons, undefined);
});

test('saving puts the contact in «Por escribir» with its email, once, and the vault forgets it', async () => {
  const { client, tables } = memory(seed(), { unique: { lead_drops: ['organization_id', 'user_id', 'drop_date'] } });
  await planOrganizationDrops(client, ORG, ['u-ana'], { now: TUESDAY, search: fakeSearch as any, budgetUsd: 3, spentUsd: 0 });
  await writeDrop(client, tables.lead_drops[0], { generate: fakeGenerate, now: TUESDAY });
  const scope = { organizationId: ORG, userId: 'u-ana' };
  const drop = tables.lead_drops[0];
  assert.equal(drop.items.length, 1, 'one contact a day');
  await assert.rejects(saveDropLeads(client, { organizationId: ORG, userId: 'u-leo' }, drop.id, undefined, { now: TUESDAY }), { status: 404 }, 'never another person\'s drop');
  const { name, company, why } = drop.items[0];
  assert.deepEqual(await latestDrop(client, scope, TUESDAY), { id: drop.id, dropDate: '2026-10-20', total: 1, left: 1, next: { name, company, why } });
  const saved = await saveDropLeads(client, scope, drop.id, [drop.items[0].leadId], { now: TUESDAY });
  assert.equal(saved.saved.length, 1);
  const row = tables.enriched_leads.find(lead => lead.id === saved.saved[0].savedLeadId);
  assert.ok(row.email && row.email.endsWith('.cl'));
  assert.equal(row.source_provider, 'leads_finder');
  assert.equal(row.data.leadDrop.dropId, drop.id);
  assert.equal(row.data.leadDrop.draft.subject, 'Ingresos en temporada alta');
  assert.equal(tables.lead_search_vault.length, 0);
  assert.equal(await latestDrop(client, scope, TUESDAY), null, 'nothing left to save');
  assert.equal((await saveDropLeads(client, scope, drop.id, undefined, { now: TUESDAY })).saved.length, 0, 'saving again saves nobody twice');
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

test('the PDF: who, why, what we know and the first email, with the link as a button and the day in Spanish', async () => {
  const item = { leadId: 'lf_1', name: 'Ana Pérez', title: 'Gerente', company: 'Ripley', domain: null, industry: null, size: null, city: null,
    hasEmail: true, hasPhone: false, why: 'Calza.', research: ['Vende ropa.'], draft: { subject: 'Hola', body: 'Hola Ana,\n\n¿Cuántos?\n\nSaludos,\nLeo' } };
  const meta = { name: 'Ana', date: '2026-10-20', link: 'https://app.antonia.ai/x' };
  const spec = dropDocument([item], meta);
  assert.equal(spec.title, 'Ana Pérez');
  assert.equal(spec.subtitle, 'Gerente · Ripley');
  assert.deepEqual(spec.meta, [{ label: 'Para', value: 'Ana' }, { label: 'Fecha', value: '20 de octubre de 2026' }]);
  assert.deepEqual((spec.blocks[0] as any).runs[0], { text: 'Ver y guardar en ANTON.IA', href: 'https://app.antonia.ai/x', bold: true }, 'a link, not the bare address');
  const mail = spec.blocks.at(-1) as any;
  assert.equal(mail.type, 'callout');
  assert.equal(mail.runs.map((run: any) => run.text).join(''), 'Asunto: Hola\n\nHola Ana,\n\n¿Cuántos?\n\nSaludos,\nLeo', 'the subject in its own case and the signature together');
  assert.equal(dropDocument([item, { ...item, leadId: 'lf_2', name: 'Leo Rojas' }], meta).blocks.filter(block => block.type === 'pageBreak').length, 1, 'each contact on its own page');
  const pdf = await dropPdf([item], meta);
  assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
  const plain = (block: any) => (block.runs || []).map((run: any) => run.text).join('');
  assert.deepEqual(spec.blocks.filter(block => block.type === 'heading').map(plain), ['Lo que sabemos de la empresa', 'Primer correo sugerido'], 'a drop from before: what it has');

  // Since 29 Oct 2026: the reasons, the fit, the person, the company, how to open.
  const full = { ...item, company: 'Ripley S.A.', industry: 'Retail', size: 500, city: 'Santiago', country: 'Chile', seniority: 'Gerencia o jefatura', department: 'Recursos humanos',
    website: 'https://www.ripley.cl/', companyLinkedin: 'https://linkedin.com/company/ripley', summary: 'Ripley vende ropa y artículos para el hogar.', hasPhone: true,
    fit: [{ criterion: 'Cargo' as const, theirs: 'Gerente', wanted: 'Gerente de Personas', match: 'partial' as const }, { criterion: 'Lugar' as const, theirs: 'Santiago, Chile', wanted: 'Chile', match: 'yes' as const }],
    reasons: ['Decide cómo se revisa a quien entra.', 'Ripley contrata mucho en temporada.'], approach: 'Pregúntale por la temporada alta.' };
  const blocks = dropDocument([full], meta).blocks as any[];
  assert.deepEqual(blocks.filter(block => block.type === 'heading').map(plain), ['Cómo calza con tu cliente ideal', 'Sobre la persona', 'Sobre Ripley', 'Cómo abordarlo', 'Primer correo sugerido']);
  assert.equal(plain(blocks[1]), 'Calza.\n\n- Decide cómo se revisa a quien entra.\n- Ripley contrata mucho en temporada.');
  assert.deepEqual(blocks.find(block => block.type === 'table').rows.map((row: any[]) => row.map(cell => plain({ runs: cell }))),
    [['Cargo', 'Gerente', 'Gerente de Personas', 'En parte'], ['Lugar', 'Santiago, Chile', 'Chile', 'Sí']]);
  assert.deepEqual(blocks.find(block => block.type === 'list').items.map(plain), ['Nivel: Gerencia o jefatura', 'Área: Recursos humanos',
    'Datos de contacto: correo verificado y teléfono móvil, que ves al guardarlo'], 'the place is in the table already');
  const facts = blocks[blocks.findIndex(block => plain(block) === 'Sobre Ripley') + 2];
  assert.equal(plain(facts), 'Retail  ·  500 personas  ·  ripley.cl  ·  LinkedIn de la empresa');
  assert.deepEqual(facts.runs.filter((run: any) => run.href).map((run: any) => run.href), ['https://www.ripley.cl/', 'https://linkedin.com/company/ripley']);
  assert.equal(blocks.at(-1).type, 'callout', 'the email last');
  assert.equal((await dropPdf([full], meta)).subarray(0, 4).toString(), '%PDF');
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

test('whoever left the last six unopened rests two weeks from the last one, then gets one more (audit B3)', async () => {
  const { restingFromDrops } = await import('./lead-drops');
  const sent = (dates: string[], opened: string[] = []) => dates.map(drop_date => ({ drop_date, opened_at: opened.includes(drop_date) ? `${drop_date}T12:00:00Z` : null, saved_at: null }));
  const six = ['2026-10-14', '2026-10-16', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-28'];
  assert.equal(restingFromDrops(sent(six), '2026-10-29'), true);
  assert.equal(restingFromDrops(sent(six, ['2026-10-16']), '2026-10-29'), false, 'one opened is enough');
  assert.equal(restingFromDrops(sent(six.slice(1)), '2026-10-29'), false, 'five are not two weeks');
  assert.equal(restingFromDrops(sent(six), '2026-11-11'), false, 'after two weeks of rest, one more goes');
  assert.equal(restingFromDrops([...sent(six), { drop_date: '2026-10-30', opened_at: null, saved_at: '2026-10-30T13:00:00Z' }], '2026-11-03'), false, 'saving counts as opening');
});
