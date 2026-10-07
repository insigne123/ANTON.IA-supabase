import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { COWORK_COMPOSER_KEYS, COWORK_KEY_HANDLERS, COWORK_SHORTCUTS, coworkIsMac, coworkShortcut, coworkTypesIntoComposer, type CoworkKeyPress } from './shortcuts';

const press = (key: string, modifiers: Partial<CoworkKeyPress> = {}): CoworkKeyPress => ({ key, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...modifiers });

test('the shortcuts of any AI chat: ⌘ on a Mac, Ctrl elsewhere', () => {
  assert.equal(coworkShortcut(press('O', { metaKey: true, shiftKey: true }), true), 'new');
  assert.equal(coworkShortcut(press('o', { ctrlKey: true, shiftKey: true }), false), 'new');
  assert.equal(coworkShortcut(press('k', { metaKey: true }), true), 'search');
  assert.equal(coworkShortcut(press('k', { ctrlKey: true }), false), 'search');
  assert.equal(coworkShortcut(press('/', { ctrlKey: true }), false), 'help');
  // A keyboard layout that types another character still has the key's code.
  assert.equal(coworkShortcut(press('-', { ctrlKey: true, code: 'Slash' }), false), 'help');
});

test('what they are not: Ctrl+K on a Mac deletes to the end of the line, and the app keeps its own keys', () => {
  assert.equal(coworkShortcut(press('k', { ctrlKey: true }), true), null);
  assert.equal(coworkShortcut(press('k', { metaKey: true }), false), null);
  assert.equal(coworkShortcut(press('k', { ctrlKey: true, shiftKey: true }), false), null);
  assert.equal(coworkShortcut(press('o', { ctrlKey: true }), false), null, 'Ctrl+O opens a file');
  assert.equal(coworkShortcut(press('b', { ctrlKey: true }), false), null, 'Ctrl+B is the app sidebar');
  assert.equal(coworkShortcut(press('k', { ctrlKey: true, altKey: true }), false), null);
  assert.equal(coworkShortcut(press('k', { ctrlKey: true, isComposing: true }), false), null);
  assert.equal(coworkShortcut(press('k'), false), null);
});

test('typing where it does nothing starts the message; in a field, on a button or with a modifier it does not', () => {
  assert.equal(coworkTypesIntoComposer(press('h'), false), true);
  assert.equal(coworkTypesIntoComposer(press('¿'), false), true);
  assert.equal(coworkTypesIntoComposer(press('H', { shiftKey: true }), false), true);
  assert.equal(coworkTypesIntoComposer(press('h'), true), false, 'a field, a button or a menu keeps its keys');
  assert.equal(coworkTypesIntoComposer(press(' '), false), false, 'Space scrolls the page');
  assert.equal(coworkTypesIntoComposer(press('Enter'), false), false);
  assert.equal(coworkTypesIntoComposer(press('c', { metaKey: true }), false), false, '⌘C copies');
  // What handles keys of its own, and the app's main region (focused when clicked, as the «skip to content» target), which does not.
  for (const selector of ['input', 'textarea', 'button', 'a[href]', '[role="menuitem"]', '[role="option"]']) assert.ok(COWORK_KEY_HANDLERS.includes(selector), selector);
  assert.doesNotMatch(COWORK_KEY_HANDLERS, /main|section|\[tabindex/);
});

test('the list says each shortcut with the keys of the person\'s system, and the composer\'s keys too', () => {
  assert.deepEqual(COWORK_SHORTCUTS.map(item => item.keys(true).join(' ')), ['⌘ ⇧ O', '⌘ K', '⌘ /']);
  assert.deepEqual(COWORK_SHORTCUTS.map(item => item.keys(false).join(' ')), ['Ctrl Shift O', 'Ctrl K', 'Ctrl /']);
  assert.deepEqual(COWORK_COMPOSER_KEYS.map(item => item.keys.join(' ')), ['Enter', 'Shift Enter', '@', '/']);
  assert.equal(coworkIsMac('MacIntel'), true);
  assert.equal(coworkIsMac('Win32'), false);
  assert.equal(coworkIsMac(undefined), false);
});

test('the workspace listens for them, leaves an open dialog its keys and opens the list with its search field', () => {
  const workspace = readFileSync('src/components/cowork/CoworkWorkspace.tsx', 'utf8');
  assert.match(workspace, /const action = coworkShortcut\(event, mac\)/);
  assert.match(workspace, /if \(dialogOpen && !\(action === 'help' && shortcutsOpen\)\) return;/);
  assert.match(workspace, /if \(action === 'new'\) choose\(null\);/);
  assert.match(workspace, /document\.getElementById\(rail \? 'cowork-rail-filter' : 'cowork-drawer-filter'\)\?\.focus\(\)/);
  assert.match(workspace, /const focused = document\.activeElement;/);
  assert.match(workspace, /coworkTypesIntoComposer\(event, Boolean\(focused && focused !== document\.body && focused\.closest\(COWORK_KEY_HANDLERS\)\)\)\) composer\.current\?\.focus\(\)/);
  assert.match(workspace, /<CoworkShortcuts open=\{shortcutsOpen\} onOpenChange=\{setShortcutsOpen\} mac=\{mac\} \/>/);
  // The ids it focuses are the lists' own.
  const list = readFileSync('src/components/cowork/CoworkThreadList.tsx', 'utf8');
  assert.match(list, /idPrefix = 'cowork-rail'/);
  assert.match(list, /id=\{`\$\{idPrefix\}-filter`\}/);
  assert.match(workspace, /idPrefix="cowork-drawer"/);
});
