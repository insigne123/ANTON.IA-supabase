import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PROFILE_SEARCH_ACTION_LABELS, profileProblemFromHttp, profileProblemFromMessage, profileProblemFromProviderCode,
  profileSearchMessage, profileSearchPersonHint, profileUrlProblem, type ProfileSearchProblem,
} from '@/lib/search/profile-search-outcome';

const ALL: ProfileSearchProblem[] = ['invalid_url', 'sales_navigator_url', 'company_page_url', 'not_found', 'no_usable_data',
  'identity_mismatch', 'provider_unavailable', 'credits_exhausted', 'daily_limit', 'session_expired', 'unknown'];

test('every problem says what happened in Spanish, never blames the filters, and offers known actions', () => {
  for (const problem of ALL) {
    const message = profileSearchMessage(problem, { url: 'https://www.linkedin.com/in/maria-jose-perez' });
    assert.ok(message.title.length > 0 && message.title.length <= 60, problem);
    assert.ok(message.description.length > 0 && message.description.length <= 240, problem);
    assert.doesNotMatch(`${message.title} ${message.description}`, /filtros|Apollo|busqueda|sesion\b|valida\b/i, problem);
    for (const action of message.actions) assert.ok(PROFILE_SEARCH_ACTION_LABELS[action], `${problem}:${action}`);
  }
  // Problems the person can work around always offer a way forward.
  for (const problem of ['not_found', 'identity_mismatch', 'no_usable_data', 'company_page_url', 'unknown'] as const) {
    assert.ok(profileSearchMessage(problem).actions.includes('search_company'), problem);
  }
  assert.deepEqual(profileSearchMessage('provider_unavailable').actions, ['retry']);
});

test('the person to look for comes from the slug, never from a custom slug with digits', () => {
  assert.equal(profileSearchPersonHint('https://www.linkedin.com/in/maria-jose-perez'), 'Maria Jose Perez');
  assert.match(profileSearchMessage('not_found', { url: 'https://www.linkedin.com/in/maria-jose-perez' }).description, /Busca a Maria Jose Perez/);
  assert.equal(profileSearchPersonHint('https://www.linkedin.com/in/jperez87'), '');
  assert.match(profileSearchMessage('not_found', { url: 'https://www.linkedin.com/in/jperez87' }).description, /Busca a la persona/);
});

test('URL, provider, HTTP and legacy message failures map to the right problem', () => {
  assert.equal(profileUrlProblem('https://www.linkedin.com/in/ana'), null);
  assert.equal(profileUrlProblem('https://www.linkedin.com/sales/lead/ACwAAA'), 'sales_navigator_url');
  assert.equal(profileUrlProblem('https://www.linkedin.com/company/acme'), 'company_page_url');
  assert.equal(profileUrlProblem('ana soto'), 'invalid_url');

  assert.equal(profileProblemFromProviderCode('APOLLO_PERSON_IDENTITY_MISMATCH'), 'identity_mismatch');
  assert.equal(profileProblemFromProviderCode('APOLLO_CREDITS_EXHAUSTED'), 'credits_exhausted');
  assert.equal(profileProblemFromProviderCode('apollo_person_not_found'), 'not_found');
  for (const code of ['APOLLO_UPSTREAM_ERROR', 'APOLLO_UPSTREAM_TIMEOUT', 'APOLLO_GATEWAY_HTTP_503', 'APOLLO_GATEWAY_TIMEOUT', 'APOLLO_RATE_LIMITED', 'APOLLO_ENRICHMENT_FAILED', 'pre_provider_failure']) {
    assert.equal(profileProblemFromProviderCode(code), 'provider_unavailable', code);
  }
  assert.equal(profileProblemFromProviderCode(''), null);

  assert.equal(profileProblemFromHttp(503), 'provider_unavailable');
  assert.equal(profileProblemFromHttp(429), 'daily_limit');
  assert.equal(profileProblemFromHttp(401), 'session_expired');
  assert.equal(profileProblemFromHttp(402), 'credits_exhausted');
  assert.equal(profileProblemFromHttp(400, 'APOLLO_PROVIDER_NOT_CONFIGURED'), 'provider_unavailable');
  assert.equal(profileProblemFromHttp(409), 'unknown');

  assert.equal(profileProblemFromMessage('APOLLO_PROFILE_NO_USABLE_DATA'), 'no_usable_data');
  assert.equal(profileProblemFromMessage('El proveedor devolvió un perfil distinto al solicitado.'), 'identity_mismatch');
  assert.equal(profileProblemFromMessage('No pudimos iniciar la búsqueda de datos de contacto.'), 'provider_unavailable');
  assert.equal(profileProblemFromMessage('Failed to fetch'), 'provider_unavailable');
  assert.equal(profileProblemFromMessage('algo raro'), 'unknown');
});
