import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildLinkedInProfileNotice,
  companyFilterSignature,
  contactedKeys,
  contactStateBadge,
  displayDomain,
  getFriendlySearchErrorMessage,
  hasBatchSearchFilters,
  hasVisibleLeadEmail,
  hasVisibleLeadPhone,
  isLeadContacted,
  isLeadSaved,
  isPendingEnrichmentStatus,
  mapLeadToEnriched,
  normalizeLeadForUI,
  normalizeUiPhoneNumbers,
  peopleFilterSignature,
  splitFilterInput,
} from './lead-ui';
import { DEFAULT_LEAD_SEARCH_FILTERS } from './saved-search-criteria';

test('provider errors read as plain Spanish, and filter or credit messages pass through as written', () => {
  assert.match(getFriendlySearchErrorMessage(''), /No pudimos completar la búsqueda/);
  assert.match(getFriendlySearchErrorMessage('HTTP_502 upstream'), /no respondió/);
  assert.match(getFriendlySearchErrorMessage('APOLLO_PROFILE_NO_USABLE_DATA'), /No hay nombre, cargo ni empresa/);
  assert.equal(getFriendlySearchErrorMessage('Debes elegir al menos un filtro'), 'Debes elegir al menos un filtro');
  assert.equal(getFriendlySearchErrorMessage('No tienes créditos suficientes'), 'No tienes créditos suficientes');
  assert.match(getFriendlySearchErrorMessage('429 quota exceeded'), /límite disponible por hoy/);
  assert.match(getFriendlySearchErrorMessage('Unauthorized'), /sesión necesita renovarse/);
});

test('a provider lead becomes a row: hidden email placeholder, phones and the company site', () => {
  const lead = normalizeLeadForUI({
    id: 'p1',
    first_name: 'Ana',
    last_name: 'Pérez',
    title: 'Gerente de Personas',
    email: 'email_not_unlocked@domain.com',
    organization: { name: 'Retail Andino', domain: 'retailandino.cl' },
    phone_numbers: [{ raw_number: '' }, { sanitized_number: '+56911112222', type_cd: 'mobile' }],
    photo_url: 'https://ui-avatars.com/api/?name=Ana',
    city: 'Santiago',
    country: 'Chile',
  } as never);

  assert.equal(lead.name, 'Ana Pérez');
  assert.equal(lead.company, 'Retail Andino');
  assert.equal(lead.email, null, 'the locked placeholder is never shown as an email');
  assert.equal(lead.avatar, '', 'no third-party avatar service');
  assert.equal(lead.companyWebsite, 'https://retailandino.cl');
  assert.equal(lead.primaryPhone, '+56911112222');
  assert.equal(lead.phoneNumbers?.length, 1, 'empty phones are dropped');
  assert.equal(lead.location, 'Santiago, Chile');

  const hidden = normalizeLeadForUI({ id: 'p2', name: 'Luis', primary_phone: '+5622' } as never, { revealPhone: false });
  assert.equal(hidden.primaryPhone, null);
  assert.equal(hidden.phoneNumbers, null);
});

test('contact helpers: visible email and phone, pending status, domains and the enriched mapping', () => {
  assert.equal(hasVisibleLeadEmail({ email: 'email_not_unlocked@domain.com' }), false);
  assert.equal(hasVisibleLeadEmail({ email: ' ana@retail.cl ' }), true);
  assert.equal(normalizeUiPhoneNumbers([]), null);
  assert.equal(hasVisibleLeadPhone({ primary_phone: null, phone_numbers: [{ number: '+5691' }] } as never), true);
  assert.equal(hasVisibleLeadPhone({ primary_phone: null, phone_numbers: [] } as never), false);
  assert.equal(isPendingEnrichmentStatus(' Pending_phone '), true);
  assert.equal(isPendingEnrichmentStatus('completed'), false);
  assert.equal(displayDomain('https://www.retail.cl/contacto'), 'retail.cl');
  assert.equal(displayDomain('retail.cl'), 'retail.cl');

  const enriched = mapLeadToEnriched({ id: 'p1', name: 'Ana', title: 'Gerente', company: 'Retail', companyWebsite: 'https://www.retail.cl', email: null, phoneNumbers: null } as never);
  assert.equal(enriched.companyDomain, 'retail.cl');
  assert.equal(enriched.email, undefined);
  assert.equal(enriched.emailStatus, 'unknown');
});

