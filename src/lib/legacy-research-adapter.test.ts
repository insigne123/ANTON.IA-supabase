import test from 'node:test';
import assert from 'node:assert/strict';

import { adaptLegacyResearchPayloadV1 } from '@/lib/legacy-research-adapter';
import { ResearchSnapshotV1Schema } from '@/lib/research-contracts';

const NOW = '2026-08-13T12:00:00.000Z';
const context = {
  scope: {
    kind: 'organization' as const,
    organizationId: 'org-1',
    ownerUserId: 'user-1',
  },
  leadRef: 'lead-1',
  provider: 'n8n',
  now: () => NOW,
};

function assertResearchExcludesMessaging(snapshot: unknown) {
  const serialized = JSON.stringify(snapshot);
  for (const field of ['emailDraft', 'subjectLines', 'talkTracks', 'valueProps', 'nextSteps']) {
    assert.equal(serialized.includes(`"${field}"`), false, `snapshot must exclude ${field}`);
  }
}

test('adapter supports nested reports and preserves source provenance', () => {
  const result = adaptLegacyResearchPayloadV1({
    status: 'queued',
    report: {
      report_id: 'report-123',
      status: 'completed',
      generated_at: '2026-08-12T10:00:00.000Z',
      company: { name: 'Acme', domain: 'acme.test' },
      overview: { statement: 'Acme provides workflow automation.', source_id: 'legacy-source-1' },
      sources: [{
        id: 'legacy-source-1',
        type: 'news',
        url: 'https://news.example/acme',
        title: 'Acme expands',
        published_at: '2026-08-11T08:30:00.000Z',
        provider: 'news-index',
      }],
    },
  }, context);

  assert.equal(result.snapshot.id, 'report-123');
  assert.equal(result.snapshot.lifecycle.status, 'completed');
  assert.equal(result.snapshot.sources[0].title, 'Acme expands');
  assert.equal(result.snapshot.sources[0].publishedAt, '2026-08-11T08:30:00.000Z');
  assert.equal(result.snapshot.sources[0].provider, 'news-index');
  assert.ok(result.snapshot.claims.some((claim) => claim.kind === 'company_overview'));
  assert.equal(ResearchSnapshotV1Schema.safeParse(result.snapshot).success, true);
  assert.equal(result.legacyExtras.detectedShape, 'nested_report');
});

test('adapter splits flat cross research from lightweight messaging drafts', () => {
  const result = adaptLegacyResearchPayloadV1({
    company: {
      name: 'Acme',
      domain: 'acme.test',
      website: 'https://acme.test/',
    },
    overview: 'Acme automates finance operations.',
    pains: ['Manual reconciliation may slow reporting.'],
    opportunities: ['Automate recurring reconciliation.'],
    risks: ['Migration complexity may delay adoption.'],
    useCases: ['Reconciliation assistance'],
    valueProps: ['Reduce manual effort'],
    talkTracks: ['How is reconciliation handled today?'],
    subjectLines: ['Faster reconciliation'],
    emailDraft: { subject: 'Faster reconciliation', body: 'Hello Jane.' },
    nextSteps: [{ action: 'Send email', why: 'Start a conversation', priority: 'high' }],
    sources: [{ title: 'Acme', url: 'https://acme.test/' }],
  }, context);

  assertResearchExcludesMessaging(result.snapshot);
  assert.ok(result.snapshot.claims.some((claim) => claim.kind === 'pain_hypothesis'));
  assert.equal(result.drafts.length, 1);
  assert.equal(result.drafts[0].subject, 'Faster reconciliation');
  assert.equal(result.drafts[0].body, 'Hello Jane.');
  assert.deepEqual(result.drafts[0].valuePropositions, ['Reduce manual effort']);
  assert.deepEqual(result.drafts[0].nextSteps, [{
    action: 'Send email',
    why: 'Start a conversation',
    priority: 'high',
  }]);
});

test('adapter parses native OpenAI content arrays and annotation citations', () => {
  const content = JSON.stringify({
    company: { name: 'Acme' },
    overview: 'Acme announced a new operations platform.',
  });
  const result = adaptLegacyResearchPayloadV1([
    {
      index: 0,
      message: {
        role: 'assistant',
        content: [{ type: 'output_text', text: content }],
        annotations: [{
          type: 'url_citation',
          url_citation: {
            title: 'Acme announcement',
            url: 'https://acme.test/news/platform',
          },
        }],
      },
      finish_reason: 'stop',
    },
  ], context);

  assert.equal(result.legacyExtras.detectedShape, 'assistant_content');
  assert.equal(result.snapshot.sources[0].url, 'https://acme.test/news/platform');
  assert.equal(result.snapshot.sources[0].title, 'Acme announcement');
  assert.equal(result.snapshot.sources[0].provider, 'n8n');
  assert.equal(result.snapshot.evidence.length, 0);
  assert.equal(result.snapshot.lifecycle.status, 'insufficient_data');
});

