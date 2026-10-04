import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// Plan 9: cw-faint (a light gray) read below 4.5:1 for the times in «Recientes» and the note under the composer (the
// day's searches), the contrast findings left on /cowork. They read as the rest of the app's secondary text.
test('Cowork times and the note under the composer have enough contrast', () => {
  const home = readFileSync('src/components/cowork/CoworkHome.tsx', 'utf8');
  const composer = readFileSync('src/components/cowork/CoworkComposer.tsx', 'utf8');
  assert.match(home, /text-right text-\[12px\] text-foreground\/70 sm:inline">\{coworkShortTime\(thread\.updatedAt\)\}/);
  assert.match(composer, /text-center text-\[11\.5px\] text-foreground\/70">\{footnote\}/);
});
