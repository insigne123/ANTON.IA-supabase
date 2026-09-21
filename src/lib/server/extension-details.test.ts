import test from 'node:test';
import assert from 'node:assert/strict';
import { ExtensionProfileSchema } from '../extension-contracts';
import { createResearchPdf } from '../../../chrome-extension/ui/research-pdf';
import { reportPending, reportReady } from '../../../chrome-extension/ui/research-state';
test('additional Apollo fields are bounded and export of insufficient research remains explicit', () => {
  const profile = ExtensionProfileSchema.parse({ linkedinUrl: 'https://www.linkedin.com/in/ana', fullName: 'Ana', details: { city: 'Lima', industry: 'Servicios', departments: ['hr'] } });
  assert.equal(profile.details?.city, 'Lima');
  assert.throws(() => ExtensionProfileSchema.parse({ ...profile, details: { city: 'x'.repeat(161) } }));
  const initial = { status: 'partial', researchSnapshotId: 'snapshot', result: { evidence: [{ statement: 'Raw search snippet' }] }, reportSynthesisV2: { status: 'running' } };
  assert.equal(reportPending(initial), true);
  assert.equal(reportReady(initial), false);
  assert.throws(() => createResearchPdf(profile, initial));
  const pdf = createResearchPdf(profile, { ...initial, reportDocumentV2: {
    synthesis: { status: 'partial' }, sections: [{ title: 'Resumen y decisión', paragraphs: [{ text: 'Análisis comercial redactado y revisado.' }], blocks: [] }], evidenceGraph: {},
  } }).output();
  assert.ok(pdf.startsWith('%PDF-'));
  assert.match(pdf, /Informe comercial parcial/);
  assert.doesNotMatch(pdf, /Raw search snippet/);
  assert.throws(() => createResearchPdf(profile, { status: 'queued' }));
});
