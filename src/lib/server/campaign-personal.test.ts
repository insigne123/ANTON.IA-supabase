import assert from 'node:assert/strict';
import test from 'node:test';

import type { AuthContext } from '@/lib/server/auth-utils';
import { personalItem, personalMessages, personalRecipientOf, personalizeRecipients, type PersonalDeps, type PersonalRecipient } from './campaign-personal';

const auth = { user: { id: '11111111-1111-4111-8111-111111111111' }, organizationId: '22222222-2222-4222-8222-222222222222', organizationIds: [], supabase: null } as unknown as AuthContext;
const seller = { fullName: 'Carla Muñoz', companyName: 'Aula en Ruta', offer: 'Capacitación a medida para equipos.', services: ['Cursos en faena'], proofPoints: ['Certificación NCh 2728'] };
const messages = [
  { subject: 'Capacitación para {{empresa}}', body: 'Hola {{nombre}},\n\nHacemos capacitación a medida para {{empresa}}.\n\n¿Conversamos 20 minutos?', delayDays: 0 },
  { subject: 'Cierro por ahora', body: 'Hola {{nombre}},\n\nEste es mi último correo. ¿Con quién hablo?', delayDays: 5 },
];
const ana = personalRecipientOf({ id: 'lead-ana', email: 'Ana@Puerto.Example', full_name: 'Ana Rojas Soto', title: 'Jefa de Personas', company_name: 'Puerto Ejemplo', organization_industry: 'logistics',
  organization_size: '1.200', country: 'Chile', state: 'Antofagasta', city: 'Mejillones', headline: 'Personas y cultura en puertos', seniority: 'manager', departments: ['human_resources'], about: 'Terminal de graneles del norte.' });
const leo = personalRecipientOf({ id: 'lead-leo', email: 'leo@obra.example', name: 'Le***o', role: 'Director', company: 'Obras Ejemplo', data: { industry: 'construction', companySize: '51-200', country: 'Chile' } });
const body = (name: string, text: string, ask: string) => `Hola ${name},\n\n${text}\n\n${ask}`;
const answer = (who: string) => ({ emails: [
  { day: 1, subject: `Cursos en faena para ${who}`, body: body('{{nombre}}', `Te escribo porque llevas personas en ${who} y en Aula en Ruta armamos cursos en faena para equipos que no pueden dejar su turno, con certificación NCh 2728.`, '¿Te interesa que te cuente cómo lo armamos?') },
  { day: 6, subject: 'Cierro por ahora', body: body('{{nombre}}', `Este es el último correo que te mando sobre esto. ¿Es otra persona quien ve la capacitación en ${who}, para escribirle a ella?`, '').trim() },
] });
const deps = (over: Partial<PersonalDeps> = {}): Partial<PersonalDeps> => ({
  recipients: async () => new Map<string, PersonalRecipient>([[ana.email, ana], [leo.email, leo]]),
  research: async () => new Map([[ana.email, ['Abrió un segundo sitio de atraque en 2026.']]]),
  seller: async () => seller, samples: async () => [],
  generate: async options => answer(JSON.parse(options.prompt).contacto.empresa),
  ...over,
});
const input = (emails: string[], over: Record<string, unknown> = {}) => ({ emails, objective: 'Una llamada de 20 minutos.', description: 'Jefes de personas', relationship: 'never_contacted', messages, offset: 5, ...over });

test('what is saved of a recipient becomes the contact the writer reads: their company, what it does and what else is known', () => {
  assert.deepEqual([ana.email, ana.name, ana.company, ana.industry, ana.region, ana.leadRef], ['ana@puerto.example', 'Ana Rojas Soto', 'Puerto Ejemplo', 'logistics', 'Antofagasta', 'lead-ana']);
  assert.deepEqual([leo.name, leo.title, leo.company, leo.industry, leo.size, leo.country], ['Le***o', 'Director', 'Obras Ejemplo', 'construction', '51-200', 'Chile']);
  const item = personalItem(ana, ['Abrió un segundo sitio de atraque en 2026.']);
  assert.deepEqual([item.name, item.title, item.company, item.size, item.city, item.country, item.summary, item.department], ['Ana Rojas Soto', 'Jefa de Personas', 'Puerto Ejemplo', 1200, 'Mejillones', 'Chile', 'Terminal de graneles del norte.', 'human_resources']);
  assert.deepEqual(item.research, ['Así se presenta en LinkedIn: Personas y cultura en puertos', 'Abrió un segundo sitio de atraque en 2026.']);
  // A range is not a number of employees: it goes as a fact.
  assert.deepEqual([personalItem(leo).size, personalItem(leo).research], [null, ['Tamaño de la empresa: 51-200']]);
});

