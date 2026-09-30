import assert from 'node:assert/strict';
import test from 'node:test';
import { coworkDecisionSchema, runCoworkReadLoop } from './agent-loop';
import { COWORK_TURN_DEFAULTS, type CoworkTurnBudget } from './turn-budget';
import { COWORK_NOTE_ACTION } from './contracts';

const answer = { action: 'answer' as const, query: null, leadId: null, answer: { reply: 'Un contacto encontrado.', document: null } };
const search = { action: 'leads.search' as const, query: 'Logística', leadId: null, answer: null };

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
  // Every decision but the last may read; the last one must answer.
  assert.equal(calls, COWORK_TURN_DEFAULTS.decisions - 1);
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
    ceiling: { ...COWORK_TURN_DEFAULTS, reads: 3 },
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

test('a fixed read sent with periods runs once instead of costing the decision', async () => {
  const executed: string[] = [];
  let decisions = 0;
  const result = await runCoworkReadLoop({
    message: 'Informe del mes', signal: new AbortController().signal, authorize: async () => {}, record: async () => {},
    decide: async observations => {
      if (decisions++ > 0) {
        assert.deepEqual(observations.map(item => item.action), ['metrics.rates', 'leads.search']);
        return answer;
      }
      return { action: 'reads.parallel', query: null, leadId: null, answer: null, reads: [
        { action: 'metrics.rates', input: 'last_30_days' }, { action: 'metrics.rates', input: 'last_7_days' }, { action: 'leads.search', input: '' }] };
    },
    execute: async (action, value) => { executed.push(`${action}:${value}`); return {}; },
  });
  assert.equal(result.reply, 'Un contacto encontrado.');
  assert.deepEqual(executed.sort(), ['leads.search:', 'metrics.rates:']);
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
  assert.equal(fromHistory.reply, 'Propongo guardar este contacto en ANTON.IA. Revísalo antes de aprobar.');
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

test('code proposed before reading its upload: the loop lists the uploads once instead of failing the turn', async () => {
  const runId = '00000000-0000-4000-8000-000000000010';
  const reads: string[] = [];
  const proposals: Array<{ originRunId: string }> = [];
  const analyze = { action: 'code.execute' as const, query: null, leadId: null,
    code: { language: 'python' as const, code: 'print(1)', inputFiles: ['prospectos.xlsx'] }, answer: null };
  await runCoworkReadLoop({ message: 'Revisa el excel', runId, signal: new AbortController().signal, authorize: async () => {}, record: async () => {},
    execute: async action => { reads.push(action); return { scope: 'own_uploads', files: [{ name: 'prospectos.xlsx', runId: 'otro', size: 9 }] }; },
    proposeEffect: async (proposal: { originRunId: string }) => { proposals.push(proposal); },
    decide: async () => analyze });
  assert.deepEqual(reads, ['files.list']);
  assert.equal(proposals[0].originRunId, runId);
});

test('code execution also takes a file that files.read found, here or in an earlier turn, but not one it missed', async () => {
  const runId = '00000000-0000-4000-8000-000000000010';
  const parentId = '00000000-0000-4000-8000-000000000011';
  const proposals: Array<{ originRunId: string }> = [];
  const notes: string[] = [];
  const found = { scope: 'own_uploads', found: true, name: 'prospectos.xlsx', runId: parentId, size: 900, kind: 'unreadable', message: 'Excel' };
  const missed = { scope: 'own_uploads', found: false, name: 'prospectos.xlsx', available: [] };
  const base = { message: 'Revisa el excel', runId, signal: new AbortController().signal, authorize: async () => {},
    record: async (observation: { action: string; result: unknown }) => {
      if (observation.action === COWORK_NOTE_ACTION) notes.push((observation.result as { reply: string }).reply);
    },
    proposeEffect: async (proposal: { originRunId: string }) => { proposals.push(proposal); } };
  const readFile = { action: 'files.read' as const, query: 'prospectos.xlsx', leadId: null, answer: null };
  const analyze = { action: 'code.execute' as const, query: null, leadId: null,
    code: { language: 'python' as const, code: 'print(1)', inputFiles: ['prospectos.xlsx'] }, answer: null };
  await runCoworkReadLoop({ ...base, execute: async () => found, decide: async observations => observations.length ? analyze : readFile });
  assert.equal(proposals[0].originRunId, runId);
  // Without an explanation from the model, the card still says what it runs on.
  assert.match(notes[0], /Propongo analizar prospectos\.xlsx con código/);
  // Read in the previous turn: that turn is the origin.
  const history = [{ runId: parentId, observations: [{ action: 'files.read', input: 'prospectos.xlsx', result: found }] }];
  await runCoworkReadLoop({ ...base, history, execute: async () => found, decide: async () => analyze });
  assert.equal(proposals[1].originRunId, parentId);
  // A read that did not find it is no evidence.
  await assert.rejects(runCoworkReadLoop({ ...base, execute: async () => missed,
    decide: async observations => observations.length ? analyze : readFile }), /observed first/);
  assert.equal(proposals.length, 2);
});

test('importing contacts is proposed only when it is on, for a file seen in the thread, with its sheet and columns', async () => {
  const runId = '00000000-0000-4000-8000-000000000010';
  const parentId = '00000000-0000-4000-8000-000000000011';
  const proposals: Array<Record<string, unknown>> = [];
  const notes: string[] = [];
  const reads: string[] = [];
  const found = { scope: 'own_uploads', found: true, name: 'prospectos.xlsx', runId: parentId, size: 900, kind: 'table', columns: ['Quién'], rows: [] };
  const base = { message: 'Guarda en mis contactos a los del excel', runId, signal: new AbortController().signal, authorize: async () => {},
    record: async (observation: { action: string; result: unknown }) => {
      if (observation.action === COWORK_NOTE_ACTION) notes.push((observation.result as { reply: string }).reply);
    },
    proposeEffect: async (proposal: Record<string, unknown>) => { proposals.push(proposal); } };
  const readFile = { action: 'files.read' as const, query: 'prospectos.xlsx', leadId: null, answer: null };
  const importing = { action: 'contacts.import' as const, query: null, leadId: null, answer: null,
    contactsImport: { file: 'prospectos.xlsx#Prospectos', columns: { name: 'Quién' } } };
  // Off (the default, until its migration is applied): refused, never proposed.
  await assert.rejects(runCoworkReadLoop({ ...base, execute: async () => found,
    decide: async observations => observations.length ? importing : readFile }), /Contacts import unavailable/);
  assert.equal(proposals.length, 0);
  // On: the file files.read found (a sheet of it) anchors the proposal to the run that read it.
  await runCoworkReadLoop({ ...base, contactsImport: true, execute: async () => found,
    decide: async observations => observations.length ? importing : readFile });
  assert.deepEqual(proposals[0], { kind: 'contacts_import', targetId: 'new-contacts-import', label: 'Importar contactos de un archivo',
    originRunId: runId, contactsImport: { file: 'prospectos.xlsx#Prospectos', columns: { name: 'Quién' } } });
  assert.match(notes[0], /Propongo guardar en tus contactos a las personas del archivo que aún no están/);
  // Proposed before reading anything: the loop lists the uploads once, and a file that is not there is refused.
  await assert.rejects(runCoworkReadLoop({ ...base, contactsImport: true,
    execute: async action => { reads.push(action); return { scope: 'own_uploads', files: [{ name: 'otra.csv', runId, size: 3 }] }; },
    decide: async () => importing }), /observed first/);
  assert.deepEqual(reads, ['files.list']);
  assert.equal(proposals.length, 1);
});

test('a proposal carries the model explanation as a persisted note, recorded before the approval card', async () => {
  const runId = '00000000-0000-4000-8000-000000000010';
  const leadId = '00000000-0000-4000-8000-000000000021';
  const order: string[] = [];
  const recorded: Array<{ action: string; result: unknown }> = [];
  const found = { action: 'leads.search' as const, query: 'Nehal', leadId: null, answer: null };
  const enrich = { action: 'lead.enrich' as const, query: null, leadId, providerId: null, snapshotId: null, note: null,
    answer: { reply: 'Nehal no tiene correo ni investigación. Propongo buscar su correo (1 crédito).', document: null } };
  const result = await runCoworkReadLoop({
    message: '¿Vale la pena escribirle a Nehal?', runId, signal: new AbortController().signal, authorize: async () => {},
    execute: async () => ({ items: [{ id: leadId, name: 'Nehal P.', company: 'Adecco' }], scope: 'own_saved_contacts' }),
    record: async value => { order.push(`record:${value.action}`); recorded.push(value); },
    proposeEffect: async () => { order.push('propose'); },
    decide: async observations => observations.length === 0 ? found : enrich,
  });
  assert.equal(result.reply, enrich.answer.reply);
  assert.deepEqual(order, ['record:leads.search', 'record:assistant.note', 'propose']);
  assert.deepEqual(recorded[1], { action: 'assistant.note', input: '', result: { reply: enrich.answer.reply } });
});

test('a document sent with a proposal goes back to the model instead of being dropped', async () => {
  const leadId = '00000000-0000-4000-8000-000000000021';
  const report = { title: 'Prospección · septiembre', content: '## Actividad\n- 4 contactos' };
  const proposals: unknown[] = [];
  const recorded: Array<{ action: string }> = [];
  const result = await runCoworkReadLoop({
    message: 'Hazme el informe del mes', runId: '00000000-0000-4000-8000-000000000010', signal: new AbortController().signal, authorize: async () => {},
    execute: async () => ({ items: [{ id: leadId, name: 'Nehal P.', company: 'Adecco' }], scope: 'own_saved_contacts' }),
    record: async value => { recorded.push(value); },
    proposeEffect: async proposal => { proposals.push(proposal); },
    decide: async (observations, _mustAnswer, rejections = []) => {
      if (observations.length === 0) return { action: 'leads.search' as const, query: '', leadId: null, answer: null };
      if (!rejections.length) return { action: 'lead.enrich' as const, query: null, leadId, answer: { reply: 'Dejé el informe listo. ¿Busco su correo?', document: report } };
      assert.match(rejections[0].reason, /documento se perdería/);
      return { action: 'answer' as const, query: null, leadId: null, answer: { reply: 'Te dejé el informe. ¿Busco los correos que faltan?', document: report } };
    },
  });
  assert.deepEqual(result.document, report);
  assert.equal(proposals.length, 0);
  assert.equal(recorded.some(value => value.action === 'assistant.note'), false);
});

test('an email lookup that already ran in the thread is not proposed again', async () => {
  const leadId = '00000000-0000-4000-8000-000000000021';
  const row = { id: leadId, name: 'Carlos A.', company: 'Minera Centinela' };
  const proposals: Array<{ kind: string; label: string }> = [];
  await runCoworkReadLoop({
    message: 'No encontró correo? igual investígalo', runId: '00000000-0000-4000-8000-000000000010', signal: new AbortController().signal, authorize: async () => {},
    history: [{ runId: '00000000-0000-4000-8000-000000000009', observations: [{ action: 'leads.search', input: 'Carlos', result: { items: [row], scope: 'own_saved_contacts' } }],
      actions: [{ kind: 'enrich_contact', label: 'Enriquecer contacto Carlos A. (Minera Centinela)', outcome: 'ejecutada', result: { found: false } }] } as never],
    execute: async () => ({}), record: async () => {},
    proposeEffect: async proposal => { proposals.push(proposal); },
    decide: async (_observations, _mustAnswer, rejections = []) => {
      if (!rejections.length) return { action: 'lead.enrich' as const, query: null, leadId, answer: { reply: 'Vuelvo a buscar su correo.', document: null } };
      assert.match(rejections[0].reason, /Ya se buscó el correo/);
      return { action: 'research.start' as const, query: null, leadId, answer: { reply: 'El correo no apareció: lo investigo con su cargo y empresa.', document: null } };
    },
  });
  assert.deepEqual(proposals.map(proposal => [proposal.kind, proposal.label]), [['start_research', 'Investigar contacto Carlos A. (Minera Centinela)']]);
});

test('a proposal without explanation gets a note that says what it does and for whom', async () => {
  const leadId = '00000000-0000-4000-8000-000000000021';
  const recorded: string[] = [];
  const result = await runCoworkReadLoop({
    message: 'Enriquece', runId: '00000000-0000-4000-8000-000000000010', signal: new AbortController().signal, authorize: async () => {},
    execute: async () => ({ items: [{ id: leadId, name: 'José C.', company: 'GrupoExpro' }], scope: 'own_saved_contacts' }),
    record: async value => { recorded.push(value.action); },
    proposeEffect: async () => {},
    decide: async observations => observations.length === 0
      ? { action: 'leads.search' as const, query: 'José', leadId: null, answer: null }
      : { action: 'lead.enrich' as const, query: null, leadId, answer: null },
  });
  assert.equal(result.reply, 'Propongo buscar el correo de José C. (GrupoExpro) con el proveedor; usa un crédito. Revísalo antes de aprobar.');
  assert.deepEqual(recorded, ['leads.search', 'assistant.note']);
});

test('a proposal the server cannot stage returns to the model with the reason instead of failing the run', async () => {
  const leadId = '00000000-0000-4000-8000-000000000021';
  const reasons: string[] = [];
  const result = await runCoworkReadLoop({
    message: 'Busca su correo', runId: '00000000-0000-4000-8000-000000000010', signal: new AbortController().signal, authorize: async () => {},
    execute: async () => ({ items: [{ id: leadId, name: 'José C.', company: 'GrupoExpro' }], scope: 'own_saved_contacts' }),
    record: async () => {},
    proposeEffect: async () => { throw new Error('El destinatario ya no está disponible para esta audiencia.'); },
    decide: async (observations, _mustAnswer, rejections = []) => {
      reasons.push(...rejections.map(item => item.reason));
      if (!observations.length) return { action: 'leads.search' as const, query: 'José', leadId: null, answer: null };
      if (!rejections.length) return { action: 'lead.enrich' as const, query: null, leadId, answer: null };
      return { action: 'answer' as const, query: null, leadId: null, answer: { reply: 'No pude prepararlo: el destinatario no está en la audiencia.', document: null } };
    },
  });
  assert.match(result.reply, /No pude prepararlo/);
  assert.match(reasons.join('|'), /La propuesta no se pudo preparar: El destinatario ya no está disponible/);
});

test('access errors while staging a proposal still stop the run', async () => {
  const leadId = '00000000-0000-4000-8000-000000000021';
  await assert.rejects(runCoworkReadLoop({
    message: 'Busca su correo', runId: '00000000-0000-4000-8000-000000000010', signal: new AbortController().signal, authorize: async () => {},
    execute: async () => ({ items: [{ id: leadId, name: 'José C.' }], scope: 'own_saved_contacts' }),
    record: async () => {},
    proposeEffect: async () => { const error = new Error('Acceso Cowork revocado.'); error.name = 'AuthError'; throw error; },
    decide: async observations => observations.length
      ? { action: 'lead.enrich' as const, query: null, leadId, answer: null }
      : { action: 'leads.search' as const, query: 'José', leadId: null, answer: null },
  }), /revocado/);
});

test('an invalid model output is corrected on the next decision', async () => {
  let calls = 0;
  const result = await runCoworkReadLoop({
    message: 'Hola', signal: new AbortController().signal, authorize: async () => {}, record: async () => {},
    execute: async () => ({}),
    decide: async (_observations, _mustAnswer, rejections = []) => {
      calls++;
      if (!rejections.length) {
        const error = new Error('invalid') as Error & { issues: unknown[] };
        error.name = 'ZodError';
        error.issues = [{ path: ['campaign', 'messages', 0, 'delayDays'], message: 'El primer correo es inmediato.' }];
        throw error;
      }
      assert.match(rejections[0].reason, /delayDays: El primer correo es inmediato/);
      return { action: 'answer' as const, query: null, leadId: null,
        answer: { reply: 'Listo.\n¿Creo la campaña?', document: null, suggestions: [{ label: 'Sí, créala', message: 'Sí, crea la campaña' }] } };
    },
  });
  assert.equal(result.reply, 'Listo.\n¿Creo la campaña?');
  assert.equal(calls, 2);
});

test('an answer missing its closing question or quick replies gets one correction, never a second one', async () => {
  const chips = [{ label: 'Sí, búscalos', message: 'Sí, busca el correo de los tres contactos' }];
  const open = { ...answer, answer: { reply: 'Tienes 3 contactos sin correo. Después los reviso.', document: null, suggestions: chips } };
  const asked = { ...answer, answer: { reply: 'Tienes 3 contactos sin correo.\n¿Busco sus correos?', document: null, suggestions: chips } };
  const seen: string[][] = [];
  const base = { message: 'Pendientes', signal: new AbortController().signal, authorize: async () => {},
    execute: async () => ({}), record: async () => {} };
  const corrected = await runCoworkReadLoop({ ...base, decide: async (_observations, _mustAnswer, rejections = []) => {
    seen.push(rejections.map(item => item.reason));
    return rejections.length ? asked : open;
  } });
  assert.equal(corrected.reply, 'Tienes 3 contactos sin correo.\n¿Busco sus correos?');
  assert.equal(seen.length, 2);
  assert.match(seen[1][0], /pregunta del siguiente paso/);
  assert.doesNotMatch(seen[1][0], /agrega 1 a 3 respuestas sugeridas/);
  // The retry is told to keep what already worked.
  assert.match(seen[1][0], /conservando las respuestas sugeridas/);
  // Still open after the correction: the answer stands rather than looping.
  let calls = 0;
  const kept = await runCoworkReadLoop({ ...base, decide: async () => { calls++; return open; } });
  assert.equal(kept.reply, 'Tienes 3 contactos sin correo. Después los reviso.');
  assert.equal(calls, 2);
  // Quick replies that do not survive cleanup count as missing.
  const reasons: string[] = [];
  await runCoworkReadLoop({ ...base, decide: async (_observations, _mustAnswer, rejections = []) => {
    reasons.push(...rejections.map(item => item.reason));
    return { ...answer, answer: { reply: '¿Busco sus correos?', document: null, suggestions: [{ label: 'Sí', message: 'Aquí van los textos:' }] } };
  } });
  assert.equal(reasons.length, 1);
  assert.match(reasons[0], /respuestas sugeridas/);
  // Several emails in the chat belong in a document.
  const drafts: string[] = [];
  await runCoworkReadLoop({ ...base, decide: async (_observations, _mustAnswer, rejections = []) => {
    drafts.push(...rejections.map(item => item.reason));
    return { ...answer, answer: { reply: 'Asunto: Uno\nHola\n\nAsunto: Dos\nHola\n¿Creo la campaña?', document: null, suggestions: chips } };
  } });
  assert.equal(drafts.length, 1);
  assert.match(drafts[0], /pon los correos en un bloque sequence/);
  // The same emails as a sequence card are delivered: no correction.
  calls = 0;
  await runCoworkReadLoop({ ...base, decide: async () => {
    calls++;
    return { ...answer, answer: { reply: 'Te dejé dos correos.\n¿Creo la campaña?', document: null, suggestions: chips,
      blocks: [{ type: 'sequence', title: 'Dos correos', steps: [{ day: 1, subject: 'Uno', body: 'Hola,\nNicolás' }, { day: 4, subject: 'Dos', body: 'Hola,\nNicolás' }] }] } };
  } });
  assert.equal(calls, 1);
  // A [placeholder] in a card would reach the recipient: one correction, keeping the rest.
  const filler: string[] = [];
  await runCoworkReadLoop({ ...base, decide: async (_observations, _mustAnswer, rejections = []) => {
    filler.push(...rejections.map(item => item.reason));
    return { ...answer, answer: { reply: 'Te dejé el correo.\n¿Lo uso en una campaña?', document: null, suggestions: chips,
      blocks: [{ type: 'email_draft', title: 'Correo', to: null, subject: 'Hola', body: 'Hola,\n[tu nombre]' }] } };
  } });
  assert.equal(filler.length, 1);
  assert.match(filler[0], /corchetes/);
  assert.doesNotMatch(filler[0], /conservando[^.]*los bloques/);
  // A complete answer needs no second call.
  calls = 0;
  await runCoworkReadLoop({ ...base, decide: async () => { calls++; return asked; } });
  assert.equal(calls, 1);
});

test('the closing question can travel apart in answer.question, and a retry never drops it', async () => {
  const chips = [{ label: 'Sí, créala', message: 'Sí, crea la campaña pausada' }];
  const base = { message: 'Secuencia', signal: new AbortController().signal, authorize: async () => {}, execute: async () => ({}), record: async () => {} };
  let calls = 0;
  const apart = await runCoworkReadLoop({ ...base, decide: async () => {
    calls++;
    return { ...answer, answer: { reply: 'Te dejé la secuencia de 3 correos.', document: null, question: '¿Creo la campaña pausada?', suggestions: chips } };
  } });
  assert.equal(calls, 1, 'a question in answer.question completes the closing');
  assert.equal(apart.question, '¿Creo la campaña pausada?');
  // The first answer had the question but no quick replies; the retry adds them and forgets the question.
  const reasons: string[] = [];
  const fixed = await runCoworkReadLoop({ ...base, decide: async (_observations, _mustAnswer, rejections = []) => {
    reasons.push(...rejections.map(item => item.reason));
    return rejections.length
      ? { ...answer, answer: { reply: 'Te dejé la secuencia de 3 correos.', document: null, question: null, suggestions: chips } }
      : { ...answer, answer: { reply: 'Te dejé la secuencia de 3 correos.', document: null, question: '¿Creo la campaña pausada?', suggestions: null } };
  } });
  // A question apart already has its one-tap yes: missing quick replies alone cost no second call.
  assert.equal(reasons.length, 0);
  assert.equal(fixed.question, '¿Creo la campaña pausada?');
  // The retry keeps the question: a first answer with only the reply asking gets one.
  const retried: string[] = [];
  const kept = await runCoworkReadLoop({ ...base, decide: async (_observations, _mustAnswer, rejections = []) => {
    retried.push(...rejections.map(item => item.reason));
    return rejections.length
      ? { ...answer, answer: { reply: 'Te dejé la secuencia de 3 correos.', document: null, question: null, suggestions: chips } }
      : { ...answer, answer: { reply: 'Te dejé la secuencia de 3 correos.\n¿Creo la campaña pausada?', document: null, question: null, suggestions: null } };
  } });
  assert.match(retried[0], /conservando la pregunta final/);
  assert.equal(kept.question, '¿Creo la campaña pausada?');
  assert.deepEqual(kept.suggestions, chips);
});

test('a closing correction never leaves the turn worse than the first answer', async () => {
  const chips = [{ label: 'Sí, créala', message: 'Sí, crea la campaña pausada' }];
  const first = { ...answer, answer: { reply: 'Te dejé la secuencia.', document: { title: 'Secuencia', content: '## Correo 1\nAsunto: Hola' }, suggestions: chips } };
  const base = { message: 'Secuencia', signal: new AbortController().signal, authorize: async () => {}, record: async () => {} };
  // The retry fixes the question but drops the document and the quick replies: both come back.
  const fixed = await runCoworkReadLoop({ ...base, execute: async () => ({}), decide: async (_observations, mustAnswer, rejections = []) => {
    if (!rejections.length) return first;
    assert.equal(mustAnswer, true);
    return { ...answer, answer: { reply: 'Te dejé la secuencia.\n¿Creo la campaña?', document: null, suggestions: null } };
  } });
  assert.equal(fixed.reply, 'Te dejé la secuencia.\n¿Creo la campaña?');
  assert.equal(fixed.document?.title, 'Secuencia');
  assert.deepEqual(fixed.suggestions, chips);
  // The retry goes back to reading: nothing more is read and the first answer stands.
  let reads = 0;
  const kept = await runCoworkReadLoop({ ...base, execute: async () => { reads++; return {}; },
    decide: async (_observations, _mustAnswer, rejections = []) => rejections.length ? search : first });
  assert.equal(reads, 0);
  assert.equal(kept.reply, 'Te dejé la secuencia.');
  // The retry is not valid output: the first answer stands instead of failing the turn.
  const survived = await runCoworkReadLoop({ ...base, execute: async () => ({}),
    decide: async (_observations, _mustAnswer, rejections = []) => {
      if (!rejections.length) return first;
      const error = new Error('invalid') as Error & { issues: unknown[] };
      error.name = 'ZodError';
      error.issues = [{ path: ['answer'], message: 'Required' }];
      throw error;
    } });
  assert.equal(survived.reply, 'Te dejé la secuencia.');
});

test('a search proposed without an explanation still gets a sentence built from its criteria', async () => {
  const notes: unknown[] = [];
  await runCoworkReadLoop({
    message: 'Busca gerentes', signal: new AbortController().signal, authorize: async () => {}, execute: async () => ({}),
    record: async observation => { notes.push(observation); }, proposeSearch: async () => {},
    decide: async () => ({ action: 'prospecting.propose_search' as const, query: null, leadId: null, answer: null,
      searchCriteria: { titles: ['Gerente de Operaciones', 'Superintendente'], industries: ['minería'], locations: ['Antofagasta, Chile'], limit: 25 } }),
  });
  assert.deepEqual(notes, [{ action: 'assistant.note', input: '', result: { reply:
    'Propongo buscar hasta 25 personas con cargos como Gerente de Operaciones o Superintendente, del rubro minería, en Antofagasta, Chile. Revisa los criterios antes de aprobar: la búsqueda no guarda contactos ni revela correos.' } }]);
  // Seen with the real model: a repeated industry was named twice («del rubro retail y retail»).
  const repeated: unknown[] = [];
  await runCoworkReadLoop({
    message: 'Busca gerentes de RR. HH. en retail', signal: new AbortController().signal, authorize: async () => {}, execute: async () => ({}),
    record: async observation => { repeated.push(observation); }, proposeSearch: async () => {},
    decide: async () => ({ action: 'prospecting.propose_search' as const, query: null, leadId: null, answer: null,
      searchCriteria: { titles: ['HR Manager', 'hr manager '], industries: ['retail', 'Retail'], locations: ['Santiago, Chile'], limit: 10 } }),
  });
  assert.equal((repeated[0] as { result: { reply: string } }).result.reply,
    'Propongo buscar hasta 10 personas con cargos como HR Manager, del rubro retail, en Santiago, Chile. Revisa los criterios antes de aprobar: la búsqueda no guarda contactos ni revela correos.');
  // Seen with the real model: the first step of «busca… y después armame una campaña» came without a note.
  const chained: unknown[] = [];
  await runCoworkReadLoop({
    message: 'busca 10 gerentes de rrhh en retail y despues armame una campaña para ellos', signal: new AbortController().signal,
    authorize: async () => {}, execute: async () => ({}), record: async observation => { chained.push(observation); }, proposeSearch: async () => {},
    decide: async () => ({ action: 'prospecting.propose_search' as const, query: null, leadId: null, answer: null,
      searchCriteria: { titles: ['HR Manager'], industries: ['retail'], locations: ['Santiago, Chile'], limit: 10 } }),
  });
  assert.match((chained[0] as { result: { reply: string } }).result.reply, /Cuando veas los resultados y guardes a quienes te sirvan, sigo con la campaña\.$/);
});

test('a campaign proposed before listing campaigns gets the list read by the loop, not a failed turn', async () => {
  const executed: string[] = [];
  const proposals: Array<{ kind: string; originRunId: string }> = [];
  const campaign = { name: 'AXIS · RR. HH.', objective: 'Primera conversación',
    criteria: { relationship: 'never_contacted', titles: [], industries: [], countries: [], sizes: [], seniorities: [], minimumDaysSinceSent: 0, excludeReplied: true, enrichedOnly: false },
    emails: ['fmunoz@securitas.cl'], provider: 'google', messages: [{ subject: 'Hola', body: 'Hola,\nNicolás', delayDays: 0 }] };
  const reply = await runCoworkReadLoop({
    message: 'Mándale un correo a mis contactos de RR. HH.', runId: '00000000-0000-4000-8000-0000000000aa',
    signal: new AbortController().signal, authorize: async () => {}, record: async () => {},
    execute: async action => { executed.push(action); return { scope: 'own', campaigns: [] }; },
    proposeEffect: async proposal => { proposals.push({ kind: proposal.kind, originRunId: proposal.originRunId }); },
    decide: async () => coworkDecisionSchema.parse({ action: 'campaign.create', query: null, leadId: null, campaign,
      answer: { reply: 'Te dejo la campaña pausada para Felipe.', document: null } }),
  });
  assert.deepEqual(executed, ['campaigns.list']);
  assert.deepEqual(proposals, [{ kind: 'campaign_create', originRunId: '00000000-0000-4000-8000-0000000000aa' }]);
  assert.equal(reply.reply, 'Te dejo la campaña pausada para Felipe.');

  // Seen with the real model: three reads first, then the campaign on the last decision.
  const late: string[] = [];
  const lateProposals: string[] = [];
  const decisions = [
    { action: 'leads.search', query: 'RRHH', leadId: null, answer: null },
    { action: 'reads.parallel', reads: [{ action: 'app.context', input: '' }], query: null, leadId: null, answer: null },
    { action: 'reads.parallel', reads: [{ action: 'message.context', input: '' }], query: null, leadId: null, answer: null },
    { action: 'campaign.create', query: null, leadId: null, campaign, answer: { reply: 'Te dejo la campaña pausada.', document: null } },
  ];
  const lateReply = await runCoworkReadLoop({
    message: 'Mándale un correo a mis contactos de RR. HH.', runId: '00000000-0000-4000-8000-0000000000aa',
    signal: new AbortController().signal, authorize: async () => {}, record: async () => {},
    execute: async action => { late.push(action); return action === 'campaigns.list' ? { scope: 'own', campaigns: [] } : {}; },
    proposeEffect: async proposal => { lateProposals.push(proposal.kind); },
    decide: async () => coworkDecisionSchema.parse(decisions.shift()),
  });
  assert.deepEqual(late, ['leads.search', 'app.context', 'message.context', 'campaigns.list']);
  assert.deepEqual(lateProposals, ['campaign_create']);
  assert.equal(lateReply.reply, 'Te dejo la campaña pausada.');

  // Without an explanation from the model, the card still comes with one.
  const notes: unknown[] = [];
  const silent = await runCoworkReadLoop({
    message: 'Mándale un correo a mis contactos de RR. HH.', runId: '00000000-0000-4000-8000-0000000000aa',
    signal: new AbortController().signal, authorize: async () => {}, record: async observation => { notes.push(observation); },
    execute: async () => ({ scope: 'own', campaigns: [] }), proposeEffect: async () => {},
    decide: async () => coworkDecisionSchema.parse({ action: 'campaign.create', query: null, leadId: null, campaign, answer: null }),
  });
  assert.equal(silent.reply, 'Preparé la campaña «AXIS · RR. HH.» para 1 contacto, con 1 correo. Queda pausada: revísala y, cuando la apruebes, se crea sin enviar nada todavía.');
  assert.equal((notes.at(-1) as { action: string }).action, 'assistant.note');
});

test('the plan is recorded once, before the first read, and never reaches the model as data', async () => {
  const recorded: Array<{ action: string; result: unknown }> = [];
  const seen: number[] = [];
  const decisions = [
    { ...search, outline: [
      { label: '**Reviso tus contactos** de logística.', read: 'leads.search' },
      { label: 'Abro la ficha 00000000-0000-4000-8000-000000000022', read: 'crm.get_lead' },
      { label: 'Cruzo con lo que ya enviaste y con el historial completo de respuestas de cada contacto de la lista', read: 'contacted.search' },
      { label: 'Redacto el correo', read: 'invented.read' },
    ] },
    { ...search, query: 'Transporte', outline: [{ label: 'Otro plan', read: null }, { label: 'Que no se guarda', read: null }] },
    { ...answer, answer: { reply: 'Un contacto encontrado.', document: null, question: '¿Le escribo?' } },
  ];
  await runCoworkReadLoop({
    message: 'Busca logística', signal: new AbortController().signal, authorize: async () => {},
    decide: async observations => { seen.push(observations.length); return coworkDecisionSchema.parse(decisions.shift()); },
    execute: async () => ({ items: [] }), record: async observation => { recorded.push(observation); },
  });
  assert.deepEqual(recorded.map(item => item.action), ['assistant.plan', 'leads.search', 'leads.search']);
  // Sanitized: no IDs, no Markdown, short labels, only reads the loop knows.
  assert.deepEqual(recorded[0].result, { steps: [
    { label: 'Reviso tus contactos de logística', read: 'leads.search' },
    { label: 'Cruzo con lo que ya enviaste y con el historial completo de respuestas de cada…', read: 'contacted.search' },
    { label: 'Redacto el correo', read: null },
  ] });
  // The model sees its reads, not its plan.
  assert.deepEqual(seen, [0, 1, 2]);

  // Answering straight away needs no plan.
  const direct: string[] = [];
  await runCoworkReadLoop({
    message: 'Hola', signal: new AbortController().signal, authorize: async () => {}, execute: async () => ({}),
    record: async observation => { direct.push(observation.action); },
    decide: async () => coworkDecisionSchema.parse({ ...answer, outline: [{ label: 'Saludo', read: null }, { label: 'Respondo', read: null }] }),
  });
  assert.deepEqual(direct, []);
});

test('a LinkedIn proposal without an explanation still says for whom and what to check', async () => {
  const lead = '00000000-0000-4000-8000-000000000101';
  const notes: unknown[] = [];
  const proposals: string[] = [];
  const decisions = [
    { action: 'leads.search', query: 'Felipe', leadId: null, answer: null },
    { action: 'linkedin.message', query: null, leadId: lead, linkedinMessage: 'Hola Felipe, ¿conversamos sobre AXIS?', answer: null },
  ];
  const reply = await runCoworkReadLoop({
    message: 'Escríbele a Felipe por LinkedIn', runId: '00000000-0000-4000-8000-0000000000aa',
    signal: new AbortController().signal, authorize: async () => {},
    execute: async () => ({ scope: 'own_saved_contacts', items: [{ id: lead, name: 'Felipe Muñoz', company: 'Securitas Chile' }] }),
    record: async observation => { notes.push(observation); },
    proposeEffect: async proposal => { proposals.push(proposal.kind); },
    decide: async () => coworkDecisionSchema.parse(decisions.shift()),
  });
  assert.deepEqual(proposals, ['linkedin_message']);
  assert.equal(reply.reply, 'Preparé un mensaje de LinkedIn para Felipe Muñoz (Securitas Chile). Revisa el texto en la tarjeta antes de aprobarlo.');
  assert.equal((notes.at(-1) as { action: string }).action, 'assistant.note');
});

test('a campaign asked with the exact emails carries them word for word, spaced by their days', async () => {
  const message = [
    'Crea una campaña pausada con esta versión editada de «Secuencia AXIS», sin cambiar el texto.',
    '', 'Correo 1 · día 1', 'Asunto: Antecedentes sin trámites', '', 'Hola,', 'Escribí esto yo.', 'Nicolás',
    '', '---', '', 'Correo 2 · día 5', 'Asunto: ¿Lo vemos?', '', 'Hola,', '¿Te sirve el jueves?', 'Nicolás',
  ].join('\n');
  let proposed: { messages: Array<{ subject: string; body: string; delayDays: number }> } | undefined;
  const reply = await runCoworkReadLoop({
    message, runId: '00000000-0000-4000-8000-0000000000aa', signal: new AbortController().signal, authorize: async () => {},
    record: async () => {}, execute: async () => ({ scope: 'own', campaigns: [] }),
    proposeEffect: async proposal => { proposed = proposal.campaign; },
    // The model «improves» the text and guesses the spacing; the person's version wins.
    decide: async () => coworkDecisionSchema.parse({ action: 'campaign.create', query: null, leadId: null, answer: { reply: 'Te dejo la campaña pausada.', document: null },
      campaign: { name: 'AXIS · RR. HH.', objective: 'Primera conversación',
        criteria: { relationship: 'never_contacted', titles: [], industries: [], countries: [], sizes: [], seniorities: [], minimumDaysSinceSent: 0, excludeReplied: true, enrichedOnly: false },
        emails: ['fmunoz@securitas.cl'], provider: 'google',
        messages: [{ subject: 'Antecedentes laborales, sin trámites', body: 'Hola,\nTe escribo por AXIS.\nNicolás', delayDays: 0 },
          { subject: '¿Lo vemos esta semana?', body: 'Hola,\n¿Te sirve?\nNicolás', delayDays: 2 }] } }),
  });
  assert.equal(reply.reply, 'Te dejo la campaña pausada.');
  assert.deepEqual(proposed?.messages, [
    { subject: 'Antecedentes sin trámites', body: 'Hola,\nEscribí esto yo.\nNicolás', delayDays: 0 },
    { subject: '¿Lo vemos?', body: 'Hola,\n¿Te sirve el jueves?\nNicolás', delayDays: 4 },
  ]);
});

test('«Usar esta versión» proposes nothing: a proposal comes back as a correction, and the last decision confirms instead of failing', async () => {
  const message = [
    'Usa exactamente esta versión editada de «Secuencia AXIS», sin cambiar el texto.',
    '', 'Correo 1 · día 1', 'Asunto: Antecedentes sin trámites', '', 'Hola,', 'Escribí esto yo.', 'Nicolás',
  ].join('\n');
  const create = coworkDecisionSchema.parse({ action: 'campaign.create', query: null, leadId: null, answer: { reply: 'Te dejo la campaña pausada.', document: null },
    campaign: { name: 'AXIS', objective: 'Primera conversación',
      criteria: { relationship: 'never_contacted', titles: [], industries: [], countries: [], sizes: [], seniorities: [], minimumDaysSinceSent: 0, excludeReplied: true, enrichedOnly: false },
      emails: ['fmunoz@securitas.cl'], provider: 'google', messages: [{ subject: 'Antecedentes sin trámites', body: 'Hola,\nEscribí esto yo.\nNicolás', delayDays: 0 }] } });
  const confirm = { action: 'answer' as const, query: null, leadId: null,
    answer: { reply: 'Listo, uso tu versión tal cual.', document: null, question: '¿Creo la campaña pausada con ella?' } };
  let proposals = 0;
  const reasons: string[] = [];
  const base = { message, runId: '00000000-0000-4000-8000-0000000000aa', signal: new AbortController().signal, authorize: async () => {},
    record: async () => {}, execute: async () => ({ scope: 'own', campaigns: [] }), proposeEffect: async () => { proposals++; } };
  const corrected = await runCoworkReadLoop({ ...base, decide: async (_observations, _mustAnswer, rejections = []) => {
    reasons.push(...rejections.map(rejection => rejection.reason));
    return rejections.length ? confirm : create;
  } });
  assert.equal(corrected.reply, 'Listo, uso tu versión tal cual.');
  assert.match(reasons.join('|'), /Usar esta versión/);
  // A model that insists until its last decision still leaves the person a clear answer.
  const insisted = await runCoworkReadLoop({ ...base, ceiling: { decisions: 2, reads: 3, softDeadlineMs: 50_000 }, decide: async () => create });
  assert.equal(insisted.reply, 'Listo: desde ahora uso tu versión tal cual, sin cambiarla.');
  assert.equal(proposals, 0);
});

test('draft.write hands the emails to the Writer, whose answer ends the turn; without it the coordinator writes them', async () => {
  const brief = { kind: 'email' as const, recipients: ['Felipe Muñoz'], objective: 'Una reunión sobre AXIS', angle: null, tone: null, steps: null, notes: null, findings: null };
  const write = coworkDecisionSchema.parse({ action: 'draft.write', query: null, leadId: null, answer: null, write: brief });
  const written = { reply: 'Te dejo el correo para Felipe.', document: null, question: '¿Lo dejo listo para enviar?',
    blocks: [{ type: 'email_draft' as const, title: 'Correo a Felipe', to: ['Felipe Muñoz'], subject: 'AXIS', body: 'Hola Felipe,\n¿Lo vemos?\nNicolás' }],
    suggestions: [{ label: 'Sí', message: 'Sí, déjalo listo' }] };
  const closed = { action: 'answer' as const, query: null, leadId: null,
    answer: { reply: 'Te dejo el correo que escribí.', document: null, question: '¿Lo dejo listo para enviar?' } };
  const base = { message: 'Escríbele a Felipe', signal: new AbortController().signal, authorize: async () => {}, record: async () => {}, execute: async () => ({}) };
  const briefs: unknown[] = [];
  const result = await runCoworkReadLoop({ ...base, decide: async () => write, write: async given => { briefs.push(given); return written; } });
  assert.deepEqual(result, written);
  assert.deepEqual(briefs, [brief]);
  // No Writer wired, a Writer that fails, or a decision without its brief: the coordinator hears why and writes them itself.
  for (const [decision, writer, reason] of [
    [write, undefined, /no está disponible/],
    [write, async () => { throw new Error('timeout'); }, /no pudo escribir/],
    [{ ...write, write: null }, async () => written, /sin encargo/],
  ] as const) {
    const reasons: string[] = [];
    const fallback = await runCoworkReadLoop({ ...base, ...(writer ? { write: writer } : {}), decide: async (_observations, _mustAnswer, rejections = []) => {
      reasons.push(...rejections.map(rejection => rejection.reason));
      return rejections.length ? closed : decision;
    } });
    assert.equal(fallback.reply, 'Te dejo el correo que escribí.');
    assert.match(reasons.join('|'), reason);
  }
  // On the last decision nobody is left to write it: the turn says so and offers to try again, instead of failing.
  const late = await runCoworkReadLoop({ ...base, ceiling: { decisions: 2, reads: 3, softDeadlineMs: 50_000 },
    decide: async (_observations, _mustAnswer, rejections = []) => rejections.length ? write : { ...write, write: null },
    write: async () => { throw new Error('timeout'); } });
  assert.match(late.reply, /No alcancé a escribir los correos/);
  assert.deepEqual(late.suggestions, [{ label: 'Sí, escríbelos', message: 'Escríbele a Felipe' }]);
  // A turn resumed after the specialists may hand the emails to the Writer too.
  const resumed = await runCoworkReadLoop({ ...base, resumedObservations: [{ action: 'leads.search', input: 'Felipe', result: { items: [] } }],
    decide: async () => write, write: async () => written });
  assert.deepEqual(resumed, written);
  // «Usar esta versión» keeps the person's text: it never goes to the Writer.
  let rewritten = 0;
  const kept = await runCoworkReadLoop({ ...base, message: 'Usa exactamente esta versión editada de «Correo a Felipe», sin cambiar el texto.\n\nAsunto: AXIS\n\nHola,\nNicolás',
    ceiling: { decisions: 2, reads: 3, softDeadlineMs: 50_000 }, decide: async () => write, write: async () => { rewritten++; return written; } });
  assert.equal(kept.reply, 'Listo: desde ahora uso tu versión tal cual, sin cambiarla.');
  assert.equal(rewritten, 0);
});

test('the judge reads the final answer once; its correction may read once, and the judged answer stands if it fails', async () => {
  const ask = { action: 'answer' as const, query: null, leadId: null,
    answer: { reply: 'Tienes 5 contactos guardados.', document: null, question: '¿Quieres que revise a quiénes ya les escribiste?',
      suggestions: [{ label: 'Sí, revísalo', message: 'Sí, revisa a quiénes ya les escribí' }] } };
  const fixed = { action: 'answer' as const, query: null, leadId: null,
    answer: { reply: 'Tienes 5 contactos guardados; a Marcela ya le escribiste, así que partiría por Felipe y Camila.', document: null,
      question: '¿Les preparo el correo?', suggestions: [{ label: 'Sí, prepáralo', message: 'Sí, prepara el correo para Felipe y Camila' }] } };
  const readSent = { action: 'contacted.search' as const, query: '', leadId: null, answer: null };
  const base = { message: '¿A quién le escribo?', signal: new AbortController().signal, authorize: async () => {}, record: async () => {} };
  const feedback = 'Antes de mostrarla, una revisión de tu respuesta encontró:\n- Pide permiso para una consulta que podía hacer.';

  // A clean answer: judged once, shown as it is.
  const judgedClean: string[] = [];
  const clean = await runCoworkReadLoop({ ...base, execute: async () => ({}), decide: async () => fixed,
    judge: async answer => { judgedClean.push(answer.reply); return null; } });
  assert.equal(clean.reply, fixed.answer.reply);
  assert.deepEqual(judgedClean, [fixed.answer.reply]);

  // The judge asks for a fix: the correction reads what the answer offered, then answers with it.
  const seen: Array<{ mustAnswer: boolean; reasons: string[] }> = [];
  const executed: string[] = [];
  let judgements = 0;
  const corrected = await runCoworkReadLoop({ ...base,
    execute: async action => { executed.push(action); return { items: [{ name: 'Marcela Rojas' }] }; },
    decide: async (_observations, mustAnswer, rejections = []) => {
      seen.push({ mustAnswer, reasons: rejections.map(rejection => rejection.reason) });
      return seen.length === 1 ? ask : seen.length === 2 ? readSent : fixed;
    },
    judge: async () => { judgements++; return feedback; } });
  assert.equal(corrected.reply, fixed.answer.reply);
  assert.equal(judgements, 1, 'one judgement per turn');
  assert.deepEqual(executed, ['contacted.search']);
  assert.deepEqual(seen.map(item => item.mustAnswer), [false, false, true], 'after its one read the correction must answer');
  assert.match(seen[1].reasons.join('|'), /una revisión de tu respuesta/);

  // A correction that reads twice, or fails, leaves the judged answer.
  let second = 0;
  const readsTwice = await runCoworkReadLoop({ ...base, execute: async () => ({ items: [] }),
    decide: async () => (second++ === 0 ? ask : readSent), judge: async () => feedback });
  assert.equal(readsTwice.reply, ask.answer.reply);
  let broken = 0;
  const invalid = await runCoworkReadLoop({ ...base, execute: async () => ({}),
    decide: async () => (broken++ === 0 ? ask : { action: 'answer', query: null, leadId: null, answer: null }) as never, judge: async () => feedback });
  assert.equal(invalid.reply, ask.answer.reply);

  // A judge that fails never blocks the answer.
  const failing = await runCoworkReadLoop({ ...base, execute: async () => ({}), decide: async () => ask, judge: async () => { throw new Error('timeout'); } });
  assert.equal(failing.reply, ask.answer.reply);

  // The judge knows whether its correction may still read: a decision for the read and one to answer.
  const reads = (count: number) => ({ action: 'reads.parallel' as const, query: null, leadId: null, answer: null,
    reads: Array.from({ length: count }, (_, index) => ({ action: 'leads.search' as const, input: `q${index}` })) });
  const canRead: boolean[] = [];
  let sequential = 0;
  await runCoworkReadLoop({ ...base, execute: async () => ({ items: [] }),
    decide: async () => [readSent, { ...readSent, query: 'x' }, ask][sequential++] ?? fixed,
    judge: async (_answer, _observations, turn) => { canRead.push(turn.canRead); return null; } });
  await runCoworkReadLoop({ ...base, execute: async () => ({ items: [] }), decide: async () => ask,
    judge: async (_answer, _observations, turn) => { canRead.push(turn.canRead); return null; } });
  assert.deepEqual(canRead, [false, true], 'an answer on the third decision leaves no read for the correction');
  // After three reads the correction may still make the one read the answer offered, past the ceiling.
  const afterThree: string[] = [];
  let step = 0;
  const past = await runCoworkReadLoop({ ...base, execute: async action => { afterThree.push(action); return { items: [] }; },
    decide: async (_observations, mustAnswer) => [reads(3), ask, readSent][step++] ?? (mustAnswer ? fixed : readSent),
    judge: async () => feedback });
  assert.equal(past.reply, fixed.answer.reply);
  assert.deepEqual(afterThree, ['leads.search', 'leads.search', 'leads.search', 'contacted.search']);

  // No decision to spare, or an answer from the Writer: nothing is judged.
  let judgedLast = 0;
  const last = await runCoworkReadLoop({ ...base, execute: async () => ({}), ceiling: { decisions: 2, reads: 3, softDeadlineMs: 50_000 },
    decide: async (_observations, _mustAnswer, rejections = []) => rejections.length ? ask : { action: 'answer', query: null, leadId: null, answer: { reply: 'Hola', document: null } } as never,
    judge: async () => { judgedLast++; return feedback; } });
  assert.equal(last.reply, ask.answer.reply);
  assert.equal(judgedLast, 0, 'the closing correction used the last decision');
  const brief = { kind: 'email' as const, recipients: null, objective: 'Una reunión', angle: null, tone: null, steps: null, notes: null, findings: null };
  const written = { reply: 'Te dejo el correo.', document: null, question: '¿Lo dejo listo?', blocks: null, suggestions: null };
  let judgedWriter = 0;
  const viaWriter = await runCoworkReadLoop({ ...base, execute: async () => ({}),
    decide: async () => coworkDecisionSchema.parse({ action: 'draft.write', query: null, leadId: null, answer: null, write: brief }),
    write: async () => written, judge: async () => { judgedWriter++; return feedback; } });
  assert.equal(viaWriter, written);
  assert.equal(judgedWriter, 0);
  // «Usa exactamente esta versión» only confirms the version: nothing to judge.
  let judgedVersion = 0;
  const version = await runCoworkReadLoop({ ...base, message: 'Usa exactamente esta versión editada de «Correo a Felipe», sin cambiar el texto.\n\nAsunto: AXIS\n\nHola,\nNicolás',
    execute: async () => ({}), decide: async () => fixed, judge: async () => { judgedVersion++; return feedback; } });
  assert.equal(version.reply, fixed.answer.reply);
  assert.equal(judgedVersion, 0);
});

test('a correction edits the answer it fixes, and is kept only when it is one: no figures without support, not the same answer', async () => {
  const ask = { action: 'answer' as const, query: null, leadId: null,
    answer: { reply: 'Tienes 5 contactos guardados.', document: null, question: '¿Quieres que revise a quiénes ya les escribiste?',
      suggestions: [{ label: 'Sí, revísalo', message: 'Sí, revisa a quiénes ya les escribí' }] } };
  const fixed = { action: 'answer' as const, query: null, leadId: null,
    answer: { reply: 'Tienes 5 contactos guardados; a 2 ya les escribiste (12 correos en total).', document: null, question: '¿Les preparo el correo?',
      suggestions: [{ label: 'Sí, prepáralo', message: 'Sí, prepara el correo' }] } };
  const readSent = { action: 'contacted.search' as const, query: '', leadId: null, answer: null };
  const base = { message: '¿A quién le escribo?', signal: new AbortController().signal, authorize: async () => {}, record: async () => {},
    execute: async () => ({ contacted: 2, sent: 12 }), judge: async () => 'Antes de mostrarla, una revisión de tu respuesta encontró:\n- Ofrece una consulta que podía hacer.' };
  const script = (answers: unknown[]) => { let step = 0; return async () => [ask, readSent, ...answers][step++] as never; };

  // The correction is handed the answer it edits, apart from the reason, and its figures come from what was read.
  const seen: Array<Array<{ reason: string; previous?: { reply: string } }>> = [];
  const verdicts: unknown[] = [];
  const next = script([fixed]);
  const edited = await runCoworkReadLoop({ ...base, onCorrection: verdict => verdicts.push(verdict), decide: async (_observations, _mustAnswer, rejections = []) => {
    seen.push(rejections);
    return next();
  } });
  assert.equal(edited.reply, fixed.answer.reply);
  assert.deepEqual(verdicts, [{ keep: 'correction', reason: 'improved' }]);
  assert.equal(seen[1][0].previous?.reply, ask.answer.reply);
  assert.match(seen[1][0].reason, /una revisión de tu respuesta/);

  // A figure that is neither in the first answer nor in what was read: the first answer stands.
  const invented = { ...fixed, answer: { ...fixed.answer, reply: 'Tienes 5 contactos guardados; el 37 % abrió tus correos.' } };
  const guarded: unknown[] = [];
  const stands = await runCoworkReadLoop({ ...base, onCorrection: verdict => guarded.push(verdict), decide: script([invented]) });
  assert.equal(stands.reply, ask.answer.reply);
  assert.deepEqual(guarded, [{ keep: 'first', reason: 'new_figures', figures: ['37'] }]);
  // The person's own profile backs figures too: it travels to the check as userContext.
  const backed = await runCoworkReadLoop({ ...base, userContext: { proofPoints: ['Reduce 37 % el tiempo de verificación'] },
    decide: script([invented]) });
  assert.equal(backed.reply, invented.answer.reply);

  // The same answer again is not a correction either.
  const same: unknown[] = [];
  const unchanged = await runCoworkReadLoop({ ...base, onCorrection: verdict => same.push(verdict), decide: script([ask]) });
  assert.equal(unchanged.reply, ask.answer.reply);
  assert.deepEqual(same, [{ keep: 'first', reason: 'unchanged' }]);

  // The closing correction also edits the answer it fixes (a missing final question).
  const noQuestion = { action: 'answer' as const, query: null, leadId: null, answer: { reply: 'Tienes 5 contactos guardados.', document: null } };
  const closing: Array<{ previous?: { reply: string }; reason: string }> = [];
  await runCoworkReadLoop({ ...base, judge: undefined, decide: async (_observations, _mustAnswer, rejections = []) => {
    closing.push(...rejections);
    return (rejections.length ? ask : noQuestion) as never;
  } });
  assert.equal(closing[0].previous?.reply, noQuestion.answer.reply);
  assert.match(closing[0].reason, /Edita tu respuesta anterior \(answerToCorrect\)/);
});

test('the coordinator sees what is left of the turn and may read past three when the ceiling is raised', async () => {
  const seen: Array<{ mustAnswer: boolean; budget?: CoworkTurnBudget }> = [];
  const batch = (inputs: string[]) => ({ action: 'reads.parallel' as const, query: null, leadId: null, answer: null,
    reads: inputs.map(input => ({ action: 'leads.search' as const, input })) });
  // A complete answer: no closing correction spends another decision.
  const closed = { action: 'answer' as const, query: null, leadId: null,
    answer: { reply: 'Comparé los seis segmentos.', document: null, question: '¿Te preparo la campaña para el primero?' } };
  let reads = 0;
  const result = await runCoworkReadLoop({
    message: 'Compara seis segmentos', signal: new AbortController().signal, authorize: async () => {},
    ceiling: { decisions: 5, reads: 6, softDeadlineMs: 50_000 },
    execute: async () => { reads++; return {}; }, record: async () => {},
    decide: async (_observations, mustAnswer, _rejections, budget) => {
      seen.push({ mustAnswer, budget });
      return seen.length === 1 ? batch(['uno', 'dos', 'tres']) : seen.length === 2 ? batch(['cuatro', 'cinco', 'seis']) : closed;
    },
  });
  assert.equal(result.reply, 'Comparé los seis segmentos.');
  assert.equal(reads, 6);
  assert.deepEqual(seen, [
    { mustAnswer: false, budget: { reads: 6, readsLeft: 6, decisionsLeft: 4 } },
    { mustAnswer: false, budget: { reads: 6, readsLeft: 3, decisionsLeft: 3 } },
    // All the reads are spent: the third decision answers.
    { mustAnswer: true, budget: { reads: 6, readsLeft: 0, decisionsLeft: 2 } },
  ]);
});

test('past the soft deadline the turn answers with what it has, without a closing correction', async () => {
  let clock = 0;
  let decisions = 0;
  const bare = { action: 'answer' as const, query: null, leadId: null, answer: { reply: 'Tienes 4 contactos con correo.', document: null } };
  const result = await runCoworkReadLoop({
    message: 'Revisa mis contactos', signal: new AbortController().signal, authorize: async () => {},
    now: () => clock,
    execute: async () => { clock += 51_000; return {}; }, record: async () => {},
    decide: async (_observations, mustAnswer) => {
      decisions++;
      if (decisions === 1) return search;
      assert.equal(mustAnswer, true);
      return bare;
    },
  });
  // The answer has no closing question, but there is no time left to ask for one.
  assert.equal(result.reply, 'Tienes 4 contactos con correo.');
  assert.equal(decisions, 2);
});

test('a read asked for after the soft deadline is refused and the turn still answers', async () => {
  let clock = 0;
  let decisions = 0;
  let reads = 0;
  const reasons: string[] = [];
  const result = await runCoworkReadLoop({
    message: 'Revisa mis contactos', signal: new AbortController().signal, authorize: async () => {},
    now: () => clock,
    execute: async () => { reads++; clock += 51_000; return {}; }, record: async () => {},
    decide: async (_observations, _mustAnswer, rejections = []) => {
      decisions++;
      reasons.push(...rejections.map(item => item.reason));
      return decisions < 3 ? search : answer;
    },
  });
  assert.equal(result.reply, 'Un contacto encontrado.');
  assert.equal(reads, 1);
  assert.match(reasons.join('|'), /Se acabó el tiempo de este turno/);
});

test('a specialist review sees at most three observations of the turn', async () => {
  const reasons: string[] = [];
  let decisions = 0;
  const specialists = { action: 'specialists.review' as const, query: null, leadId: null, answer: null,
    specialists: [{ role: 'analyst' as const, objective: 'Compara', evidence: [0, 1, 2] }] };
  const result = await runCoworkReadLoop({
    message: 'Analiza cuatro segmentos', signal: new AbortController().signal, authorize: async () => {},
    // Only a raised ceiling reaches four observations.
    ceiling: { decisions: 5, reads: 6, softDeadlineMs: 50_000 },
    execute: async () => ({}), record: async () => {},
    review: async () => { assert.fail('must not review four observations'); },
    decide: async (_observations, _mustAnswer, rejections = []) => {
      decisions++;
      reasons.push(...rejections.map(item => item.reason));
      if (decisions === 1) return { action: 'reads.parallel' as const, query: null, leadId: null, answer: null,
        reads: ['uno', 'dos', 'tres'].map(input => ({ action: 'leads.search' as const, input })) };
      if (decisions === 2) return search;
      return decisions === 3 ? specialists : answer;
    },
  });
  assert.equal(result.reply, 'Un contacto encontrado.');
  assert.match(reasons.join('|'), /solo está disponible con hasta 3 consultas/);
});

test('an uploaded file is read by its name, alone or next to other reads', async () => {
  const calls: string[] = [];
  let decisions = 0;
  const result = await runCoworkReadLoop({
    message: '¿Qué trae la lista que subí?', signal: new AbortController().signal, authorize: async () => {},
    execute: async (action, value) => { calls.push(`${action}:${value}`); return {}; }, record: async () => {},
    decide: async () => {
      decisions++;
      if (decisions === 1) return { action: 'files.read' as const, query: 'leads-feria.csv', leadId: null, answer: null };
      if (decisions === 2) return { action: 'reads.parallel' as const, query: null, leadId: null, answer: null,
        reads: [{ action: 'files.read' as const, input: 'notas.md' }, { action: 'leads.search' as const, input: '' }] };
      return answer;
    },
  });
  assert.equal(result.reply, 'Un contacto encontrado.');
  assert.deepEqual(calls, ['files.read:leads-feria.csv', 'files.read:notas.md', 'leads.search:']);
});

test('options the first answer had come back when the closing correction drops them', async () => {
  const choices = { multiple: true, options: ['RR. HH.', 'Retail'] };
  const first = { ...answer, answer: { reply: 'Tus contactos están en dos segmentos. Marca los que van en la campaña.', document: null, suggestions: null, choices } };
  const fixed = await runCoworkReadLoop({ message: 'Arma una campaña para algunos', signal: new AbortController().signal, authorize: async () => {},
    record: async () => {}, execute: async () => ({}),
    decide: async (_observations, _mustAnswer, rejections = []) => rejections.length
      ? { ...answer, answer: { reply: 'Tus contactos están en dos segmentos.', document: null, question: '¿A qué segmentos va la campaña?', suggestions: null, choices: null } }
      : first });
  assert.equal(fixed.question, '¿A qué segmentos va la campaña?');
  assert.deepEqual('choices' in fixed ? fixed.choices : undefined, choices);
});
