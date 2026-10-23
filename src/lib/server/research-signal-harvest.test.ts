import assert from 'node:assert/strict';
import test from 'node:test';
import { consolidateReportV2Claims } from '@/ai/flows/extract-report-v2-claims';
import type { FactV2, SourceV2 } from '@/lib/report-v2-contracts';
import { DRAFT_CONTEXT_MAX_AGE_MS } from './draft-context-v2';
import { datesInText } from '@/lib/research-signal-grounding';
import {
  buildSignalHarvestPrompt, harvestResearchSignals, rejectionOf, selectHarvestCandidates, signalHarvestSettings,
  type HarvestInput, type SignalHarvestSettings,
} from './research-signal-harvest';

const TODAY = '2026-10-23T12:00:00.000Z';
const settings: SignalHarvestSettings = { model: 'claude-sonnet-5-5', maxSignals: 3, maxFacts: 80, recencyDays: 30, deadlineMs: 30_000 };

const source = (n: number, publishedAt: string | null, host = 'redimin.cl', about = ''): SourceV2 => ({
  id: `src_${String(n).padStart(10, '0')}`, url: `https://${host}/nota-${n}${about && `-${about}`}`, canonicalUrl: `https://${host}/nota-${n}${about && `-${about}`}`, title: `Nota ${n}${about && ` de ${about}`}`,
  sourceType: 'other', jurisdiction: 'CL', publishedAt, modifiedAt: null, retrievedAt: '2026-10-23T11:00:00.000Z', ownDomain: false, contentHash: String(n).repeat(64).slice(0, 64),
});
const fact = (n: number, sourceN: number, text: string, observedAt: string | null = null): FactV2 => ({
  id: `f_${String(n).padStart(10, '0')}`, sourceId: `src_${String(sourceN).padStart(10, '0')}`, text, observedAt, jurisdiction: null, locator: `block:${n}`,
});

// The notes about Sodexo are pages about it; the note of August is about Ingevec and the undated one about a spill that names another company.
const SOURCES = [source(1, '2026-10-12T00:00:00.000Z', 'redimin.cl', 'sodexo'), source(2, '2026-10-21T08:00:00.000Z', 'chilepaisminero.com', 'sodexo'), source(3, '2026-08-14T00:00:00.000Z'), source(4, null)];
const FACTS = [
  fact(1, 1, 'Auxiliar de Bodega con turnos 6x1 – MalloaEmpresa: Sodexo.Cargo: Auxiliar de Bodega.Ubicación: Malloa, Región de O\'Higgins.Vacantes publicadas: 10.'),
  fact(2, 1, 'Ayudantes de Cocina para mineríaEmpresa: Sodexo.Cargo: Ayudantes de Cocina.Ubicación: Coquimbo.Vacantes publicadas: 5. Vigencia hasta el 19 de noviembre de 2026.'),
  fact(3, 2, 'Sodexo busca coordinadores de control y gestión para sus contratos mineros de alimentación y servicios en Antofagasta y Copiapó, con renta de entre $1.800.000 y $1.900.000.'),
  fact(4, 3, 'Ingevec cerró el primer semestre de 2026 con ingresos de $185.209,6 millones y utilidades de $11.263 millones, un alza de 49,35% frente a 2025 en todas sus áreas.'),
  fact(5, 4, 'El 9 de octubre se produjo un derrame de ácido nítrico en Mejillones por el volcamiento de un camión de una empresa contratista de Enaex.'),
  fact(6, 4, 'Una nota sin fecha alguna sobre servicios generales de la empresa, escrita de manera genérica y sin ningún dato concreto.'),
  fact(7, 1, 'Insertar este artículo en tu sitioCopia el código y pégalo en tu página o blog (bloque HTML personalizado) para mostrarlo.'),
  fact(8, 1, 'Auxiliar de Bodega con turnos 6x1 – MalloaEmpresa: Sodexo.Cargo: Auxiliar de Bodega.Ubicación: Malloa, Región de O\'Higgins.Vacantes publicadas: 10.'),
  fact(9, 1, 'Así se verá:Sodexo mantiene oportunidades laborales en Antofagasta para cargos profesionales, técnicos y operativos vinculados a servicios de alimentación.'),
];
const input: HarvestInput = {
  companyName: 'Sodexo Chile', companyDomain: 'sodexo.cl', country: 'CL', contactTitle: 'Gerente de Personas', department: 'Recursos Humanos',
  sellerOffer: 'AXIS: consulta antecedentes laborales de postulantes en el PJUD', sources: SOURCES, facts: FACTS, today: TODAY,
};

