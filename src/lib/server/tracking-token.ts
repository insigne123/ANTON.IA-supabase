import { createHmac, timingSafeEqual } from 'crypto';

const TOKEN_VERSION = 'v1';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_TOKEN_LENGTH = 8_192;

export type TrackingEvent = 'open' | 'click';

type TrackingTokenPayload = {
  v: 1;
  e: TrackingEvent;
  c: string;
  o: string;
  u?: string;
};

export type ResolvedTrackingToken = {
  contactedId: string;
  organizationId: string;
  destination?: string;
};

function toBase64Url(value: Buffer) {
  return value.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4 || 4)) % 4);
  return Buffer.from(padded, 'base64');
}

function getTrackingTokenSecret() {
  return String(process.env.TRACKING_TOKEN_SECRET || '').trim();
}

function signPayload(encodedPayload: string, secret: string) {
  return createHmac('sha256', secret).update(`${TOKEN_VERSION}.${encodedPayload}`).digest('hex');
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

function normalizeHttpUrl(value: unknown): string | null {
  const raw = String(value || '').trim().replace(/&amp;/g, '&');
  if (!raw || raw.length > 4_096) return null;

  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function getTrackingAppOrigin() {
  const configured = String(
    process.env.NEXT_PUBLIC_APP_URL
    || process.env.NEXT_PUBLIC_BASE_URL
    || process.env.CANONICAL_APP_URL
    || ''
  ).trim();
  const origin = normalizeHttpUrl(configured);
  if (!origin) throw new Error('A public app URL is required for email tracking.');
  return new URL(origin).origin;
}

function escapeHtmlAttribute(value: string) {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function isTrackingPath(value: string, event: TrackingEvent) {
  try {
    const parsed = new URL(value.replace(/&amp;/g, '&'), 'https://tracking.invalid');
    return parsed.pathname === `/api/tracking/${event}`;
  } catch {
    return false;
  }
}

function getTrackedClickDestination(value: string): string | null {
  try {
    const parsed = new URL(value.replace(/&amp;/g, '&'), 'https://tracking.invalid');
    if (parsed.pathname !== '/api/tracking/click') return null;

    const token = resolveTrackingToken(parsed.searchParams.get('t'), 'click');
    if (token?.destination) return token.destination;
    return normalizeHttpUrl(parsed.searchParams.get('url'));
  } catch {
    return null;
  }
}

export function isTrackingId(value: unknown): value is string {
  return UUID_PATTERN.test(String(value || '').trim());
}

export function hasEmailTrackingMarkup(html: string) {
  return /\/api\/tracking\/(?:open|click)(?:[/?]|$)/i.test(String(html || ''));
}

export function createTrackingToken(input: {
  event: TrackingEvent;
  contactedId: string;
  organizationId: string;
  destination?: string;
}) {
  const secret = getTrackingTokenSecret();
  if (!secret) throw new Error('TRACKING_TOKEN_SECRET is not configured.');
  if (!isTrackingId(input.contactedId) || !isTrackingId(input.organizationId)) {
    throw new Error('Tracking requires UUID contact and organization identifiers.');
  }

  const destination = input.event === 'click' ? normalizeHttpUrl(input.destination) : null;
  if (input.event === 'click' && !destination) {
    throw new Error('Click tracking requires an HTTP(S) destination.');
  }

  const payload: TrackingTokenPayload = {
    v: 1,
    e: input.event,
    c: input.contactedId,
    o: input.organizationId,
    ...(destination ? { u: destination } : {}),
  };
  const encodedPayload = toBase64Url(Buffer.from(JSON.stringify(payload), 'utf8'));
  return `${TOKEN_VERSION}.${encodedPayload}.${signPayload(encodedPayload, secret)}`;
}

export function resolveTrackingToken(rawToken: string | null | undefined, expectedEvent: TrackingEvent): ResolvedTrackingToken | null {
  const raw = String(rawToken || '').trim();
  const secret = getTrackingTokenSecret();
  if (!raw || !secret || raw.length > MAX_TOKEN_LENGTH) return null;

  const [version, encodedPayload, signature, ...rest] = raw.split('.');
  if (
    rest.length > 0
    || version !== TOKEN_VERSION
    || !/^[A-Za-z0-9_-]+$/.test(encodedPayload || '')
    || !/^[0-9a-f]{64}$/i.test(signature || '')
  ) {
    return null;
  }

  const expectedSignature = signPayload(encodedPayload, secret);
  if (!safeEqual(expectedSignature, signature)) return null;

  try {
    const payload = JSON.parse(fromBase64Url(encodedPayload).toString('utf8')) as TrackingTokenPayload;
    if (
      payload?.v !== 1
      || payload?.e !== expectedEvent
      || !isTrackingId(payload?.c)
      || !isTrackingId(payload?.o)
    ) {
      return null;
    }

    if (expectedEvent === 'click') {
      const destination = normalizeHttpUrl(payload?.u);
      if (!destination) return null;
      return {
        contactedId: payload.c,
        organizationId: payload.o,
        destination,
      };
    }

    if (payload?.u !== undefined) return null;
    return {
      contactedId: payload.c,
      organizationId: payload.o,
    };
  } catch {
    return null;
  }
}

export function stripEmailTrackingMarkup(html: string) {
  let output = String(html || '');

  output = output.replace(/href=(["'])([^"']+)\1/gi, (match: string, quote: string, href: string) => {
    if (!isTrackingPath(href, 'click')) return match;
    const destination = getTrackedClickDestination(href);
    return destination ? `href=${quote}${escapeHtmlAttribute(destination)}${quote}` : 'href="#"';
  });

  return output.replace(/<img\b[^>]*\bsrc=(["'])[^"']*\/api\/tracking\/open(?:\?[^"']*)?\1[^>]*\/?\s*>/gi, '');
}

export function prepareEmailTracking(input: {
  html: string;
  contactedId: string;
  organizationId: string;
  trackLinks: boolean;
  trackPixel: boolean;
}) {
  if (!isTrackingId(input.contactedId) || !isTrackingId(input.organizationId)) {
    throw new Error('Tracking requires UUID contact and organization identifiers.');
  }

  let html = stripEmailTrackingMarkup(input.html);
  const origin = getTrackingAppOrigin();

  if (input.trackLinks) {
    html = html.replace(/href=(["'])([^"']+)\1/gi, (match: string, quote: string, href: string) => {
      const destination = normalizeHttpUrl(href);
      if (!destination || destination.includes('/unsubscribe?')) return match;

      const trackingUrl = new URL('/api/tracking/click', origin);
      trackingUrl.searchParams.set('t', createTrackingToken({
        event: 'click',
        contactedId: input.contactedId,
        organizationId: input.organizationId,
        destination,
      }));
      return `href=${quote}${escapeHtmlAttribute(trackingUrl.toString())}${quote}`;
    });
  }

  if (input.trackPixel) {
    const pixelUrl = new URL('/api/tracking/open', origin);
    pixelUrl.searchParams.set('t', createTrackingToken({
      event: 'open',
      contactedId: input.contactedId,
      organizationId: input.organizationId,
    }));
    html += `\n<br><img src="${escapeHtmlAttribute(pixelUrl.toString())}" alt="" width="1" height="1" style="width:1px;height:1px;border:0;" />`;
  }

  return html;
}
