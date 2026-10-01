import assert from 'node:assert/strict';
import test from 'node:test';
import { APOLLO_SENIORITIES } from '@/lib/apollo-taxonomies';
import { companySizes } from '@/lib/data';
import { DEFAULT_LEAD_SEARCH_FILTERS } from '@/lib/search/saved-search-criteria';
import { activeFilterChips, savedLeadsToast, searchStartersFor } from '@/lib/search/search-guidance';

test('starting points follow what the organization sells, and anyone else gets generic buyers', () => {
  assert.deepEqual(searchStartersFor('GrupoExpro').map((starter) => starter.id),
    ['expro-transitorios', 'expro-outsourcing', 'expro-seleccion', 'expro-pay']);
  assert.equal(searchStartersFor('Grupo Expro Chile')[0]?.id, 'expro-transitorios');
  assert.deepEqual(searchStartersFor('PSOL').map((starter) => starter.id), ['psol-evaluaciones', 'psol-masiva', 'psol-comercial']);
  assert.equal(searchStartersFor('Yago SpA')[0]?.id, 'generic-rrhh');
  assert.equal(searchStartersFor('')[0]?.id, 'generic-rrhh');
  // «psol» must be its own word: an unrelated name that contains it gets the generic set.
  assert.equal(searchStartersFor('Apsolutions')[0]?.id, 'generic-rrhh');
});

test('every starting point fills only valid filter values', () => {
  const seniorities = new Set(APOLLO_SENIORITIES.map((option) => option.value));
  for (const name of ['GrupoExpro', 'PSOL', 'Otra']) {
    for (const starter of searchStartersFor(name)) {
      assert.ok(starter.label.length <= 30 && starter.description.length <= 90, starter.id);
      assert.ok(starter.filters.title.trim(), starter.id);
      assert.ok(!starter.filters.sizeRange || companySizes.includes(starter.filters.sizeRange), starter.id);
      for (const seniority of starter.filters.seniorities) assert.ok(seniorities.has(seniority), `${starter.id}:${seniority}`);
    }
  }
});

test('saving says where people went and offers the one next step', () => {
  assert.deepEqual(savedLeadsToast({ withContact: 3, withoutContact: 0, duplicates: 0 }), {
    title: 'Guardaste 3 contactos', description: '3 contactos con correo o teléfono, listos para escribirles.',
    href: '/saved/leads/enriched', actionLabel: 'Escribirles' });
  const mixed = savedLeadsToast({ withContact: 1, withoutContact: 2, duplicates: 1 });
  assert.equal(mixed.title, 'Guardaste 3 contactos');
  assert.match(mixed.description, /1 contacto con correo o teléfono[\s\S]*2 contactos sin correo: complétalos en «Por completar»\. 1 ya estaba guardado\./);
  assert.equal(mixed.href, '/saved/leads/enriched');
  const withoutEmail = savedLeadsToast({ withContact: 0, withoutContact: 2, duplicates: 0 });
  assert.equal(withoutEmail.href, '/saved/leads');
  assert.equal(withoutEmail.actionLabel, 'Completar correos');
  assert.equal(savedLeadsToast({ withContact: 0, withoutContact: 0, duplicates: 4 }).title, 'Ya tenías estos contactos');
});

test('an empty search names the filters to drop, broadest-first', () => {
  assert.deepEqual(activeFilterChips(DEFAULT_LEAD_SEARCH_FILTERS), []);
  const chips = activeFilterChips({ ...DEFAULT_LEAD_SEARCH_FILTERS, title: 'Gerente de RR. HH.', sizeRange: '201-500', seniorities: ['director', 'manager'], location: 'Chile' });
  assert.deepEqual(chips.map((chip) => chip.field), ['sizeRange', 'seniorities', 'title', 'location']);
  assert.equal(chips[1]?.value, 'director, manager');
});

test('«Tu cliente ideal» from «Perfil» becomes the first starting point', async () => {
  const { idealCustomerStarter } = await import('./search-guidance');
  assert.equal(idealCustomerStarter({ targetRoles: '', targetIndustries: ' ' }), null);
  const starter = idealCustomerStarter({
    targetRoles: 'Gerente de Personas, Jefe de Operaciones, Gerente de Finanzas',
    targetIndustries: 'Retail, Logística',
    targetCompanySize: '201-500',
    targetLocations: 'Perú, Chile',
  });
  assert.equal(starter?.label, 'Tu cliente ideal');
  assert.equal(starter?.description, 'Desde tu perfil: Gerente de Personas y Jefe de Operaciones en Retail y Logística.');
  assert.deepEqual(starter?.filters, {
    companyKeywords: 'Retail, Logística',
    location: 'Perú',
    title: 'Gerente de Personas, Jefe de Operaciones, Gerente de Finanzas',
    sizeRange: '201-500',
    seniorities: [],
  });
  assert.equal(idealCustomerStarter({ targetIndustries: 'Minería' })?.filters.location, 'Chile');
});