const proposal = (overrides: Record<string, unknown> = {}) => ({
  hechos: [1, 2], frase: 'Sodexo Chile publicó avisos con 10 vacantes de auxiliar de bodega en Malloa y 5 de ayudante de cocina en Coquimbo.', fecha: '2026-10-12', tipo: 'hiring', conexion: 'directa', relevancia: 'Contratación masiva', ...overrides,
}) as any;

test('the harvest is off unless the flag is on and there is a key, and its limits are bounded', () => {
  assert.equal(signalHarvestSettings({}), null);
  assert.equal(signalHarvestSettings({ RESEARCH_SIGNAL_HARVEST_ENABLED: 'true' }), null, 'without a key there is no Claude');
  assert.equal(signalHarvestSettings({ ANTHROPIC_API_KEY: 'k' }), null, 'the key alone turns nothing on');
  assert.deepEqual(signalHarvestSettings({ RESEARCH_SIGNAL_HARVEST_ENABLED: 'true', ANTHROPIC_API_KEY: 'k' }), { ...settings, deadlineMs: 45_000 });
  assert.deepEqual(signalHarvestSettings({ RESEARCH_SIGNAL_HARVEST_ENABLED: 'true', ANTHROPIC_API_KEY: 'k', RESEARCH_SIGNAL_HARVEST_MODEL: 'claude-haiku-5-5', RESEARCH_SIGNAL_HARVEST_MAX: '99',
    RESEARCH_SIGNAL_HARVEST_FACTS: '5', RESEARCH_SIGNAL_HARVEST_DAYS: '1000', RESEARCH_SIGNAL_HARVEST_DEADLINE_MS: '5' }),
  { model: 'claude-haiku-5-5', maxSignals: 5, maxFacts: 20, recencyDays: 365, deadlineMs: 10_000 });
});

test('by default a signal must be as recent as the draft accepts a claim', () => {
  assert.equal(settings.recencyDays * 86_400_000, DRAFT_CONTEXT_MAX_AGE_MS, 'an older signal would reach the report and never the email');
});

test('dates are read as the text writes them, and a date without a year takes the one given', () => {
  assert.deepEqual(datesInText('Publicado el 2026-10-12 y vigente hasta el 19/11/2026', 2026).sort(), ['2026-10-12', '2026-11-19']);
  assert.deepEqual(datesInText('Vigencia hasta el 19 de noviembre de 2026.', 2025), ['2026-11-19']);
  assert.deepEqual(datesInText('El 9 de octubre se produjo un derrame', 2026), ['2026-10-09']);
  assert.deepEqual(datesInText('Ayer, 31 de febrero, nada', 2026), [], 'a day that does not exist is not a date');
  assert.deepEqual(datesInText('Sin fechas aquí', 2026), []);
});

test('the facts shown to the model are dated inside the window, not page furniture, each text once, and spread over the pages', () => {
  const candidates = selectHarvestCandidates(input, settings);
  const texts = candidates.map(candidate => candidate.text);
  assert.ok(!texts.some(text => text.startsWith('Ingevec')), 'a page of August is out of a window of 30 days');
  assert.ok(!texts.some(text => text.startsWith('Una nota sin fecha')), 'no date, none in the text');
  assert.ok(!texts.some(text => /Insertar este artículo/.test(text)), 'embed widgets are not facts');
  assert.equal(texts.filter(text => text.startsWith('Auxiliar de Bodega')).length, 1, 'the same text twice is shown once');
  assert.ok(texts.includes('Sodexo mantiene oportunidades laborales en Antofagasta para cargos profesionales, técnicos y operativos vinculados a servicios de alimentación.'), 'the «Así se verá:» prefix is dropped');
  const derrame = candidates.find(candidate => candidate.text.startsWith('El 9 de octubre'));
  assert.equal(derrame?.date, '2026-10-09', 'a fact of a page without date is dated by its own text');
  assert.deepEqual(candidates.map(candidate => candidate.n), candidates.map((_, index) => index + 1));
  // Newest page first and one fact of each page before the second of any.
  assert.equal(candidates[0]!.source.id, SOURCES[1]!.id);
  assert.equal(candidates[1]!.source.id, SOURCES[0]!.id);
  assert.equal(selectHarvestCandidates(input, { ...settings, maxFacts: 2 }).length, 2);
});

