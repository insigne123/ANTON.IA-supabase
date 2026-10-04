import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(path, 'utf8');

test('the unsubscribe page names the sender, works in dark mode and never shows a raw server response', () => {
  const page = read('src/app/unsubscribe/page.tsx');
  assert.match(page, /bg-background/);
  assert.doesNotMatch(page, /(red|green|amber|slate)-\d/, 'palette tokens only');
  assert.doesNotMatch(page, /res(ponse)?\.text\(\)/, 'no raw response text');
  assert.match(page, /preview\.senderName/);
  const route = read('src/app/api/tracking/unsubscribe/route.ts');
  assert.match(route, /export async function GET\(req: NextRequest\)/);
  assert.match(route, /resolveUnsubscribeRequest\(Object\.fromEntries\(req\.nextUrl\.searchParams\)\)/, 'only a valid signed link gets a preview');
  assert.match(route, /\.from\('organizations'\)\.select\('name'\)/, 'the preview reads only the organization name');
  assert.doesNotMatch(route, /error: e\.message/, 'no internals echoed to a public page');
});

test('the privacy policy reads with accents and the request form uses the palette', () => {
  const policy = read('src/app/privacy/page.tsx');
  for (const word of ['Política de Privacidad', 'Última actualización', '1. Qué cubre', 'búsqueda', 'campañas', 'escríbenos']) {
    assert.ok(policy.includes(word), word);
  }
  assert.doesNotMatch(policy, /\bpolitica\b|\bcampanas\b|\bbusqueda\b/);
  const request = read('src/app/privacy/request/page.tsx');
  assert.doesNotMatch(request, /(red|emerald)-\d/);
});

test('connecting the extension says at once when the link has no code, and sends the code the bridge expects', () => {
  const page = read('src/app/(app)/extension/connect/page.tsx');
  assert.match(page, /if \(!value\.trim\(\)\) \{ setStatus\('error'\); setError\(MISSING_NONCE\); \}/);
  assert.match(page, /disabled=\{status === 'pending' \|\| !nonce\}/);
  assert.doesNotMatch(page, /4\.0\.9|(slate|indigo|emerald|red)-\d/);
});

test('«Oportunidades» never shows environment variable names or the word «mantenedor» to the person', () => {
  const page = read('src/components/commercial-opportunities/OpportunitiesWorkspace.tsx');
  assert.doesNotMatch(page, /mantenedor/);
  assert.doesNotMatch(page, /MERCADO_PUBLICO_TICKET|OPPORTUNITIES_MONTHLY_USD_CAP|\$\{source\.missing\}/);
  assert.match(page, /Pide a quien administra ANTON\.IA/);
});
