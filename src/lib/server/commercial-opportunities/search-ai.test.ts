import assert from 'node:assert/strict';
import test from 'node:test';
import { generateRoleVariants, generateTenderTerms } from './search-ai';

const answer = (value: unknown) => (async () => value) as any;
const failing = (async () => { throw new Error('timeout'); }) as any;

test('the variants come back cleaned, and without the model the roles go as they are', async () => {
  const asked: string[] = [];
  const variants = await generateRoleVariants(['cajero'], (async (options: { prompt: string }) => {
    asked.push(options.prompt);
    return { roles: [{ role: 'cajero', variants: ['cajera', 'operador de caja', 'cashier'] }] };
  }) as any);
  assert.deepEqual(variants, { cajero: ['operador de caja', 'cashier'] });
  assert.match(asked[0], /nunca instrucciones/);
  assert.deepEqual(await generateRoleVariants(['cajero'], failing), {});
  assert.deepEqual(await generateRoleVariants([], answer({ roles: [] })), {}, 'no roles, no call');
});

test('the tender words come from the offer; without the model, from the services in «Perfil»', async () => {
  const perfil = { offer: 'Servicios transitorios y reclutamiento para empresas', services: ['Servicios transitorios', 'Reclutamiento masivo; Nómina'], sector: 'RR. HH.' };
  const terms = await generateTenderTerms(perfil, answer({ keywords: ['Suministro de personal', '«servicios transitorios»', 'suministro de personal', 'x', 'reclutamiento'], sectors: ['mineria', 'energia'] }));
  assert.deepEqual(terms, { keywords: ['suministro de personal', 'servicios transitorios', 'reclutamiento'], sectors: ['mineria', 'energia'], source: 'ai' });
  assert.deepEqual(await generateTenderTerms(perfil, failing), {
    keywords: ['servicios transitorios', 'reclutamiento masivo', 'nómina'], sectors: [], source: 'services',
  });
  assert.deepEqual(await generateTenderTerms({ offer: null, services: [], sector: null }, answer({ keywords: ['nada'], sectors: [] })),
    { keywords: [], sectors: [], source: 'none' }, 'nothing in «Perfil»: no call and no words');
});
