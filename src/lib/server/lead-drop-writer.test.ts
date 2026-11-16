import assert from 'node:assert/strict';
import test from 'node:test';

import type { DropItem } from '@/lib/lead-drops';
import { DROP_EMAIL_DAYS, DROP_WRITER_RULES, dropEmailIssues, dropWriterEnabled, dropWriterModel, dropWriterPrompt, finishDropEmails, writeDropEmails, type DropSeller } from './lead-drop-writer';

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