test('the emails are kept with the person\'s first name, or with none when the saved name is not one, and never with a variable left', () => {
  const emails = answer('Puerto Ejemplo').emails;
  assert.match(personalMessages(emails, 'Ana Rojas Soto')![0].body, /^Hola Ana,\n\nTe escribo porque/);
  assert.match(personalMessages(emails, 'Le***o')![0].body, /^Hola,\n\nTe escribo porque/);
  assert.equal(personalMessages([{ subject: 'Para {{empresa}}', body: 'Hola {{nombre}},\n\nTexto.' }], 'Ana Rojas'), null);
});

test('each recipient of a request gets their own emails, written from what is known of them and with the campaign as a guide', async () => {
  const asked: any[] = [];
  const result = await personalizeRecipients(auth, input([ana.email, leo.email, 'nadie@ejemplo.cl']), deps({
    generate: async options => { asked.push(options); return answer(JSON.parse(options.prompt).contacto.empresa); },
  }));
  assert.deepEqual(result.written.map(person => person.email), [ana.email, leo.email]);
  assert.deepEqual(result.failed, [{ email: 'nadie@ejemplo.cl', reason: 'No encontramos sus datos guardados.' }]);
  assert.deepEqual(result.written[0].messages.map(message => message.subject), ['Cursos en faena para Puerto Ejemplo', 'Cierro por ahora']);
  assert.match(result.written[0].messages[0].body, /^Hola Ana,/);
  assert.match(result.written[1].messages[0].body, /^Hola,\n\nTe escribo porque llevas personas en Obras Ejemplo/);
  // No closing: the mailbox signs when it sends.
  assert.ok(result.written.every(person => person.messages.every(message => !/Saludos/.test(message.body) && !/\{\{/.test(message.body))));
  const read = asked.map(options => JSON.parse(options.prompt)).find(prompt => prompt.contacto.empresa === 'Puerto Ejemplo');
  assert.deepEqual(read.dias, [1, 6]);
  assert.deepEqual([read.campana.objetivo, read.campana.a_quienes, read.campana.ya_le_escribiste, read.campana.guia.length], ['Una llamada de 20 minutos.', 'Jefes de personas', false, 2]);
  assert.deepEqual(read.investigacion.otros_datos, ['Así se presenta en LinkedIn: Personas y cultura en puertos', 'Abrió un segundo sitio de atraque en 2026.']);
  assert.equal(read.vendedor.empresa, 'Aula en Ruta');
  assert.match(asked[0].systemPrompt, /una secuencia de 2 correos/);
  assert.match(asked[0].systemPrompt, /Esto es una campaña/);
  assert.equal(asked[0].openAiModel, 'claude-haiku-5-5');
  const again = await personalizeRecipients(auth, input([ana.email], { relationship: 'previously_contacted' }), deps({ generate: async options => { asked.push(options); return answer('Puerto Ejemplo'); } }));
  assert.equal(again.written.length, 1);
  assert.equal(JSON.parse(asked.at(-1).prompt).campana.ya_le_escribiste, true);
});

test('a person the writer fails with keeps the base and the others are written; without research or a seller the emails are still written', async () => {
  const result = await personalizeRecipients(auth, input([ana.email, leo.email]), deps({
    research: async () => { throw new Error('sin informes'); }, seller: async () => { throw new Error('sin perfil'); },
    generate: async options => {
      const company = JSON.parse(options.prompt).contacto.empresa;
      if (company === 'Obras Ejemplo') throw Object.assign(new Error('Request timed out'), { name: 'TimeoutError' });
      return answer(company);
    },
  }));
  assert.deepEqual(result.written.map(person => person.email), [ana.email]);
  assert.deepEqual(result.failed, [{ email: leo.email, reason: 'La IA tardó más de lo esperado.' }]);
  const short = await personalizeRecipients(auth, input([ana.email]), deps({ generate: async () => ({ emails: answer('Puerto Ejemplo').emails.slice(0, 1) }) }));
  assert.deepEqual(short.failed, [{ email: ana.email, reason: 'La IA no devolvió todos los correos.' }]);
});
