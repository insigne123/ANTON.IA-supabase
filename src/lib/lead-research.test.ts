import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildLeadResearchPayloadFromLead,
  getLeadResearchAutoContactBlockReason,
  getLeadResearchStatus,
  hasMeaningfulLeadResearch,
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
      sources: [{ title: 'Official source', url: 'https://bakertilly.example/news' }],
    },
    raw: {
      status: 'completed',
      website_summary: {
        overview: 'Bakertilly esta modernizando procesos internos.',
        source_ids: ['source-1'],
      },
      sources: [{ id: 'source-1', url: 'https://bakertilly.example/news' }],
    },
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
    raw: { status: 'completed', source: 'fallback' },
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
  assert.equal(getLeadResearchAutoContactBlockReason(fallbackReport), 'fallback');
});

test('blocks URL-only and unrelated-source research', () => {
  const urlOnly = buildReport({
    cross: { ...buildReport().cross, overview: '' },
    raw: { status: 'completed', sources: [{ id: 'source-1', url: 'https://bakertilly.example/news' }] },
  });
  const unrelated = buildReport({
    raw: {
      status: 'completed',
      overview: 'Bakertilly esta modernizando procesos internos.',
      sources: [{ id: 'source-1', url: 'https://unrelated.example/news' }],
    },
  });

  assert.equal(getLeadResearchAutoContactBlockReason(urlOnly), 'insufficient_research');
  assert.equal(getLeadResearchAutoContactBlockReason(unrelated), 'missing_evidence_links');
});

test('does not treat drafts or talk tracks as meaningful research evidence', () => {
  const report = buildReport({
    cross: {
      ...buildReport().cross,
      overview: '',
      talkTracks: ['Ask about priorities'],
      emailDraft: { subject: 'Hello', body: 'Draft body' },
    },
    raw: { status: 'completed', sources: [{ id: 'source-1', url: 'https://bakertilly.example/news' }] },
  });

  assert.equal(hasMeaningfulLeadResearch(report), false);
});

test('new request identity and target domain never fall back to seller or name plus company', () => {
  const payload = buildLeadResearchPayloadFromLead({
    userId: 'user-1',
    lead: {
      fullName: 'Jane Doe',
      companyName: 'Target Co',
    } as any,
    sellerProfile: {
      company_name: 'Seller Co',
      company_domain: 'seller.example',
    },
    freshnessBucket: '2026-08-13',
  });

  assert.equal(payload.lead_ref, undefined);
  assert.equal(payload.company.domain, undefined);
  assert.match(payload.idempotency_key, /^research:v1:/);
  assert.equal(payload.options.force_refresh, true);
});

test('lead research request key is stable for retries and changes on intentional refresh', () => {
  const base = {
    userId: 'user-1',
    lead: { id: 'lead-1', email: 'Jane@Acme.test', companyDomain: 'acme.test' } as any,
  };
  const first = buildLeadResearchPayloadFromLead({ ...base, freshnessBucket: '2026-08-13' });
  const retry = buildLeadResearchPayloadFromLead({ ...base, freshnessBucket: '2026-08-13' });
  const refresh = buildLeadResearchPayloadFromLead({ ...base, freshnessBucket: '2026-08-14' });

  assert.equal(first.idempotency_key, retry.idempotency_key);
  assert.notEqual(first.idempotency_key, refresh.idempotency_key);
});
