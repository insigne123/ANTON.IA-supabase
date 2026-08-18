import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeLinkedinProfileUrl } from '@/lib/linkedin-url';

test('normalizes only public LinkedIn person profiles', () => {
  assert.equal(
    normalizeLinkedinProfileUrl('linkedin.com/in/Jane-Doe/'),
    'https://www.linkedin.com/in/Jane-Doe',
  );
  assert.equal(normalizeLinkedinProfileUrl('https://www.linkedin.com/company/example'), '');
  assert.equal(normalizeLinkedinProfileUrl('https://evil-linkedin.com/in/jane'), '');
});
