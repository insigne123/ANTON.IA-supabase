import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { EXCLUSION_MOTIVES, TENDER_PREREQUISITES, byClosing, bySource, closesLabel, exclusionGroups, startHere, workAdvice } from './workspace-radar';

const NOW = Date.parse('2026-10-14T12:00:00Z');
const at = (days: number) => new Date(NOW + days * 86_400_000).toISOString();
const item = (id: string, evaluation: string | null, deadline: string | null, score = 50, extra: Record<string, unknown> = {}) => ({
  id, kind: 'tender', title: `Licitación ${id}`, company_name: null, buyer_name: 'Organismo', company_domain: null, url: null, score,
  reasons: [`Motivo ${id}`], deadline_at: deadline, amount: null, currency: null, updated_at: at(0),
  data: { ...(evaluation ? { evaluation } : {}), ...extra },
});

test('each opportunity says what to do: recommended → Postular, review → Evaluar, excluded → No postular, else Por evaluar', () => {
  assert.equal(workAdvice(item('a', 'recommended', at(10)), NOW).label, 'Postular');
  assert.equal(workAdvice(item('b', 'review', at(10)), NOW).label, 'Evaluar');
  assert.equal(workAdvice(item('c', 'excluded', at(10)), NOW).label, 'No postular');
  assert.equal(workAdvice(item('d', null, at(10)), NOW).label, 'Por evaluar');
  assert.equal(workAdvice({ ...item('e', null, null), kind: 'private' }, NOW).label, 'Evaluar', 'a private invitation starts in review');
});

test('a LinkedIn signal is a conversation to start: Contactar or No contactar, never Postular', () => {
  assert.equal(workAdvice({ ...item('a', 'recommended', null), kind: 'hiring' }, NOW).label, 'Contactar');
  assert.equal(workAdvice({ ...item('b', 'excluded', null), kind: 'linkedin_post' }, NOW).label, 'No contactar');
  assert.equal(workAdvice({ ...item('c', 'review', null), kind: 'linkedin_post' }, NOW).label, 'Evaluar');
});

test('a deadline within three days is urgent, a past one is closed, and an excluded one is never urgent', () => {
  const soon = workAdvice(item('a', 'recommended', at(1.5)), NOW);
  assert.equal(soon.urgent, true);
  assert.equal(closesLabel(soon), 'cierra mañana');
  assert.equal(workAdvice(item('b', 'recommended', at(10)), NOW).urgent, false);
  const past = workAdvice(item('c', 'recommended', at(-1)), NOW);
  assert.equal(past.closed, true);
  assert.equal(past.urgent, false);
  assert.equal(closesLabel(past), 'cerrada');
  assert.equal(workAdvice(item('d', 'excluded', at(1)), NOW).urgent, false);
  assert.equal(closesLabel(workAdvice(item('e', 'review', at(0.2)), NOW)), 'cierra hoy');
  assert.equal(closesLabel(workAdvice(item('f', 'review', null), NOW)), null);
});

test('«Por dónde empezar» keeps the recommended ones with at least a day to prepare, nearest deadline first, then the ones to evaluate', () => {
  const items = [
    item('late', 'recommended', at(20)), item('soon', 'recommended', at(3)), item('today', 'recommended', at(0.5)),
    item('review', 'review', at(2)), item('excluded', 'excluded', at(2)), item('post', 'recommended', null),
  ];
  assert.deepEqual(startHere(items, NOW).map(entry => entry.id), ['soon', 'late', 'review']);
  assert.equal(startHere(items, NOW, 1).length, 1);
  assert.deepEqual(startHere([item('x', 'excluded', at(5))], NOW), []);
});

test('the excluded ones are grouped by why, the largest group first and those without a motive last', () => {
  const groups = exclusionGroups([
    item('a', 'excluded', at(5), 5, { excludedMotive: 'requisito' }), item('b', 'excluded', at(5), 5, { excludedMotive: 'otro_producto' }),
    item('c', 'excluded', at(5), 5, { excludedMotive: 'otro_producto' }), item('d', 'excluded', at(5), 5),
    item('e', 'excluded', at(5), 5, { excludedMotive: 'inventado' }),
  ]);
  assert.deepEqual(groups.map(group => [group.label, group.items.length]),
    [['Piden otra cosa', 2], ['Exigen algo que no ofreces', 1], ['Otros motivos', 2]]);
  assert.deepEqual(EXCLUSION_MOTIVES, ['otro_producto', 'parte_menor', 'requisito', 'escala', 'sin_compra']);
});

test('the evaluation asks why an excluded one was left out and keeps it next to the verdict; the page shows the radar parts', () => {
  const sources = readFileSync('src/lib/server/commercial-opportunities/workspace-sources.ts', 'utf8');
  assert.match(sources, /motive: z\.enum\(EXCLUSION_MOTIVES\)\.nullable\(\)\.optional\(\)/, 'results saved before the motive still parse');
  assert.match(sources, /excludedMotive: answer\.verdict === 'excluded' \? answer\.motive \?\? null : null/);
  const page = readFileSync('src/components/commercial-opportunities/OpportunityWorkWorkspace.tsx', 'utf8');
  assert.match(page, /<AdvicePill item=\{item\} \/>/);
  assert.match(page, /filter === 'recommended' && !query && <StartHere/);
  assert.match(page, /bySource\(items\)\.map\(group =>/);
  assert.match(page, /filter === 'excluded' \? <ExclusionGroups items=\{group\.items\}/);
  assert.match(page, /<TenderPrerequisites \/>/);
  assert.ok(TENDER_PREREQUISITES.length >= 4 && TENDER_PREREQUISITES.every(block => block.items.length >= 3));
});

test('each view is split in Licitaciones and LinkedIn, the open ones by nearest closing, closed ones last', () => {
  const list = [
    item('closed', 'review', at(-2)), item('later', 'review', at(20)), item('none', 'review', null, 90), item('soon', 'review', at(2)),
    { ...item('ad-low', 'review', null, 40), kind: 'hiring' }, { ...item('post-high', 'review', null, 80), kind: 'linkedin_post' },
    { ...item('received', 'review', at(5)), kind: 'private' },
  ];
  assert.deepEqual(byClosing(list.filter(i => !['hiring', 'linkedin_post'].includes(i.kind)), NOW).map(i => i.id), ['soon', 'received', 'later', 'none', 'closed']);
  const groups = bySource(list, NOW);
  assert.deepEqual(groups.map(g => [g.label, g.items.map(i => i.id)]),
    [['Licitaciones', ['soon', 'received', 'later', 'none', 'closed']], ['LinkedIn', ['post-high', 'ad-low']]]);
  assert.deepEqual(bySource([item('a', 'review', at(3))], NOW).map(g => g.key), ['tenders'], 'an empty group is not shown');
  assert.deepEqual(byClosing([item('old', null, at(-9)), item('recent', null, at(-1))], NOW).map(i => i.id), ['recent', 'old']);
});
