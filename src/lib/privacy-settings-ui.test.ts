import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (page: string) => readFileSync(`src/app/(app)/settings/${page}/page.tsx`, 'utf8');

test('privacy pages share the header with «Privacidad» as the way back, and no native confirm', () => {
  for (const page of ['privacy-requests', 'privacy-incidents', 'unsubscribes']) {
    const source = read(page);
    assert.match(source, /back=\{\{ href: '\/settings\/privacy', label: 'Privacidad' \}\}/, page);
    assert.doesNotMatch(source, /window\.confirm|[^.\w]confirm\('/, `${page} has no native confirm`);
    assert.doesNotMatch(source, /(red|green|amber|emerald|yellow)-\d/, `${page} uses the palette`);
    assert.doesNotMatch(source, /toLocale(Date)?String\(\)|format\(new Date/, `${page} formats dates in es-CL`);
  }
});

test('«Solicitudes» counts every request and filters on the page; statuses read in Spanish', () => {
  const source = read('privacy-requests');
  assert.doesNotMatch(source, /params\.set\('status'/, 'the status filter no longer narrows what the totals count');
  assert.match(source, /const visibleRequests = useMemo/);
  assert.match(source, /visibleRequests\.map\(/);
  assert.match(source, /in_review: 'En revisión'/);
  assert.match(source, /\{statusLabel\(request\.status\)\}/);
  assert.match(source, /Rectificación/);
});

test('«Bajas y bloqueos» blocks a single address too, and the block test does not paint a contactable address as an error', () => {
  const source = read('unsubscribes');
  assert.match(source, /unsubscribeService\.addToBlacklist\(cleanEmail, user\.id, organizationId, 'Bloqueado a mano'\)/);
  assert.match(source, /Bloquear correo/);
  assert.match(source, /blocked: 'success', review: 'warning', clear: 'info', error: 'destructive'/);
});
