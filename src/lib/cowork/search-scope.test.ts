import assert from 'node:assert/strict';
import test from 'node:test';
import { coworkSearchCriteriaSchema } from './search-proposal';
import { coworkExplainsSearchScope, coworkRequestedPlaces, coworkSearchDefaults, coworkSearchScope, coworkSearchScopeNotice } from './search-scope';

const criteria = (fields: Record<string, unknown> = {}) => coworkSearchCriteriaSchema.parse({
  titles: ['Gerente de Recursos Humanos'], industries: ['retail'], locations: [], limit: 25, ...fields,
});
const chile = { places: ['Chile'], source: 'default' as const };

test('a request names the places to search in, never a verb or a place it leaves out', () => {
  assert.deepEqual(coworkRequestedPlaces('Busca empresas de Chile y personas de reclutamiento'), ['Chile']);
  assert.deepEqual(coworkRequestedPlaces('busca 25 gerentes de RRHH de retail en Santiago'), ['Santiago']);
  assert.deepEqual(coworkRequestedPlaces('empresas chilenas y peruanas de minería'), ['Chile', 'Perú']);
  assert.deepEqual(coworkRequestedPlaces('gerentes de finanzas fuera de Santiago, en regiones de Chile'), ['Chile']);
  assert.deepEqual(coworkRequestedPlaces('busca jefes de selección; usa el tono formal'), [], '«usa» is the verb, not the United States');
  assert.deepEqual(coworkRequestedPlaces('en la Región Metropolitana y en Santiago'), ['Santiago'], 'one place');
  assert.deepEqual(coworkRequestedPlaces('busca gerentes de operaciones en Antofagasta y Calama'), ['Antofagasta', 'Calama']);
});

test('a place asked for and left out goes back to the model, widened or narrowed alike', () => {
  const dropped = coworkSearchScope(criteria(), 'Busca empresas de Chile y personas de reclutamiento', chile);
  assert.deepEqual(dropped.missing, ['Chile']);
  assert.match(dropped.problem || '', /nombra Chile y la búsqueda no tiene ubicación/);
  assert.equal(dropped.added, null, 'never filled behind the model when the person said where');

  const widened = coworkSearchScope(criteria({ locations: ['Chile'] }), 'gerentes de RRHH de retail en Santiago', chile);
  assert.deepEqual(widened.missing, ['Santiago']);
  assert.match(widened.problem || '', /«Santiago, Chile»/);

  const narrowed = coworkSearchScope(criteria({ locations: ['Santiago, Chile'] }), 'busca gerentes de RRHH en Chile', chile);
  assert.deepEqual(narrowed.missing, ['Chile'], 'one city of a country asked for whole is a change too');

  const calama = coworkSearchScope(criteria({ locations: ['Antofagasta, Chile'] }), 'jefes de operaciones en Calama', chile);
  assert.deepEqual(calama.missing, ['Calama'], 'a nearby city does not cover another one');
});

test('the place as asked keeps the criteria as they are', () => {
  for (const [locations, request] of [
    [['Santiago, Chile'], 'busca 25 gerentes de RRHH de retail en Santiago'],
    [['Región Metropolitana, Chile'], 'gerentes de personas en Santiago'],
    [['Chile'], 'Busca empresas de Chile y personas de reclutamiento'],
    [['Chile', 'Perú'], 'empresas chilenas y peruanas'],
  ] as const) {
    const scope = coworkSearchScope(criteria({ locations: [...locations] }), request, chile);
    assert.equal(scope.problem, null, request);
    assert.deepEqual(scope.criteria.locations, locations);
  }
});

test('a search with no place at all gets the person\'s market, in the field its target uses', () => {
  const people = coworkSearchScope(criteria(), 'ayudame a buscar leads del retail con cargo alto en selección', chile);
  assert.deepEqual(people.criteria.locations, ['Chile']);
  assert.deepEqual(people.added, chile);
  assert.equal(coworkSearchScopeNotice(people.added!), 'Busco en Chile porque no dijiste dónde; si es en otro lugar, dímelo.');

  const companies = coworkSearchScope(criteria({ target: 'companies', titles: [] }), 'busca empresas de logística', { places: ['Chile', 'Perú'], source: 'profile' });
  assert.deepEqual(companies.criteria.companyLocations, ['Chile', 'Perú']);
  assert.deepEqual(companies.criteria.locations, [], 'a company search never takes people filters');
  assert.equal(coworkSearchScopeNotice(companies.added!), 'Busco en Chile y Perú, el mercado de tu Perfil; si es en otro lugar, dímelo.');
});

test('a single profile, given companies or «anywhere» keep the criteria; a region asked for needs its countries', () => {
  const profile = coworkSearchCriteriaSchema.parse({ linkedinUrl: 'https://www.linkedin.com/in/marcela-rojas', titles: [], industries: [], locations: [], limit: 1 });
  assert.deepEqual(coworkSearchScope(profile, 'consulta este perfil de Santiago', chile).criteria, profile);
  assert.equal(coworkSearchScope(criteria({ companyDomains: ['falabella.com'] }), 'busca gerentes en Falabella', chile).added, null);
  const anywhere = coworkSearchScope(criteria(), 'busca gerentes de RRHH en cualquier país', chile);
  assert.equal(anywhere.added, null);
  assert.deepEqual(anywhere.criteria.locations, []);
  assert.match(coworkSearchScope(criteria(), 'gerentes de RRHH en Latinoamérica', chile).problem || '', /Latinoamérica/);
  assert.equal(coworkSearchScope(criteria({ locations: ['Chile', 'Perú', 'Colombia'] }), 'gerentes de RRHH en LATAM', chile).problem, null);
});

test('a change said in the answer stands; the default comes from Perfil, then from the account', () => {
  assert.equal(coworkExplainsSearchScope('Amplié a todo Chile porque en Calama hay pocos gerentes.', ['Calama']), true);
  assert.equal(coworkExplainsSearchScope('Propongo buscar gerentes en Chile.', ['Calama']), false, 'it must name what it changed');
  assert.equal(coworkExplainsSearchScope('En Calama hay pocos, así que busco en la región.', ['Calama']), false, 'and say it changed it');
  assert.deepEqual(coworkSearchDefaults({ idealCustomer: { locations: ['Chile', ' Perú '] } }, ''), { places: ['Chile', 'Perú'], source: 'profile' });
  assert.deepEqual(coworkSearchDefaults(null, undefined), { places: ['Chile'], source: 'default' });
  assert.deepEqual(coworkSearchDefaults(null, 'Perú'), { places: ['Perú'], source: 'default' });
  assert.equal(coworkSearchDefaults({}, '  '), null, 'an empty setting turns the default off');
});
