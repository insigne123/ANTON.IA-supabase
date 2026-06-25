import test from 'node:test';
import assert from 'node:assert/strict';

import { formatSupliaWorkflowPlan, type SupliaWorkflowPlan } from './suplia-workflow-plan';

test('formats workflow plan with approval guardrails', () => {
  const plan: SupliaWorkflowPlan = {
    title: 'Plan para buscar leads',
    summary: 'Primero validamos el ICP y despues preparamos una busqueda revisable.',
    clarificationNotes: [],
    assumptions: ['No se consumen creditos externos sin aprobacion separada.'],
    steps: [
      { title: 'Definir ICP', description: 'Aterrizar segmento y decisores.', agentName: 'icp-strategist', requiresApproval: false },
      { title: 'Preparar busqueda', description: 'Crear criterios Apollo/PDL revisables.', agentName: 'prospector', requiresApproval: true },
    ],
    risks: ['Apollo/PDL requiere aprobacion separada.'],
    approvalQuestion: 'Apruebas este plan?',
  };

  const formatted = formatSupliaWorkflowPlan(plan);
  assert.ok(formatted.includes('Primero validamos el ICP'));
  assert.ok(formatted.includes('Preparar busqueda: Crear criterios Apollo/PDL revisables. (requiere aprobacion)'));
  assert.ok(formatted.includes('No se consumen creditos externos'));
  assert.ok(formatted.includes('Apruebas este plan?'));
});
