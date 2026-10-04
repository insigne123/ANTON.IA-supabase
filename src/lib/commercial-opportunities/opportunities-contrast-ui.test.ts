import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// Plan 9 (final audit): gray text on the gray chip (text-muted-foreground on bg-muted) read at 4.3:1 in «Oportunidades»,
// the last contrast findings of the full run («+N más» under the roles and the keywords). Every muted chip on the page
// uses the app's secondary text (text-foreground/70, 6.4:1 light, 6.5:1 dark), without new colors.
test('the muted chips in «Oportunidades» have enough contrast', () => {
  const source = readFileSync('src/components/commercial-opportunities/OpportunitiesWorkspace.tsx', 'utf8');
  const classes = source.match(/(?:className=|cn\(|\? |: )['"`][^'"`]*bg-muted[^'"`]*['"`]/g) ?? [];
  assert.ok(classes.length >= 7, 'the tab counts, filter counts, «+N más» and «Aún no es contacto» chips are found');
  for (const value of classes) assert.doesNotMatch(value, /text-muted-foreground/, value);
  assert.equal(source.match(/\+\{(?:profile\.roles|tenderSearch\.keywords)\.length - \d+\} más/g)?.length, 2);
  assert.match(source, /\{entry\.role\} <span className="text-foreground\/70">\(\{entry\.ads\}\)<\/span>/);
});
