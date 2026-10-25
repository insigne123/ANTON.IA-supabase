import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const compiled = ts.transpileModule(await readFile(new URL('./ProfileIndex.tsx', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
const dependencies: Record<string, unknown> = { '@/components/ui/chip': { chipClass: (on: boolean) => (on ? 'chip chip-on' : 'chip') } };
const exports: any = {};
new Function('require', 'exports', compiled)((id: string) => (id in dependencies ? dependencies[id] : require(id)), exports);
const { ProfileIndex, PROFILE_INDEX } = exports;

test('the index of «Perfil» names its five parts, jumps to each and marks the first one (APP-07)', async () => {
  const html = renderToStaticMarkup(React.createElement(ProfileIndex));
  assert.match(html, /^<nav aria-label="Partes del perfil" class="sticky top-12/);
  assert.deepEqual([...html.matchAll(/href="#([a-z]+-heading)"/g)].map(match => match[1]), PROFILE_INDEX.map((item: { id: string }) => item.id));
  assert.match(html, /href="#identity-heading" aria-current="location" class="chip chip-on">Tú</);
  assert.equal((html.match(/aria-current/g) || []).length, 1);
  // Every part it names is a heading of the page: the links to /profile#icp-heading keep working.
  const page = await readFile(new URL('../../app/(app)/profile/page.tsx', import.meta.url), 'utf8');
  for (const id of ['identity', 'company', 'offer', 'icp']) assert.match(page, new RegExp(`<Section id="${id}"`));
  assert.match(page, /<div id="security-heading" className="scroll-mt-28"><PasswordChangeForm \/><\/div>/);
  assert.match(page, /<ProfileIndex \/>/);
});
