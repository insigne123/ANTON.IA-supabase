import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync('src/app/(app)/dashboard/page.tsx', 'utf8');
const summary = readFileSync('src/components/home/HomeSummary.tsx', 'utf8');
const today = readFileSync('src/components/home/TodayPanel.tsx', 'utf8');
const chart = readFileSync('src/components/ui/chart.tsx', 'utf8');

test('«Hoy» puts the work first and the week beside it, in the phone order step → contact → pending → summary → recommended', () => {
  const todayAt = page.indexOf('<TodayPanel');
  const asideAt = page.indexOf('<aside aria-label="Tu actividad de hoy"');
  const recommendedAt = page.indexOf('<RecommendedLeads />');
  assert.ok(todayAt > 0 && todayAt < asideAt && asideAt < recommendedAt, 'DOM order is the phone order');
  assert.match(page, /xl:grid-cols-\[minmax\(0,1fr\)_380px\]/);
  assert.match(page, /xl:col-start-2 xl:row-span-2 xl:row-start-1/, 'on wide screens the week sits beside both blocks of work');
  assert.ok(!existsSync('src/components/dashboard/SummaryCards.tsx'), 'the browser no longer downloads whole tables to count');
});

test('today\'s contact sits right under the next step, not fourth on a phone, and never doubles the «Perfil» step', () => {
  // It lived in the aside, below the checklist on a phone (21 Oct 2026): the feature we most want used came after two cards of setup.
  assert.match(page, /<TodayPanel afterPrimary=\{primary => <LeadDropBanner quietProfile=\{primary\.href === '\/profile'\} \/>\} \/>/);
  const aside = page.slice(page.indexOf('<aside aria-label="Tu actividad de hoy"'), page.indexOf('</aside>'));
  assert.doesNotMatch(aside, /LeadDropBanner/);
  assert.match(today, /\{afterPrimary\?\.\(data\.primary\)\}/);
  assert.ok(today.indexOf('afterPrimary?.(data.primary)') > today.indexOf('{data.primary.cta}'), 'after the next step');
  assert.ok(today.indexOf('afterPrimary?.(data.primary)') < today.indexOf('Lo que te espera'), 'before the pending');
  const banner = readFileSync('src/components/home/LeadDropBanner.tsx', 'utf8');
  assert.match(banner, /if \(quietProfile && data\?\.pull === 'profile'\) return null;/);
});

test('what is empty today takes one line, not a card: nothing waiting, no activity yet', () => {
  // When the step above is the only pending item, nothing more is said (APP-01).
  assert.match(today, /data\.queue\.length === 0 \? \(data\.primary\.queueId \? null : \(\s*<p className="flex items-center gap-2[^"]*">\s*<CheckCircle2/);
  assert.match(today, /Nada pendiente por ahora\./);
  assert.match(summary, /const quiet=Boolean\(summary\)&&METRICS\.every\(metric=>summary!\[metric\.key\]===0\)&&!summary!\.activity\.length/);
  assert.match(summary, /if\(quiet\)return <section aria-labelledby="summary-title">[\s\S]*Hoy aún no hay actividad en esta organización\./);
  // The chart (with its own empty text) is only drawn with activity.
  assert.ok(summary.indexOf('if(quiet)') < summary.indexOf('<PerformanceChart'));
});

test('the cards of «Tu semana» keep their own height on phones', () => {
  // A stretched grid item resolves h-full against the whole column: «Rendimiento» grew that tall and covered the credits.
  assert.match(page, /className="grid items-start gap-6/);
  for (const file of ['src/components/dashboard/PerformanceChart.tsx', 'src/components/dashboard/UserCreditsCard.tsx']) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), /<Card[^>]*h-full|'h-full /, file);
  }
});

test('the counts come from /api/home/summary and each one opens its screen', () => {
  assert.match(summary, /usePersonalHome<Summary>\('\/api\/home\/summary'/);
  assert.doesNotMatch(summary, /from\('contacted_leads'\)|supabase\./);
  for (const href of ['/contacted?view=all', '/contacted?view=reply', '/saved/leads/enriched']) assert.ok(summary.includes(`href:'${href}'`), href);
  assert.doesNotMatch(summary,/Campañas en curso|activeCampaigns|enrichedLeads/);
});

test('a finished setup shrinks to one line, still the tour target, the first week only (APP-01)', () => {
  assert.match(today, /setupComplete \? \(!data\.newAccount \? null : \(\s*<p data-tour="setup"/);
  assert.match(today, /Tu cuenta está lista/);
  assert.match(readFileSync('src/app/api/home/today/route.ts', 'utf8'), /newAccount: Date\.parse\(String\(\(user as \{ created_at\?: string \}\)\.created_at \|\| ''\)\) > now\.getTime\(\) - 7 \* 86_400_000/);
});

test('a labelled chart is an image for assistive tech, which fixes axe aria-prohibited-attr on every chart', () => {
  assert.match(chart, /role=\{role \?\? \(props\["aria-label"\] \? "img" : undefined\)\}/);
});

test('«Cambiar las metas del equipo» opens the editor from «Hoy» without leaving the page', () => {
  // A link to /dashboard with other parameters changed only the address: «Hoy» reads its view once (20 oct 2026).
  const card = readFileSync('src/components/home/WeeklyGoalCard.tsx', 'utf8');
  assert.match(page, /<WeeklyGoalCard onEditGoals=\{open\} \/>/);
  assert.match(page, /const open = \(href: string\) => \{ window\.history\.pushState\(null, '', href\); setView\(viewInUrl\(\)\);/);
  assert.match(card, /event\.preventDefault\(\); onEditGoals\(EDIT_GOALS\);/);
  assert.match(card, /EDIT_GOALS = '\/dashboard\?vista=semana&informe=equipo&metas=1'/);
});

test('the three readers of the quota on «Hoy» share one request', () => {
  for (const file of ['src/components/quota/quota-sync.tsx', 'src/components/quota/daily-quota-progress.tsx', 'src/components/dashboard/UserCreditsCard.tsx']) {
    const source = readFileSync(file, 'utf8');
    assert.match(source, /fetchQuotaStatus\(/, file);
    assert.doesNotMatch(source, /fetch\('\/api\/quota\/status'/, file);
  }
});

test('«Tu semana» says its week once, has no tiles of zeros and does not send people to connect a mailbox when the Yago address sends', () => {
  const report = readFileSync('src/components/weekly-report/WeeklyReport.tsx', 'utf8');
  const route = readFileSync('src/app/api/weekly-report/route.ts', 'utf8');
  // The toggle beside it says «Esta semana»: the line is only the range. A role pill no longer repeats «Tu semana» (page title, view toggle, pill).
  assert.match(report, /\(embedded \? report\.week\.label : `\$\{report\.week\.which === 'current' \? 'Esta semana' : 'La semana pasada'\} · \$\{report\.week\.label\}`\)/);
  assert.match(readFileSync('src/lib/weekly-report.ts', 'utf8'), /\{ id: 'personal', label: 'Personal' \}/);
  assert.match(report, /\{quietWeek \? null : <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">/);
  assert.match(report, /const quietWeek = Boolean\(report\) && \[report!\.personal\.sent, report!\.personal\.contacted, report!\.personal\.replies\]\.every\(count => count\.now === 0 && count\.before === 0\) && report!\.personal\.meetings === 0;/);
  assert.match(report, /\{data\.yago\s*\? 'A las 8:00, con la semana anterior, a tu correo\.'/);
  assert.match(route, /sender: canEmailEveryone\(\), yago: Boolean\(resendSender\(\)\),/);
});
