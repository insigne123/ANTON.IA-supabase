import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createTrackingToken,
  prepareEmailTracking,
  resolveTrackingToken,
  stripEmailTrackingMarkup,
} from './tracking-token';

function withTrackingEnvironment<T>(run: () => T) {
  const previousSecret = process.env.TRACKING_TOKEN_SECRET;
  const previousAppUrl = process.env.NEXT_PUBLIC_APP_URL;
  process.env.TRACKING_TOKEN_SECRET = 'tracking-token-test-secret';
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.test';

  try {
    return run();
  } finally {
    if (previousSecret === undefined) delete process.env.TRACKING_TOKEN_SECRET;
    else process.env.TRACKING_TOKEN_SECRET = previousSecret;
    if (previousAppUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = previousAppUrl;
  }
}

const contactedId = '11111111-1111-4111-8111-111111111111';
const organizationId = '22222222-2222-4222-8222-222222222222';

test('tracking tokens bind a click to its exact destination and organization', () => {
  withTrackingEnvironment(() => {
    const token = createTrackingToken({
      event: 'click',
      contactedId,
      organizationId,
      destination: 'https://example.com/pricing?plan=pro',
    });

    assert.deepEqual(resolveTrackingToken(token, 'click'), {
      contactedId,
      organizationId,
      destination: 'https://example.com/pricing?plan=pro',
    });
    assert.equal(resolveTrackingToken(token, 'open'), null);
    assert.equal(resolveTrackingToken(`${token}x`, 'click'), null);
  });
});

test('tracking markup signs destinations and removes legacy unsigned wrappers', () => {
  withTrackingEnvironment(() => {
    const html = prepareEmailTracking({
      html: '<a href="https://example.com/path?a=1&amp;b=2">Visit</a><img src="https://app.example.test/api/tracking/open?id=legacy" />',
      contactedId,
      organizationId,
      trackLinks: true,
      trackPixel: true,
    });

    assert.match(html, /\/api\/tracking\/click\?t=/);
    assert.match(html, /\/api\/tracking\/open\?t=/);
    assert.doesNotMatch(html, /tracking\/open\?id=/);
    assert.doesNotMatch(html, /tracking\/click\?id=/);

    const href = html.match(/href="([^"]+)"/)?.[1] || '';
    const clickUrl = new URL(href.replace(/&amp;/g, '&'));
    assert.equal(resolveTrackingToken(clickUrl.searchParams.get('t'), 'click')?.destination, 'https://example.com/path?a=1&b=2');
  });
});

test('stripping unsigned tracking preserves only a valid legacy destination', () => {
  assert.equal(
    stripEmailTrackingMarkup('<a href="https://app.example.test/api/tracking/click?id=x&amp;url=https%3A%2F%2Fexample.com%2Fsafe">Visit</a>'),
    '<a href="https://example.com/safe">Visit</a>',
  );
  assert.equal(
    stripEmailTrackingMarkup('<a href="https://app.example.test/api/tracking/click?id=x">Visit</a>'),
    '<a href="#">Visit</a>',
  );
});
