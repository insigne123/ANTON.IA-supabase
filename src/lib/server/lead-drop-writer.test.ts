import assert from 'node:assert/strict';
import test from 'node:test';

import type { DropItem } from '@/lib/lead-drops';
import { DROP_EMAIL_DAYS, DROP_WRITER_RULES, dropEmailIssues, dropWriterEnabled, dropWriterModel, dropWriterPrompt, finishDropEmails, sequenceRoles, sequenceRules, writeDropEmails, writeSequence, type DropSeller, type SequencePlan } from './lead-drop-writer';

const seller: DropSeller = { fullName: 'Carla Muñoz', jobTitle: 'Ejecutiva comercial', companyName: 'Brigadas del Sur', offer: 'Protegemos faenas frente a emergencias.',
  services: ['Planes de emergencia', 'Brigadas de emergencia en faena'], proofPoints: ['Más de 12 años de experiencia', 'Más de 3 millones de horas sin accidentes'],
  differentiators: ['Cobertura en todo el país'], referenceClients: ['Forestal Los Robles'], painPoints: ['Brigadas propias difíciles de mantener entrenadas'],
  inOwnWords: 'Le vendemos a quien opera faenas, no a proveedores.' };
const item = { leadId: 'a1', name: 'Rodrigo Sa***o', title: 'Gerente HSE', company: 'Minera Aurora', domain: 'aurora.example', industry: 'Minería', size: 800, city: 'Antofagasta',
  hasEmail: true, hasPhone: false, why: '', research: ['Opera dos faenas de cobre.'], draft: null, country: 'Chile',
  brief: { company: 'Minera Aurora opera dos faenas de cobre en el norte.', news: { text: 'Sumó una planta concentradora.', date: '3 nov 2026', source: 'Diario Ejemplo', url: 'https://diario.example/x' },
    fit: 'Una planta nueva suma áreas que proteger.', role: 'Responde por la seguridad de las faenas.', opener: 'Pregúntale por la planta nueva.' } } as unknown as DropItem;
const body = (...parts: string[]) => ['Hola {{nombre}},', ...parts].join('\n\n');
const good = () => [
  { day: 1, subject: 'La planta nueva de Minera Aurora', body: body('Vi que Minera Aurora sumó una planta concentradora. Te escribo porque en Brigadas del Sur armamos los planes de emergencia de faenas que crecen, y llevamos más de 3 millones de horas sin accidentes en ese trabajo.', '¿Te interesa que te cuente cómo lo hacemos?') },
  { day: 3, subject: 'Brigadas para la planta', body: body('Te escribí hace unos días por los planes de emergencia. También dejamos brigadas en faena, entrenadas en cada turno.', '¿Te sirve un resumen de una página?') },
  { day: 7, subject: 'Seguridad de las dos faenas', body: body('En las faenas que ya operan revisamos los planes vigentes y los ponemos a prueba en terreno, con cobertura en todo el país para llegar donde esté la operación.', '¿Lo vemos en una llamada de 15 minutos?') },
  { day: 11, subject: 'Con quién hablar en Aurora', body: body('Este es el último correo que te mando sobre esto. ¿Es otra persona quien ve las emergencias en Minera Aurora, para escribirle a ella?') },
];
const check = (emails: ReturnType<typeof good>, over: Partial<DropItem> = {}) => dropEmailIssues(emails, { item: { ...item, ...over }, seller, prompt: dropWriterPrompt({ item: { ...item, ...over }, seller }) });
const change = (index: number, patch: Partial<ReturnType<typeof good>[number]>) => good().map((email, at) => (at === index ? { ...email, ...patch } : email));

