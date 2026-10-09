import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildCoworkStaticPreview, coworkPreviewAssetName, CoworkPreviewError } from './static-preview';
const contents = new Map([['styles.css',Buffer.from('body{color:blue;background-image:url("logo.svg")}')],
  ['app.js',Buffer.from('document.getElementById("result").textContent="Listo";globalThis.__serverMustNotExecute=true;')],
  ['logo.svg',Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle r="3"/></svg>')]]);
const files = [...contents].map(([name,bytes])=>({name,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),at:''}));
test('confirmed local files assemble without executing code or reading another revision', async () => {
  const html=Buffer.from('<html><head><link rel="stylesheet" href="./styles.css"></head><body><img src="logo.svg"><p id="result">Antes</p><script src="app.js"></script></body></html>');
  const preview=await buildCoworkStaticPreview(html,files,async file=>contents.get(file.name)!);
  const text=preview.bytes.toString('utf8');
  assert.match(text,/data:image\/svg\+xml;base64/);assert.doesNotMatch(text,/script src=|stylesheet" href=/);
  assert.match(text,/Antes/);assert.equal((globalThis as {__serverMustNotExecute?:boolean}).__serverMustNotExecute,undefined);
  assert.deepEqual(preview.assets.sort(),['app.js','logo.svg','styles.css']);
  await assert.rejects(buildCoworkStaticPreview(html,files,async()=>Buffer.from('modified')),CoworkPreviewError);
});
test('traversal, external resources, unobserved assets and module imports refuse instead of producing a broken preview', async () => {
  for(const reference of ['../private.js','%2e%2e%2fprivate.js','https://external.test/app.js','/api/private','//outside.test/x','app.js?version=2'])assert.throws(()=>coworkPreviewAssetName(reference));
  await assert.rejects(buildCoworkStaticPreview(Buffer.from('<script src="missing.js"></script>'),files,async file=>contents.get(file.name)!),/revisión publicada/);
  await assert.rejects(buildCoworkStaticPreview(Buffer.from('<script type="module" src="app.js"></script>'),files,async file=>contents.get(file.name)!),/Compila/);
});
