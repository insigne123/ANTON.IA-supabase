import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { safeAvatarUrl } from './avatar';

test('a real photo passes; an initials service, plain http or garbage does not', () => {
  assert.equal(safeAvatarUrl('https://media.licdn.com/dms/image/abc.jpg'), 'https://media.licdn.com/dms/image/abc.jpg');
  assert.equal(safeAvatarUrl('https://ui-avatars.com/api/?name=Andrea%20Soto&size=40'), undefined);
  assert.equal(safeAvatarUrl('https://cdn.ui-avatars.com/api/?name=x'), undefined);
  assert.equal(safeAvatarUrl('http://example.com/photo.jpg'), undefined);
  assert.equal(safeAvatarUrl('javascript:alert(1)'), undefined);
  assert.equal(safeAvatarUrl('not a url'), undefined);
  assert.equal(safeAvatarUrl(''), undefined);
  assert.equal(safeAvatarUrl(null), undefined);
});

test('no screen builds an avatar URL that carries a prospect name to a third party', () => {
  const search = readFileSync('src/app/(app)/search/page.tsx', 'utf8');
  // The provider lead → row mapping moved to lead-ui.ts when the search page was split.
  const leadUi = readFileSync('src/lib/search/lead-ui.ts', 'utf8');
  const saved = readFileSync('src/app/(app)/saved/leads/page.tsx', 'utf8');
  assert.doesNotMatch(search, /ui-avatars\.com/);
  assert.doesNotMatch(leadUi, /ui-avatars\.com/);
  assert.match(leadUi, /safeAvatarUrl\(raw\.photo_url\)/);
  assert.match(search, /<InitialsAvatar name=\{lead\.name\}/);
  assert.match(saved, /<AvatarImage src=\{safeAvatarUrl\(l\.avatar\)\}/, 'saved leads may still hold old ui-avatars URLs');
});
