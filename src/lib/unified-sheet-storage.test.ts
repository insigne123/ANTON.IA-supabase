import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { defaultColumns, loadColumns } from './unified-sheet-storage';

function withStorage(seed: Record<string, string>, run: (store: Map<string, string>) => void) {
  const store = new Map(Object.entries(seed));
  const localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
  };
  const previous = (globalThis as any).window;
  (globalThis as any).window = { localStorage };
  try { run(store); } finally { (globalThis as any).window = previous; }
}

test('the retired Autopilot columns leave the sheet, also from a layout saved before', () => {
  assert.ok(!defaultColumns().some((column) => column.key === 'autopilotStatus' || column.key === 'lastAutopilotEvent'));
  const saved = [
    { key: 'name', label: 'Nombre', visible: true },
    { key: 'email', label: 'Email', visible: true },
    { key: 'autopilotStatus', label: 'Autopilot', visible: true },
    { key: 'lastAutopilotEvent', label: 'Último evento', visible: false },
    { key: 'status', label: 'Estado', visible: true },
  ];
  withStorage({ 'leadflow-sheet-columns-v1': JSON.stringify(saved), unified_sheet_columns_v: '4' }, (store) => {
    const keys = loadColumns().map((column) => column.key);
    assert.ok(!keys.includes('autopilotStatus') && !keys.includes('lastAutopilotEvent'), keys.join(', '));
    assert.ok(keys.includes('name') && keys.includes('status') && keys.includes('meetingLink'), keys.join(', '));
    assert.equal(store.get('unified_sheet_columns_v'), '5', 'the cleaned layout is saved once');
  });
});

test('Pipeline and the data sheet open the exact contact, not the whole list', () => {
  const sheet = readFileSync('src/app/(app)/sheet/page.tsx', 'utf8');
  assert.match(sheet, /href=\{`\/contacted\?c=\$\{encodeURIComponent\(row\.sourceId\)\}`\}/, '«Ver conversación» opens that conversation');
  assert.match(sheet, /href=\{`\/saved\/leads\?q=\$\{encodeURIComponent\(/, '«Abrir» searches that contact in «Por completar»');
  assert.doesNotMatch(sheet, /<Link href="\/contacted">|<Link href="\/saved\/leads">/);
  const saved = readFileSync('src/app/(app)/saved/leads/page.tsx', 'utf8');
  assert.match(saved, /new URLSearchParams\(window\.location\.search\)\.get\('q'\)/, '«Por completar» starts its search with ?q=');
  const drawer = readFileSync('src/components/crm/LeadDetailDrawer.tsx', 'utf8');
  assert.match(drawer, /\/contacted\?c=\$\{encodeURIComponent\(lead\.sourceId\)\}/);
  assert.doesNotMatch(drawer, /autopilotStatus/, 'no Autopilot badge in the drawer');
  const pipeline = readFileSync('src/app/(app)/crm/page.tsx', 'utf8');
  assert.match(pipeline, /useState<'graph' \| 'board' \| null>\(null\)/, 'the view waits for the remembered choice, so it never jumps');
});
