import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { NAV_SECTIONS, isNavItemActive, navLabelFor } from './navigation';

const item = (href: string) => {
  const found = NAV_SECTIONS.flatMap((section) => section.items).find((entry) => entry.href === href);
  assert.ok(found, href);
  return found;
};

test('an entry stays lit on the screens below it and on its aliases, but «Hoy» and «Por completar» only on their own path', () => {
  assert.ok(isNavItemActive(item('/campaigns'), '/campaigns/history'));
  assert.ok(isNavItemActive(item('/sheet'), '/leads/import'));
  assert.ok(isNavItemActive(item('/connections'), '/gmail'));
  assert.ok(isNavItemActive(item('/settings/privacy'), '/settings/unsubscribes'));
  assert.ok(isNavItemActive(item('/contacted'), '/contacted?view=reply'));
  assert.ok(!isNavItemActive(item('/dashboard'), '/dashboard/admin/users'));
  assert.ok(isNavItemActive(item('/dashboard/admin'), '/dashboard/admin/users'));
  assert.ok(!isNavItemActive(item('/saved/leads'), '/saved/leads/enriched'));
  assert.ok(isNavItemActive(item('/saved/leads/enriched'), '/saved/leads/enriched'));
  assert.ok(!isNavItemActive(item('/search'), '/searching'), 'a shared prefix is not a screen below');
  assert.ok(!isNavItemActive(item('/search'), null));
});

test('the phone top bar names the screen on view: its menu entry, or the screen itself outside the menu', () => {
  const cases: Array<[string | null, string | null]> = [
    ['/dashboard', 'Hoy'], ['/dashboard/admin/teams', 'Administración'], ['/saved/leads', 'Por completar'],
    ['/saved/leads/enriched', 'Por escribir'], ['/leads/import', 'Tabla de datos'], ['/settings/privacy-requests', 'Privacidad'],
    ['/campaigns/history', 'Campañas'], ['/contact/compose', 'Redactar correo'], ['/contact/sequence', 'Secuencia'],
    ['/ayuda/perfil', 'Centro de ayuda'], ['/cowork', 'Cowork'], ['/opportunities', 'Oportunidades'],
    ['/algo-que-no-existe', null], ['', null], [null, null],
  ];
  for (const [path, label] of cases) assert.equal(navLabelFor(path), label, String(path));
});

test('the menu has one entry per screen and every entry opens a real page', () => {
  const hrefs = NAV_SECTIONS.flatMap((section) => section.items.map((entry) => entry.href));
  assert.equal(new Set(hrefs).size, hrefs.length);
  for (const href of hrefs) {
    assert.doesNotThrow(() => readFileSync(`src/app/(app)${href}/page.tsx`), `${href} has a page`);
  }
});

test('the shell clips sideways without becoming a scroll box, so sticky bars inside a page stay on screen', () => {
  // overflow-x: hidden turns overflow-y into auto: <main> and its wrappers became the sticky container while the window
  // scrolled, so the top bar, the search rail and every bottom action bar scrolled away with the page. clip does not.
  const shell = readFileSync('src/components/app-shell.tsx', 'utf8');
  const sidebar = readFileSync('src/components/ui/sidebar.tsx', 'utf8');
  for (const [file, code] of [['app-shell', shell], ['sidebar', sidebar]] as const) {
    assert.doesNotMatch(code, /overflow-x-hidden/, `${file} keeps no overflow-x-hidden wrapper`);
  }
  assert.match(shell, /id="contenido"[\s\S]{0,80}className="[^"]*overflow-x-clip/, '<main> clips sideways');
  assert.equal((sidebar.match(/overflow-x-clip/g) || []).length, 2, 'the sidebar wrapper and the inset clip sideways');
});