test('what the writer reads: who sells, the contact and what is known of their company, with a different proof first for each contact of the day', () => {
  const read = JSON.parse(dropWriterPrompt({ item, seller }));
  assert.deepEqual(read.contacto, { nombre_de_pila: 'Rodrigo', cargo: 'Gerente HSE', nivel: null, area: null, empresa: 'Minera Aurora', rubro: 'Minería', empleados: 800, lugar: 'Antofagasta, Chile', papel: 'decide' });
  assert.equal(read.investigacion.novedad.texto, 'Sumó una planta concentradora.');
  assert.equal(read.investigacion.que_le_importa_a_su_cargo, 'Responde por la seguridad de las faenas.');
  assert.deepEqual(read.vendedor.clientes_que_puede_nombrar, ['Forestal Los Robles']);
  assert.equal(read.vendedor.en_sus_palabras, 'Le vendemos a quien opera faenas, no a proveedores.');
  assert.deepEqual(read.vendedor.pruebas, seller.proofPoints);
  assert.deepEqual(JSON.parse(dropWriterPrompt({ item, seller, variant: 1 })).vendedor.pruebas, ['Más de 3 millones de horas sin accidentes', 'Más de 12 años de experiencia']);
  assert.deepEqual(read.dias, DROP_EMAIL_DAYS);
  const refers = JSON.parse(dropWriterPrompt({ item: { ...item, role: 'refer', expanded: 'Construcción' }, seller }));
  assert.equal(refers.contacto.papel, 'deriva');
  assert.match(refers.investigacion.rubro_vecino, /rubro vecino[^)]*\(Construcción\)/);
  assert.equal(JSON.parse(dropWriterPrompt({ item, seller })).voz_del_vendedor, undefined);
  // The rules name no trade: an example of one leaked into another («si la nómina coincide con un cambio de turno», to a mining company).
  assert.doesNotMatch(DROP_WRITER_RULES.join(' '), /nómina|guardias|retail|minería|AXIS/i);
});

test('emails that start from the person, offer one thing and ask one thing pass; each known defect is told as something to fix', () => {
  assert.deepEqual(check(good()), []);
  const told = (emails: ReturnType<typeof good>, pattern: RegExp, over: Partial<DropItem> = {}) => assert.ok(check(emails, over).some(issue => pattern.test(issue)), `${pattern} in ${JSON.stringify(check(emails, over))}`);
  told(change(0, { body: body('Cuando una emergencia detiene una faena, tu respuesta define cuánto se pierde. En Brigadas del Sur armamos planes de emergencia para faenas mineras de cobre.', '¿Te interesa que te cuente cómo?') }), /Correo 1: la primera frase es una hipótesis/);
  told(change(0, { body: body('En minería, una emergencia sin plan deja frentes parados. En Brigadas del Sur armamos planes de emergencia para faenas mineras de cobre del norte.', '¿Te interesa que te cuente cómo?') }), /hipótesis o una lección/);
  told(change(1, { body: body('Te escribí hace unos días por los planes de emergencia. También dejamos brigadas en faena.', '¿Quién coordina hoy la respuesta ante emergencias?') }), /Correo 2: .*quién hace algo que es su propio cargo/);
  told(change(0, { body: body('Vi que Minera Aurora sumó una planta concentradora. Te escribo porque en Brigadas del Sur armamos los planes de emergencia de faenas que crecen.', '¿Cuánto les toma hoy actualizar sus planes?') }), /le pide un dato de su operación/);
  told(change(2, { body: body('Revisamos los planes vigentes y los ponemos a prueba en terreno. ¿Los tienen al día? Tenemos cobertura en todo el país para llegar donde esté la operación.', '¿Lo vemos en una llamada de 15 minutos?') }), /Correo 3: lleva 2 preguntas/);
  told(change(0, { body: body('Vi que Minera Aurora sumó una planta concentradora. Te escribo porque armamos planes de emergencia para faenas que crecen, y ya lo hicimos en 40 faenas del país.', '¿Te interesa que te cuente cómo?') }), /la cifra «40» no viene en los datos/);
  told(change(2, { body: body('Revisamos los planes vigentes y los ponemos a prueba en terreno, con más de 12 años de experiencia y cobertura en todo el país para llegar a la operación.', '¿Lo vemos en una llamada de 15 minutos?') })
    .map((email, at) => (at === 0 ? { ...email, body: email.body.replace('más de 3 millones de horas sin accidentes', 'más de 12 años de experiencia') } : email)), /repite «más de 12 años»/);
  told(change(0, { body: body('Vi que Minera Aurora sumó una planta concentradora. Te escribo porque en Brigadas del Sur armamos los planes de emergencia de faenas que crecen como la suya.', '¿Te interesa que te cuente cómo lo hacemos?') }), /le habla de usted/);
  told(change(0, { subject: 'Brigadas del Sur para Minera Aurora' }), /el asunto nombra a la empresa del vendedor/);
  told(change(3, { body: body('No te escribo más por este tema. ¿Es otra persona quien ve las emergencias en Minera Aurora, para hablar con ella?') }), /Correo 4: debe decir/);
  told(change(1, { subject: 'La planta nueva de Minera Aurora' }), /mismo asunto/);
  told(change(0, { body: 'Estimado Rodrigo:\n\nVi que Minera Aurora sumó una planta concentradora y en Brigadas del Sur armamos los planes de emergencia de faenas que crecen.\n\n¿Te interesa que te cuente cómo?' }), /debe empezar con «Hola \{\{nombre\}\},»/);
  // Who works in the area but does not decide is asked exactly that: who sees it.
  const asksWho = change(0, { body: body('Te escribo porque trabajas en el área de emergencias de Minera Aurora y en Brigadas del Sur armamos planes de emergencia para faenas como esa.', '¿Quién ve este tema en Minera Aurora?') });
  assert.ok(!check(asksWho, { role: 'refer' }).some(issue => /propio cargo/.test(issue)));
  assert.ok(check(asksWho).some(issue => /propio cargo/.test(issue)));
});

