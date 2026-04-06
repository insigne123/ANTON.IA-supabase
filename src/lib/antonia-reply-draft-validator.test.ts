import test from 'node:test';
import assert from 'node:assert/strict';

import { validateAutonomousReplyDraft } from '@/lib/antonia-reply-draft-validator';

test('validates a safe meeting reply draft', () => {
  const result = validateAutonomousReplyDraft({
    subject: 'Coordinemos reunion',
    bodyText: 'Gracias por responder. Si te acomoda, puedes tomar un horario aqui: https://calendly.com/demo/reunion. Quedo atento.',
    desiredAction: 'send',
    intent: 'meeting_request',
    bookingLink: 'https://calendly.com/demo/reunion',
    allowedAssetNames: ['Brochure general'],
    recommendedAssetNames: [],
  });

  assert.equal(result.valid, true);
});

test('flags placeholders and AI mentions', () => {
  const result = validateAutonomousReplyDraft({
    subject: 'Hola {{name}}',
    bodyText: 'Como IA, te comparto mas contexto [pendiente].',
    desiredAction: 'draft',
    intent: 'positive',
  });

  assert.equal(result.valid, false);
  assert.ok(result.issues.includes('unresolved_placeholders'));
  assert.ok(result.issues.includes('mentions_ai'));
});

test('flags invalid assets and missing booking CTA', () => {
  const result = validateAutonomousReplyDraft({
    subject: 'Gracias por responder',
    bodyText: 'Perfecto, avancemos con la conversacion.',
    desiredAction: 'send',
    intent: 'meeting_request',
    bookingLink: 'https://calendly.com/demo/reunion',
    allowedAssetNames: ['Deck corto'],
    recommendedAssetNames: ['Brochure enterprise'],
  });

  assert.equal(result.valid, false);
  assert.ok(result.issues.includes('missing_booking_cta'));
  assert.ok(result.issues.includes('invalid_asset:Brochure enterprise'));
});
