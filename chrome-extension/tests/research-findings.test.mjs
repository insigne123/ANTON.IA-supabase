import test from 'node:test';
import assert from 'node:assert/strict';
import { researchFindings } from '../ui/research-findings.ts';
test('partial collection remains readable without a validated report', () => {
  const findings = researchFindings({ status: 'partial', reportDocumentV2: null, result: { evidence: [
    { statement: 'Experiencia anterior según la fuente', sourceUrl: 'https://example.test/profile' },
    { statement: 'Texto sin enlace válido', sourceUrl: 'javascript:alert(1)' },
    { statement: '' },
  ] } });
  assert.equal(findings.length, 2);
  assert.equal(findings[0].text, 'Experiencia anterior según la fuente');
  assert.equal(findings[1].url, null);
  assert.deepEqual(researchFindings(null), []);
});
