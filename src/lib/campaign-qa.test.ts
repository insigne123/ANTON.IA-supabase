import test from 'node:test';
import assert from 'node:assert/strict';

import { assessCampaignDraftReadiness, assessCampaignQa, resolveNewCampaignStatus } from './campaign-qa';

test('campaign qa blocks missing recipient and content', () => {
  const result = assessCampaignQa({ email: '', subject: '', body: '' });

  assert.equal(result.status, 'blocked');
  assert.ok(result.checks.some((check) => check.id === 'recipient' && check.severity === 'blocked'));
  assert.ok(result.checks.some((check) => check.id === 'subject' && check.severity === 'blocked'));
  assert.ok(result.checks.some((check) => check.id === 'body' && check.severity === 'blocked'));
});

test('campaign qa blocks unresolved placeholders', () => {
  const result = assessCampaignQa({
    email: 'lead@example.com',
    subject: 'Hola {{lead.name}}',
    body: 'Queria compartir una idea para tu equipo esta semana.',
    contactability: { status: 'ok', label: 'Contactable', description: 'OK', reasons: [] },
  });

  assert.equal(result.status, 'blocked');
  assert.ok(result.checks.some((check) => check.id === 'placeholders' && check.severity === 'blocked'));
});

test('campaign qa marks risky copy for review', () => {
  const result = assessCampaignQa({
    email: 'lead@example.com',
    subject: 'OFERTA LIMITADA!!!',
    body: 'Gratis y garantizado. Actua ahora: https://example.com/a https://example.com/b https://example.com/c https://example.com/d https://example.com/e https://example.com/f',
    contactability: { status: 'ok', label: 'Contactable', description: 'OK', reasons: [] },
    usePixel: true,
    useLinkTracking: true,
  });

  assert.equal(result.status, 'review');
  assert.ok(result.checks.some((check) => check.id === 'deliverability-copy' && check.severity === 'review'));
});

test('campaign drafts can be assessed for review independently from persistence', () => {
  const incomplete = assessCampaignDraftReadiness({
    name: 'Nueva propuesta',
    campaignType: 'reconnection',
    steps: [{ subject: '', bodyHtml: '' }],
    offerName: '',
    offerSummary: '',
    hasActiveAudienceSegment: false,
  });

  assert.equal(incomplete.ready, false);
  assert.ok(incomplete.issues.some((issue) => issue.includes('asunto')));
  assert.ok(incomplete.issues.some((issue) => issue.includes('propuesta')));
  assert.ok(incomplete.issues.some((issue) => issue.includes('segmento')));
});

test('campaign draft is ready after content and audience are complete', () => {
  const complete = assessCampaignDraftReadiness({
    name: 'Reconexión agosto',
    campaignType: 'reconnection',
    steps: [{ subject: 'Una idea para tu equipo', bodyHtml: '<p>¿Lo revisamos esta semana?</p>' }],
    offerName: 'Auditoría comercial',
    hasActiveAudienceSegment: true,
  });

  assert.deepEqual(complete, { ready: true, issues: [] });
});

test('new campaigns are always created paused', () => {
  assert.equal(resolveNewCampaignStatus(), 'paused');
});