test('the emails as they are kept: the company as the profile writes it, no closing of the model\'s and the same signature in all four', () => {
  const written = good().map((email, index) => ({ ...email, day: 99, subject: index === 2 ? '  Seguridad   de las dos faenas ' : email.subject,
    body: `${email.body.replace(/Brigadas del Sur/g, 'BRIGADAS DEL SUR')}${index === 0 ? '\n\nSaludos,\nCarla Muñoz\nBrigadas del Sur' : index === 1 ? '\n\nUn abrazo,\nCarla' : ''}` }));
  const kept = finishDropEmails(written, seller);
  assert.deepEqual(kept.map(email => email.day), DROP_EMAIL_DAYS);
  assert.ok(kept.every(email => email.body.endsWith('\n\nSaludos,\nCarla Muñoz')), 'one closing, the same in every email');
  assert.equal(kept[0].body.match(/Saludos,/g)?.length, 1);
  assert.doesNotMatch(kept[1].body, /Un abrazo/);
  assert.doesNotMatch(kept.map(email => email.body).join('\n'), /BRIGADAS DEL SUR/);
  assert.match(kept[0].body, /en Brigadas del Sur armamos/);
  assert.equal(kept[2].subject, 'Seguridad de las dos faenas');
  assert.ok(finishDropEmails(good(), { ...seller, fullName: null })[0].body.endsWith('\n\nSaludos,'));
});

