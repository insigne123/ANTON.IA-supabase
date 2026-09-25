import assert from 'node:assert/strict';
import test from 'node:test';
import { runCoworkReadLoop } from './agent-loop';

const answer = { action: 'answer' as const, query: null, leadId: null, answer: { reply: 'Un contacto encontrado.', document: null } };
const search = { action: 'leads.search' as const, query: 'Logística', leadId: null, answer: null };

test('a document attached to a proposal is corrected internally before any effect', async () => {
  const document = { title: 'Resumen', content: 'Contenido solicitado' };
  let decisions = 0;
  let proposals = 0;
  const result = await runCoworkReadLoop({
    message: 'Prepara el resumen', runId: '00000000-0000-4000-8000-000000000010',
    signal: new AbortController().signal, authorize: async () => {},
    execute: async () => ({ configured: true }), record: async () => {},
    proposeEffect: async () => { proposals++; },
    decide: async (_observations, _mustAnswer, rejected) => {
      decisions++;
      if (decisions === 1) return { action: 'message.context', query: null, leadId: null, answer: null };
      if (decisions === 2) return { action: 'message_context.update', query: null, leadId: null,
        messageContext: { prohibitedTerms: ['ejemplo'] }, answer: { reply: 'Resumen', document } };
      assert.equal(rejected?.length, 1);
      assert.equal(rejected[0].action, 'message_context.update');
      return { ...answer, answer: { reply: 'Aquí tienes el resumen.', document } };
    },
  });
  assert.deepEqual(result.document, document);
  assert.equal(proposals, 0);
});

test('repeated enrichment cannot bypass rejection on the last decision', async () => {
  const leadId = '00000000-0000-4000-8000-000000000021';
  let decisions = 0;
  let proposals = 0;
  await assert.rejects(runCoworkReadLoop({
    message: 'Continúa', signal: new AbortController().signal, authorize: async () => {},
    history: [{ runId: 'previous', observations: [{ action: 'leads.search', result: { scope: 'own_saved_contacts', items: [{ id: leadId, name: 'Ana' }] } }],
      actions: [{ kind: 'enrich_contact', label: 'Enriquecer contacto Ana' }] }],
    execute: async () => { throw new Error('Unexpected read'); }, record: async () => {},
    proposeEffect: async () => { proposals++; },
    decide: async (_observations, _mustAnswer, rejected) => {
      assert.equal(rejected?.length, decisions++);
      return { action: 'lead.enrich', query: null, leadId, answer: null };
    },
  }), /Repeated enrichment/);
  assert.equal(decisions, 4);
  assert.equal(proposals, 0);
});

test('proposal explanation is persisted as a note before staging, not as a read', async () => {
  const recorded: Array<{ action: string; result: unknown }> = [];
  let decisions = 0;
  const result = await runCoworkReadLoop({
    message: 'Actualiza el contexto', runId: '00000000-0000-4000-8000-000000000010',
    signal: new AbortController().signal, authorize: async () => {},
    execute: async () => ({ configured: true }), record: async value => { recorded.push(value); },
    proposeEffect: async () => {
      assert.equal(recorded.at(-1)?.action, 'assistant.note');
      assert.deepEqual(recorded.at(-1)?.result, { reply: 'Propongo excluir este término. Revisa el cambio.' });
    },
    decide: async () => decisions++ === 0
      ? { action: 'message.context', query: null, leadId: null, answer: null }
      : { action: 'message_context.update', query: null, leadId: null,
        messageContext: { prohibitedTerms: ['ejemplo'] },
        answer: { reply: 'Propongo excluir este término. Revisa el cambio.', document: null } },
  });
  assert.equal(result.reply, 'Propongo excluir este término. Revisa el cambio.');
  assert.equal(recorded.length, 2);
});

