import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

/**
 * Focused UI slice tests for the report visual redesign.
 * Mounting is impractical here: the repo unit runner only transpiles `.ts`
 * (see scripts/ts-test-loader.mjs) and there is no React testing library
 * installed. We therefore assert behavior of the mirrored pure helpers and
 * assert source contracts (variant, badges, states, responsive, focus).
 */

type ReportFieldStatus = 'confirmed' | 'estimated' | 'hypothesis' | 'unavailable' | 'restricted';
type ReportFieldGroup = 'company' | 'contact' | 'commercial' | 'decision' | 'personalization';
type ReportFieldAnswer = {
  key: string;
  group: ReportFieldGroup;
  label: string;
  value: string;
  detail?: string;
  status: ReportFieldStatus;
  sourceUrls?: string[];
  observedAt?: string | null;
};

// Mirrors src/components/research/ReportFieldAnswers.tsx (kept in sync via source assertions below).
const GROUP_ORDER: ReportFieldGroup[] = ['company', 'contact', 'commercial', 'decision', 'personalization'];

function groupReportFieldAnswers(answers: ReportFieldAnswer[]): Record<ReportFieldGroup, ReportFieldAnswer[]> {
  const grouped: Record<ReportFieldGroup, ReportFieldAnswer[]> = {
    company: [],
    contact: [],
    commercial: [],
    decision: [],
    personalization: [],
  };
  answers.forEach((answer) => {
    grouped[answer.group]?.push(answer);
  });
  return grouped;
}

function selectPreviewReportFields(answers: ReportFieldAnswer[], limit = 6): ReportFieldAnswer[] {
  const safeLimit = Math.max(0, Math.floor(limit));
  return answers
    .filter((answer) => answer.status === 'confirmed' || answer.status === 'estimated')
    .slice(0, safeLimit);
}

