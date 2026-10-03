import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync('src/app/(app)/dashboard/page.tsx', 'utf8');
const summary = readFileSync('src/components/home/HomeSummary.tsx', 'utf8');
const today = readFileSync('src/components/home/TodayPanel.tsx', 'utf8');
const chart = readFileSync('src/components/ui/chart.tsx', 'utf8');

test('«Hoy» puts the work first and the week beside it, in the phone order step → pending → summary → recommended', () => {
  const todayAt = page.indexOf('<TodayPanel />');
  const asideAt = page.indexOf('<aside aria-label="Tu semana"');
  const recommendedAt = page.indexOf('<RecommendedLeads />');
  assert.ok(todayAt > 0 && todayAt < asideAt && asideAt < recommendedAt, 'DOM order is the phone order');
  assert.match(page, /xl:grid-cols-\[minmax\(0,1fr\)_380px\]/);
  assert.match(page, /xl:col-start-2 xl:row-span-2 xl:row-start-1/, 'on wide screens the week sits beside both blocks of work');
  assert.ok(!existsSync('src/components/dashboard/SummaryCards.tsx'), 'the browser no longer downloads whole tables to count');
});

test('the counts come from /api/home/summary and each one opens its screen', () => {
  assert.match(summary, /fetch\('\/api\/home\/summary'/);
  assert.doesNotMatch(summary, /from\('contacted_leads'\)|supabase\./);
  for (const href of ['/contacted?view=all', '/contacted?view=reply', '/campaigns', '/saved/leads/enriched']) assert.ok(summary.includes(`href: '${href}'`), href);
  assert.match(summary, /Campañas en curso/);
});

test('a finished setup shrinks to one line, still the tour target', () => {
  assert.match(today, /setupComplete \? \(\s*<p data-tour="setup"/);
  assert.match(today, /Tu cuenta está lista/);
});

test('a labelled chart is an image for assistive tech, which fixes axe aria-prohibited-attr on every chart', () => {
  assert.match(chart, /role=\{role \?\? \(props\["aria-label"\] \? "img" : undefined\)\}/);
});

test('the three readers of the quota on «Hoy» share one request', () => {
  for (const file of ['src/components/quota/quota-sync.tsx', 'src/components/quota/daily-quota-progress.tsx', 'src/components/dashboard/UserCreditsCard.tsx']) {
    const source = readFileSync(file, 'utf8');
    assert.match(source, /fetchQuotaStatus\(/, file);
    assert.doesNotMatch(source, /fetch\('\/api\/quota\/status'/, file);
  }
});