test('a proposal is accepted only if what it says is in the facts it cites', () => {
  const pick = (overrides: Record<string, unknown>, extra: Partial<typeof input> = {}) => {
    const candidates = selectHarvestCandidates({ ...input, ...extra }, settings);
    return rejectionOf(proposal(overrides), candidates, input, 30);
  };
  const candidates = selectHarvestCandidates(input, settings);
  const numbered = (prefix: string) => candidates.find(candidate => candidate.text.startsWith(prefix))!.n;
  const bodega = numbered('Auxiliar de Bodega');
  const cocina = numbered('Ayudantes de Cocina');
  const base = { hechos: [bodega, cocina] };
  assert.equal(pick(base), null);
  assert.equal(pick({ hechos: [99] }), 'fact_not_listed');
  assert.equal(pick({ ...base, frase: `${'Sodexo Chile publicó vacantes. '.repeat(10)}` }), 'too_long');
  assert.equal(pick({ ...base, frase: 'Sodexo Chile publicó vacantes: https://redimin.cl/nota con 10 cupos en Malloa.' }), 'markup');
  assert.equal(pick({ ...base, fecha: '2026-02-30' }), 'invalid_date');
  assert.equal(pick({ ...base, fecha: '2026-08-14' }), 'date_out_of_window');
  assert.equal(pick({ ...base, fecha: '2026-10-15' }), 'date_not_in_facts', 'neither the date of the page nor one of the text');
  assert.equal(pick({ ...base, fecha: '2026-10-12' }), null, 'the date of the page');
  assert.equal(pick({ ...base, conexion: 'indirecta' }), 'indirect', 'a forced signal is worse than none');
  assert.equal(pick({ hechos: [numbered('El 9 de octubre')], frase: 'Sodexo Chile vio un derrame de ácido nítrico el 9 de octubre en Mejillones.', fecha: '2026-10-09' }), 'no_fact_for_the_draft', 'the fact of a third-party page that does not name the company would be dropped by the draft');
  assert.equal(pick({ ...base, frase: 'La empresa publicó avisos con 10 vacantes de auxiliar de bodega en Malloa.' }), 'company_not_named');
  assert.equal(pick({ ...base, frase: 'Sodexo Chile publicó avisos con 25 vacantes de auxiliar de bodega en Malloa.' }), 'number_not_in_facts', 'a sum or an invention is not in the facts');
  assert.equal(pick({ ...base, frase: 'Sodexo Chile publicó avisos con 10 vacantes de auxiliar de bodega en Rancagua.' }), 'name_not_in_facts');
  const sources = [bodega, numbered('Sodexo busca coordinadores'), numbered('El 9 de octubre')];
  assert.equal(pick({ hechos: sources }), 'too_many_sources');
});

test('the day, month and year of the signal may be written even if the fact has them in another form, and the first word of a sentence is free', () => {
  const candidates = selectHarvestCandidates({ ...input, facts: [fact(10, 1, 'Sodexo Chile publicó el 2026-10-12 un aviso para Ayudante de Bodega en Malloa con 10 vacantes disponibles de inmediato.')] }, settings);
  assert.equal(rejectionOf(proposal({ hechos: [1], frase: 'Durante el 12 de octubre de 2026, Sodexo Chile publicó un aviso de 10 vacantes de Ayudante de Bodega en Malloa.' }), candidates, input, 30), null);
});

test('the prompt carries the offer, the role, the window and the facts, never a name', () => {
  const candidates = selectHarvestCandidates(input, settings);
  const prompt = buildSignalHarvestPrompt(input, candidates, settings);
  assert.match(prompt, /Hoy es 2026-10-23/);
  assert.match(prompt, /Gerente de Personas \(Recursos Humanos\)/);
  assert.match(prompt, /AXIS: consulta antecedentes laborales/);
  assert.match(prompt, /últimos 30 días/);
  assert.match(prompt, /1\. \[2026-10-21\] chilepaisminero\.com ✓: Sodexo busca coordinadores/, 'a fact the draft can take is marked');
  assert.match(prompt, /\d+\. \[2026-10-09\] [a-z.]+: El 9 de octubre se produjo un derrame/, 'one that names another company is not');
});