test('written, read by the checks and corrected once: the version with fewer points stays, and a model that gives nothing usable is an error to fall back from', async () => {
  const calls: any[] = [];
  const bad = change(1, { body: body('Te escribí hace unos días por los planes de emergencia. También dejamos brigadas en faena.', '¿Quién coordina hoy la respuesta ante emergencias?') });
  const generate = async (options: any) => { const prompt = JSON.parse(options.prompt); calls.push({ ...options, prompt }); return { emails: prompt.correcciones ? good() : bad }; };
  const written = await writeDropEmails({ item, seller, generate: generate as any, variant: 0 });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].openAiModel, 'claude-haiku-5-5');
  assert.match(calls[0].systemPrompt, /por qué le escribes a él/);
  assert.match(calls[1].prompt.correcciones[0], /Correo 2: .*propio cargo/);
  assert.equal(calls[1].prompt.borrador_anterior.length, 4);
  assert.deepEqual(written.issues, []);
  assert.equal(written.draft.subject, 'La planta nueva de Minera Aurora');
  assert.deepEqual(written.followUps.map(step => step.day), [3, 7, 11]);
  assert.match(written.followUps[0].body, /¿Te sirve un resumen de una página\?\n\nSaludos,\nCarla Muñoz$/);
  // A correction that fails or does not improve leaves the first version.
  const stubborn = await writeDropEmails({ item, seller, generate: (async (options: any) => { if (JSON.parse(options.prompt).correcciones) throw new Error('down'); return { emails: bad }; }) as any });
  assert.equal(stubborn.issues.length, 1);
  assert.match(stubborn.followUps[0].body, /¿Quién coordina hoy/);
  // Clean at once: one call.
  let once = 0;
  await writeDropEmails({ item, seller, generate: (async () => { once++; return { emails: good() }; }) as any });
  assert.equal(once, 1);
  await assert.rejects(writeDropEmails({ item, seller, generate: (async () => ({ emails: good().slice(0, 2) })) as any }));
  await assert.rejects(writeDropEmails({ item, seller, generate: (async () => { throw new Error('down'); }) as any }));
});

test('the model and the switch: Haiku unless a setting says another, and «off» goes back to Cowork\'s Writer', () => {
  assert.equal(dropWriterModel({}), 'claude-haiku-5-5');
  assert.equal(dropWriterModel({ LEAD_DROPS_WRITER_MODEL: ' gpt-6-luna ' }), 'gpt-6-luna');
  assert.equal(dropWriterEnabled({}), true);
  assert.equal(dropWriterEnabled({ LEAD_DROPS_WRITER: 'off' }), false);
});

// A campaign (17 Nov 2026): the same writer with the campaign's own number of emails and days, and its texts as a guide.
const guide = [
  { subject: 'Planes de emergencia para {{empresa}}', body: 'Hola {{nombre}},\n\nSomos Brigadas del Sur y armamos planes de emergencia para empresas como {{empresa}}, con brigadas entrenadas en cada turno.\n\n¿Conversamos 20 minutos esta semana?' },
  { subject: '¿Pudiste ver mi correo?', body: 'Hola {{nombre}},\n\nTe escribí por los planes de emergencia.\n\n¿Te mando un resumen?' },
  { subject: 'Cierro por ahora', body: 'Hola {{nombre}},\n\nEste es mi último correo. ¿Con quién hablo en {{empresa}}?' },
];
const campaignPlan: SequencePlan = { days: [1, 4, 11], sign: false, campaign: { objective: 'Conseguir una llamada de 20 minutos.', audience: 'Gerentes de faenas', guide } };

test('a sequence takes its roles from how many emails it has: the first, short ones and other angles between, and a close from three on', () => {
  assert.deepEqual(sequenceRoles(1), ['first']);
  assert.deepEqual(sequenceRoles(2), ['first', 'short']);
  assert.deepEqual(sequenceRoles(3), ['first', 'short', 'close']);
  assert.deepEqual(sequenceRoles(4), ['first', 'short', 'angle', 'close']);
  assert.deepEqual(sequenceRoles(7), ['first', 'short', 'angle', 'short', 'angle', 'short', 'close']);
});

