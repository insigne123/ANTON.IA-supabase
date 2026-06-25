import test from 'node:test';
import assert from 'node:assert/strict';

import { assessCampaignQa } from './campaign-qa';

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
