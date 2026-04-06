import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getLeadResearchAutoContactBlockReason,
  getLeadResearchStatus,
  isLeadResearchReadyForAutoContact,
} from '@/lib/lead-research';

function buildReport(overrides: Record<string, any> = {}) {
  return {
    id: 'report-1',
    company: { name: 'Bakertilly' },
    websiteSummary: { overview: '', services: [], sources: [] },
    signals: [],
    createdAt: '2026-04-01T00:00:00.000Z',
    cross: {
      company: { name: 'Bakertilly' },
      overview: 'Bakertilly esta modernizando procesos internos.',
      pains: [],
      opportunities: [],
      risks: [],
      valueProps: [],
      useCases: [],
      talkTracks: [],
      subjectLines: [],
      emailDraft: { subject: '', body: '' },
      sources: [],
    },
    raw: { status: 'completed' },
    ...overrides,
  };
}

test('allows auto contact only for completed meaningful research', () => {
  const report = buildReport();

  assert.equal(getLeadResearchStatus(report), 'completed');
  assert.equal(isLeadResearchReadyForAutoContact(report), true);
  assert.equal(getLeadResearchAutoContactBlockReason(report), 'ready');
});

test('blocks partial research even if it contains content', () => {
  const report = buildReport({ raw: { status: 'partial' } });

  assert.equal(getLeadResearchStatus(report), 'partial');
  assert.equal(isLeadResearchReadyForAutoContact(report), false);
  assert.equal(getLeadResearchAutoContactBlockReason(report), 'partial');
});

test('blocks missing research and fallback investigation summaries', () => {
  assert.equal(isLeadResearchReadyForAutoContact(null), false);
  assert.equal(getLeadResearchAutoContactBlockReason(null), 'missing_research');

  const fallbackReport = buildReport({
    cross: {
      company: { name: 'Bakertilly' },
      overview: 'No se pudo completar la investigacion automatica de Bakertilly, pero el lead sigue elegible para contacto manual.',
      pains: [],
      opportunities: [],
      risks: [],
      valueProps: [],
      useCases: [],
      talkTracks: [],
      subjectLines: [],
      emailDraft: { subject: '', body: '' },
      sources: [],
    },
  });

  assert.equal(isLeadResearchReadyForAutoContact(fallbackReport), false);
  assert.equal(getLeadResearchAutoContactBlockReason(fallbackReport), 'research_failed_fallback');
});
