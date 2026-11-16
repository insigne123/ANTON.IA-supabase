import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { NAV_SECTIONS, isNavItemActive, isNavSubItemActive, navLabelFor } from './navigation';

const item = (href: string) => {
  const found = NAV_SECTIONS.flatMap((section) => section.items).find((entry) => entry.href === href);
  assert.ok(found, href);
  return found;
};

test('an entry stays lit on the screens below it and on its aliases, but «Hoy» only on its own path', () => {
  assert.ok(isNavItemActive(item('/campaigns'), '/campaigns/history'));
  assert.ok(isNavItemActive(item('/sheet'), '/leads/import'));
  assert.ok(isNavItemActive(item('/connections'), '/gmail'));
  assert.ok(isNavItemActive(item('/settings/privacy'), '/settings/unsubscribes'));
  assert.ok(isNavItemActive(item('/contacted'), '/contacted?view=reply'));
  assert.ok(!isNavItemActive(item('/dashboard'), '/dashboard/admin/users'));
  assert.ok(isNavItemActive(item('/dashboard/admin'), '/dashboard/admin/users'));
  assert.ok(isNavItemActive(item('/saved/leads/enriched'), '/saved/leads/enriched'));
  assert.ok(!isNavItemActive(item('/search'), '/searching'), 'a shared prefix is not a screen below');
  assert.ok(!isNavItemActive(item('/search'), null));
});

test('«Tus contactos de hoy» is a screen of «Hoy»: listed under it, lit on its own paths, and named in the phone top bar', () => {
  // 16 Nov 2026, the owner: «la idea es que esto de tus contactos de hoy sea una subsección de Hoy, para que todo conviva en la misma app».
  const inside = item('/dashboard').sub || [];
  assert.deepEqual(inside.map((entry) => [entry.href, entry.label, entry.pending.key]), [['/dashboard/contactos', 'Tus contactos de hoy', 'contacts']]);
  assert.ok(isNavSubItemActive(inside[0], '/dashboard/contactos'));
  assert.ok(isNavSubItemActive(inside[0], '/dashboard/contactos/00000000-0000-4000-8000-000000000951?c=x'));
  assert.ok(!isNavSubItemActive(inside[0], '/dashboard'));
  assert.ok(!isNavSubItemActive(inside[0], '/dashboard/contactos-otros'), 'a shared prefix is not a screen below');
  assert.ok(!isNavItemActive(item('/dashboard'), '/dashboard/contactos'), '«Hoy» is not lit beside its own screen');
  assert.equal(navLabelFor('/dashboard/contactos/00000000-0000-4000-8000-000000000951'), 'Tus contactos de hoy');
  assert.equal(navLabelFor('/dashboard/contactos'), 'Tus contactos de hoy');
  // The menu lists it while the person has contacts (its number is known) and on its own screens; a rail has no room: «Hoy» is lit.
  const sidebar = readFileSync(new URL('../components/app-sidebar.tsx', import.meta.url), 'utf8');
  assert.match(sidebar, /\(item\.sub \|\| \[\]\)\.filter\(\(child\) => isNavSubItemActive\(child, pathname\) \|\| pending\?\.\[child\.pending\.key\] != null\)/);
  assert.match(sidebar, /const isActive = isNavItemActive\(item, pathname\) \|\| \(rail && insideActive\);/);
  assert.match(sidebar, /<SidebarMenuSubButton asChild isActive=\{childActive\}/);
});

test('«Por completar» is gone: saved contacts without email wait in «Por escribir»', () => {
  assert.equal(NAV_SECTIONS.flatMap((section) => section.items).some((entry) => entry.href === '/saved/leads'), false);
});

test('the phone top bar names the screen on view: its menu entry, or the screen itself outside the menu', () => {
  const cases: Array<[string | null, string | null]> = [
    ['/dashboard', 'Hoy'], ['/dashboard/admin/teams', 'Administración'],
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
  assert.match(shell, /id="contenido"[\s\S]{0,80}className=(?:"|\{cn\(')[^"']*overflow-x-clip/, '<main> clips sideways');
  assert.equal((sidebar.match(/overflow-x-clip/g) || []).length, 2, 'the sidebar wrapper and the inset clip sideways');
});
