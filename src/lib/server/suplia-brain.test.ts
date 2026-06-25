import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSupliaBrainFailureOutput,
  buildSupliaBrainPrompt,
  normalizeSupliaBrainWorkflowRequest,
  repairSupliaNoOpOperationalOutput,
  SupliaBrainOutputSchema,
} from './suplia-brain';

test('brain prompt makes the model the first decision maker', () => {
  const prompt = buildSupliaBrainPrompt({
    message: 'que sectores deberiamos buscar para mi empresa?',
    context: {
      user: { id: 'user-1', email: 'user@example.com' },
      organizationId: 'org-1',
      profile: { company_name: 'Axis', signatures: { profile_extended: { sector: 'software B2B' } } },
      emailConnections: { google: false, outlook: false },
      counts: { leads: 0, contacted: 0, campaigns: 0, activeMissions: 0, openExceptions: 0 },
    },
    conversationContext: {
      mode: 'full',
      tokenEstimate: 12,
      thresholdTokens: 150000,
      messageCount: 1,
      messages: [{ role: 'user', content: 'que sectores deberiamos buscar para mi empresa?', createdAt: null }],
    },
  });

  assert.match(prompt, /Todos los mensajes del usuario pasan primero por tu criterio/);
  assert.match(prompt, /No eres un formulario ni un router por palabras clave/);
  assert.match(prompt, /workflowRequest\.kind="plan_approval"/);
  assert.match(prompt, /No uses workflowRequest para preguntas/);
  assert.match(prompt, /askRequests/);
});

test('workflow normalization only accepts model-selected workflows with a goal', () => {
  const none = normalizeSupliaBrainWorkflowRequest({ kind: 'none' }, 'buscar leads');
  assert.equal(none.kind, 'none');

  const plan = normalizeSupliaBrainWorkflowRequest({ kind: 'plan_approval' }, '  buscar   leads para mi empresa  ');
  assert.equal(plan.kind, 'plan_approval');
  assert.equal(plan.goal, 'buscar leads para mi empresa');

  const gmail = normalizeSupliaBrainWorkflowRequest({ kind: 'gmail_job', goal: 'revisar Gmail Axis' }, 'fallback');
  assert.equal(gmail.kind, 'gmail_job');
  assert.equal(gmail.goal, 'revisar Gmail Axis');
});

test('model failure fallback is technical and non-operational', () => {
  const output = buildSupliaBrainFailureOutput();
  assert.match(output.reply, /fallo el modelo/);
  assert.equal(output.artifacts.length, 0);
  assert.equal(output.tables.length, 0);
  assert.equal(output.codeBlocks.length, 0);
  assert.equal(output.askRequests.length, 0);
  assert.equal(output.toolRequests.length, 0);
  assert.equal(output.pendingActions.length, 0);
  assert.equal(output.workflowRequest.kind, 'none');
});

test('brain output schema tolerates nullable arrays and optional strings', () => {
  const output = SupliaBrainOutputSchema.parse({
    reply: 'Listo, lo revise.',
    reasoningSummary: null,
    artifacts: null,
    tables: null,
    codeBlocks: null,
    askRequests: null,
    toolRequests: null,
    pendingActions: null,
    workflowRequest: null,
  });

  assert.equal(output.reply, 'Listo, lo revise.');
  assert.equal(output.reasoningSummary, undefined);
  assert.deepEqual(output.artifacts, []);
  assert.deepEqual(output.tables, []);
  assert.deepEqual(output.codeBlocks, []);
  assert.deepEqual(output.askRequests, []);
  assert.deepEqual(output.toolRequests, []);
  assert.deepEqual(output.pendingActions, []);
  assert.equal(output.workflowRequest.kind, 'none');
});

