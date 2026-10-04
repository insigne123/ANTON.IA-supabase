import test from 'node:test';
import assert from 'node:assert/strict';
import { blockLines, presentReportBlock } from '../ui/report-blocks.ts';

const graph = {
  sources: [{ id: 'src_1234567890', title: 'Sitio oficial', canonicalUrl: 'https://empresa.test/', url: 'https://empresa.test/' }],
  claims: [{ id: 'c01', type: 'hypothesis', statement: 'Puede necesitar apoyo estacional.', validationQuestion: '¿Hay picos de trabajo?' }],
  facts: [{ id: 'f_1234567890', text: 'Opera en Chile.' }],
  signals: [{ id: 'sig_1234567890', claimId: 'c01' }],
  gaps: [{ id: 'gap_1234567890', unknown: 'Dotación por confirmar', howToFind: 'Consultar al responsable', requiredField: 'headcount' }],
  deliverables: [{ id: 'del_1234567890', status: 'blocked', content: 'Guion pendiente de revisión' }],
};
const report = { evidenceGraph: graph, analysis: { buyingCommittee: [{ name: null, title: 'Gerencia de Personas', rationale: 'Valida la necesidad.' }] } };
const block = (type, payload) => ({ type, title: 'Contexto', claimIds: ['c01'], payload });

test('report blocks resolve evidence references and do not show internal envelopes', () => {
  const reading = presentReportBlock(block('facts', ['f_1234567890', 'sig_1234567890', 'c99']), report);
  assert.match(reading.lines.join(' '), /Opera en Chile/);
  assert.match(reading.lines.join(' '), /Hipótesis por validar:.*¿Hay picos/);
  assert.doesNotMatch(reading.lines.join(' '), /c99|sig_|claimIds|payload|type/);
  assert.deepEqual(blockLines({ id: 'gap_1234567890', status: 'ready', scope: { organizationId: 'private-org' }, content: 'Texto útil' }), ['Contenido: Texto útil']);
});

test('sources are safe links; committee and gaps are commercial content', () => {
  assert.deepEqual(presentReportBlock(block('sources', ['src_1234567890']), report).links, [{ label: 'Sitio oficial', url: 'https://empresa.test/' }]);
  assert.deepEqual(presentReportBlock(block('sources', [{ title: 'No ejecutar', url: 'javascript:alert(1)' }]), report).links, []);
  assert.deepEqual(presentReportBlock(block('committee', []), report).lines, ['Rol por identificar · Gerencia de Personas', 'Valida la necesidad.']);
  const gaps = presentReportBlock(block('gaps', graph.gaps), report).lines.join(' ');
  assert.match(gaps, /Dotación por confirmar.*Consultar al responsable/);
  assert.doesNotMatch(gaps, /requiredField|headcount|gap_/);
  assert.match(presentReportBlock(block('deliverable', 'del_1234567890'), report).lines.join(' '), /No utilizar todavía.*Guion pendiente/);
});

test('volume scenarios and table cells remain readable without trace metadata', () => {
  const volume = presentReportBlock(block('table', { baseClaimId: 'c01', baseScenarioIndex: 1,
    assumptions: [{ id: 'asm_1234567890', label: 'Duración', value: 4, rationale: 'Por validar', editable: true }],
    scenarios: [{ label: 'Base', eventsPerMonth: 3, hoursPerMonth: 12 }], caveats: ['No es demanda confirmada.'] }), report).lines.join(' ');
  assert.match(volume, /Duración.*Valor: 4.*Eventos por mes: 3.*Horas por mes: 12.*No es demanda confirmada/);
  assert.doesNotMatch(volume, /baseClaimId|baseScenarioIndex|editable|asm_/);
  assert.deepEqual(blockLines({ columns: ['Cargo', 'Avisos'], rows: [['Operario', 4]] }), ['Cargo: Operario', 'Avisos: 4']);
});
