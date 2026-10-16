import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';

// workspace-documents with the session and the database stubbed out: only the text extraction runs.
async function load() {
  const stubs: Record<string, string> = {
    '@/lib/server/auth-utils': 'export class AuthError extends Error {constructor(m,s){super(m);this.status=s}}',
    './workspace-access': 'export async function assertOpportunityRead(){}',
    './workspace-store': 'export function opportunityDb(r){ return r?.data ?? null }',
  };
  const bundle = await build({
    stdin: { contents: `export { extractOpportunityFile, webPageBody } from './src/lib/server/commercial-opportunities/workspace-documents';`, loader: 'ts', resolveDir: process.cwd() },
    bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external',
    plugins: [{ name: 'stubs', setup(builder) {
      builder.onResolve({ filter: /^(@\/lib\/server\/auth-utils|\.\/workspace-access|\.\/workspace-store)$/ }, args => ({ path: args.path, namespace: 'stub' }));
      builder.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ loader: 'js', contents: stubs[args.path] }));
    } }],
  });
  const compiled: { exports: any } = { exports: {} };
  new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), compiled, compiled.exports);
  return compiled.exports as { extractOpportunityFile: (name: string, bytes: Uint8Array) => Promise<{ status: string; sections: Array<{ text: string }> }>; webPageBody: (html: string) => string };
}

// The shape of Mercado Público's public ficha: styles, a tracking script, a comment and hidden ASP.NET fields around the text.
const ficha = `<!DOCTYPE html><html><head><title>Ficha Licitación</title><style>.sustentClass1 { font-size: 12px; color: #666666; }</style>
<script>(function (h, o, t, j, a, r) { h.hj = h.hj || function () {}; })(window, document, 'https://static.hotjar.com/c/hotjar-', '.js?sv=');</script></head>
<body><!-- Ficha Licitación --><form><input type="hidden" name="__VIEWSTATE" value="dDwtMTA4MzE0MjQ5NDs7Pg==" />
<h1>Servicios de Seguridad y Monitoreo de Cámaras.</h1><script>$(document).ready(function () { $(".fancyNBA").fancybox({ 'width': 800 }); });</script>
<p>Fecha de cierre de recepción de la oferta: 29-10-2026 9:00:00</p><noscript><img src="pixel.gif"></noscript>
<table><tr><td>Anexo N.º 1</td><td>Identificación del oferente</td></tr></table><svg><path d="M0 0"/></svg></form></body></html>`;

test('a captured web page reads as its text: no styles, scripts, comments or hidden fields', async () => {
  const { extractOpportunityFile, webPageBody } = await load();
  const body = webPageBody(ficha);
  assert.doesNotMatch(body, /sustentClass1|hotjar|fancybox|VIEWSTATE|pixel\.gif|<svg|Ficha Licitación -->/);
  const extracted = await extractOpportunityFile('Ficha pública de Mercado Público.html', new TextEncoder().encode(ficha));
  const text = extracted.sections.map(s => s.text).join('\n');
  assert.equal(extracted.status, 'read');
  assert.match(text, /Servicios de Seguridad y Monitoreo de Cámaras\./);
  assert.match(text, /Fecha de cierre de recepción de la oferta: 29-10-2026 9:00:00/);
  assert.match(text, /Anexo N\.º 1 \| Identificación del oferente/);
  assert.doesNotMatch(text, /font-size|function \(|window, document|\$\(document\)/);
});
