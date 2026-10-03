import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import type { Lead } from '@/lib/types';
import { SAVED_LOOKUP_LABELS, classifyEnrichmentResults, savedLeadToEnriched, savedLookupState } from './saved-enrichment';

const saved = (id: string, overrides: Partial<Lead> = {}): Lead => ({
  id, name: `Persona ${id}`, title: 'Gerente de Personas', company: 'Retail Andino', email: null, avatar: '', status: 'saved',
  companyWebsite: 'https://www.retailandino.cl', linkedinUrl: `https://linkedin.com/in/${id}`, ...overrides,
} as Lead);

test('each saved contact shows whether it has an email, was searched without luck, or was never searched', () => {
  assert.equal(savedLookupState({ email: 'ana@retail.cl' }), 'with_email');
  assert.equal(savedLookupState({ email: null, emailEnrichment: { status: 'not_found', attemptedAt: '2026-10-02T10:00:00Z' } }), 'not_found');
  assert.equal(savedLookupState({ email: '' }), 'not_searched');
  assert.equal(savedLookupState({ email: 'email_not_unlocked' }), 'not_searched', 'a placeholder without @ is not an email');
});

test('only contacts with an email, a phone or a running lookup move to «Por escribir»; the rest stay marked', () => {
  const chosen = [saved('a'), saved('b'), saved('c'), saved('d'), saved('e')];
  const outcome = classifyEnrichmentResults(chosen, [
    { clientRef: 'a', id: 'enr-a', email: 'a@retail.cl', emailStatus: 'verified' },
    { clientRef: 'b', id: 'enr-b', email: '', primaryPhone: '+56 9 1111 2222' },
    { clientRef: 'c', id: 'enr-c', email: '', enrichmentStatus: 'pending' },
    { clientRef: 'd', id: 'enr-d', email: '', enrichmentStatus: 'completed' },
    { clientRef: 'zz', id: 'stranger', email: 'x@y.cl' },
    { clientRef: 'a', id: 'enr-a-dup', email: 'a@retail.cl' },
  ], { revealPhone: false });

  assert.deepEqual(outcome.removeFromSaved, ['a', 'b', 'c']);
  assert.deepEqual(outcome.notFound, ['d'], 'a finished search with nothing stays in «Por completar»');
  assert.equal(outcome.toEnriched.length, 3, 'a stranger row and a duplicate are ignored; «e» had no answer and is left untouched');
  const [withEmail, withPhone, pending] = outcome.toEnriched;
  assert.equal(withEmail.email, 'a@retail.cl');
  assert.equal(withEmail.emailStatus, 'verified');
  assert.equal(withEmail.companyDomain, 'retailandino.cl', 'the domain comes from the saved website');
  assert.equal(withPhone.email, undefined);
  assert.equal(withPhone.emailStatus, 'unknown');
  assert.equal(withPhone.primaryPhone, '+56 9 1111 2222');
  assert.equal(pending.enrichmentStatus, 'pending', 'a running lookup moves and finishes on its new row');
});

test('a saved contact with an email moves without a search, keeping its provider id', () => {
  const moved = savedLeadToEnriched(saved('f', { email: 'f@retail.cl', apolloId: 'apollo-9', companyWebsite: null, country: 'Chile' }));
  assert.equal(moved.email, 'f@retail.cl');
  assert.equal(moved.sourceProviderId, 'apollo-9');
  assert.equal(moved.companyDomain, 'retail.cl', 'without a website the domain comes from the email');
  assert.equal(moved.fullName, 'Persona f');
  assert.equal(moved.country, 'Chile');
});

test('«Por completar» moves only what the classification says, marks the rest and shows the cost before searching', () => {
  const page = readFileSync('src/app/(app)/saved/leads/page.tsx', 'utf8');
  assert.match(page, /classifyEnrichmentResults\(chosen,/);
  assert.match(page, /supabaseService\.markEmailNotFound\(outcome\.notFound, attemptedAt\)/);
  assert.doesNotMatch(page, /processedRefs/, 'a processed contact without email no longer leaves the list');
  assert.match(page, /APOLLO_EMAIL_ENRICHMENT_CREDITS/, 'the action bar names the credits a search uses');
  assert.match(page, /data-tour="saved-list"/);
  assert.deepEqual(Object.keys(SAVED_LOOKUP_LABELS).sort(), ['not_found', 'not_searched', 'with_email']);
});
