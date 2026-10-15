import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createEmptyProfileForm, getDefaultSuggestionSelection } from './profile-mappings';
import { suggestionFromWorkspaceOffer, WORKSPACE_OFFER_SOURCE } from './workspace-offer-suggestion';

const offer = { offer: 'Cubrimos peaks de temporada con personal transitorio en 48 horas.', services: ['Transitorios', 'Outsourcing de procesos'], territories: ['Chile', 'Perú'] };

test('the offer confirmed in Oportunidades becomes profile fields, with where it came from', () => {
  const suggestion = suggestionFromWorkspaceOffer(offer, createEmptyProfileForm());
  assert.deepEqual(suggestion?.values, { services: 'Transitorios\nOutsourcing de procesos', valueProposition: offer.offer, targetLocations: 'Chile, Perú' });
  assert.equal(suggestion?.sourceLabel, WORKSPACE_OFFER_SOURCE);
  // Empty fields come checked; nothing is saved until «Guardar cambios».
  assert.deepEqual(Object.entries(getDefaultSuggestionSelection(createEmptyProfileForm(), suggestion!.values)).filter(([, on]) => on).map(([field]) => field),
    ['services', 'valueProposition', 'targetLocations']);
});

test('only the fields it would change are proposed, and a profile that already says it gets nothing', () => {
  const profile = { ...createEmptyProfileForm(), services: 'Transitorios\nOutsourcing de procesos', valueProposition: 'Otra propuesta escrita a mano' };
  const suggestion = suggestionFromWorkspaceOffer(offer, profile);
  assert.deepEqual(Object.keys(suggestion?.values || {}), ['valueProposition', 'targetLocations']);
  // A different value proposition is proposed but not checked: it replaces what the person wrote only if they check it.
  assert.equal(getDefaultSuggestionSelection(profile, suggestion!.values).valueProposition, false);
  assert.equal(suggestionFromWorkspaceOffer(offer, { ...profile, valueProposition: offer.offer, targetLocations: 'Chile, Perú' }), null);
});

test('the profile reads only the offer text, and only for accounts with Oportunidades', () => {
  const route = readFileSync('src/app/api/commercial-opportunities/workspace/offer/route.ts', 'utf8');
  assert.match(route, /requireOpportunityWorkspace\(\)/);
  assert.match(route, /\.select\('offer,services,territories'\)\s*\n?\s*\.eq\('organization_id', scope\.organizationId\)/);
  const page = readFileSync('src/app/(app)/profile/page.tsx', 'utf8');
  assert.match(page, /const \{ opportunities \} = useSharedNavAccess\(\);/);
  assert.match(page, /if \(!opportunities\) return;/);
});