test('the signals come back as claims drafts that the research consolidates, and the ones the checks refuse do not', async () => {
  const bodega = selectHarvestCandidates(input, settings).find(candidate => candidate.text.startsWith('Auxiliar de Bodega'))!.n;
  const cocina = selectHarvestCandidates(input, settings).find(candidate => candidate.text.startsWith('Ayudantes de Cocina'))!.n;
  const requests: any[] = [];
  const generate = async (request: any) => {
    requests.push(request);
    return {
      data: { senales: [
        proposal({ hechos: [bodega, cocina] }),
        proposal({ hechos: [bodega], frase: 'Sodexo Chile publicó avisos con 99 vacantes de auxiliar de bodega en Malloa.' }),
        proposal({ hechos: [bodega, cocina], frase: 'Sodexo Chile publicó avisos con 10 vacantes de auxiliar de bodega en Malloa y 5 de ayudante de cocina en Coquimbo.' }),
      ] },
      telemetry: { usage: { prompt_tokens: 9_000, completion_tokens: 400 }, modelName: 'claude-sonnet-5-5' },
    } as any;
  };
  const result = await harvestResearchSignals(input, settings, { generate });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].openAiModel, 'claude-sonnet-5-5');
  assert.equal(requests[0].temperature, 0);
  assert.equal(result.picked, 3);
  assert.deepEqual(result.rejected, ['number_not_in_facts', 'duplicate']);
  assert.deepEqual(result.usage, { inputTokens: 9_000, outputTokens: 400 });
  assert.equal(result.drafts.length, 1);
  const [draft] = result.drafts;
  assert.equal(draft!.dimension, 'signal');
  assert.equal(draft!.type, 'fact');
  assert.equal(draft!.scope, 'company');
  assert.equal(draft!.observedAt, '2026-10-12T12:00:00.000Z');
  assert.equal(draft!.freshnessDays, 11);
  assert.deepEqual(draft!.evidenceIds, [FACTS[0]!.id, FACTS[1]!.id].sort());
  // The research consolidates it like any other claim: it is valid, has its short id and keeps the facts it stands on.
  const consolidated = consolidateReportV2Claims({ drafts: result.drafts, facts: FACTS });
  assert.equal(consolidated.claims.length, 1);
  assert.equal(consolidated.claims[0]!.dimension, 'signal');
  assert.deepEqual(consolidated.claims[0]!.evidenceIds, draft!.evidenceIds);
});

test('a signal the extraction already found is not added twice, and no more than the limit are kept', async () => {
  const [first, second] = selectHarvestCandidates(input, settings);
  const generate = async () => ({
    data: { senales: [
      proposal({ hechos: [first!.n], frase: 'Sodexo Chile busca coordinadores de control y gestión para sus contratos mineros en Antofagasta y Copiapó.', fecha: '2026-10-21' }),
      proposal({ hechos: [second!.n], frase: 'Sodexo Chile publicó un aviso con 10 vacantes de auxiliar de bodega en Malloa, Región de O\'Higgins.', fecha: '2026-10-12' }),
    ] },
    telemetry: { usage: {}, modelName: 'claude-sonnet-5-5' },
  }) as any;
  const withExisting = await harvestResearchSignals({ ...input, existingSignals: ['Sodexo busca coordinadores de control y gestión para sus contratos mineros en Antofagasta y Copiapó'] }, settings, { generate });
  assert.equal(withExisting.drafts.length, 1);
  assert.ok(withExisting.rejected.includes('duplicate'));
  const capped = await harvestResearchSignals(input, { ...settings, maxSignals: 1 }, { generate });
  assert.equal(capped.drafts.length, 1);
});

test('with no fact inside the window the model is not called, and a model that fails throws so the research can go on without', async () => {
  let calls = 0;
  const none = await harvestResearchSignals({ ...input, facts: [FACTS[3]!] }, settings, { generate: async () => { calls += 1; return null as any; } });
  assert.deepEqual(none, { drafts: [], candidates: 0, picked: 0, rejected: [], usage: null });
  assert.equal(calls, 0);
  await assert.rejects(harvestResearchSignals(input, settings, { generate: async () => { throw new Error('anthropic down'); } }), /anthropic down/);
});
