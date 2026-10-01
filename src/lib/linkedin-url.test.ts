import test from 'node:test';
import assert from 'node:assert/strict';

import { getLinkedinProfileDisplayName, linkedinSlugConflictsWithName, normalizeLinkedinProfileUrl } from '@/lib/linkedin-url';

test('normalizes public LinkedIn person profiles from trusted LinkedIn hosts', () => {
  assert.equal(
    normalizeLinkedinProfileUrl('linkedin.com/in/Jane-Doe/'),
    'https://www.linkedin.com/in/Jane-Doe',
  );
  assert.equal(
    normalizeLinkedinProfileUrl('https://cl.linkedin.com/in/jane-doe?trk=public_profile'),
    'https://www.linkedin.com/in/jane-doe',
  );
  assert.equal(
    normalizeLinkedinProfileUrl('https://es.linkedin.com/in/jane-doe/'),
    'https://www.linkedin.com/in/jane-doe',
  );
  assert.equal(
    normalizeLinkedinProfileUrl('https://m.linkedin.com/in/jane-doe'),
    'https://www.linkedin.com/in/jane-doe',
  );
  assert.equal(normalizeLinkedinProfileUrl('https://www.linkedin.com/company/example'), '');
  assert.equal(normalizeLinkedinProfileUrl('https://evil-linkedin.com/in/jane'), '');
  assert.equal(normalizeLinkedinProfileUrl('https://linkedin.com.evil.test/in/jane'), '');
});

test('decodes and normalizes percent-encoded profile slugs', () => {
  const encoded = 'https://www.linkedin.com/in/sally-tatiana-bard%C3%A1lez-chota-0693a875/';
  assert.equal(
    normalizeLinkedinProfileUrl(encoded),
    'https://www.linkedin.com/in/sally-tatiana-bard%C3%A1lez-chota-0693a875',
  );
  assert.equal(getLinkedinProfileDisplayName(encoded), 'Sally Tatiana Bardález Chota');
});

test('flags a personal slug that shares nothing with the returned name', () => {
  assert.equal(
    linkedinSlugConflictsWithName('https://www.linkedin.com/in/it-recruiter-janet-montero/', 'Marco Psenda'),
    true,
  );
  assert.equal(linkedinSlugConflictsWithName('https://www.linkedin.com/in/it-recruiter-janet-montero/', 'Janet Montero'), false);
  assert.equal(linkedinSlugConflictsWithName('https://www.linkedin.com/in/it-recruiter-janet-montero/', 'Janet M.'), false);
  assert.equal(linkedinSlugConflictsWithName('https://www.linkedin.com/in/luisruben-rrhh/', 'Luis Rubén Mines Ayuqui'), false);
  assert.equal(linkedinSlugConflictsWithName('https://www.linkedin.com/in/luisruben-rrhh/', 'Luis Mines Ayuqui'), false);
  assert.equal(linkedinSlugConflictsWithName('https://www.linkedin.com/in/luisruben-consultor/', 'Luis Rubén Mines Ayuqui'), false);
  assert.equal(linkedinSlugConflictsWithName('https://www.linkedin.com/in/luisruben-mines/', 'Marco Psenda'), true);
  assert.equal(linkedinSlugConflictsWithName('https://www.linkedin.com/in/jdoe2024/', 'Marco Psenda'), false);
  assert.equal(linkedinSlugConflictsWithName('https://www.linkedin.com/in/ana-perez/', 'Ana'), false);
  assert.equal(linkedinSlugConflictsWithName('not a url', 'Marco Psenda'), false);
  assert.equal(linkedinSlugConflictsWithName('https://www.linkedin.com/in/it-recruiter-janet-montero/', ''), false);
});

test('preserves the exact UTF-8 identity of accented LinkedIn slugs', () => {
  const encoded = 'https://www.linkedin.com/in/laura-sof%C3%ADa-sotelo-torres-47423735/';
  assert.equal(
    normalizeLinkedinProfileUrl(encoded),
    'https://www.linkedin.com/in/laura-sof%C3%ADa-sotelo-torres-47423735',
  );
  assert.equal(
    normalizeLinkedinProfileUrl('https://cl.linkedin.com/in/laura-sofi\u0301a-sotelo-torres-47423735?trk=public_profile'),
    'https://www.linkedin.com/in/laura-sof%C3%ADa-sotelo-torres-47423735',
  );
  assert.equal(getLinkedinProfileDisplayName(encoded), 'Laura Sofía Sotelo Torres');
});

test('profiles match ignoring case, accents, country subdomains and tracking, never across slugs', async () => {
  const { linkedinProfilesMatch } = await import('@/lib/linkedin-url');
  assert.equal(linkedinProfilesMatch('https://cl.linkedin.com/in/laura-sof%C3%ADa-sotelo-torres-47423735/?trk=x', 'http://www.linkedin.com/in/laura-sofia-sotelo-torres-47423735'), true);
  assert.equal(linkedinProfilesMatch('linkedin.com/in/Juan-Perez', 'https://www.linkedin.com/in/juan-pérez/'), true);
  assert.equal(linkedinProfilesMatch('https://www.linkedin.com/in/juan-perez-1', 'https://www.linkedin.com/in/juan-perez-2'), false);
  assert.equal(linkedinProfilesMatch('https://www.linkedin.com/in/juan-perez', null), false);
  assert.equal(linkedinProfilesMatch('https://www.linkedin.com/company/juan-perez', 'https://www.linkedin.com/in/juan-perez'), false);
});

test('a personal slug vouches for a returned name only when all its name tokens are in it', async () => {
  const { linkedinSlugMatchesName } = await import('@/lib/linkedin-url');
  assert.equal(linkedinSlugMatchesName('https://www.linkedin.com/in/maria-jose-perez', 'María José Pérez González'), true);
  assert.equal(linkedinSlugMatchesName('https://www.linkedin.com/in/maria-jose-perez-47423735', 'María José Pérez'), true);
  assert.equal(linkedinSlugMatchesName('https://www.linkedin.com/in/maria-jose-perez', 'María Pérez'), false);
  assert.equal(linkedinSlugMatchesName('https://www.linkedin.com/in/jperez87', 'Juan Pérez'), false);
  assert.equal(linkedinSlugMatchesName('https://www.linkedin.com/in/luisruben-rrhh', 'Luis Rubén Mines'), false);
  assert.equal(linkedinSlugMatchesName('https://www.linkedin.com/in/ana-soto', 'Ana'), false);
});

test('a pasted address is classified so each wrong kind gets its own fix', async () => {
  const { classifyLinkedinInput } = await import('@/lib/linkedin-url');
  assert.equal(classifyLinkedinInput(''), 'empty');
  assert.equal(classifyLinkedinInput('https://www.linkedin.com/in/ana-soto'), 'profile');
  assert.equal(classifyLinkedinInput('linkedin.com/in/ana-soto?trk=x'), 'profile');
  assert.equal(classifyLinkedinInput('https://www.linkedin.com/sales/lead/ACwAAA123,NAME_SEARCH,abc'), 'sales_navigator');
  assert.equal(classifyLinkedinInput('https://www.linkedin.com/talent/profile/AEMAA'), 'sales_navigator');
  assert.equal(classifyLinkedinInput('https://cl.linkedin.com/company/grupoexpro/'), 'company_page');
  assert.equal(classifyLinkedinInput('https://www.linkedin.com/feed/'), 'other');
  assert.equal(classifyLinkedinInput('ana soto'), 'other');
});
