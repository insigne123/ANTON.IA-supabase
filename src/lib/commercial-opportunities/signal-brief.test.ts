import assert from 'node:assert/strict';
import test from 'node:test';
import { reportSchema } from './expedient';
import { readOpportunityReportEnvelope, opportunityReportPrompt } from './report-generation';
import { SIGNAL_BRIEF_RULE, commercialBriefSchema, sanitizeBrief } from './signal-brief';
import { brief, report } from './signal-sheet-fixtures';

/** The JSON a model answers with: the fixture report with five sections, as the schema asks. */
const answer = (commercial: unknown) => {
  const base = report(false);
  const sections = Array.from({ length: 5 }, (_, i) => ({ id: `s${i}`, title: `Sección ${i + 1}`, paragraphs: ['Texto.'], facts: [] }));
  const { coverage, sources, route, reviewers, kind, generatedAt, ...rest } = base as never as Record<string, unknown>;
  void coverage; void sources; void route; void reviewers; void kind; void generatedAt;
  return JSON.stringify({ ...rest, sections, ...(commercial === undefined ? {} : { commercial }) });
};

test('the structured plan the writer is asked for is valid as it is, and the report schema carries it as optional', () => {
  assert.equal(commercialBriefSchema.safeParse(brief()).success, true);
  assert.equal(sanitizeBrief(brief())?.messages.length, 3);
  assert.deepEqual(sanitizeBrief(brief()), brief(), 'a good plan comes back as it was');
  const withoutIt = JSON.parse(answer(undefined));
  assert.equal(reportSchema.safeParse(withoutIt).success, true, 'a report of a purchase, or from before the plan, has none');
  assert.equal(reportSchema.safeParse({ ...withoutIt, commercial: brief() }).success, true);
});

test('a plan that is too long, malformed or half empty is cut to its limits instead of losing the paid report', () => {
  const messy = sanitizeBrief({
    headline: `  ${'h'.repeat(400)}  `, whyNow: ['uno', '', 7, 'dos', 'tres', 'cuatro', 'cinco'],
    fit: { services: [{ service: 'Logística', why: 'x'.repeat(500), strength: 'enorme' }, { service: '', why: 'sin nombre', strength: 'strong' }, null], gaps: 'no es una lista' },
    company: { summary: 'Texto   con\n\nespacios', facts: [{ label: 'Rubro', value: '' }, { label: '', value: 'sin etiqueta' }] },
    buyers: [{ title: 'Gerente', why: 'porque sí', priority: 'urgente' }, { title: '', why: 'x' }],
    approach: { angle: 'a'.repeat(900), hooks: ['gancho'], avoid: [] },
    messages: [{ channel: 'telegrama', subject: 's', body: 'Hola [nombre]' }, { channel: 'email', body: '' }],
    cadence: [{ day: 9, channel: 'call', action: 'Llamar' }, { day: -3, channel: 'fax', action: 'Empezar' }, { day: 400, channel: 'email', action: 'Cerrar' }, { day: 5, channel: 'email', action: '' }],
    objections: [{ objection: 'Caro', answer: '' }, { objection: 'Ya tenemos', answer: 'Respaldo en picos' }],
  })!;
  assert.equal(messy.headline.length, 160);
  assert.deepEqual(messy.whyNow, ['uno', 'dos', 'tres', 'cuatro'], 'at most four, and nothing that is not text');
  assert.deepEqual(messy.fit.services, [{ service: 'Logística', why: 'x'.repeat(260), strength: 'weak' }], 'an unknown strength is the safest one; a service without a name is left out');
  assert.deepEqual(messy.fit.gaps, []);
  assert.equal(messy.company.summary, 'Texto con espacios');
  assert.deepEqual(messy.company.facts, [{ label: 'Rubro', value: 'No informado' }], 'a missing value says so instead of staying blank');
  assert.deepEqual(messy.buyers, [{ title: 'Gerente', why: 'porque sí', priority: 'secondary' }]);
  assert.equal(messy.approach.angle.length, 420);
  assert.deepEqual(messy.messages, [{ channel: 'email', subject: 's', body: 'Hola [nombre]' }], 'an unknown channel is an email; an empty message is left out');
  assert.deepEqual(messy.cadence.map(step => [step.day, step.channel]), [[0, 'research'], [9, 'call'], [45, 'email']], 'sorted by day, days kept in 0 to 45, unknown channels are research');
  assert.deepEqual(messy.objections, [{ objection: 'Ya tenemos', answer: 'Respaldo en picos' }]);
  assert.equal(commercialBriefSchema.safeParse(messy).success, true, 'what is left is valid');
});

test('with nothing usable there is no plan, and the report is still read', () => {
  for (const value of [undefined, null, 'texto', 3, {}, { headline: '', whyNow: [], buyers: [{}] }]) assert.equal(sanitizeBrief(value), undefined, JSON.stringify(value));
  const read = readOpportunityReportEnvelope({ json: answer({ headline: '', whyNow: [] }) });
  assert.equal(read.commercial, undefined); assert.equal(read.recommendation, 'conditional');
});

test('a report whose model went over the limits in the plan is read, with the plan cut', () => {
  const long = { ...brief(), headline: 'x'.repeat(900), messages: [{ channel: 'email', subject: 'a'.repeat(500), body: 'b'.repeat(5000) }] };
  assert.equal(commercialBriefSchema.safeParse(long).success, false, 'the schema alone would have refused it');
  const read = readOpportunityReportEnvelope({ json: answer(long) });
  assert.equal(read.commercial?.headline.length, 160); assert.equal(read.commercial?.messages[0].body.length, 900); assert.equal(read.commercial?.messages[0].subject.length, 120);
  assert.equal(readOpportunityReportEnvelope({ json: answer(brief()) }).commercial?.buyers.length, 4);
});

test('only a signal is asked for the plan, with the rules a schema cannot say', () => {
  const evidence = { item: { title: 'Retail Pacífico' } };
  const signal = opportunityReportPrompt('2026-10-22', evidence, 'hiring');
  assert.ok(signal.includes(SIGNAL_BRIEF_RULE));
  assert.ok(opportunityReportPrompt('2026-10-22', evidence, 'linkedin_post').includes('commercial (el plan comercial'));
  assert.ok(!opportunityReportPrompt('2026-10-22', evidence, 'tender').includes('commercial (el plan comercial'));
  assert.ok(!opportunityReportPrompt('2026-10-22', evidence, 'compra_agil').includes('commercial (el plan comercial'));
  for (const rule of [/280 caracteres/, /120 palabras/, /30 segundos/, /no nombres de personas/, /«No informado», nunca una cifra inventada/, /no inventes servicios/, /sin prometer precio/]) assert.match(SIGNAL_BRIEF_RULE, rule);
  assert.match(signal, /"commercial"/, 'the schema the model reads has it');
});
