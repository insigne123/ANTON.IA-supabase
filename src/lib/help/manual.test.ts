import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import {
  FIRST_EMAIL_PATH, HELP_GROUPS, HELP_ICONS, HELP_SECTIONS, POPULAR_QUESTIONS, helpSectionFor, helpSectionHref, manualAsText,
  popularHelpQuestions, searchHelp, visibleHelpSections,
} from './manual';

test('every section is complete, unique and points at real screens and sections', () => {
  const ids = HELP_SECTIONS.map((section) => section.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const section of HELP_SECTIONS) {
    assert.ok(HELP_GROUPS.includes(section.group), section.id);
    assert.match(section.id, /^[a-z-]+$/, 'usable as a path in /ayuda');
    assert.ok(section.summary.length >= 20 && section.summary.length <= 220, `${section.id}: summary`);
    assert.ok(section.steps.length >= 2, `${section.id}: steps`);
    assert.ok(section.faqs.length >= 1, `${section.id}: faqs`);
    for (const faq of section.faqs) assert.match(faq.q, /¿[^?]+\?$/, `${section.id}: «${faq.q}» is a question`);
    for (const id of section.related || []) assert.ok(ids.includes(id), `${section.id} → ${id}`);
    if (section.href) {
      assert.ok(existsSync(join('src/app/(app)', section.href, 'page.tsx')), `${section.id}: ${section.href} is a real screen`);
      assert.equal(helpSectionFor(section.href)?.id, section.id, `${section.id}: its own screen opens it`);
    }
  }
});

test('every entry of the menu has its help', () => {
  const sidebar = readFileSync('src/components/app-sidebar.tsx', 'utf8');
  const hrefs = [...sidebar.matchAll(/href: '([^']+)'/g)].map((match) => match[1]).filter((href) => href !== '/cowork');
  assert.ok(hrefs.length >= 14, 'the menu was read');
  for (const href of hrefs) assert.ok(helpSectionFor(href), `${href} has a section in the manual`);
  assert.match(sidebar, /href="\/ayuda"/, 'the menu links to the Centro de ayuda');
});

test('the «?» of each screen opens its section, including the screens behind a menu entry', () => {
  const cases: Array<[string, string | null]> = [
    ['/dashboard', 'hoy'], ['/search', 'buscar'], ['/saved/leads', 'por-completar'], ['/saved/leads/enriched', 'por-escribir'],
    ['/contact/compose', 'correo'], ['/contact/sequence', 'correo'], ['/contacted', 'conversaciones'], ['/contacted/replied', 'conversaciones'],
    ['/campaigns', 'campanas'], ['/crm', 'pipeline'], ['/profile', 'perfil'], ['/gmail', 'conexiones'], ['/outlook', 'conexiones'],
    ['/settings/email-studio', 'firmas'], ['/settings/unsubscribes', 'privacidad'], ['/leads/import', 'tabla'],
    ['/dashboard/admin/users', 'administracion'], ['/search?mode=x', 'buscar'], ['/cowork', null], ['/ayuda', null], ['/ayuda/perfil', null], [null as never, null],
  ];
  for (const [path, id] of cases) assert.equal(helpSectionFor(path)?.id ?? null, id, String(path));
});

test('hidden features stay out of the manual for the people who cannot use them', () => {
  const member = visibleHelpSections({ opportunities: false, admin: false }).map((section) => section.id);
  assert.ok(!member.includes('administracion') && !member.includes('oportunidades') && !member.includes('empresas-guardadas'));
  const admin = visibleHelpSections({ opportunities: true, admin: true }).map((section) => section.id);
  assert.equal(admin.length, HELP_SECTIONS.length);
  assert.doesNotMatch(manualAsText(visibleHelpSections({ opportunities: false, admin: false })), /\[administracion\]/);
});

test('search finds the answer without accents or case, FAQs first', () => {
  const credits = searchHelp('me quede sin CREDITOS');
  assert.equal(credits[0].section.id, 'creditos');
  assert.ok(credits[0].faq, 'the FAQ that answers it comes first');
  assert.equal(searchHelp('¿Desde qué correo sale?')[0].section.id, 'correo');
  assert.equal(searchHelp('linkedin perfil no encontró')[0].section.id, 'buscar');
  assert.ok(searchHelp('baja').some((match) => match.section.id === 'privacidad'));
  assert.deepEqual(searchHelp('de la'), [], 'only stop words: nothing');
  assert.deepEqual(searchHelp('xylofón'), []);
});

test('the manual the AI reads has every visible section with its id, steps and FAQs', () => {
  const text = manualAsText();
  for (const section of HELP_SECTIONS) assert.ok(text.includes(`[${section.id}] ${section.title}`), section.id);
  assert.match(text, /P: ¿Por dónde empiezo\?\nR: /);
  assert.ok(text.length < 40_000, 'small enough to send with every question');
});

test('the manual does not mention retired or internal things', () => {
  const text = JSON.stringify(HELP_SECTIONS);
  assert.doesNotMatch(text, /agente|misiones|Apollo|Serper|Supabase|token de/i);
});

test('the Centro de ayuda: a page and an icon per section, the path to the first email and the popular questions', () => {
  assert.equal(helpSectionHref('perfil'), '/ayuda/perfil');
  assert.deepEqual(Object.keys(HELP_ICONS).sort(), HELP_SECTIONS.map((section) => section.id).sort(), 'every section has its icon');

  const member = visibleHelpSections({ opportunities: false, admin: false });
  const memberIds = member.map((section) => section.id);
  assert.equal(FIRST_EMAIL_PATH.length, 6);
  for (const step of FIRST_EMAIL_PATH) {
    assert.ok(memberIds.includes(step.section), `${step.section}: every member sees the path`);
    assert.ok(step.title.length <= 24 && step.text.length <= 80, `${step.section}: short enough for a card`);
  }

  const popular = popularHelpQuestions(member);
  assert.equal(popular.length, POPULAR_QUESTIONS.length, 'every popular question is still in the manual, word for word');
  assert.deepEqual(popular.map(({ section }) => section.id), POPULAR_QUESTIONS.map(([id]) => id));
  assert.deepEqual(popularHelpQuestions(member.filter((section) => section.id !== 'creditos')).map(({ section }) => section.id),
    ['correo', 'conversaciones', 'por-completar', 'campanas'], 'a hidden section takes its questions with it');
});
