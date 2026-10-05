import assert from 'node:assert/strict';
import test from 'node:test';
import { GRUPOEXPRO_PILOT, GRUPOEXPRO_TENDER_KEYWORDS } from './pilot';
import { suggestedHiringProfile } from './profile-suggestion';

test('GrupoExpro starts from its pilot values, recognized by its organization name', () => {
  for (const name of ['GrupoExpro', 'Grupo Expro SpA', 'grupoexpro']) {
    const suggestion = suggestedHiringProfile({ organizationName: name, offer: 'otra cosa' });
    assert.equal(suggestion.pilot, true, name);
    assert.equal(suggestion.offer, GRUPOEXPRO_PILOT.offer);
    assert.deepEqual(suggestion.roles, [...GRUPOEXPRO_PILOT.roles]);
    assert.deepEqual(suggestion.keywords, [...GRUPOEXPRO_TENDER_KEYWORDS]);
  }
});

test('any other organization starts from its own offer and nothing invented', () => {
  const suggestion = suggestedHiringProfile({ organizationName: 'Constructora Andes', offer: '  Arriendo de maquinaria\npesada  ' });
  assert.deepEqual(suggestion, {
    name: 'Qué buscamos', offer: 'Arriendo de maquinaria pesada', roles: [], regions: [], minAds: 5, keywords: [], unspscCodes: [], sectors: [],
    minInvestmentUsd: null, pilot: false,
  });
  assert.equal(suggestedHiringProfile({ organizationName: null, offer: null }).offer, '');
  assert.ok(!JSON.stringify(suggestedHiringProfile({ organizationName: 'Otra', offer: '' })).includes('operario'), 'no pilot roles for others');
});