test('brain output schema normalizes unknown model labels safely', () => {
  const output = SupliaBrainOutputSchema.parse({
    reply: null,
    artifacts: [{ type: 'search_results', title: null, content: null, data: null }],
    tables: [{ headers: ['Empresa', null], rows: [['Axis', 92], null] }],
    codeBlocks: [{ language: null, content: 123 }],
    askRequests: [{ question: 'Que sector priorizamos?', options: [{ label: 'Retail', description: null }, { label: null }] }],
    toolRequests: [{ toolName: null, input: null, reason: null }],
    pendingActions: [{ actionType: null, title: null, description: null, payload: null }],
    workflowRequest: { kind: 'lead_search', goal: null, reason: null, confidence: '0.6' },
  });

  const artifact = output.artifacts[0]!;
  const table = output.tables[0]!;
  const codeBlock = output.codeBlocks[0]!;
  const askRequest = output.askRequests[0]!;
  const toolRequest = output.toolRequests[0]!;
  const pendingAction = output.pendingActions[0]!;

  assert.equal(output.reply, '');
  assert.equal(artifact.type, 'note');
  assert.equal(artifact.title, '');
  assert.equal(artifact.content, undefined);
  assert.deepEqual(artifact.data, {});
  assert.deepEqual(table.headers, ['Empresa', '']);
  assert.deepEqual(table.rows, [['Axis', '92'], []]);
  assert.equal(codeBlock.language, undefined);
  assert.equal(codeBlock.content, '');
  assert.equal(askRequest.question, 'Que sector priorizamos?');
  assert.equal(askRequest.options[0]?.label, 'Retail');
  assert.equal(askRequest.allowOther, true);
  assert.equal(toolRequest.toolName, '');
  assert.deepEqual(toolRequest.input, {});
  assert.equal(toolRequest.reason, undefined);
  assert.equal(pendingAction.actionType, '');
  assert.equal(pendingAction.title, '');
  assert.deepEqual(pendingAction.payload, {});
  assert.equal(output.workflowRequest.kind, 'none');
  assert.equal(output.workflowRequest.confidence, 0.6);
});

test('repairs no-op consulting replies into a traceable workflow request', () => {
  const output = SupliaBrainOutputSchema.parse({
    reply: 'Déjame consultar sugerencias internas para darte una recomendación data-driven.',
    artifacts: [],
    tables: [],
    codeBlocks: [],
    askRequests: [],
    toolRequests: [],
    pendingActions: [],
    workflowRequest: { kind: 'none' },
  });

  const repaired = repairSupliaNoOpOperationalOutput(output, 'busca 10 leads de salud y retail');

  assert.equal(repaired.workflowRequest.kind, 'plan_approval');
  assert.equal(repaired.workflowRequest.goal, 'busca 10 leads de salud y retail');
  assert.match(repaired.reply, /plan aprobable/);
});

test('does not repair normal conversational replies', () => {
  const output = SupliaBrainOutputSchema.parse({
    reply: 'Para partir, priorizaria salud y retail por volumen operativo.',
    artifacts: [],
    tables: [],
    codeBlocks: [],
    askRequests: [],
    toolRequests: [],
    pendingActions: [],
    workflowRequest: { kind: 'none' },
  });

  const repaired = repairSupliaNoOpOperationalOutput(output, 'que sectores recomiendas?');

  assert.equal(repaired.workflowRequest.kind, 'none');
  assert.equal(repaired.reply, output.reply);
});

test('does not repair clarification ask responses into workflows', () => {
  const output = SupliaBrainOutputSchema.parse({
    reply: 'Antes de gastar creditos, necesito afinar la busqueda.',
    artifacts: [],
    tables: [],
    codeBlocks: [],
    askRequests: [{
      header: 'Afinar busqueda',
      question: 'Que priorizamos?',
      options: [{ label: 'Mayor rotacion' }, { label: 'Mayor dotacion' }],
      allowOther: true,
    }],
    toolRequests: [],
    pendingActions: [],
    workflowRequest: { kind: 'none' },
  });

  const repaired = repairSupliaNoOpOperationalOutput(output, 'busca leads para mi empresa');

  assert.equal(repaired.workflowRequest.kind, 'none');
  assert.equal(repaired.askRequests.length, 1);
});
