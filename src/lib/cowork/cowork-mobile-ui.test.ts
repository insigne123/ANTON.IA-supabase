import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workspace = readFileSync('src/components/cowork/CoworkWorkspace.tsx', 'utf8');

// Plan 9 (Cowork on phones): the list of work opened in a home-made drawer (no focus trap, Esc did nothing) with the
// same icon as the app menu right above it; below xl the summary could not be opened at all; and the floating
// «Ir al final» / «Cowork espera tu decisión» sat at a fixed 132 px, over the quick actions when the box grew.
test('on phones the list of work opens in the shared sheet, with its own icon', () => {
  assert.match(workspace, /<Sheet open=\{drawerOpen\} onOpenChange=\{setDrawerOpen\}>/);
  assert.match(workspace, /<SheetTitle className="sr-only">Conversaciones<\/SheetTitle>/);
  assert.doesNotMatch(workspace, /absolute inset-0 z-40/, 'the home-made drawer is gone');
  assert.match(workspace, /aria-label="Mostrar conversaciones"[\s\S]{0,240}?<History aria-hidden="true" \/>/);
  assert.doesNotMatch(workspace, /\bPanelLeft\b/, 'PanelLeft is the app menu button');
  // Radix only refocuses its own trigger: the workspace gives focus back to the button that opened each sheet.
  assert.match(workspace, /onCloseAutoFocus=\{returnFocusTo\(listOpener\)\}/);
  assert.match(workspace, /onCloseAutoFocus=\{returnFocusTo\(summaryOpener\)\}/);
});

test('below xl the summary opens in a sheet from the header', () => {
  assert.match(workspace, /<Sheet open=\{summaryOpen\} onOpenChange=\{setSummaryOpen\}>/);
  assert.match(workspace, /ref=\{summaryOpener\} variant="ghost" size="icon-sm" className="xl:hidden" onClick=\{\(\) => setSummaryOpen\(true\)\} aria-label="Ver resumen de la conversación"/);
  assert.match(workspace, /if \(isWide\) setSummaryOpen\(false\)/, 'a sheet left open does not linger once the panel fits beside the chat');
  assert.match(workspace, /<CoworkSidePanel closeStyle="dismiss"/);
});

test('the floating buttons sit above the composer at whatever height it has', () => {
  assert.doesNotMatch(workspace, /bottom-\[132px\]/);
  assert.equal(workspace.match(/className="absolute bottom-full left-1\/2 z-10 mb-2 /g)?.length, 2);
  const dock = workspace.indexOf('<div className="relative shrink-0 px-3 pb-3 pt-1 sm:px-6 sm:pb-4">');
  assert.ok(dock > 0 && dock < workspace.indexOf('key="decision"') && workspace.indexOf('key="jump"') < workspace.indexOf('id="cowork-followup"'));
});

test('a list that could not be read is told in the list and on the home', () => {
  assert.equal(workspace.match(/error=\{listError\} onRetry=\{retryList\}/g)?.length, 2, 'side rail and sheet');
  assert.match(workspace, /listFailed=\{Boolean\(listError\)\}/);
  const home = readFileSync('src/components/cowork/CoworkHome.tsx', 'utf8');
  assert.match(home, /\{!ready && !loading && !listFailed && <p/);
});
