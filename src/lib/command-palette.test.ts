import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { isPaletteShortcut, paletteItems } from './command-palette';

const everyone = { opportunities: false, cowork: false, admin: false };
const all = { opportunities: true, cowork: true, admin: true };

test('with nothing written it lists the screens the person sees in the menu, and the help (APP-24)', () => {
  const labels = paletteItems('', everyone).map(item => item.label);
  assert.ok(labels.includes('Hoy') && labels.includes('Conversaciones') && labels.includes('Centro de ayuda'));
  assert.ok(!labels.includes('Oportunidades') && !labels.includes('Cowork') && !labels.includes('Administración'), 'what the menu hides, ⌘K hides');
  assert.ok(paletteItems('', all).some(item => item.label === 'Administración'));
});

test('a few letters find a screen without accents, and search the data of three sections; Cowork goes last', () => {
  assert.deepEqual(paletteItems('campa', everyone).filter(item => item.group === 'Ir a').map(item => item.href), ['/campaigns']);
  assert.deepEqual(paletteItems('conversacion', everyone).filter(item => item.group === 'Ir a').map(item => item.label), ['Conversaciones']);
  const items = paletteItems('  Andrea   Soto ', all);
  assert.deepEqual(items.filter(item => item.group === 'Buscar en tus datos').map(item => item.href),
    ['/contacted?q=Andrea%20Soto', '/sheet?q=Andrea%20Soto', '/opportunities?vista=lista&q=Andrea%20Soto']);
  assert.equal(items.at(-1)?.group, 'Preguntar a Cowork');
  assert.equal(items.at(-1)?.href, '/cowork?pregunta=Andrea%20Soto');
  assert.ok(!paletteItems('Andrea', everyone).some(item => item.group === 'Preguntar a Cowork' || item.href.startsWith('/opportunities')), 'only with access');
  assert.ok(!paletteItems('a', all).some(item => item.group === 'Buscar en tus datos'), 'one letter is not a search');
});

test('⌘K on a Mac, Ctrl+K elsewhere, never with other keys, and not on Cowork, which searches its conversations with it', () => {
  const key = (over: Partial<{ key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) => ({ key: 'k', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...over });
  assert.equal(isPaletteShortcut(key({ metaKey: true }), true, '/dashboard'), true);
  assert.equal(isPaletteShortcut(key({ ctrlKey: true }), false, '/dashboard'), true);
  assert.equal(isPaletteShortcut(key({ ctrlKey: true }), true, '/dashboard'), false);
  assert.equal(isPaletteShortcut(key({ metaKey: true, shiftKey: true }), true, '/dashboard'), false);
  assert.equal(isPaletteShortcut(key({ metaKey: true }), true, '/cowork'), false);
});

test('the screens read what ⌘K sends: Conversaciones and the Tabla de datos their search, Cowork the question it leaves written', () => {
  assert.match(readFileSync('src/components/contacted/ConversationsWorkspace.tsx', 'utf8'), /get\('q'\)\?\.trim\(\);\s*if \(asked\) setQuery\(asked\.slice\(0, 200\)\);/);
  assert.match(readFileSync('src/app/(app)/sheet/page.tsx', 'utf8'), /get\('q'\)\?\.trim\(\);\s*if \(asked\) setQuery\(asked\.slice\(0, 200\)\);/);
  const cowork = readFileSync('src/components/cowork/CoworkWorkspace.tsx', 'utf8');
  assert.match(cowork, /searchParams\.get\('pregunta'\)/);
  assert.match(cowork, /setMessage\(asked\.slice\(0, 2000\)\)/);
  assert.doesNotMatch(cowork.slice(cowork.indexOf("get('pregunta')"), cowork.indexOf("get('pregunta')") + 400), /send\(|submit\(/, 'it is written, not sent');
  const shell = readFileSync('src/components/app-shell.tsx', 'utf8');
  assert.equal((shell.match(/<CommandPalette access=/g) || []).length, 1, 'a single box listens to the shortcut');
});
