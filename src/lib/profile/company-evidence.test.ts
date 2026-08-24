import test from 'node:test';
import assert from 'node:assert/strict';

import { parseCompanyEvidence } from './company-evidence';

test('company evidence keeps concise attributable search results', () => {
  const evidence = parseCompanyEvidence({
    organic_results: [
      { title: 'Empresa', link: 'https://empresa.cl', snippet: 'Servicios B2B.', displayed_link: 'empresa.cl' },
      { title: 'Sin extracto', link: 'https://example.com' },
    ],
  });

  assert.deepEqual(evidence, [{
    title: 'Empresa',
    link: 'https://empresa.cl',
    snippet: 'Servicios B2B.',
    source: 'empresa.cl',
  }]);
});
