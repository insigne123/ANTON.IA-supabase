import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeLinkedinProfileUrl } from '@/lib/linkedin-url';

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
