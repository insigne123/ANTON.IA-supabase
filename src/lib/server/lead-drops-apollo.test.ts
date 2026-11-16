import assert from 'node:assert/strict';
import test from 'node:test';

import { dropEmailSection } from '@/lib/lead-drops';
import { memory } from './goals-alerts-test-fixtures';
import { apolloDropEntries, dropDocument, keepDropLead, latestDrop, linkDropLead, planOrganizationDrops, pullStatus, saveDropLeads, writeDrop } from './lead-drops';
import { clearTitleAiCache } from './search/title-ai';

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

test('the emails of a recommended contact come from the drops\' own writer, with what the profile says may be named; when it fails, from Cowork\'s Writer as before', async () => {
  const ANA = '00000000-0000-4000-8000-00000000000a';
  const world = () => memory({ ...seed(), organization_members: [{ organization_id: ORG, user_id: ANA, role: 'admin' }],
    profiles: [{ ...profile(ANA, { targetRoles: 'Gerente de Personas', targetIndustries: 'retail', targetLocations: 'Chile', proofPoints: 'Más de 200 empresas atendidas',
      referenceClients: 'Tiendas Ejemplo, Logística Sur', painPoints: 'Revisar antecedentes uno por uno' }), full_name: 'Ana Pérez' }] }, unique);
  const email = (subject: string, text: string, ask: string) => ({ subject, body: `Hola {{nombre}},\n\n${text}\n\n${ask}` });
  const four = [
    { day: 1, ...email('Ingresos de fin de año', 'Te escribo porque llevas las personas de una cadena de tiendas y en AXIS revisamos los antecedentes laborales de quienes ingresan, con más de 200 empresas atendidas hasta hoy.', '¿Te interesa que te cuente cómo lo hacemos?') },
    { day: 3, ...email('Antecedentes en lote', 'Te escribí hace unos días por los ingresos. También revisamos un grupo completo de una vez, antes de su primer día.', '¿Te sirve un resumen de una página?') },
    { day: 7, ...email('Respaldo de cada consulta', 'Cada consulta que hacemos queda con su respaldo, para cuando alguien pregunta cómo se revisó a una persona que ya entró a trabajar.', '¿Lo vemos en una llamada de 15 minutos?') },
    { day: 11, ...email('Con quién hablar', 'Este es el último correo que te mando sobre esto.', '¿Es otra persona quien ve los ingresos, para escribirle a ella?') },
  ];
  const read: any[] = [];
  const own = async (options: any) => {
    if (options.prompt.includes('"companies"')) return { companies: [] };
    if (String(options.systemPrompt).startsWith('Le explicas a un vendedor')) return { contacts: [] };
    const prompt = JSON.parse(options.prompt);
    if (!prompt.vendedor) throw new Error('Cowork\'s Writer is not asked when the drops\' writer answers');
    read.push({ prompt, model: options.openAiModel });
    return { emails: four };
  };
  const first = world();
  await planOrganizationDrops(first.client, ORG, [ANA], { now: TUESDAY, search: apolloSearch as any, budgetUsd: 3, spentUsd: 0 });
  assert.equal((await writeDrop(first.client, first.tables.lead_drops[0], { generate: own, now: TUESDAY })).written, 1);
  const [item] = first.tables.lead_drops[0].items;
  assert.equal(read.length, 1);
  assert.equal(read[0].model, 'claude-haiku-5-5');
  assert.deepEqual([read[0].prompt.vendedor.nombre, read[0].prompt.vendedor.clientes_que_puede_nombrar, read[0].prompt.vendedor.problemas_que_resuelve],
    ['Ana Pérez', ['Tiendas Ejemplo', 'Logística Sur'], ['Revisar antecedentes uno por uno']]);
  assert.equal(item.draft.subject, 'Ingresos de fin de año');
  assert.match(item.draft.body, /^Hola \{\{nombre\}\},[\s\S]*¿Te interesa que te cuente cómo lo hacemos\?\n\nSaludos,\nAna Pérez$/);
  assert.deepEqual(item.followUps.map((step: any) => [step.day, step.subject]), [[3, 'Antecedentes en lote'], [7, 'Respaldo de cada consulta'], [11, 'Con quién hablar']]);

  // The drops' writer down: the contact still gets its emails, from Cowork's Writer.
  const second = world();
  writerPrompts.length = 0;
  const down = async (options: any) => { if (options.prompt.includes('"vendedor"') && !options.prompt.includes('"brief"')) throw new Error('down'); return fakeGenerate(options); };
  await planOrganizationDrops(second.client, ORG, [ANA], { now: TUESDAY, search: apolloSearch as any, budgetUsd: 3, spentUsd: 0 });
  assert.equal((await writeDrop(second.client, second.tables.lead_drops[0], { generate: down, now: TUESDAY })).written, 1);
  assert.equal(second.tables.lead_drops[0].items[0].draft.subject, 'Ingresos en temporada alta');
  assert.equal(writerPrompts[0].brief.kind, 'sequence');
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

test('a team with six contacts a day: the customer asked three ways, every candidate scored for what the team sells, and two slots for roles next to the customer\'s', async () => {
  clearTitleAiCache();
  const searches: any[] = [];
  const at = (n: number, title: string, company: string, extra: Record<string, unknown> = {}) => person(n, company, { title, ...extra });
  const finderSearch = async (input: any) => {
    searches.push(input);
    // The heads of the customer's companies (lead-drop-accounts.ts): these people come without a company site, so none is kept.
    if (!input.titles.length) return { results: [], costUsd: 0 };
    const asked = input.titles.join('|');
    const found = asked === 'Gerente de Personas'
      ? input.industryKeywords.length
        ? [at(1, 'Gerente de Personas', 'Ripley'), at(2, 'Gerente de Personas', 'Falabella'), at(3, 'Gerente de Personas', 'Paris'), at(4, 'Gerente de Personas', 'Lider'),
          at(5, 'Diseñador Gráfico', 'Tottus'), at(6, 'Gerente de Operaciones', 'Jumbo'), at(7, 'Gerente de Personas', 'Hites', { has_email: false })]
        : [at(12, 'Gerente de Personas', 'Sodimac'), at(1, 'Gerente de Personas', 'Ripley')]
      : asked.includes('HR Manager') ? [at(8, 'HR Manager', 'Easy'), at(9, 'Head of People', 'Corona')]
        : [at(10, 'Jefe de Relaciones Laborales', 'Unimarc'), at(11, 'Subgerente de Personas', 'Abcdin')];
    return { results: apolloDropEntries(found), costUsd: 0 };
  };
  const classes: Record<string, string> = { 'HR Manager': 'exact', 'Head of People': 'similar', 'Gerente de Operaciones': 'related', 'Jefe de Relaciones Laborales': 'related', 'Subgerente de Personas': 'similar' };
  const notes: Record<string, [number, number]> = { Ripley: [10, 10], Falabella: [10, 8], Paris: [10, 6], Easy: [10, 9], Corona: [8, 8], Abcdin: [6, 6], Sodimac: [10, 4], Jumbo: [6, 10], Unimarc: [4, 8] };
  const scoring: any[] = [];
  const generate = async (options: any) => {
    const prompt = JSON.parse(options.prompt);
    if (prompt.cargoBuscado) return { titles: prompt.cargos.map((entry: any) => ({ i: entry.i, match: classes[entry.cargo] ?? 'none' })) };
    if (prompt.personas) { scoring.push(prompt); return { people: prompt.personas.flatMap((entry: any) => notes[entry.empresa] ? [{ i: entry.i, cargo: notes[entry.empresa][0], empresa: notes[entry.empresa][1] }] : []) }; }
    return { titles: prompt.cargos.map((entry: any) => ({ i: entry.i, variants: ['HR Manager', 'Gerenta de Personas'], keywords: ['personas', 'rrhh'] })) };
  };
  // What the person sells is read as Cowork reads it, which takes a real user id.
  const ANA = '00000000-0000-4000-8000-00000000000a';
  const earlier = { organization_id: ORG, user_id: ANA, drop_date: '2026-10-16', status: 'sent', criteria: {}, items: [
    { leadId: id(40), name: 'Antes', title: 'Gerente de Personas', industry: 'Retail', savedLeadId: 's-1' },
    { leadId: id(41), name: 'Antes', title: 'Jefe de Bodega', industry: 'Logística', feedback: { useful: false, reason: 'no decide', at: '2026-10-16T12:00:00Z' } },
  ] };
  const base = seed();
  const { client, tables } = memory({ ...base, organization_members: [{ organization_id: ORG, user_id: ANA, role: 'admin' }], profiles: [{ ...base.profiles[0], id: ANA }], lead_drops: [earlier] }, unique);
  const planned = await planOrganizationDrops(client, ORG, [ANA], { now: TUESDAY, search: finderSearch as any, budgetUsd: 3, spentUsd: 0, generate: generate as any,
    plan: { size: 6, weekdays: [1, 2, 3, 4, 5] } });
  assert.equal(planned.planned, 1);
  assert.deepEqual(searches.map(call => [call.titles.join('|'), call.maxResults, call.includeSimilarTitles, call.industryKeywords.length > 0]), [
    ['Gerente de Personas', 400, true, true],
    ['HR Manager|Gerenta de Personas', 100, true, true],
    ['personas|rrhh', 100, false, true],
    ['', 300, false, true],
    ['Gerente de Personas', 400, true, false],
  ], 'the customer\'s roles (a hundred further down Apollo\'s list than the base, for the few people the team has), the ways people write them, the words of their area, the heads of its companies and, with few new people, the titles and places only');
  const drop = tables.lead_drops.find((row: any) => row.drop_date === '2026-10-20');
  assert.deepEqual(drop.items.map((item: any) => [item.company, item.title, item.track ?? 'core']), [
    ['Ripley', 'Gerente de Personas', 'core'], ['Easy', 'HR Manager', 'core'], ['Falabella', 'Gerente de Personas', 'core'], ['Paris', 'Gerente de Personas', 'core'],
    ['Jumbo', 'Gerente de Operaciones', 'explore'], ['Unimarc', 'Jefe de Relaciones Laborales', 'explore'],
  ], 'the best four of the customer\'s roles, then the two best of the roles next to them; not the designer, nor Lider (the team has it), nor Hites (no email)');
  const byCompany = (company: string) => drop.items.find((item: any) => item.company === company);
  assert.equal(byCompany('Easy').fit.find((entry: any) => entry.criterion === 'Cargo').match, 'yes', '«HR Manager» is the role asked, whatever its words');
  assert.equal(byCompany('Jumbo').fit.find((entry: any) => entry.criterion === 'Cargo').match, 'partial');
  assert.match(byCompany('Jumbo').why, /^Su cargo es vecino a los que buscas/);
  assert.match(byCompany('Ripley').why, /^Calza con tu cliente ideal por su cargo/);
  // What the team sells and what it did with earlier contacts reach the score.
  assert.equal(scoring.length, 1);
  assert.equal(scoring[0].vendedor.oferta, 'AXIS consulta antecedentes laborales en el PJUD.');
  assert.deepEqual(scoring[0].aprendizaje, { le_sirvieron: ['Gerente de Personas · Retail'], descarto: ['Jefe de Bodega · Logística (no decide)'] });
  assert.ok(!scoring[0].personas.some((entry: any) => ['Lider', 'Hites'].includes(entry.empresa)), 'nobody the team has or without an email is scored');
});

test('by company: the customer\'s companies found through their heads, each scored once, the best opened to bring their people, and what ran out remembered', async () => {
  clearTitleAiCache();
  const searches: any[] = [];
  const at = (n: number, title: string, company: string, domain: string, extra: Record<string, unknown> = {}) =>
    person(n, company, { title, organization: { name: company, primary_domain: domain, short_description: `${company} opera tiendas en Chile.` }, ...extra });
  const search = async (input: any) => {
    searches.push(input);
    const domains: string[] = input.organizationDomains || [];
    // A company opened: everyone there, whatever the title.
    if (domains.length === 1 && !input.titles.length) {
      return { results: apolloDropEntries(domains[0] === 'paris.example' ? [at(20, 'Jefe de Personas', 'Paris', 'paris.example'), at(21, 'Analista de Personas', 'Paris', 'paris.example'), at(22, 'Cajero', 'Paris', 'paris.example')]
        : domains[0] === 'ripley.example' ? [at(1, 'Gerente de Personas', 'Ripley', 'ripley.example'), at(23, 'Coordinadora de Personas', 'Ripley', 'ripley.example')] : []), costUsd: 0 };
    }
    // The customer's roles across the companies opened.
    if (domains.length > 1) return { results: apolloDropEntries([at(2, 'Gerente de Personas', 'Falabella', 'falabella.example')]), costUsd: 0 };
    // Their heads: one a company, a supplier among them.
    if (!input.titles.length) return { results: apolloDropEntries([at(30, 'Gerente General', 'Paris', 'paris.example'), at(31, 'Gerente General', 'Insumos del Retail', 'insumos.example')]), costUsd: 0 };
    return { results: input.titles.join('|') === 'Gerente de Personas' && input.industryKeywords.length
      ? apolloDropEntries([at(1, 'Gerente de Personas', 'Ripley', 'ripley.example'), at(2, 'Gerente de Personas', 'Falabella', 'falabella.example')]) : [], costUsd: 0 };
  };
  const classes: Record<string, string> = { 'Jefe de Personas': 'similar', 'Analista de Personas': 'related', 'Coordinadora de Personas': 'related' };
  const companyNotes: Record<string, [number, string | null]> = { Ripley: [9, 'Opera tiendas con mucha dotación.'], Falabella: [9, 'Contrata por temporada en todo Chile.'], Paris: [8, 'Multitienda con alta rotación.'], 'Insumos del Retail': [2, null] };
  const personNotes: Record<string, [number, number]> = { 'Gerente de Personas': [10, 0], 'Jefe de Personas': [8, 0], 'Analista de Personas': [3, 9], 'Coordinadora de Personas': [4, 7] };
  const scoring: any[] = [], companyScoring: any[] = [];
  const generate = async (options: any) => {
    const prompt = JSON.parse(options.prompt);
    if (prompt.cargoBuscado) return { titles: prompt.cargos.map((entry: any) => ({ i: entry.i, match: classes[entry.cargo] ?? 'none' })) };
    if (prompt.empresas) { companyScoring.push(prompt); return { companies: prompt.empresas.map((entry: any) => ({ i: entry.i, nota: companyNotes[entry.empresa][0], razon: companyNotes[entry.empresa][1] })) }; }
    if (prompt.personas) { scoring.push(prompt); return { people: prompt.personas.map((entry: any) => ({ i: entry.i, cargo: personNotes[entry.cargo][0], deriva: personNotes[entry.cargo][1], empresa: entry.evaluacion_empresa ?? 5 })) }; }
    if (prompt.cargos) return { titles: prompt.cargos.map((entry: any) => ({ i: entry.i, variants: [], keywords: [] })) };
    return { rubros: [] };
  };
  const ANA = '00000000-0000-4000-8000-00000000000a';
  const base = seed();
  const { client, tables } = memory({ ...base, organization_members: [{ organization_id: ORG, user_id: ANA, role: 'admin' }], profiles: [{ ...base.profiles[0], id: ANA }], enriched_leads: [],
    lead_drop_accounts: [] as any[] }, { unique: { ...unique.unique, lead_drop_accounts: ['organization_id', 'customer_key', 'domain'] } });
  const planned = await planOrganizationDrops(client, ORG, [ANA], { now: TUESDAY, search: search as any, budgetUsd: 3, spentUsd: 0, generate: generate as any, plan: { size: 6, weekdays: [1, 2, 3, 4, 5] } });
  assert.equal(planned.planned, 1);

  const heads = searches.find(call => call.seniorities?.length);
  assert.deepEqual([heads.titles, heads.seniorities, heads.industryKeywords.length > 0], [[], ['owner', 'founder', 'c_suite'], true], 'the companies of the industry, through whoever heads them');
  assert.deepEqual(companyScoring.flatMap(call => call.empresas.map((entry: any) => entry.empresa)).sort(), ['Falabella', 'Insumos del Retail', 'Paris', 'Ripley'], 'every company scored once, for what the team sells');
  const openedOne = searches.filter(call => call.organizationDomains?.length === 1).map(call => call.organizationDomains[0]).sort();
  assert.deepEqual(openedOne, ['falabella.example', 'paris.example', 'ripley.example'], 'the three that fit are opened; the supplier is not');
  assert.ok(searches.filter(call => call.organizationDomains?.length === 1).every(call => call.titles.length === 0 && call.personLocations.join() === 'Chile'), 'everyone there, in the customer\'s places, whatever the title');
  assert.deepEqual(searches.find(call => call.organizationDomains?.length === 3).titles, ['Gerente de Personas'], 'and the customer\'s roles across the companies opened');

  const drop = tables.lead_drops.find((row: any) => row.drop_date === '2026-10-20');
  assert.deepEqual(drop.items.map((item: any) => [item.company, item.title, item.role ?? 'decides']).sort(), [
    ['Falabella', 'Gerente de Personas', 'decides'], ['Paris', 'Jefe de Personas', 'decides'], ['Ripley', 'Gerente de Personas', 'decides'],
  ], 'one a company for the person: who decides in each, and Paris came only by opening it');
  assert.equal(drop.items.find((item: any) => item.company === 'Paris').companyWhy, 'Multitienda con alta rotación.', 'why that company, as it was scored');
  assert.deepEqual(drop.criteria.accounts, { fit: 3, opened: 3 }, 'the drop says how it searched by company');
  assert.ok(scoring[0].personas.every((entry: any) => typeof entry.evaluacion_empresa === 'number'), 'the score of each person starts from the one of their company');
  assert.ok(!scoring[0].personas.some((entry: any) => entry.empresa === 'Insumos del Retail' && entry.cargo !== 'Gerente General'), 'nobody of the supplier but who the search itself brought');

  const kept = new Map<string, any>(tables.lead_drop_accounts.map((row: any) => [row.domain, row]));
  assert.deepEqual([...kept.keys()].sort(), ['falabella.example', 'insumos.example', 'paris.example', 'ripley.example']);
  assert.deepEqual(['ripley.example', 'falabella.example', 'paris.example', 'insumos.example'].map(domain => [kept.get(domain).score, Boolean(kept.get(domain).opened_at), kept.get(domain).people_left]), [
    [9, true, 1], [9, true, 0], [8, true, 1], [2, false, null],
  ], 'what each company still has after today: Ripley and Paris someone of the area who can refer; Falabella nobody, so it rests');
  assert.equal(new Set(tables.lead_drop_accounts.map((row: any) => row.customer_key)).size, 1);

  // The next day: the companies are known, so none is scored again, and the one that ran out is not opened.
  searches.length = 0; companyScoring.length = 0;
  await planOrganizationDrops(client, ORG, [ANA], { now: new Date('2026-10-21T10:00:00.000Z'), search: search as any, budgetUsd: 3, spentUsd: 0, generate: generate as any, plan: { size: 6, weekdays: [1, 2, 3, 4, 5] } });
  assert.equal(companyScoring.length, 0);
  assert.deepEqual(searches.filter(call => call.organizationDomains?.length === 1).map(call => call.organizationDomains[0]).sort(), ['paris.example', 'ripley.example']);
  const next = tables.lead_drops.find((row: any) => row.drop_date === '2026-10-21');
  assert.deepEqual(next.items.map((item: any) => [item.company, item.title, item.role ?? 'decides']).sort(), [
    ['Paris', 'Analista de Personas', 'refer'], ['Ripley', 'Coordinadora de Personas', 'refer'],
  ], 'with nobody left who decides, the people of the area who can refer, in the companies already opened');

  // Asked from «Hoy», with someone waiting (a month later, when the ones that ran out have rested): the companies already known are
  // opened, and nothing new is looked for, scored or widened.
  searches.length = 0;
  const asked: string[] = [];
  const watching = async (options: any) => { const prompt = JSON.parse(options.prompt); asked.push(prompt.empresas ? 'empresas' : prompt.personas ? 'personas' : prompt.cargoBuscado ? 'clases' : prompt.cargos ? 'cargos' : 'rubros'); return generate(options); };
  await planOrganizationDrops(client, ORG, [ANA], { now: new Date('2026-12-01T10:00:00.000Z'), search: search as any, budgetUsd: 3, spentUsd: 0, generate: watching as any,
    plan: { size: 6, weekdays: [1, 2, 3, 4, 5] }, quick: true });
  assert.equal(searches.filter(call => call.seniorities?.length).length, 0, 'no search for the heads of new companies');
  assert.ok(searches.some(call => call.organizationDomains?.length === 1), 'the known ones are opened');
  assert.ok(!asked.includes('empresas') && !asked.includes('rubros'));
  // With little of the run left, the companies wait for the next one.
  searches.length = 0;
  await planOrganizationDrops(client, ORG, [ANA], { now: new Date('2027-01-05T10:00:00.000Z'), search: search as any, budgetUsd: 3, spentUsd: 0, generate: generate as any,
    plan: { size: 6, weekdays: [1, 2, 3, 4, 5] }, timeLeft: () => 60_000 });
  assert.equal(searches.filter(call => call.seniorities?.length || call.organizationDomains?.length).length, 0);
});

test('when the customer\'s industries run out: the industries next to them, only the people of the companies that fit, and said in the drop', async () => {
  clearTitleAiCache();
  const searches: any[] = [];
  const at = (n: number, title: string, company: string, domain: string) => person(n, company, { title, organization: { name: company, primary_domain: domain } });
  const search = async (input: any) => {
    searches.push(input);
    if ((input.organizationDomains || []).length) return { results: [], costUsd: 0 };
    if (input.companyKeywords.length) {
      return { results: input.titles.length ? apolloDropEntries([at(40, 'Gerente de Personas', 'Supermercados del Sur', 'delsur.example'), at(41, 'Gerente de Personas', 'Distribuidora Mayorista', 'mayorista.example')]) : [], costUsd: 0 };
    }
    return { results: input.titles.length && input.industryKeywords.length ? apolloDropEntries([at(1, 'Gerente de Personas', 'Ripley', 'ripley.example')]) : [], costUsd: 0 };
  };
  const companyNotes: Record<string, number> = { Ripley: 9, 'Supermercados del Sur': 7, 'Distribuidora Mayorista': 3 };
  const asked: any[] = [];
  const generate = async (options: any) => {
    const prompt = JSON.parse(options.prompt);
    if (prompt.cargoBuscado) return { titles: prompt.cargos.map((entry: any) => ({ i: entry.i, match: 'none' })) };
    if (prompt.empresas) return { companies: prompt.empresas.map((entry: any) => ({ i: entry.i, nota: companyNotes[entry.empresa], razon: `Motivo de ${entry.empresa}.` })) };
    if (prompt.personas) return { people: prompt.personas.map((entry: any) => ({ i: entry.i, cargo: 9, empresa: entry.evaluacion_empresa })) };
    if (prompt.cargos) return { titles: prompt.cargos.map((entry: any) => ({ i: entry.i, variants: [], keywords: [] })) };
    asked.push(prompt);
    return { rubros: [{ rubro: 'Supermercados', palabras: ['supermercados', 'grocery'] }, { rubro: 'Retail', palabras: ['retail'] }] };
  };
  const ANA = '00000000-0000-4000-8000-00000000000a';
  const base = seed();
  const { client, tables } = memory({ ...base, organization_members: [{ organization_id: ORG, user_id: ANA, role: 'admin' }], profiles: [{ ...base.profiles[0], id: ANA }], enriched_leads: [],
    lead_drop_accounts: [] as any[] }, { unique: { ...unique.unique, lead_drop_accounts: ['organization_id', 'customer_key', 'domain'] } });
  await planOrganizationDrops(client, ORG, [ANA], { now: TUESDAY, search: search as any, budgetUsd: 3, spentUsd: 0, generate: generate as any, plan: { size: 6, weekdays: [1, 2, 3, 4, 5] } });
  assert.equal(asked.length, 1, 'one person worth offering for a day of six: the model is asked for the industries next to the customer\'s');
  assert.deepEqual(asked[0].cliente_ideal.rubros, ['retail']);
  const widened = searches.filter(call => call.companyKeywords.length);
  assert.deepEqual([...new Set(widened.map(call => call.companyKeywords.join('|')))], ['supermercados|grocery'], 'the industry it already searches is not asked again');
  assert.ok(widened.every(call => call.industryKeywords.length === 0 && call.personLocations.join() === 'Chile'), 'by the words of the company, in the same places');
  const drop = tables.lead_drops.find((row: any) => row.drop_date === '2026-10-20');
  assert.deepEqual(drop.items.map((item: any) => [item.company, item.expanded ?? null]), [['Ripley', null], ['Supermercados del Sur', 'Supermercados']], 'the wholesaler does not fit, so its people do not come in');
  assert.match(drop.items[1].why, /rubro vecino a los tuyos \(supermercados\): ampliamos la búsqueda/);
  assert.deepEqual(drop.criteria.accounts, { fit: 2, opened: 2, expanded: ['Supermercados'] });
  assert.deepEqual(tables.lead_drop_accounts.map((row: any) => [row.domain, row.origin, row.segment]).sort(), [
    ['delsur.example', 'expansion', 'Supermercados'], ['mayorista.example', 'expansion', 'Supermercados'], ['ripley.example', 'customer', null],
  ]);
});

test('six a day with the model down: the customer\'s roles by their words, as a team of one contact gets them', async () => {
  clearTitleAiCache();
  const down = async () => { throw new Error('down'); };
  const { client, tables } = memory(seed(), unique);
  const planned = await planOrganizationDrops(client, ORG, ['u-ana'], { now: TUESDAY, search: apolloSearch as any, budgetUsd: 3, spentUsd: 0, generate: down as any,
    plan: { size: 6, weekdays: [1, 2, 3, 4, 5] } });
  assert.equal(planned.planned, 1);
  assert.deepEqual(tables.lead_drops[0].items.map((item: any) => item.company).sort(), ['Falabella', 'Paris', 'Tottus'], 'everyone with an email the team does not have');
  assert.ok(tables.lead_drops[0].items.every((item: any) => !item.track));
});

test('each contact is researched before it is written: the brief is kept, its facts reach the Writer, and a research that fails leaves the contact as it came', async () => {
  clearTitleAiCache();
  const generate = fakeGenerate;
  const { client, tables } = memory(seed(), unique);
  // Two contacts, chosen by the words of their title (the finder's model is not what this test is about).
  await planOrganizationDrops(client, ORG, ['u-ana'], { now: TUESDAY, search: apolloSearch as any, budgetUsd: 3, spentUsd: 0, generate: (async () => { throw new Error('down'); }) as any,
    plan: { size: 2, weekdays: [1, 2, 3, 4, 5] } });
  writerPrompts.length = 0;
  const asked: any[] = [];
  const research = async (input: any) => {
    asked.push(input);
    if (input.contact.company !== 'Falabella') throw new Error('the web is down');
    return { domain: 'falabella.com', brief: { company: 'Vende vestuario y hogar en tiendas y en línea en Chile, Perú y Colombia.',
      news: { text: 'Abrirá un centro de distribución en Santiago', date: '3 nov 2026', source: 'Diario Financiero', url: 'https://diario.example/falabella-cd' },
      fit: 'Un centro nuevo suma cientos de ingresos que revisar antes de la temporada alta.', role: 'Responde por contratar a tiempo y sin sorpresas.',
      opener: 'Pregúntale cómo van a revisar los antecedentes de quienes entren al centro nuevo.' } };
  };
  await writeDrop(client, tables.lead_drops[0], { generate, now: TUESDAY, research });
  assert.equal(asked.length, 2, 'both contacts at once');
  assert.deepEqual(asked[0].contact, { title: 'Gerente de Personas', company: asked[0].contact.company, domain: null, country: null, industry: 'Retail' });
  assert.equal(asked[0].seller, null, 'a test user without a real id has no offer to read: the brief then says the company and its news only');
  const items = tables.lead_drops[0].items as any[];
  const falabella = items.find(item => item.company === 'Falabella');
  const other = items.find(item => item.company !== 'Falabella');
  assert.equal(falabella.brief.news.source, 'Diario Financiero');
  assert.equal(falabella.summary, 'Vende vestuario y hogar en tiendas y en línea en Chile, Perú y Colombia.');
  assert.deepEqual(falabella.research.slice(0, 2), ['Vende vestuario y hogar en tiendas y en línea en Chile, Perú y Colombia.', 'Abrirá un centro de distribución en Santiago (Diario Financiero, 3 nov 2026).']);
  assert.equal(falabella.domain, 'falabella.com');
  assert.equal(falabella.website, 'https://falabella.com');
  assert.equal(other.brief, undefined);
  assert.equal(other.domain, null);
  assert.ok(other.draft && falabella.draft, 'both are written');
  // The Writer opens with what the research found, and reads the company's facts.
  const forFalabella = writerPrompts.find(prompt => JSON.stringify(prompt.observations).includes('Falabella'));
  assert.equal(forFalabella.brief.angle, 'Para abrir: Pregúntale cómo van a revisar los antecedentes de quienes entren al centro nuevo. Por qué le sirve: Un centro nuevo suma cientos de ingresos que revisar antes de la temporada alta.');
  assert.match(JSON.stringify(forFalabella.observations), /Abrirá un centro de distribución en Santiago \(Diario Financiero, 3 nov 2026\)/);
  assert.equal(writerPrompts.find(prompt => !JSON.stringify(prompt.observations).includes('Falabella')).brief.angle, null);
});
