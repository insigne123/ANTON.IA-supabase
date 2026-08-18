import assert from 'node:assert/strict';
import test from 'node:test';

import { getResearchReadinessBlockReason, hasMeaningfulResearchEvidence } from './research-readiness';

test('message content never qualifies as research evidence by itself', () => {
    const onlyMessage = {
        status: 'completed',
        emailDraft: { subject: 'Hola', body: 'Contenido comercial' },
        talkTracks: ['Pregunta'],
        subjectLines: ['Asunto'],
    };
    assert.equal(hasMeaningfulResearchEvidence(onlyMessage), false);
    assert.equal(getResearchReadinessBlockReason(onlyMessage), 'insufficient_research');
});

test('terminal status and evidence are both required', () => {
  assert.equal(getResearchReadinessBlockReason({ status: 'partial', overview: 'Evidence' }), 'partial');
  assert.equal(getResearchReadinessBlockReason({ status: 'completed', overview: 'Substantive research evidence.' }), 'missing_research_sources');
  assert.equal(getResearchReadinessBlockReason({
    status: 'completed',
    website_summary: {
      overview: 'Substantive research evidence.',
      source_ids: ['source-1'],
    },
    sources: [{ id: 'source-1', url: 'https://example.test/source' }],
  }), null);
});

test('URL-only, fallback, and unrelated sources cannot authorize contact', () => {
  assert.equal(getResearchReadinessBlockReason({
    status: 'completed',
    sources: [{ id: 'source-1', url: 'https://example.test/source' }],
  }), 'insufficient_research');
  assert.equal(getResearchReadinessBlockReason({
    status: 'completed',
    source: 'fallback',
    overview: 'Substantive research evidence.',
    sources: [{ id: 'source-1', url: 'https://example.test/source' }],
  }), 'fallback');
  assert.equal(getResearchReadinessBlockReason({
    status: 'completed',
    warnings: ['provider_http_error'],
    website_summary: { overview: 'Substantive research evidence.', source_ids: ['source-1'] },
    sources: [{ id: 'source-1', url: 'https://example.test/source' }],
  }), 'http_error');
  assert.equal(getResearchReadinessBlockReason({
    status: 'completed',
    overview: 'Substantive research evidence.',
    sources: [{ id: 'source-1', url: 'https://unrelated.example/source' }],
  }), 'missing_evidence_links');
  assert.equal(getResearchReadinessBlockReason({
    status: 'completed',
    pains: [{ statement: 'Manual reconciliation delays monthly reporting.', url: 'https://other.example/source' }],
    sources: [{ id: 'source-1', url: 'https://unrelated.example/source' }],
  }), 'missing_evidence_links');
});

test('canonical claim evidence linked to an HTTP source authorizes contact', () => {
  assert.equal(getResearchReadinessBlockReason({
    lifecycle: { status: 'completed', errors: [] },
    sources: [{ id: 'source-1', url: 'https://example.test/source' }],
    evidence: [{ id: 'evidence-1', sourceId: 'source-1', statement: 'Acme automates finance operations.' }],
    claims: [{ statement: 'Acme automates finance operations.', supportingEvidenceIds: ['evidence-1'] }],
  }), null);
});
