import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

import { HELP_SECTIONS } from '@/lib/help/manual';

const read = (path: string) => readFileSync(path, 'utf8');

test('the help shows Oportunidades with the same rule as the menu, and the old public flag is gone', () => {
  // Plan 9, PR-19: the help used NEXT_PUBLIC_OPPORTUNITIES_ENABLED (off), so the pilot accounts never saw the section.
  for (const file of ['src/app/(app)/ayuda/page.tsx', 'src/app/(app)/ayuda/[seccion]/page.tsx']) {
    const code = read(file);
    assert.doesNotMatch(code, /isOpportunitiesEnabled|lib\/opportunities\/access/, `${file} drops the old flag`);
    assert.match(code, /const \{ opportunities \} = useSharedNavAccess\(\);/, `${file} reads the menu's answer`);
    assert.match(code, /visibleHelpSections\(\{ opportunities, admin \}\), \[opportunities, admin\]/, `${file} follows it`);
  }
  assert.match(read('src/components/app-shell.tsx'), /<NavAccessProvider value=\{access\}>\{children\}<\/NavAccessProvider>/);
  const ask = read('src/app/api/help/ask/route.ts');
  // The same rule as the page (Plan 15): the list, or a member an admin let in.
  assert.match(ask, /opportunities: await canUseOpportunities\(getSupabaseAdminClient\(\), auth\.user, auth\.organizationId\)/);
  assert.doesNotMatch(ask, /isOpportunitiesEnabled/);
  assert.equal(existsSync('src/lib/opportunities/access.ts'), false);
  assert.doesNotMatch(read('apphosting.yaml'), /NEXT_PUBLIC_OPPORTUNITIES_ENABLED/);
});

test('the manual speaks of screens, not addresses', () => {
  const texts = HELP_SECTIONS.flatMap((section) => [section.summary, ...section.steps, ...(section.tips || []),
    ...section.faqs.flatMap((faq) => [faq.q, faq.a])]);
  const raw = texts.filter((text) => /(^|[\s(«])\/[a-z]/.test(text));
  assert.deepEqual(raw, [], 'no «/ruta» in what people read');
});

test('Perfil waits for the saved profile before reading the site, uses the palette and opens with the ideal customer', () => {
  const page = read('src/app/(app)/profile/page.tsx');
  const card = read('src/components/profile/ProfileAutofillCard.tsx');
  assert.match(page, /loading=\{isLoading\}/, 'the AI card knows the profile is loading');
  assert.match(page, /const handleAutofill = async \(\) => \{\s*\/\/[^\n]*\n\s*if \(isLoading\) return;/);
  assert.match(card, /const canRun = !loading && /);
  assert.match(card, /disabled=\{running \|\| loading\}/);
  assert.match(card, /'Cargando tu perfil…'/);
  assert.match(page, /<ProfileIcpSummary profile=\{profile\} dirty=\{isDirty\} onEdit=\{\(\) => focusField\('targetRoles'\)\} \/>/);
  assert.match(page, /<Alert variant="warning"/);
  for (const file of ['src/app/(app)/profile/page.tsx', 'src/components/profile/ProfileAutofillCard.tsx',
    'src/components/profile/ProfileCompleteness.tsx', 'src/components/profile/ProfileSuggestionDialog.tsx',
    'src/components/profile/ProfileIcpSummary.tsx']) {
    assert.doesNotMatch(read(file), /\b(amber|emerald|red|green|yellow|orange|rose|sky|blue)-\d{2,3}\b/, `${file} has no raw colors`);
  }
  const summary = read('src/components/profile/ProfileIcpSummary.tsx');
  assert.match(summary, /\{defined && !dirty \? \(/, '«Buscar prospectos» only when the search would use what is on screen');
  assert.match(summary, /href="\/search"/);
  // Its own name: the form's section is also «Tu cliente ideal», and two regions with one name confuse a screen reader.
  assert.match(summary, /<section aria-label="Resumen de tu cliente ideal"/);
});
