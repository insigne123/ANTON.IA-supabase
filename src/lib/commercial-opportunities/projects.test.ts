import assert from 'node:assert/strict';
import test from 'node:test';
import { matchProject, parseSeiaRows, projectSector } from './projects';

const NOW = '2026-10-02T12:00:00Z';
const PROFILE = { sectors: ['mineria', 'energia'], regions: ['Antofagasta'], minInvestmentUsd: 10_000_000 };
const mapRow = (overrides: Record<string, unknown> = {}) => ({
  ID_EXPEDIENTE: '2165432101', NOMBRE_PROYECTO: 'Expansión Mina Norte', FORMA_PRESENTACION: 'EIA', LETRA_TIPOLOGIA: 'i1',
  NOMBRE_TIPOLOGIA: 'Proyectos de desarrollo minero', REGION: 'Región de Antofagasta', TITULAR: 'Minera Norte S.A.', ESTADO_EVALUACION: 'En Calificación',
  FECHA_PRESENTACION: '12/08/2026', COMUNAS: 'Calama', INVERSION_US: '1.250,5', URL_EXPEDIENTE: 'https://seia.sea.gob.cl/expediente/ficha/fichaPrincipal.php?id_expediente=2165432101',
  ...overrides,
});

test('the export of the map is read by its field names or by readable headers', () => {
  const { projects, skipped, missingColumns } = parseSeiaRows([mapRow(), mapRow({ NOMBRE_PROYECTO: '' })]);
  assert.deepEqual([projects.length, skipped, missingColumns], [1, 1, []]);
  assert.deepEqual(projects[0], {
    id: '2165432101', name: 'Expansión Mina Norte', owner: 'Minera Norte S.A.', presentation: 'EIA', typologyLetter: 'i', typology: 'Proyectos de desarrollo minero',
    region: 'Antofagasta', communes: 'Calama', state: 'En Calificación', presentedAt: '2026-08-12', qualifiedAt: null, investmentMusd: 1250.5,
    url: 'https://seia.sea.gob.cl/expediente/ficha/fichaPrincipal.php?id_expediente=2165432101',
  });
  const readable = parseSeiaRows([{ 'Nombre del Proyecto': 'Parque Solar Sur', Titular: 'Energía Sur SpA', Tipo: 'DIA', Región: 'Región de Atacama',
    Estado: 'Aprobado', 'Fecha Presentación': '2026-03-01', 'Inversión (MMU$)': '85.4' }]);
  assert.equal(readable.projects[0].investmentMusd, 85.4);
  assert.equal(readable.projects[0].presentation, 'DIA');
  assert.match(readable.projects[0].id, /^parquesolarsur\|energiasurspa$/, 'without an id, name and owner identify it');
  assert.deepEqual(parseSeiaRows([{ Columna: 'x' }]).missingColumns, ['nombre del proyecto']);
});

test('a project fits when it is alive, of a chosen sector, over the minimum and recent', () => {
  const [project] = parseSeiaRows([mapRow()]).projects;
  const match = matchProject(project, PROFILE, NOW)!;
  assert.equal(match.score, 40 + 25 + 15 + 10 + 10, 'over US$ 500 M, in evaluation, under 6 months, sector, region');
  assert.equal(match.sector, 'mineria');
  assert.ok(match.reasons.includes('estudio de impacto (EIA): proyecto grande'));
  for (const state of ['Rechazado', 'Desistido', 'No Admitido a Tramitación', 'No calificado', 'Caducado']) {
    assert.equal(matchProject({ ...project, state }, PROFILE, NOW), null, state);
  }
  assert.equal(matchProject({ ...project, state: 'Aprobado' }, PROFILE, NOW)?.reasons.includes('aprobado'), true);
  assert.equal(matchProject({ ...project, investmentMusd: 5 }, PROFILE, NOW), null, 'under the minimum');
  assert.equal(matchProject({ ...project, presentedAt: '2023-01-01' }, PROFILE, NOW), null, 'older than two years');
  assert.equal(matchProject({ ...project, typologyLetter: 'g', typology: 'Proyectos inmobiliarios', name: 'Condominio' }, PROFILE, NOW), null, 'another sector');
  assert.ok(matchProject({ ...project, typologyLetter: 'g', typology: 'Proyectos inmobiliarios', name: 'Condominio' }, { ...PROFILE, sectors: [] }, NOW), 'no sector chosen: all');
});

test('the sector comes from the letter of the typology or, without it, from its words', () => {
  assert.equal(projectSector({ typologyLetter: 'c', typology: null, name: 'X' })?.id, 'energia');
  assert.equal(projectSector({ typologyLetter: null, typology: 'Planta fotovoltaica', name: 'X' })?.id, 'energia');
  assert.equal(projectSector({ typologyLetter: null, typology: null, name: 'Centro de bodegaje y almacenamiento' })?.id, 'industria');
  assert.equal(projectSector({ typologyLetter: null, typology: null, name: 'Algo distinto' }), null);
});
