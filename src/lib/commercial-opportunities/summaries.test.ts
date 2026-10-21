import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanSummary, fallbackLine, needsTenderDetail, opportunitySummary, summaryBasis, summaryCase, summaryFromNameOnly, summaryPrompt } from './summaries';

const tender = (data: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ id: 't1', kind: 'tender', title: 'SERVICIO DE VIGILANCIA SAG AEROPUERTO', buyer_name: null,
  company_name: null, amount: null, currency: null, deadline_at: null, data, ...extra });

test('a tender listed by name only asks for its official file; one with buyer and description, or already read, does not', () => {
  assert.equal(needsTenderDetail(tender({ description: 'SERVICIO DE VIGILANCIA SAG AEROPUERTO', observed: { code: '1234-5-LP26' } })), true);
  assert.equal(needsTenderDetail(tender({ description: 'Guardias 24/7 para el recinto del aeropuerto', observed: { code: '1234-5-LP26' } }, { buyer_name: 'Servicio Agrícola y Ganadero' })), false);
  assert.equal(needsTenderDetail(tender({ description: 'SERVICIO DE VIGILANCIA SAG AEROPUERTO', observed: { code: '1234-5-LP26' }, detail: { at: '2026-10-19' } })), false);
  assert.equal(needsTenderDetail(tender({ description: 'x', observed: {} })), false, 'without a code there is nothing to ask');
  assert.equal(needsTenderDetail({ ...tender({ observed: { code: '9-1-COT26' } }), kind: 'compra_agil' }), false, 'Compra Ágil comes with its buyer');
});

test('the case the model reads says only what the opportunity says, and drops a description that repeats the name', () => {
  const read = summaryCase(tender({ description: 'servicio de vigilancia sag aeropuerto', buyerUnit: 'Unidad Aeropuerto', observed: { code: '1', region: 'Región Metropolitana', items: [{ name: 'Guardias de seguridad' }, { name: '' }] } },
    { buyer_name: 'Servicio Agrícola y Ganadero', amount: 48000000, currency: 'CLP' }));
  assert.deepEqual(read, { id: 't1', tipo: 'Licitación pública', nombre: 'SERVICIO DE VIGILANCIA SAG AEROPUERTO', organismoOEmpresa: 'Servicio Agrícola y Ganadero', unidad: 'Unidad Aeropuerto',
    descripcion: null, lineas: ['Guardias de seguridad'], region: 'Región Metropolitana', monto: '48000000 CLP', avisos: null });
  const hiring = summaryCase({ id: 'h1', kind: 'hiring', title: 'Actividad de contratación: ISEG CHILE', company_name: 'ISEG CHILE', data: { description: 'Urgente Guardia de Seguridad 4x4 · Santiago', observed: { ads: 3 } } });
  assert.equal(hiring.tipo, 'Avisos de trabajo en LinkedIn');
  assert.equal(hiring.avisos, 3);
  assert.match(hiring.descripcion!, /Guardia de Seguridad/);
});

test('the basis records whether the model had the official file, a text or only the name', () => {
  assert.equal(summaryBasis(tender({ description: 'SERVICIO DE VIGILANCIA SAG AEROPUERTO', detail: { at: 'x' } })), 'ficha');
  assert.equal(summaryBasis(tender({ description: 'Guardias para el recinto' })), 'texto');
  assert.equal(summaryBasis(tender({ description: 'SERVICIO DE VIGILANCIA SAG AEROPUERTO', observed: { items: [] } })), 'nombre');
});

test('the prompt asks for one or two sentences without invented facts or advice', () => {
  const prompt = summaryPrompt([summaryCase(tender({}))]);
  assert.match(prompt, /máximo 200 caracteres/);
  assert.match(prompt, /Nunca inventes montos, plazos, cantidades ni lugares/);
  assert.match(prompt, /No opines si conviene postular/);
  assert.match(prompt, /Nunca comentes de dónde sale lo que dices ni lo que falta/);
  assert.match(prompt, /sin «Se requiere», «Se busca» ni «Se necesita»/);
  assert.match(prompt, /"id":"t1"/);
});

test('a summary is one line, without quotes, ending in a period and cut at a word when long', () => {
  assert.equal(cleanSummary('«Guardias para el SAG en el aeropuerto»'), 'Guardias para el SAG en el aeropuerto.');
  assert.equal(cleanSummary('Aseo de oficinas\n en Castro.'), 'Aseo de oficinas en Castro.');
  const long = cleanSummary(`${'Servicio de vigilancia y control de accesos '.repeat(8)}final`);
  assert.ok(long.length <= 220, String(long.length));
  assert.match(long, /…$/);
  assert.doesNotMatch(long, / …$/);
});

