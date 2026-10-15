import test from 'node:test';
import assert from 'node:assert/strict';
import { opportunityExportName } from './export-file-name';

test('the downloaded report is named after the opportunity, without a double period or forbidden characters', () => {
  assert.equal(opportunityExportName('Informe', 'Servicios de Seguridad y Monitoreo de Cámaras.'), 'Informe - Servicios de Seguridad y Monitoreo de Cámaras');
  assert.equal(opportunityExportName('Expediente', 'Aseo  y/o mantención: "Edificio" Central '), 'Expediente - Aseo y o mantención Edificio Central');
  assert.equal(opportunityExportName('Informe', '...'), 'Informe - Oportunidad');
  assert.ok(opportunityExportName('Informe', 'x'.repeat(200)).length <= 'Informe - '.length + 90);
});