test('read loop gives observed results to the next decision and records real queries', async () => {
  let decisions = 0;
  const recorded: unknown[] = [];
  const result = await runCoworkReadLoop({
    message: 'Busca logística', signal: new AbortController().signal, authorize: async () => {},
    decide: async observations => {
      if (decisions++ === 0) return search;
      assert.deepEqual(observations[0].result, { items: [{ name: 'Ejemplo' }] });
      return answer;
    },
    execute: async (action, value) => { assert.equal(action, 'leads.search'); assert.equal(value, 'Logística'); return { items: [{ name: 'Ejemplo' }] }; },
    record: async value => { recorded.push(value); },
  });
  assert.equal(result.reply, 'Un contacto encontrado.');
  assert.equal(recorded.length, 1);
});

test('lead-scoped effect labels use the observed contact name, never raw IDs', async () => {
  const runId = '00000000-0000-4000-8000-000000000010';
  const leadId = '00000000-0000-4000-8000-000000000021';
  const proposals: Array<{ kind: string; targetId: string; label: string }> = [];
  const found = { action: 'leads.search' as const, query: 'José', leadId: null, answer: null };
  const enrich = { action: 'lead.enrich' as const, query: null, leadId, providerId: null, snapshotId: null, note: null, answer: null };
  await runCoworkReadLoop({
    message: 'Enriquece', runId, signal: new AbortController().signal, authorize: async () => {},
    execute: async () => ({ items: [{ id: leadId, name: 'José C.', company: 'GrupoExpro' }], scope: 'own_saved_contacts' }),
    record: async () => {},
    proposeEffect: async (proposal: { kind: string; targetId: string; label: string }) => { proposals.push(proposal); },
    decide: async observations => observations.length === 0 ? found : enrich,
  });
  assert.deepEqual(proposals, [{ kind: 'enrich_contact', targetId: leadId,
    label: 'Enriquecer contacto José C. (GrupoExpro)', originRunId: runId }]);
});

test('tool loop is bounded even when the model never finishes', async () => {
  let calls = 0;
  await assert.rejects(runCoworkReadLoop({
    message: 'Busca', signal: new AbortController().signal, authorize: async () => {},
    decide: async () => search, execute: async () => { calls++; return {}; }, record: async () => {},
  }), /budget exhausted/);
  assert.equal(calls, 3);
});

test('access revoked after a model decision prevents tool execution', async () => {
  let authorized = true;
  let calls = 0;
  await assert.rejects(runCoworkReadLoop({
    message: 'Busca', signal: new AbortController().signal,
    authorize: async () => { if (!authorized) throw new Error('revoked'); },
    decide: async () => { authorized = false; return search; },
    execute: async () => { calls++; return {}; }, record: async () => {},
  }), /revoked/);
  assert.equal(calls, 0);
});

test('cancellation during a read prevents publication', async () => {
  const controller = new AbortController();
  let records = 0;
  await assert.rejects(runCoworkReadLoop({
    message: 'Busca', signal: controller.signal, authorize: async () => {}, decide: async () => search,
    execute: async () => { controller.abort(); return {}; }, record: async () => { records++; },
  }));
  assert.equal(records, 0);
});

test('note review requires an observed target and persists before returning', async () => {
  const id = '00000000-0000-4000-8000-000000000001';
  const proposal = { action: 'crm.propose_note' as const, query: null, leadId: id, note: 'Llamar el lunes', answer: null };
  let proposals = 0;
  const base = {
    message: 'Actualiza la nota', signal: new AbortController().signal, authorize: async () => {},
    execute: async () => ({ items: [{ id }] }), record: async () => {},
    proposeNote: async (leadId: string, note: string) => { assert.equal(leadId, id); assert.equal(note, proposal.note); proposals++; },
  };
  await assert.rejects(runCoworkReadLoop({ ...base, decide: async () => proposal }), /observed/);
  assert.equal(proposals, 0);
  const result = await runCoworkReadLoop({ ...base, decide: async observations => observations.length ? proposal : search });
  assert.match(result.reply, /Revisa/);
  assert.equal(proposals, 1);
});

