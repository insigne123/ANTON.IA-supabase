import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ROOT = process.cwd();

function filesUnder(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (entry.name === 'node_modules' || entry.name === '.next' || entry.name.startsWith('.git')) return [];
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? filesUnder(full) : [full];
  });
}

// Next resolves «.js» before «.ts», so a compiled copy next to its source replaces the source in the build. PR 511 added 30
// by mistake, and three of them were already behind fixes merged after they were compiled.
test('no compiled .js file sits next to its .ts source', () => {
  const twins = [...filesUnder(path.join(ROOT, 'src')), ...filesUnder(path.join(ROOT, 'scripts'))]
    .filter(file => file.endsWith('.js') && ['.ts', '.tsx'].some(extension => fs.existsSync(file.slice(0, -3) + extension)))
    .map(file => path.relative(ROOT, file));
  assert.deepEqual(twins, [], 'Delete the compiled copies: the build would use them instead of the TypeScript sources.');
});