test('the LinkedIn notice warns only when something asked for is missing', () => {
  assert.equal(buildLinkedInProfileNotice({ emailRequested: true, phoneRequested: false, emailState: 'ready', phoneState: 'not_requested' }).tone, 'info');
  const missing = buildLinkedInProfileNotice({ emailRequested: true, phoneRequested: true, emailState: 'missing', phoneState: 'missing' });
  assert.equal(missing.tone, 'warning');
  assert.match(missing.title, /sin datos de contacto/);
  assert.match(buildLinkedInProfileNotice({ emailRequested: true, phoneRequested: true, emailState: 'queued', phoneState: 'queued' }).title, /en camino/);
});

test('batch search needs at least one real filter; blanks and lone commas do not count', () => {
  assert.deepEqual(splitFilterInput(' Retail, , Minería ,'), ['Retail', 'Minería']);
  assert.equal(hasBatchSearchFilters({ ...DEFAULT_LEAD_SEARCH_FILTERS, companyKeywords: ' , ' }), false);
  assert.equal(hasBatchSearchFilters({ ...DEFAULT_LEAD_SEARCH_FILTERS, title: 'Gerente de Personas' }), true);
  assert.equal(hasBatchSearchFilters({ ...DEFAULT_LEAD_SEARCH_FILTERS, seniorities: ['director'] }), true);
});

test('a result is «Guardado» when its provider id was saved, not only when the row ids match', () => {
  const saved = { ids: new Set(['00000000-0000-4000-8000-000000001000']), providerIds: new Set(['apollo-qa-0', 'legacy-apollo-7']) };
  assert.equal(isLeadSaved({ id: 'apollo-qa-0', sourceProviderId: 'apollo-qa-0' }, saved), true, 'search rows carry the provider id');
  assert.equal(isLeadSaved({ id: 'x', sourceProviderId: 'legacy-apollo-7' }, saved), true);
  assert.equal(isLeadSaved({ id: '00000000-0000-4000-8000-000000001000' }, saved), true, 'a saved row itself');
  assert.equal(isLeadSaved({ id: 'apollo-qa-9', sourceProviderId: 'apollo-qa-9' }, saved), false);
  assert.equal(isLeadSaved({ id: '' }, { ids: new Set(['']), providerIds: new Set(['']) }), false, 'empty ids never match');
});

test('contacted matches the lead id or the email, whatever its case', () => {
  const contacted = contactedKeys([{ leadId: 'lead-1', email: 'Ana.Soto@Retail.cl' }, { leadId: null, email: ' luis@x.cl ' }]);
  assert.equal(isLeadContacted({ id: 'lead-1', email: null }, contacted), true);
  assert.equal(isLeadContacted({ id: 'other', email: 'ana.soto@retail.cl' }, contacted), true);
  assert.equal(isLeadContacted({ id: 'other', email: 'LUIS@X.CL' }, contacted), true);
  assert.equal(isLeadContacted({ id: 'other', email: null }, contacted), false);
});

test('filter signatures change only with what each list depends on', () => {
  const base = { ...DEFAULT_LEAD_SEARCH_FILTERS, companyKeywords: 'Retail, logística', location: 'Chile', title: 'Gerente de Personas' };
  assert.equal(companyFilterSignature(base), companyFilterSignature({ ...base, companyKeywords: ' logística ,retail' }), 'order, case and spaces do not matter');
  assert.notEqual(companyFilterSignature(base), companyFilterSignature({ ...base, sizeRange: '51-200' }));
  const otherTitle = { ...base, title: 'Jefe de Selección' };
  const otherCountry = { ...base, location: 'Perú' };
  assert.equal(companyFilterSignature(base), companyFilterSignature(otherTitle), 'a person filter keeps the companies');
  assert.notEqual(peopleFilterSignature(base), peopleFilterSignature(otherTitle));
  assert.equal(peopleFilterSignature(base), peopleFilterSignature(otherCountry), 'a company filter keeps the contacts signature');
});

test('profile contact states read as palette badges with a word', () => {
  assert.deepEqual(contactStateBadge('ready'), { variant: 'success', label: 'Disponible' });
  assert.deepEqual(contactStateBadge('queued'), { variant: 'info', label: 'Buscando…' });
  assert.deepEqual(contactStateBadge('missing'), { variant: 'warning', label: 'No disponible' });
  assert.deepEqual(contactStateBadge('not_requested'), { variant: 'neutral', label: 'No solicitado' });
});