test('message context update requires observed context and carries the patch', async () => {
  const patch = { prohibitedTerms: ['antecedentes penales'] };
  const proposal = { action: 'message_context.update' as const, query: null, leadId: null, answer: null, messageContext: patch };
  const proposals: unknown[] = [];
  const base = {
    message: 'Actualiza el contexto', runId: '00000000-0000-4000-8000-000000000099',
    signal: new AbortController().signal, authorize: async () => {},
    execute: async () => ({ configured: true, context: {} }), record: async () => {},
    proposeEffect: async (value: unknown) => { proposals.push(value); },
  };
  await assert.rejects(runCoworkReadLoop({ ...base, decide: async () => proposal }), /observed first/);
  assert.equal(proposals.length, 0);
  const result = await runCoworkReadLoop({ ...base,
    decide: async observations => observations.length ? proposal
      : { action: 'message.context' as const, query: null, leadId: null, answer: null } });
  assert.match(result.reply, /Revisa/);
  assert.equal(proposals.length, 1);
  assert.deepEqual((proposals[0] as { kind: string; messageContext: unknown }).kind, 'message_context_update');
  assert.deepEqual((proposals[0] as { kind: string; messageContext: unknown }).messageContext, patch);
});

test('enrich batch requires observed review and carries targets', async () => {
  const ids = ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'];
  const proposal = { action: 'lead.enrich_batch' as const, query: null, leadId: null, leadIds: ids, answer: null };
  const batches: unknown[] = [];
  const base = {
    message: 'Enriquece el lote', runId: '00000000-0000-4000-8000-000000000099',
    signal: new AbortController().signal, authorize: async () => {},
    execute: async () => ({ items: ids.map(leadId => ({ leadId })) }), record: async () => {},
    proposeEffect: async (value: unknown) => { batches.push(value); },
  };
  await assert.rejects(runCoworkReadLoop({ ...base, decide: async () => proposal }), /observed first/);
  assert.equal(batches.length, 0);
  const result = await runCoworkReadLoop({ ...base,
    decide: async observations => observations.length ? proposal
      : { action: 'lists.review_batch' as const, query: null, leadId: null, leadIds: ids, answer: null } });
  assert.match(result.reply, /Revisa/);
  assert.equal(batches.length, 1);
  assert.deepEqual((batches[0] as { kind: string; enrichBatch: unknown }).kind, 'enrich_batch');
  assert.deepEqual((batches[0] as { kind: string; enrichBatch: unknown }).enrichBatch, ids);
});

test('parallel and sequential queries share one total read budget', async () => {
  let calls = 0;
  let decisions = 0;
  await assert.rejects(runCoworkReadLoop({
    message: 'Compara', signal: new AbortController().signal, authorize: async () => {},
    decide: async (_observations, mustAnswer) => {
      if (decisions++ === 0) return { action: 'reads.parallel', query: null, leadId: null, answer: null,
        reads: ['uno','dos','tres'].map(input => ({ action: 'leads.search', input })) };
      assert.equal(mustAnswer, true);
      return search;
    },
    execute: async () => { calls++; return {}; }, record: async () => {},
  }), /budget exhausted/);
  assert.equal(calls, 3);
});

test('effect proposals require an observed target and resolve its origin run', async () => {
  const runId = '00000000-0000-4000-8000-000000000010';
  const parentId = '00000000-0000-4000-8000-000000000011';
  const save = { action: 'leads.save_contact' as const, query: null, leadId: null,
    providerId: 'apollo:abc', snapshotId: null, note: null, answer: null };
  const proposals: unknown[] = [];
  const base = {
    message: 'Guarda el contacto', runId, signal: new AbortController().signal, authorize: async () => {},
    execute: async () => ({ items: [{ id: 'apollo:abc' }], scope: 'external_search' }), record: async () => {},
    proposeEffect: async (proposal: unknown) => { proposals.push(proposal); },
  };
  await assert.rejects(runCoworkReadLoop({ ...base, decide: async () => save }), /observed/);
  assert.equal(proposals.length, 0);
  // External contacts are observed through a previous search recorded in history.
  const fromHistory = await runCoworkReadLoop({ ...base,
    history: [{ runId: parentId, observations: [{ action: 'prospecting.search', input: 'x', result: { items: [{ id: 'apollo:abc' }], scope: 'external_search' } }] }],
    decide: async () => save });
  assert.match(fromHistory.reply, /Revisa/);
  assert.deepEqual(proposals, [{ kind: 'save_contact', targetId: 'apollo:abc',
    label: 'Guardar contacto apollo:abc', originRunId: parentId }]);
});

