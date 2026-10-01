// The automatic read of an email on the approval cards (COWORK_EMAIL_REVIEW): it shows what was found as things to look at, says when it found
// nothing, shows nothing when there was no review, and is never a button: approving stays the person's. Static render of the real component.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const bundle = await build({
  stdin: { contents: `import React from 'react'; import { renderToStaticMarkup } from 'react-dom/server'; import { EmailReviewNote } from './src/components/cowork/ReviewParts';
    export const html = review => renderToStaticMarkup(React.createElement(EmailReviewNote, { review, against: 'contra tu oferta' }));`, resolveDir: process.cwd(), loader: 'tsx' },
  bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"test"' },
});
const loaded = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(require, loaded, loaded.exports);
const { html } = loaded.exports;

assert.equal(html(null), '', 'no review (off, or Jev did not answer): nothing on the card');
assert.equal(html(undefined), '');
assert.equal(html({ checked: false, issues: [] }), '', 'a review that did not run never claims it checked');
assert.match(html({ checked: true, issues: [] }), /Revisado contra tu oferta: sin contradicciones ni promesas nuevas\./);
const found = html({ checked: true, issues: [{ id: 'contradicts_thread', text: 'Parece contradecir lo que escribió la persona.' }, { id: 'invents_commitment', text: 'Afirma algo que no está en tu oferta.' }] });
assert.match(found, /role="note"/);
assert.match(found, /la revisión automática puede equivocarse/, 'it says it can be wrong');
assert.equal((found.match(/<li>/g) || []).length, 2);
assert.doesNotMatch(found, /<button/, 'it advises, it never blocks or decides');
assert.doesNotMatch(found, /Jev|TypeSafe/i, 'the person reads «revisión automática», not a vendor');
console.log('PASS: the review shows what it found, says when it found nothing, stays silent without a review and never becomes a button.');