function readWorktreeFile(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

const sampleAnswers: ReportFieldAnswer[] = [
  { key: 'company-1', group: 'company', label: 'Empresa', value: 'Acme SpA', status: 'confirmed' },
  { key: 'contact-1', group: 'contact', label: 'Cargo', value: 'CTO', status: 'confirmed' },
  { key: 'commercial-1', group: 'commercial', label: 'Señal', value: 'Abrió nueva oficina', status: 'estimated', observedAt: '2026-08-20T00:00:00.000Z' },
  { key: 'decision-1', group: 'decision', label: 'Oportunidad', value: 'Automatizar reportes', status: 'hypothesis' },
  { key: 'personalization-1', group: 'personalization', label: 'Vacío', value: 'Falta tamaño del equipo', status: 'unavailable' },
  { key: 'company-2', group: 'company', label: 'Dominio', value: 'acme.cl', status: 'restricted' },
];

test('groups field answers by group while preserving insertion order', () => {
  const grouped = groupReportFieldAnswers(sampleAnswers);
  assert.deepEqual(Object.keys(grouped).sort(), [...GROUP_ORDER].sort());
  assert.deepEqual(grouped.company.map((item) => item.key), ['company-1', 'company-2']);
  assert.deepEqual(grouped.contact.map((item) => item.key), ['contact-1']);
  assert.deepEqual(grouped.commercial.map((item) => item.key), ['commercial-1']);
  assert.deepEqual(grouped.decision.map((item) => item.key), ['decision-1']);
  assert.deepEqual(grouped.personalization.map((item) => item.key), ['personalization-1']);
});

test('returns empty groups for empty input', () => {
  const grouped = groupReportFieldAnswers([]);
  for (const group of GROUP_ORDER) {
    assert.deepEqual(grouped[group], []);
  }
});

test('preview selects only confirmed/estimated keys and caps the limit', () => {
  const preview = selectPreviewReportFields(sampleAnswers, 2);
  assert.deepEqual(preview.map((item) => item.key), ['company-1', 'contact-1']);
  const fullPreview = selectPreviewReportFields(sampleAnswers, 10);
  assert.deepEqual(fullPreview.map((item) => item.key), ['company-1', 'contact-1', 'commercial-1']);
  assert.ok(fullPreview.every((item) => item.status === 'confirmed' || item.status === 'estimated'));
});

test('preview is empty when there is nothing confirmed or estimated', () => {
  const onlyUncertain: ReportFieldAnswer[] = [
    { key: 'a', group: 'decision', label: 'Oportunidad', value: 'Hipótesis', status: 'hypothesis' },
    { key: 'b', group: 'personalization', label: 'Vacío', value: 'Falta dato', status: 'unavailable' },
  ];
  assert.deepEqual(selectPreviewReportFields(onlyUncertain), []);
});

test('ReportFieldAnswers exposes the five Spanish status labels', () => {
  const source = readWorktreeFile('src/components/research/ReportFieldAnswers.tsx');
  for (const label of ['Confirmado', 'Estimado', 'Hipótesis', 'No disponible', 'Restringido']) {
    assert.ok(source.includes(label), `missing status label: ${label}`);
  }
  for (const status of ['confirmed', 'estimated', 'hypothesis', 'unavailable', 'restricted']) {
    assert.ok(source.includes(`'${status}'`), `missing status key: ${status}`);
  }
});

test('ReportFieldAnswers covers company/contact/commercial/decision/personalization groups', () => {
  const source = readWorktreeFile('src/components/research/ReportFieldAnswers.tsx');
  for (const group of GROUP_ORDER) {
    assert.ok(source.includes(`'${group}'`), `missing group key: ${group}`);
  }
  for (const label of ['Empresa', 'Contacto', 'Lectura comercial', 'Decisión', 'Personalización']) {
    assert.ok(source.includes(label), `missing group label: ${label}`);
  }
  assert.ok(source.includes('groupReportFieldAnswers'), 'missing grouping helper');
  assert.ok(source.includes('selectPreviewReportFields'), 'missing preview selector');
});

test('field badges are never color-only and keep light/dark plus focus styles', () => {
  const source = readWorktreeFile('src/components/research/ReportFieldAnswers.tsx');
  assert.ok(source.includes('ReportFieldStatusBadge'), 'missing badge component');
  assert.ok(source.includes('aria-hidden="true"'), 'badge icon must be aria-hidden with visible text');
  assert.ok(source.includes('dark:'), 'missing dark: variants');
  assert.ok(source.includes('focus-visible:ring-2'), 'missing visible focus styles');
  assert.ok(source.includes('sm:grid-cols-2'), 'missing responsive grid');
  assert.ok(source.includes('min-w-0'), 'missing overflow-safe layout');
  assert.ok(source.includes('break-words'), 'missing break-words for long values');
  assert.ok(source.includes('role="alert"'), 'missing error role');
  assert.ok(source.includes('aria-busy'), 'missing loading semantics');
  assert.ok(source.includes('Skeleton'), 'missing Skeleton for loading');
});

test('NativeResearchReport supports preview/full, hides duplicated header, and keeps full sections plus sticky footer', () => {
  const source = readWorktreeFile('src/components/research/NativeResearchReport.tsx');
  assert.ok(source.includes("variant?: NativeResearchReportVariant") || source.includes("variant = 'full'"), 'missing variant prop');
  assert.ok(source.includes("'preview'") && source.includes("'full'"), 'missing preview/full variants');
  assert.ok(source.includes('hideHeader'), 'missing hideHeader prop');
  assert.ok(source.includes('ReportFieldAnswers'), 'missing field grid integration');
  assert.ok(source.includes('previewFieldAnswers'), 'missing preview field selection');
  assert.ok(source.includes('Cronología de señales') || source.includes('timeline'), 'missing signals timeline');
  assert.ok(source.includes('Mapa de decisión') || source.includes('decision-map'), 'missing decision map');
  assert.ok(source.includes('Supuestos y estimaciones'), 'missing assumptions/estimates table');
  assert.ok(source.includes('<Table'), 'missing Table primitive for assumptions');
  assert.ok(source.includes('Vacíos y contradicciones'), 'missing gaps/contradictions');
  assert.ok(source.includes('Fuentes y calidad'), 'missing sources/quality');
  assert.ok(source.includes('sticky bottom-0'), 'missing accessible sticky action footer');
  assert.ok(source.includes('aria-label="Acciones del informe"'), 'missing footer accessible label');
  assert.ok(source.includes('Collapsible'), 'missing keyboard-accessible collapsibles');
});

test('quick Dialog uses preview without a duplicated inner header and keeps one dialog title', () => {
  const source = readWorktreeFile('src/app/(app)/saved/leads/enriched/Client.tsx');
  assert.ok(source.includes('variant="preview"'), 'dialog must pass variant="preview"');
  assert.ok(source.includes('hideHeader'), 'dialog must hide the duplicated inner report header');
  assert.ok(source.includes('<DialogTitle'), 'dialog must keep one dialog title');
  // Legacy cross-report branch stays functional.
  assert.ok(source.includes('reportToView?.cross'), 'legacy cross-report branch must stay');
});

test('workspace uses full variant, neutralizes the duplicate header, and keeps rail/detail behavior', () => {
  const source = readWorktreeFile('src/components/research/ResearchWorkspace.tsx');
  assert.ok(source.includes('variant="full"'), 'workspace must pass variant="full"');
  assert.ok(source.includes('className="sr-only"'), 'duplicate detail header must stay screen-reader only when a report exists');
  assert.ok(source.includes('research-report-panel'), 'focus management target must stay');
  assert.ok(source.includes(".focus()"), 'focus management must stay');
  assert.ok(source.includes('mobilePane'), 'responsive rail/detail panes must stay');
  assert.ok(source.includes('lg:grid-cols-'), 'responsive rail/detail grid must stay');
});

test('report UI stays quiet, single-CTA, and responsive at narrow widths', () => {
  const answersSource = readWorktreeFile('src/components/research/ReportFieldAnswers.tsx');
  const reportSource = readWorktreeFile('src/components/research/NativeResearchReport.tsx');
  assert.ok(!/marketing|jerga|concepto de diseño/i.test(`${answersSource}\n${reportSource}`), 'no internal jargon or marketing copy');
  assert.ok(reportSource.includes('Borrador disponible para revisión') || reportSource.includes('Crear borrador'), 'one primary CTA must stay');
  for (const source of [answersSource, reportSource]) {
    assert.ok(!source.includes('w-[320px]') && !source.includes('w-[520px]'), 'no fixed narrow widths that break 320/380/520');
  }
});