test('research and draft effects match their observed evidence', async () => {
  const runId = '00000000-0000-4000-8000-000000000010';
  const leadId = '00000000-0000-4000-8000-000000000021';
  const snapshotId = '00000000-0000-4000-8000-000000000022';
  const proposals: Array<{ kind: string; targetId: string; originRunId: string }> = [];
  const base = {
    message: 'Investiga y prepara', runId, signal: new AbortController().signal, authorize: async () => {},
    execute: async (action: string) => action === 'research.get_existing'
      ? { leadId, availability: 'available', research: { snapshotId } }
      : { items: [{ id: leadId }], scope: 'own_saved_contacts' },
    record: async () => {},
    proposeEffect: async (proposal: { kind: string; targetId: string; originRunId: string }) => { proposals.push(proposal); },
  };
  const research = { action: 'research.start' as const, query: null, leadId, providerId: null, snapshotId: null, note: null, answer: null };
  await runCoworkReadLoop({ ...base, decide: async observations => {
    if (!observations.length) return search;
    if (observations.length === 1) return { action: 'leads.get' as const, query: null, leadId, providerId: null, snapshotId: null, note: null, answer: null };
    return research;
  } });
  assert.deepEqual(proposals[0], { kind: 'start_research', targetId: leadId,
    label: `Investigar contacto ${leadId}`, originRunId: runId });
  const draft = { action: 'draft.request' as const, query: null, leadId: null, providerId: null, snapshotId, note: null, answer: null };
  const readResearch = { action: 'research.get_existing' as const, query: null, leadId, providerId: null, snapshotId: null, note: null, answer: null };
  await runCoworkReadLoop({ ...base, decide: async observations => {
    if (observations.length === 0) return search;
    if (observations.length === 1) return readResearch;
    return draft;
  } });
  assert.deepEqual(proposals[1], { kind: 'request_draft', targetId: snapshotId,
    label: `Preparar borrador del informe ${snapshotId}`, originRunId: runId });
});

test('code execution anchors input files to files.list observations', async () => {
  const runId = '00000000-0000-4000-8000-000000000010';
  const parentId = '00000000-0000-4000-8000-000000000011';
  const proposals: Array<{ kind: string; targetId: string; originRunId: string }> = [];
  const base = {
    message: 'Limpia el csv', runId, signal: new AbortController().signal, authorize: async () => {},
    execute: async () => ({ scope: 'own_uploads', files: [{ name: 'in.csv', runId, size: 3 }] }),
    record: async () => {},
    proposeEffect: async (proposal: { kind: string; targetId: string; originRunId: string }) => { proposals.push(proposal); },
  };
  const code = { action: 'code.execute' as const, query: null, leadId: null,
    code: { language: 'python' as const, code: 'print(1)', inputFiles: ['ghost.csv'] }, answer: null };
  // Unobserved files fail closed.
  await assert.rejects(runCoworkReadLoop({ ...base, decide: async () => code }), /observed first/);
  assert.equal(proposals.length, 0);
  // Observed files anchor to the observing run.
  const list = { action: 'files.list' as const, query: null, leadId: null, answer: null };
  const withFiles = { action: 'code.execute' as const, query: null, leadId: null,
    code: { language: 'python' as const, code: 'print(1)', inputFiles: ['in.csv'] }, answer: null };
  await runCoworkReadLoop({ ...base, decide: async observations => observations.length ? withFiles : list });
  assert.deepEqual(proposals[0], { kind: 'code_execute', targetId: 'new-code',
    label: 'Ejecutar código en entorno aislado', originRunId: runId,
    code: { language: 'python', code: 'print(1)', inputFiles: ['in.csv'] } });
  // No inputs anchor to the proposing run itself.
  const bare = { action: 'code.execute' as const, query: null, leadId: null,
    code: { language: 'node' as const, code: 'x', inputFiles: [] }, answer: null };
  await runCoworkReadLoop({ ...base, history: [], decide: async () => bare });
  assert.equal(proposals[1].originRunId, runId);
});