test('adapter does not attach an unrelated first source to unsupported claims', () => {
  const result = adaptLegacyResearchPayloadV1({
    status: 'completed',
    overview: 'Acme automates finance operations for enterprise teams.',
    sources: [{ id: 'unrelated', url: 'https://news.example/another-company' }],
  }, context);

  const overview = result.snapshot.claims.find((claim) => claim.kind === 'company_overview');
  assert.deepEqual(overview?.supportingEvidenceIds, []);
  assert.equal(result.snapshot.evidence.length, 0);
  assert.equal(result.snapshot.lifecycle.status, 'insufficient_data');
});

test('adapter retains a valid explicit legacy source relationship', () => {
  const result = adaptLegacyResearchPayloadV1({
    status: 'completed',
    website_summary: {
      overview: 'Acme automates finance operations for enterprise teams.',
      source_ids: ['source-1'],
    },
    sources: [{ id: 'source-1', url: 'https://acme.test/about' }],
  }, context);

  const overview = result.snapshot.claims.find((claim) => claim.kind === 'company_overview');
  assert.equal(overview?.supportingEvidenceIds.length, 1);
  assert.equal(result.snapshot.evidence[0].sourceId, result.snapshot.sources[0].id);
  assert.equal(result.snapshot.evidence[0].excerpt, undefined);
  assert.equal(result.snapshot.lifecycle.status, 'completed');
});

test('adapter keeps fallback-marked evidence out of completed status', () => {
  const result = adaptLegacyResearchPayloadV1({
    status: 'completed',
    source: 'fallback',
    website_summary: {
      overview: 'Acme automates finance operations for enterprise teams.',
      source_ids: ['source-1'],
    },
    sources: [{ id: 'source-1', url: 'https://acme.test/about' }],
  }, context);

  assert.equal(result.snapshot.lifecycle.status, 'failed');
});

test('adapter parses fenced JSON and marks recovered truncated JSON partial', () => {
  const content = `\`\`\`json
{
  "company": { "name": "Acme", "website": "https://acme.test/" },
  "website_summary": { "overview": "Acme builds workflow software.", "source_ids": ["source-1"] },
  "sources": [{ "id": "source-1", "title": "Acme", "url": "https://acme.test/" }],
  "emailDraft": { "subject": "Hello", "body": "unfinished`;
  const result = adaptLegacyResearchPayloadV1({
    message: { role: 'assistant', content },
  }, context);

  assert.equal(result.legacyExtras.recoveredTruncatedJson, true);
  assert.equal(result.snapshot.lifecycle.status, 'partial');
  assert.ok(result.snapshot.lifecycle.errors.some((error) => error.code === 'truncated_response'));
  assert.ok(result.snapshot.claims.some((claim) => claim.supportingEvidenceIds.length > 0));
  assertResearchExcludesMessaging(result.snapshot);
});

test('adapter supports n8n item arrays and creates deterministic IDs and fingerprints', () => {
  const payload = [{
    json: {
      company: { name: 'Acme', website: 'https://acme.test/' },
      overview: 'Acme builds workflow software.',
      sources: [{ url: 'https://acme.test/', title: 'Acme' }],
    },
  }];

  const first = adaptLegacyResearchPayloadV1(payload, context);
  const second = adaptLegacyResearchPayloadV1(payload, context);

  assert.equal(first.legacyExtras.detectedShape, 'array');
  assert.equal(first.snapshot.id, second.snapshot.id);
  assert.equal(first.snapshot.request.inputFingerprint, second.snapshot.request.inputFingerprint);
  assert.deepEqual(first.snapshot.sources, second.snapshot.sources);
  assert.deepEqual(first.snapshot.claims, second.snapshot.claims);
});

test('adapter preserves multiple outreach variants only in drafts', () => {
  const result = adaptLegacyResearchPayloadV1({
    company: { name: 'Acme', website_url: 'https://acme.test/' },
    website_summary: {
      overview: 'Acme builds workflow software.',
      source_ids: ['source-1'],
    },
    sources: [{ id: 'source-1', url: 'https://acme.test/', title: 'Acme' }],
    outreach_pack: {
      email_drafts: {
        short: { subject: 'Short', body: 'Short body' },
        medium: { subject: 'Medium', body: 'Medium body' },
      },
      subject_lines: ['Alternative'],
      talk_tracks: ['Question'],
    },
    buyer_intelligence: { fit_reasons: ['Fit reason'] },
  }, context);

  assert.equal(result.drafts.length, 2);
  assert.deepEqual(result.drafts.map((draft) => draft.variant), ['medium', 'short']);
  assertResearchExcludesMessaging(result.snapshot);
});