test('what the model says about its sources or what is missing does not reach the card', () => {
  assert.equal(cleanSummary('Se requiere un servicio de guardias; el nombre no indica lugar ni detalles adicionales.'), 'Se requiere un servicio de guardias.');
  assert.equal(cleanSummary('Aseo de oficinas en Tocopilla, según el nombre de la oportunidad.'), 'Aseo de oficinas en Tocopilla.');
  assert.equal(cleanSummary('Mantención de aires acondicionados. Solo consta el nombre de la licitación, sin más detalles.'), 'Mantención de aires acondicionados.');
  assert.equal(cleanSummary('Aseo y retiro de residuos para establecimientos. Solo consta el nombre de la licitación, que aparece truncado.'), 'Aseo y retiro de residuos para establecimientos.');
  assert.equal(cleanSummary('Traslado de insumos y bienes. Solo consta el nombre; no hay organismo ni región informados.'), 'Traslado de insumos y bienes.');
  assert.equal(cleanSummary('Guardias 24/7 para el recinto del SAG en el aeropuerto de Santiago.'), 'Guardias 24/7 para el recinto del SAG en el aeropuerto de Santiago.', 'a plain summary stays');
  assert.equal(cleanSummary('Solo consta el nombre de la licitación.'), '', 'nothing left: no line');
});

test('a summary from the name alone of a tender never read is written again; a file found missing ends it', () => {
  const nameOnly = { evaluation: 'review', description: 'SERVICIO DE VIGILANCIA SAG AEROPUERTO', observed: { code: '1234-5-LP26' }, summary: { text: 'x', basis: 'nombre' } };
  assert.equal(summaryFromNameOnly(tender(nameOnly)), true);
  assert.equal(summaryFromNameOnly(tender({ ...nameOnly, detail: { at: 'x', found: false } })), false);
  assert.equal(summaryFromNameOnly(tender({ ...nameOnly, summary: { text: 'x', basis: 'ficha' } })), false);
  assert.equal(summaryBasis(tender({ description: 'SERVICIO DE VIGILANCIA SAG AEROPUERTO', detail: { at: 'x', found: false } })), 'nombre', 'a file not found is not a file');
});

test('the saved summary is read only when it has text', () => {
  assert.equal(opportunitySummary({ summary: { text: ' Guardias para el SAG. ' } }), 'Guardias para el SAG.');
  assert.equal(opportunitySummary({ summary: { text: '' } }), null);
  assert.equal(opportunitySummary({}), null);
  assert.equal(opportunitySummary(null), null);
});

test('a LinkedIn card with no summary yet says what the screening already found: why it matters, or else the jobs or the post', () => {
  const hiring = (reasons: unknown, description: string, kind = 'hiring') => ({ kind, title: 'Actividad de contratación: Assetplan', reasons, data: { description } });
  const jobs = 'Guardia de Seguridad Part Time · Santiago, Región Metropolitana, Chile · https://cl.linkedin.com/jobs/view/a\nGuardia 4x4 Edificios · Providencia, Chile · https://cl.linkedin.com/jobs/view/b\nConserje Nocturno · Ñuñoa · https://cl.linkedin.com/jobs/view/c';
  const why = 'Búsqueda de guardias part time y 4x4 para edificios residenciales; señal de dotación de seguridad, pero no se sabe si se externalizará.';
  assert.equal(fallbackLine(hiring([why], jobs)), why, 'the screening reason first');
  assert.equal(fallbackLine(hiring(['Pendiente de evaluación de afinidad'], jobs)), 'Busca Guardia de Seguridad Part Time, Guardia 4x4 Edificios y 1 más.', 'a generic reason says nothing: the jobs do');
  assert.equal(fallbackLine(hiring([], jobs.split('\n').slice(0, 2).join('\n'))), 'Busca Guardia de Seguridad Part Time y Guardia 4x4 Edificios.');
  assert.equal(fallbackLine(hiring([], 'Operador de Grúa Horquilla · Santiago · https://x')), 'Busca Operador de Grúa Horquilla.');
  assert.equal(fallbackLine(hiring([], 'Operador · A\nOperador · B\nVendedor · C')), 'Busca Operador y Vendedor.', 'the same job posted twice counts once');
  assert.equal(fallbackLine(hiring(['Pendiente de evaluación'], '')), null, 'nothing to say: nothing shown');
  assert.equal(fallbackLine(hiring(undefined, '')), null);
  assert.equal(fallbackLine(hiring('not a list' as any, jobs)), 'Busca Guardia de Seguridad Part Time, Guardia 4x4 Edificios y 1 más.');
  assert.equal(fallbackLine(hiring([], 'Actividad de contratación: Assetplan')), 'Busca Actividad de contratación: Assetplan.', 'whatever the postings say');
  const long = 'x'.repeat(400);
  assert.ok(fallbackLine(hiring([`${long} y más`], jobs))!.length <= 220, 'a long reason is cut');
  assert.match(fallbackLine(hiring(['palabra '.repeat(80)], jobs))!, /…$/);
  // A post: its reason, or else what it says.
  assert.equal(fallbackLine(hiring([], 'Buscamos proveedores de mano de obra para nuestra licitación en Bogotá.', 'linkedin_post')), 'Buscamos proveedores de mano de obra para nuestra licitación en Bogotá.');
  assert.equal(fallbackLine(hiring([], '   ', 'linkedin_post')), null);
  // Everything else waits for its summary.
  for (const kind of ['tender', 'compra_agil', 'private']) assert.equal(fallbackLine(hiring([why], jobs, kind)), null, kind);
});