test('the rules of a recommended contact stay as they are; a campaign gets its own number of emails, its days and the guide as guidance', () => {
  assert.equal(sequenceRules(), DROP_WRITER_RULES);
  assert.equal(sequenceRules({ days: DROP_EMAIL_DAYS }), DROP_WRITER_RULES);
  const rules = sequenceRules(campaignPlan);
  assert.match(rules[0], /una secuencia de 3 correos/);
  const roles = rules.find(rule => rule.startsWith('Los 3 correos'))!;
  assert.match(roles, /Primero \(day 1\).*Segundo \(day 4\).*Tercero \(day 11\): cierre/);
  assert.doesNotMatch(rules.join(' '), /cuatro correos/);
  assert.match(rules.join(' '), /Esto es una campaña.*no copies sus frases.*dos personas de la misma campaña nunca deben recibir el mismo texto/);
  assert.match(sequenceRules({ days: [1], campaign: {} })[0], /escribes como el vendedor.*un correo para ese contacto/i);
  assert.ok(sequenceRules({ days: [1], campaign: {} }).some(rule => rule.startsWith('Un solo correo (day 1)')));
  // Four emails on other days are not the plan of a recommended contact.
  assert.match(sequenceRules({ days: [1, 4, 8, 15] }).join(' '), /Cuarto \(day 15\)/);
  const read = JSON.parse(dropWriterPrompt({ item, seller, plan: { ...campaignPlan, campaign: { ...campaignPlan.campaign, recontact: true } } }));
  assert.deepEqual(read.dias, [1, 4, 11]);
  assert.deepEqual(read.campana, { objetivo: 'Conseguir una llamada de 20 minutos.', a_quienes: 'Gerentes de faenas', ya_le_escribiste: true,
    guia: guide.map(message => ({ asunto: message.subject, cuerpo: message.body })) });
  assert.equal(JSON.parse(dropWriterPrompt({ item, seller })).campana, undefined);
});

test('in a campaign, an email that is the guide again is told: its subject with the company\'s name, or its sentences', () => {
  const own = [good()[0], good()[1], good()[3]].map((email, index) => ({ ...email, day: [1, 4, 11][index] }));
  const prompt = dropWriterPrompt({ item, seller, plan: campaignPlan });
  const issues = (emails: typeof own) => dropEmailIssues(emails, { item, seller, prompt, plan: campaignPlan });
  // The guide's twenty minutes are a number the emails may say; three emails end with the close.
  assert.deepEqual(issues(own), []);
  assert.ok(issues(own.map((email, at) => (at === 0 ? { ...email, subject: 'Planes de emergencia para Minera Aurora' } : email))).some(issue => /Correo 1: el asunto repite el de la guía/.test(issue)));
  assert.ok(issues(own.map((email, at) => (at === 0 ? { ...email, body: body('Somos Brigadas del Sur y armamos planes de emergencia para empresas como Minera Aurora, con brigadas entrenadas en cada turno, en todo el país y en cada faena.', '¿Conversamos 20 minutos esta semana?') } : email)))
    .some(issue => /Correo 1: repite frases de la guía/.test(issue)));
  // The close may be called as the guide calls it.
  assert.deepEqual(issues(own.map((email, at) => (at === 2 ? { ...email, subject: 'Cierro por ahora' } : email))), []);
});

test('a campaign\'s emails are kept without a closing: the mailbox adds the signature on sending', async () => {
  const kept = finishDropEmails([{ day: 9, subject: 'Hola', body: body('Uno.', 'Saludos,\nCarla Muñoz') }], seller, campaignPlan);
  assert.deepEqual(kept, [{ day: 1, subject: 'Hola', body: 'Hola {{nombre}},\n\nUno.' }]);
  const own = [good()[0], good()[1], good()[3]];
  const asked: any[] = [];
  const written = await writeSequence({ item, seller, plan: campaignPlan, generate: async options => { asked.push(options); return { emails: own }; } });
  assert.equal(asked.length, 1);
  assert.equal(asked[0].systemPrompt, sequenceRules(campaignPlan).join('\n'));
  assert.deepEqual(written.emails.map(email => email.day), [1, 4, 11]);
  assert.ok(written.emails.every(email => !/Saludos/.test(email.body)));
  // Four emails where the campaign has three is not an answer.
  await assert.rejects(writeSequence({ item, seller, plan: campaignPlan, generate: async () => ({ emails: good() }) }));
});
