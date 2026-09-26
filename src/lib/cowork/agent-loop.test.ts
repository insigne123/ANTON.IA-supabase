import assert from 'node:assert/strict';
import test from 'node:test';
import { runCoworkReadLoop } from './agent-loop';

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

test('a proposal without explanation keeps the short default and records no note', async () => {
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
  assert.match(result.reply, /Revisa la propuesta/);
  assert.deepEqual(recorded, ['leads.search']);
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
  assert.match(drafts[0], /pon los correos en document/);
  // A complete answer needs no second call.
  calls = 0;
  await runCoworkReadLoop({ ...base, decide: async () => { calls++; return asked; } });
  assert.equal(calls, 1);
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
});
