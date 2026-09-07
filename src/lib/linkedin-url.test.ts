import test from 'node:test';
import assert from 'node:assert/strict';

import { getLinkedinProfileDisplayName, normalizeLinkedinProfileUrl } from '@/lib/linkedin-url';

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
