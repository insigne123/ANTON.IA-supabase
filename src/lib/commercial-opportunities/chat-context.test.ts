import test from 'node:test';
import assert from 'node:assert/strict';
import { opportunityChatDeadline, opportunityChatReportContext } from './chat-context';

test('the chat gets the deadline in Chile time, never the stored UTC value', () => {
  assert.equal(opportunityChatDeadline('2026-10-29T12:00:00Z'), '29 de octubre de 2026, 09:00 (hora de Chile)');
  assert.equal(opportunityChatDeadline(null), null);
});

test('the chat gets what the report already established: requirements with status and dates', () => {
  const context = opportunityChatReportContext({ recommendation: 'conditional', executive: 'Postular si se resuelve lo pendiente', nextSteps: ['Enviar consultas'], questions: [],
    requirements: [{ title: 'Garantía de fiel cumplimiento de 5% del precio neto', status: 'supported', evidence: [], action: '', role: '', due: '' }],
    milestones: [{ label: 'Consultas hasta', date: '16 de octubre de 2026, 9:00', state: 'documented', citations: [] }] } as any);
  assert.deepEqual(context?.requisitos, [{ requisito: 'Garantía de fiel cumplimiento de 5% del precio neto', estado: 'supported' }]);
  assert.deepEqual(context?.fechas, [{ hito: 'Consultas hasta', fecha: '16 de octubre de 2026, 9:00' }]);
  assert.equal(opportunityChatReportContext(null), null);
});
