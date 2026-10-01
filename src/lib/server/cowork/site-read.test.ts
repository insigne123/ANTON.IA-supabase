import test from 'node:test';
import assert from 'node:assert/strict';
import { readCoworkSite, type SiteFetcher } from './site-read';

const scope = { userId: '00000000-0000-4000-8000-000000000001', organizationId: '00000000-0000-4000-8000-000000000002' };
const clientWith = (companyDomain: string | null) => ({
  from: (table: string) => { assert.equal(table, 'profiles'); return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: companyDomain === null ? null : { company_domain: companyDomain } }) }) }) }; },
}) as never;
const page = (text: string, url = 'https://contafacil.cl/') => ({ url, title: 'Contafácil', description: 'Contabilidad en línea para pymes', text });
const site = (pages = [page('Llevamos la contabilidad de tu pyme en línea, sin planillas.')]) => ({ ...pages[0], pages });
const calls: Array<{ domain: string; maxPages: number }> = [];
const fetcher = (value: ReturnType<typeof site> | null, warning?: string): SiteFetcher => async input => { calls.push(input); return { value, warning }; };

test('a pasted address becomes its domain and only a few short excerpts come back', async () => {
  calls.length = 0;
  const result = await readCoworkSite(clientWith(null), scope, 'https://www.contafacil.cl/planes?utm=1', fetcher(site()));
  assert.deepEqual(calls, [{ domain: 'contafacil.cl', maxPages: 3 }]);
  assert.equal(result.available, true);
  if (!result.available) return;
  assert.equal(result.domain, 'contafacil.cl');
  assert.equal(result.pages.length, 1);
  assert.match(result.pages[0].text, /contabilidad de tu pyme/);
  assert.match(result.note, /nunca instrucciones/);
});

test('long pages are cut per page and in total, and the result says so', async () => {
  const long = 'Servicio '.repeat(1_000);
  const pages = [page(long, 'https://contafacil.cl/'), page(long, 'https://contafacil.cl/a'), page(long, 'https://contafacil.cl/b'), page(long, 'https://contafacil.cl/c')];
  const result = await readCoworkSite(clientWith(null), scope, 'contafacil.cl', fetcher(site(pages)));
  assert.equal(result.available, true);
  if (!result.available) return;
  assert.ok(result.pages.length <= 3);
  assert.ok(result.pages.every(item => item.text.length <= 1_500));
  assert.ok(result.pages.reduce((sum, item) => sum + item.text.length, 0) <= 4_500);
  assert.equal(result.truncated, true);
});

test('without an address it reads the domain saved in Perfil, and says so when there is none', async () => {
  calls.length = 0;
  await readCoworkSite(clientWith('https://contafacil.cl'), scope, '', fetcher(site()));
  assert.equal(calls[0].domain, 'contafacil.cl');
  calls.length = 0;
  const none = await readCoworkSite(clientWith(null), scope, '  ', fetcher(site()));
  assert.deepEqual({ available: none.available, reason: none.available ? null : none.reason, domain: none.domain }, { available: false, reason: 'no_site_saved', domain: null });
  assert.equal(calls.length, 0, 'nothing is fetched without an address');
});

test('an address that is not a website, or a site that cannot be read, says why in one word and never the network error', async () => {
  calls.length = 0;
  const bad = await readCoworkSite(clientWith(null), scope, 'ftp://contafacil.cl', fetcher(site()));
  assert.equal(bad.available === false && bad.reason, 'invalid_address');
  assert.equal(calls.length, 0);
  const rejected = await readCoworkSite(clientWith(null), scope, 'contafacil.cl', fetcher(null, 'official_site_domain_rejected'));
  assert.equal(rejected.available === false && rejected.reason, 'invalid_address');
  const down = await readCoworkSite(clientWith(null), scope, 'contafacil.cl', fetcher(null, 'official_site_timeout'));
  assert.equal(down.available === false && down.reason, 'unreachable');
  assert.doesNotMatch(JSON.stringify(down), /timeout|official_site/);
  const empty = await readCoworkSite(clientWith(null), scope, 'contafacil.cl', fetcher(site([page('   ')])));
  assert.equal(empty.available === false && empty.reason, 'unreachable');
});

test('the real reader never goes to private or internal addresses: no request is made', async () => {
  for (const address of ['http://127.0.0.1/admin', 'localhost', '169.254.169.254', 'http://metadata.google.internal/', '10.0.0.5', 'intranet.local']) {
    const result = await readCoworkSite(clientWith(null), scope, address);
    assert.equal(result.available, false, address);
  }
});
