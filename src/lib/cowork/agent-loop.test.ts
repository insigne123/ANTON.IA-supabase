import assert from 'node:assert/strict';
import test from 'node:test';
import { coworkCampaignWithExactEmails, coworkDecisionSchema, coworkOfferedRead, coworkWithoutOfferedRead, runCoworkReadLoop, type CoworkObservation, type CoworkRejection } from './agent-loop';
import { coworkCampaignDraftSchema } from './campaign-proposal';
import { COWORK_TURN_DEFAULTS, type CoworkTurnBudget } from './turn-budget';
import { COWORK_NOTE_ACTION, COWORK_PLAN_ACTION } from './contracts';

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

test('the decision that closes the turn hands its summary of the conversation to remember, and a failure to keep it never fails the turn', async () => {
  const memory = { offer: 'Revisión de antecedentes (AXIS)', audience: 'Jefes de RR. HH.', people: [], decisions: [], pending: ['Escribir a Rafael'] };
  const remembered: unknown[] = [];
  let decisions = 0;
  const base = { message: 'Busca logística', signal: new AbortController().signal, authorize: async () => {},
    execute: async () => ({ items: [{ name: 'Ejemplo' }] }), record: async () => {} };
  const result = await runCoworkReadLoop({ ...base,
    decide: async () => (decisions++ === 0 ? { ...search, memory: null } : { ...answer, memory }) as never,
    remember: async value => { remembered.push(value); } });
  assert.equal(result.reply, 'Un contacto encontrado.');
  // Reads carry no memory; the closing decision does (twice here: the closing correction asks for the answer again, the last one wins).
  assert.ok(remembered.length >= 1);
  for (const value of remembered) assert.deepEqual(value, memory);
  const kept = await runCoworkReadLoop({ ...base, decide: async () => ({ ...answer, memory }) as never,
    remember: async () => { throw new Error('table missing'); } });
  assert.equal(kept.reply, 'Un contacto encontrado.');
});

test('reports named in the answer go complete in its document, written by the app from what the turn read, not by the model', async () => {
  const leadId = '00000000-0000-4000-8000-0000000000a1';
  const report = { status: 'completed', caveats: [], truncated: false, sections: [
    { key: 'verdict', title: 'Resumen y decisión', text: 'Vale la pena escribirle.' },
    { key: 'angle', title: 'Cómo usarlo en el correo y los seguimientos', text: 'Idea de primer correo: asunto «antecedentes».' }] };
  let decisions = 0;
  const result = await runCoworkReadLoop({
    message: 'Terminaron las investigaciones que pediste en esta conversación', signal: new AbortController().signal, authorize: async () => {},
    decide: async () => (decisions++ === 0
      ? { action: 'research.get_existing', query: null, leadId, answer: null }
      : { action: 'answer', query: null, leadId: null, answer: { reply: 'Rafael: abrir con la temporada.', document: null,
        reports: [{ leadId, title: 'Rafael Durán · RyD Montajes' }] } }) as never,
    execute: async (action, value) => { assert.equal(action, 'research.get_existing'); return { leadId: value, availability: 'available', reportStatus: 'ready', report }; },
    record: async () => {},
  });
  assert.equal(result.document?.title, 'Informes de la investigación');
  assert.match(result.document?.content || '', /## Rafael Durán · RyD Montajes\n\n### Resumen y decisión\n\nVale la pena escribirle\./);
  assert.match(result.document?.content || '', /### Cómo usarlo en el correo y los seguimientos/);
  assert.equal('reports' in result, false);
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

test('a preference is proposed with its text and scope, without reading first, only when it is on', async () => {
  const preference = { text: 'No le escribo a empresas de la competencia', scope: 'personal' as const };
  const proposal = { action: 'preference.save' as const, query: null, leadId: null, answer: null, preference };
  const proposals: unknown[] = [];
  const base = {
    message: 'Recuerda que no le escribo a empresas de la competencia', runId: '00000000-0000-4000-8000-000000000099',
    signal: new AbortController().signal, authorize: async () => {},
    execute: async () => ({}), record: async () => {},
    proposeEffect: async (value: unknown) => { proposals.push(value); },
  };
  // Off: the decision goes back to the model, which cannot store it.
  await assert.rejects(runCoworkReadLoop({ ...base, decide: async () => proposal }), /Preferences unavailable/);
  assert.equal(proposals.length, 0);
  const result = await runCoworkReadLoop({ ...base, preferences: true, decide: async () => proposal });
  assert.match(result.reply, /Revisa en la tarjeta cómo quedará escrito/);
  assert.equal(proposals.length, 1);
  const sent = proposals[0] as { kind: string; preference: unknown; originRunId: string; targetId: string };
  assert.equal(sent.kind, 'memory_save');
  assert.deepEqual(sent.preference, preference);
  assert.equal(sent.originRunId, base.runId);
  assert.equal(sent.targetId, 'new-preference');
});

test('a request of several steps is proposed as one task plan, only when tasks are on, and a plan that does not add up goes back', async () => {
  const task = { goal: 'Escribirles una secuencia a los 10 mejores gerentes de RR. HH. de retail', limits: { searches: 1, credits: 10 }, steps: [
    { label: 'Buscar 25 gerentes de RR. HH. de retail en Santiago', kind: 'search' as const },
    { label: 'Guardar a los 10 mejores y buscar su correo', kind: 'prepare' as const },
    { label: 'Escribir una secuencia de 3 correos', kind: 'write' as const },
    { label: 'Dejar la campaña pausada con ellos', kind: 'campaign' as const }] };
  const proposal = { action: 'task.plan' as const, query: null, leadId: null, answer: null, task };
  const proposals: unknown[] = [];
  const base = {
    message: 'busca 25 gerentes de RRHH de retail en Santiago, guarda los 10 mejores, búscales el correo y escríbeles una secuencia de 3 correos',
    runId: '00000000-0000-4000-8000-000000000099', signal: new AbortController().signal, authorize: async () => {},
    execute: async () => ({}), record: async () => {}, proposeEffect: async (value: unknown) => { proposals.push(value); },
  };
  await assert.rejects(runCoworkReadLoop({ ...base, decide: async () => proposal }), /Tasks unavailable/);
  assert.equal(proposals.length, 0);
  const result = await runCoworkReadLoop({ ...base, tasks: true, decide: async () => proposal });
  assert.match(result.reply, /los pasos, lo máximo que puede gastar y lo que nunca hará sin preguntarte/);
  const sent = proposals[0] as { kind: string; task: unknown; originRunId: string; targetId: string };
  assert.equal(sent.kind, 'task_plan');
  assert.deepEqual(sent.task, task);
  assert.equal(sent.originRunId, base.runId);
  assert.equal(sent.targetId, 'new-task');
  // A search step without a search to spend is corrected before any card.
  const reasons: string[] = [];
  await runCoworkReadLoop({ ...base, tasks: true, decide: async (_observations, _mustAnswer, rejections = []) => {
    reasons.push(...rejections.map(rejection => rejection.reason));
    return rejections.length ? { action: 'answer' as const, query: null, leadId: null, answer: { reply: 'Listo.', document: null } }
      : { ...proposal, task: { ...task, limits: { searches: 0, credits: 10 } } };
  } });
  assert.match(reasons.join('|'), /El plan no cuadra \(el plan busca prospectos pero limits\.searches es 0\)/);
});

test('a preference already remembered goes back to the model instead of a second card', async () => {
  const proposal = { action: 'preference.save' as const, query: null, leadId: null, answer: null,
    preference: { text: 'No le escribo a empresas de seguridad privada', scope: 'personal' as const } };
  const proposals: unknown[] = [];
  await assert.rejects(runCoworkReadLoop({
    message: 'Recuerda que no le escribo a seguridad privada', runId: '00000000-0000-4000-8000-000000000099', signal: new AbortController().signal,
    authorize: async () => {}, execute: async () => ({}), record: async () => {}, proposeEffect: async value => { proposals.push(value); },
    preferences: true, userContext: { memories: ['No le escribo a empresas de seguridad privada'] }, decide: async () => proposal,
  }), /Preference already remembered/);
  assert.equal(proposals.length, 0);
});

test('a writing turn that also asks to remember something offers to remember it, only with preferences on', async () => {
  const write = { kind: 'email' as const, recipients: null, objective: 'Invitar a una reunión', angle: null, tone: null, steps: null, notes: 'Firma como Nico', findings: null };
  const written = { reply: 'Preparé el correo.', document: null, suggestions: [{ label: 'Ajustar el correo', message: 'Hazlo más corto' }] };
  const base = {
    message: 'escríbeme un correo para los gerentes de retail, y recuerda que siempre firmo como Nico', runId: '00000000-0000-4000-8000-000000000099',
    signal: new AbortController().signal, authorize: async () => {}, execute: async () => ({}), record: async () => {},
    write: async () => written, decide: async () => ({ action: 'draft.write' as const, query: null, leadId: null, answer: null, write }),
  };
  const on = await runCoworkReadLoop({ ...base, preferences: true });
  assert.deepEqual(on.suggestions?.map(chip => chip.message), ['Hazlo más corto', 'Recuerda que siempre firmo como Nico']);
  const off = await runCoworkReadLoop(base);
  assert.deepEqual(off.suggestions?.map(chip => chip.message), ['Hazlo más corto']);
});

test('asked to remember what is already kept, the answer never says it proposes it', async () => {
  const preference = { text: 'No le escribo a empresas de seguridad privada', scope: 'personal' as const };
  let decisions = 0;
  const result = await runCoworkReadLoop({
    message: 'recuerda que no le escribo a empresas de seguridad privada', runId: '00000000-0000-4000-8000-000000000099',
    signal: new AbortController().signal, authorize: async () => {}, execute: async () => ({}), record: async () => {}, proposeEffect: async () => {},
    preferences: true, userContext: { memories: ['No le escribo a empresas de seguridad privada'] },
    decide: async () => (decisions++ === 0
      ? { action: 'preference.save' as const, query: null, leadId: null, answer: null, preference }
      : { action: 'answer' as const, query: null, leadId: null, answer: { reply: 'Propongo guardarla; queda pendiente de tu aprobación. ¿Reviso tus contactos para quitar esas empresas?', document: null } }),
  });
  assert.equal(result.reply, 'Ya lo tengo presente: «No le escribo a empresas de seguridad privada». Lo aplico en tus conversaciones.\n\n¿Reviso tus contactos para quitar esas empresas?');
});

test('a preference without its text goes back to the model', async () => {
  const proposal = { action: 'preference.save' as const, query: null, leadId: null, answer: null, preference: null };
  await assert.rejects(runCoworkReadLoop({
    message: 'Recuerda esto', runId: '00000000-0000-4000-8000-000000000099', signal: new AbortController().signal, authorize: async () => {},
    execute: async () => ({}), record: async () => {}, proposeEffect: async () => {}, preferences: true, decide: async () => proposal,
  }), /Missing preference/);
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

test('a read this account does not have is left out of parallel reads, with its step, and the others run', async () => {
  const executed: string[] = [];
  const recorded: CoworkObservation[] = [];
  let decisions = 0;
  const result = await runCoworkReadLoop({
    message: 'Muéstrame mi pipeline en un gráfico', signal: new AbortController().signal, authorize: async () => {},
    record: async observation => { recorded.push(observation); },
    decide: async observations => {
      if (decisions++ > 0) {
        assert.deepEqual(observations.map(item => item.action), ['crm.search']);
        return answer;
      }
      return { action: 'reads.parallel', query: null, leadId: null, answer: null,
        reads: [{ action: 'opportunities.list', input: '' }, { action: 'crm.search', input: '' }],
        outline: [{ label: 'Reviso tus oportunidades', read: 'opportunities.list' }, { label: 'Reviso las etapas del CRM', read: 'crm.search' },
          { label: 'Armo el gráfico', read: null }] };
    },
    execute: async (action, value) => { executed.push(`${action}:${value}`); return {}; },
  });
  assert.equal(result.reply, 'Un contacto encontrado.');
  assert.deepEqual(executed, ['crm.search:']);
  const plan = recorded.find(item => item.action === COWORK_PLAN_ACTION)?.result as { steps: Array<{ label: string }> } | undefined;
  assert.ok(plan && !plan.steps.some(step => /oportunidades/i.test(step.label)));
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

test('a LinkedIn batch is proposed only when it is on, for saved contacts seen in this thread, with the text each kind needs', async () => {
  const runId = '00000000-0000-4000-8000-000000000010';
  const parentId = '00000000-0000-4000-8000-000000000011';
  const lead = (n: number) => `00000000-0000-4000-8000-0000000000b${n}`;
  const proposals: Array<Record<string, unknown>> = [];
  const notes: string[] = [];
  const found = { scope: 'own_saved_contacts', items: [1, 2, 3].map(n => ({ id: lead(n), name: `Persona ${n}`, company: `Empresa ${n}`, linkedin_url: `https://www.linkedin.com/in/persona-${n}` })) };
  const base = { message: 'Invita a los de la lista', runId, signal: new AbortController().signal, authorize: async () => {},
    record: async (observation: { action: string; result: unknown }) => {
      if (observation.action === COWORK_NOTE_ACTION) notes.push((observation.result as { reply: string }).reply);
    },
    proposeEffect: async (proposal: Record<string, unknown>) => { proposals.push(proposal); } };
  const search = { action: 'leads.search' as const, query: 'lista', leadId: null, answer: null };
  const inviteBatch = (leads: unknown) => ({ action: 'linkedin.invite_batch' as const, query: null, leadId: null, answer: null, linkedinBatch: { leads } as never });
  const messageBatch = (leads: unknown) => ({ action: 'linkedin.message_batch' as const, query: null, leadId: null, answer: null, linkedinBatch: { leads } as never });
  const flow = (decision: unknown) => ({ execute: async () => found, decide: async (observations: unknown[]) => (observations.length ? decision : search) as never });
  const three = [1, 2, 3].map(n => ({ leadId: lead(n) }));
  // Off (the default): refused with the way out, never proposed.
  await assert.rejects(runCoworkReadLoop({ ...base, ...flow(inviteBatch(three)) }), /LinkedIn batch unavailable/);
  assert.equal(proposals.length, 0);
  // On: the contacts read in this turn anchor the proposal to the run that read them; the server names the card, so the label is generic here.
  await runCoworkReadLoop({ ...base, linkedinBatch: true, ...flow(inviteBatch(three)) });
  assert.deepEqual(proposals[0], { kind: 'linkedin_invite_batch', targetId: 'new-linkedin-batch', label: 'Proponer invitaciones en LinkedIn para varias personas',
    originRunId: runId, linkedinBatch: { leads: three } });
  assert.match(notes[0], /Preparé un lote de invitaciones de LinkedIn\. En la tarjeta ves a quién va y puedes quitar a quien no quieras/);
  const texts = [1, 2].map(n => ({ leadId: lead(n), message: `Hola Persona ${n}, gracias por aceptar.` }));
  await runCoworkReadLoop({ ...base, linkedinBatch: true, ...flow(messageBatch(texts)) });
  assert.equal(proposals[1].kind, 'linkedin_message_batch');
  assert.deepEqual(proposals[1].linkedinBatch, { leads: texts });
  assert.match(notes[1], /Preparé un lote de mensajes de LinkedIn, cada uno con su texto/);
  // Read in the previous turn: that turn is the origin.
  const history = [{ runId: parentId, observations: [{ action: 'leads.search', input: 'lista', result: found }] }];
  await runCoworkReadLoop({ ...base, linkedinBatch: true, history, execute: async () => found, decide: async () => inviteBatch(three) as never });
  assert.equal(proposals[2].originRunId, parentId);
  // What the kind cannot take is refused with the reason, before it reaches a card.
  for (const [decision, pattern] of [
    [inviteBatch([{ leadId: lead(1), message: 'Hola' }]), /Las invitaciones van sin nota/],
    [messageBatch([{ leadId: lead(1) }]), /necesita su propio texto/],
    [inviteBatch([{ leadId: lead(1) }, { leadId: lead(1) }]), /repetidas/],
    [{ ...inviteBatch(three), linkedinBatch: null }, /Faltan datos de la propuesta/],
  ] as const) {
    // The model reads the reason in the rejection it gets back, and the turn ends with the same rejection if it insists.
    const feedback: string[] = [];
    await assert.rejects(runCoworkReadLoop({ ...base, linkedinBatch: true, execute: async () => found,
      decide: async (observations, _mustAnswer, rejections) => { if (rejections?.length) feedback.push(JSON.stringify(rejections)); return (observations.length ? decision : search) as never; } }),
    /Invalid LinkedIn batch|Missing/);
    assert.match(feedback.join(' '), pattern);
  }
  // Nothing observed first: no proposal.
  await assert.rejects(runCoworkReadLoop({ ...base, linkedinBatch: true, execute: async () => ({}), decide: async () => inviteBatch(three) as never }), /observed first/);
  assert.equal(proposals.length, 3);
});

test('preparing several people is one proposal: search results and saved contacts seen in this thread, with the goal', async () => {
  const runId = '00000000-0000-4000-8000-000000000010';
  const parentId = '00000000-0000-4000-8000-000000000011';
  const lead = (n: number) => `00000000-0000-4000-8000-0000000000b${n}`;
  const proposals: Array<Record<string, unknown>> = [];
  const notes: string[] = [];
  const found = { scope: 'external_search', items: [1, 2].map(n => ({ id: `apollo:p${n}`, name: `Persona ${n}`, company: `Empresa ${n}` })) };
  const base = { message: 'Guarda a los dos, busca sus correos e investígalos', runId, signal: new AbortController().signal, authorize: async () => {},
    record: async (observation: { action: string; result: unknown }) => {
      if (observation.action === COWORK_NOTE_ACTION) notes.push((observation.result as { reply: string }).reply);
    },
    proposeEffect: async (proposal: Record<string, unknown>) => { proposals.push(proposal); } };
  const prepare = (prepareBatch: unknown) => ({ action: 'contacts.prepare_batch' as const, query: null, leadId: null, answer: null, prepareBatch: prepareBatch as never });
  const people = { goal: 'research', people: [{ providerId: 'apollo:p1' }, { providerId: 'apollo:p2' }, { leadId: lead(1) }] };
  // Read in the previous turn: that turn anchors the proposal; the server checks each person against the whole conversation.
  const history = [{ runId: parentId, observations: [{ action: 'prospecting.search', input: '', result: found }] }];
  // Off: refused with the way out, never proposed.
  await assert.rejects(runCoworkReadLoop({ ...base, history, execute: async () => found, decide: async () => prepare(people) as never }), /Prepare batch unavailable/);
  assert.equal(proposals.length, 0);
  await runCoworkReadLoop({ ...base, prepareBatch: true, history, execute: async () => found, decide: async () => prepare(people) as never });
  assert.deepEqual(proposals[0], { kind: 'lead_prepare_batch', targetId: 'new-prepare-batch', label: 'Preparar contactos', originRunId: parentId, prepareBatch: people });
  assert.match(notes[0], /Preparé un lote para dejar listas a estas personas con una sola aprobación/);
  // What the batch cannot take is refused with the reason, before it reaches a card.
  for (const [decision, pattern] of [
    [prepare({ goal: 'save', people: [{ providerId: 'apollo:p1' }, { providerId: 'apollo:p1' }] }), /repetidas/],
    [prepare({ goal: 'email', people: [{ providerId: 'apollo:p1', leadId: lead(1) }] }), /una de las dos/],
    [prepare({ goal: 'email', people: Array.from({ length: 11 }, (_, n) => ({ providerId: `apollo:x${n}` })) }), /hasta 10 personas/],
    [prepare(null), /Faltan datos de la propuesta/],
  ] as const) {
    const feedback: string[] = [];
    await assert.rejects(runCoworkReadLoop({ ...base, prepareBatch: true, history, execute: async () => found,
      decide: async (_observations, _mustAnswer, rejections) => { if (rejections?.length) feedback.push(JSON.stringify(rejections)); return decision as never; } }),
    /Invalid prepare batch|Missing/);
    assert.match(feedback.join(' '), pattern);
  }
  // Nobody seen in the conversation: no proposal.
  await assert.rejects(runCoworkReadLoop({ ...base, prepareBatch: true, execute: async () => ({}), decide: async () => prepare(people) as never }), /observed first/);
  assert.equal(proposals.length, 1);
});

test('replying in a thread is proposed only when it is on, for a conversation read with replies.thread whose advice is reply', async () => {
  const runId = '00000000-0000-4000-8000-000000000010';
  const parentId = '00000000-0000-4000-8000-000000000011';
  const contactedId = '00000000-0000-4000-8000-000000000021';
  const otherId = '00000000-0000-4000-8000-000000000022';
  const proposals: Array<Record<string, unknown>> = [];
  const notes: string[] = [];
  const thread = (overrides: Record<string, unknown> = {}) => ({ scope: 'own_reply_thread', available: true, contactedId, name: 'Marcela Rojas', company: 'Servicios Norte',
    advice: 'reply', canReplyInThread: true, ...overrides });
  const base = { message: 'Respóndele a Marcela', runId, signal: new AbortController().signal, authorize: async () => {},
    record: async (observation: { action: string; result: unknown }) => {
      if (observation.action === COWORK_NOTE_ACTION) notes.push((observation.result as { reply: string }).reply);
    },
    proposeEffect: async (proposal: Record<string, unknown>) => { proposals.push(proposal); } };
  const read = { action: 'replies.thread' as const, query: null, leadId: contactedId, answer: null };
  const replyThread = { contactedId, subject: 'Re: Antecedentes laborales en minutos', body: 'Hola Marcela,\n\nGracias por responder. ¿Cuántas personas necesitas revisar?' };
  const reply = { action: 'email.reply_thread' as const, query: null, leadId: null, answer: null, replyThread };
  const flow = (result: unknown, decision: unknown = reply) => ({ execute: async () => result,
    decide: async (observations: unknown[]) => (observations.length ? decision : read) as never });
  // Off (the default): refused with the way out, never proposed.
  await assert.rejects(runCoworkReadLoop({ ...base, ...flow(thread()) }), /Reply in thread unavailable/);
  assert.equal(proposals.length, 0);
  // On: the conversation read in this turn anchors the proposal to the run that read it, and the card is named after the person.
  await runCoworkReadLoop({ ...base, replyThread: true, ...flow(thread()) });
  assert.deepEqual(proposals[0], { kind: 'reply_thread', targetId: contactedId, label: 'Responder a Marcela Rojas (Servicios Norte) en su hilo', originRunId: runId, replyThread });
  assert.match(notes[0], /Preparé la respuesta para Marcela Rojas \(Servicios Norte\) y la propongo enviar en su hilo/);
  assert.match(notes[0], /si la apruebas, sale tal cual/);
  // Read in the previous turn: that turn is the origin.
  const history = [{ runId: parentId, observations: [{ action: 'replies.thread', input: contactedId, result: thread() }] }];
  await runCoworkReadLoop({ ...base, replyThread: true, history, execute: async () => thread(), decide: async () => reply });
  assert.equal(proposals[1].originRunId, parentId);
  // Only what the code's advice says takes a reply: another advice, a conversation that is not the person's, or another conversation is refused.
  for (const result of [thread({ advice: 'already_answered' }), thread({ advice: 'unsubscribe_do_not_write' }), thread({ advice: 'closed_politely' }),
    thread({ advice: 'no_reply_yet' }), { scope: 'own_reply_thread', available: false, reason: 'Esa conversación no es tuya o ya no existe.' }, thread({ contactedId: otherId })]) {
    await assert.rejects(runCoworkReadLoop({ ...base, replyThread: true, ...flow(result) }), /Reply conversation must be read first/);
  }
  // Proposed without reading anything first, or without the text of the reply.
  await assert.rejects(runCoworkReadLoop({ ...base, replyThread: true, execute: async () => ({}), decide: async () => reply }), /Reply conversation must be read first/);
  await assert.rejects(runCoworkReadLoop({ ...base, replyThread: true, ...flow(thread(), { ...reply, replyThread: null }) }), /Missing effect target/);
  assert.equal(proposals.length, 2);
});

test('retrying failed sends is proposed only when it is on, for a campaign whose retry review has something to retry', async () => {
  const runId = '00000000-0000-4000-8000-000000000010';
  const parentId = '00000000-0000-4000-8000-000000000011';
  const campaignId = '00000000-0000-4000-8000-000000000031';
  const otherId = '00000000-0000-4000-8000-000000000032';
  const proposals: Array<Record<string, unknown>> = [];
  const notes: string[] = [];
  const review = (overrides: Record<string, unknown> = {}) => ({ scope: 'own_campaign_retry_review', campaignId, summary: { retryable: 3, terminal: 1, reconcileFirst: 1 }, items: [], ...overrides });
  const base = { message: 'Reintenta los envíos que fallaron', runId, signal: new AbortController().signal, authorize: async () => {},
    record: async (observation: { action: string; result: unknown }) => {
      if (observation.action === COWORK_NOTE_ACTION) notes.push((observation.result as { reply: string }).reply);
    },
    proposeEffect: async (proposal: Record<string, unknown>) => { proposals.push(proposal); } };
  const read = { action: 'campaigns.retry_review' as const, query: null, leadId: null, campaignId, answer: null };
  const retry = { action: 'campaign.retry' as const, query: null, leadId: null, campaignId, answer: null };
  const flow = (result: unknown, decision: unknown = retry) => ({ execute: async () => result,
    decide: async (observations: unknown[]) => (observations.length ? decision : read) as never });
  // Off (the default): refused with the way out, never proposed.
  await assert.rejects(runCoworkReadLoop({ ...base, ...flow(review()) }), /Campaign retry unavailable/);
  assert.equal(proposals.length, 0);
  // On: the review read in this turn anchors the proposal to the run that read it, with the campaign as its target.
  await runCoworkReadLoop({ ...base, campaignRetry: true, ...flow(review()) });
  assert.deepEqual(proposals[0], { kind: 'campaign_retry', targetId: campaignId, label: 'Reintentar los envíos fallidos de una campaña', originRunId: runId });
  assert.match(notes[0], /Propongo reintentar los envíos de esa campaña que fallaron/);
  assert.match(notes[0], /sin enviarse dos veces/);
  // Read in the previous turn: that turn is the origin.
  const history = [{ runId: parentId, observations: [{ action: 'campaigns.retry_review', input: campaignId, result: review() }] }];
  await runCoworkReadLoop({ ...base, campaignRetry: true, history, execute: async () => review(), decide: async () => retry });
  assert.equal(proposals[1].originRunId, parentId);
  // Nothing to retry (only terminal or uncertain ones), or another campaign: refused, the retry is never the model's count.
  for (const result of [review({ summary: { retryable: 0, terminal: 2, reconcileFirst: 1 } }), review({ campaignId: otherId }), { error: 'x' }]) {
    await assert.rejects(runCoworkReadLoop({ ...base, campaignRetry: true, ...flow(result) }), /Retry campaign must be reviewed first/);
  }
  // Proposed without reading anything first, or without a campaign.
  await assert.rejects(runCoworkReadLoop({ ...base, campaignRetry: true, execute: async () => ({}), decide: async () => retry }), /Retry campaign must be reviewed first/);
  await assert.rejects(runCoworkReadLoop({ ...base, campaignRetry: true, ...flow(review(), { ...retry, campaignId: null }) }), /Missing effect target/);
  assert.equal(proposals.length, 2);
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

test('a phone reveal is proposed only when it is on, for a contact read in the thread, once, and its note says the cost', async () => {
  const runId = '00000000-0000-4000-8000-000000000010';
  const leadId = '00000000-0000-4000-8000-000000000021';
  const row = { id: leadId, name: 'Paula Ríos', company: 'Transportes del Sur' };
  const proposals: Array<Record<string, unknown>> = [];
  const notes: string[] = [];
  const base = { message: 'Necesito el teléfono de Paula', runId, signal: new AbortController().signal, authorize: async () => {},
    execute: async () => ({ items: [row], scope: 'own_saved_contacts' }),
    record: async (observation: { action: string; result: unknown }) => {
      if (observation.action === COWORK_NOTE_ACTION) notes.push((observation.result as { reply: string }).reply);
    },
    proposeEffect: async (proposal: Record<string, unknown>) => { proposals.push(proposal); } };
  const found = { action: 'leads.search' as const, query: 'Paula', leadId: null, answer: null };
  const phone = { action: 'lead.enrich_phone' as const, query: null, leadId, answer: null };
  const decide = (decision: unknown = phone) => ({ decide: async (observations: unknown[]) => (observations.length ? decision : found) as never });
  // Off (the default): refused with the way out (the email, LinkedIn), never proposed.
  await assert.rejects(runCoworkReadLoop({ ...base, ...decide() }), /Phone reveal unavailable/);
  assert.equal(proposals.length, 0);
  // On: the contact read in this turn anchors the proposal, the card is named after the person and the note says what it costs.
  await runCoworkReadLoop({ ...base, phoneReveal: true, ...decide() });
  assert.deepEqual(proposals[0], { kind: 'enrich_phone', targetId: leadId, label: 'Revelar el teléfono de Paula Ríos (Transportes del Sur)', originRunId: runId });
  assert.match(notes[0], /Propongo pedir el teléfono de Paula Ríos \(Transportes del Sur\) al proveedor: cuesta 10 créditos y es una persona por aprobación/);
  // A contact that was not read in this thread is refused.
  await assert.rejects(runCoworkReadLoop({ ...base, phoneReveal: true, execute: async () => ({}), decide: async () => phone }), /Effect target must be observed first/);
  // The same reveal in the thread is not proposed again: it would spend ten credits more for the same answer.
  const history = [{ runId: '00000000-0000-4000-8000-000000000009', observations: [{ action: 'leads.search', input: 'Paula', result: { items: [row], scope: 'own_saved_contacts' } }],
    actions: [{ kind: 'enrich_phone', label: 'Revelar el teléfono de Paula Ríos (Transportes del Sur)', outcome: 'ejecutada', result: { requested: true } }] } as never];
  await runCoworkReadLoop({ ...base, phoneReveal: true, history, decide: async (_observations, _mustAnswer, rejections = []) => {
    if (!rejections.length) return phone;
    assert.match(rejections[0].reason, /Ya se pidió el teléfono/);
    return { action: 'answer' as const, query: null, leadId: null, answer: { reply: 'Ya pedí su teléfono: llega a tus contactos enriquecidos.', document: null, question: '¿Te muestro tus contactos enriquecidos?', suggestions: [{ label: 'Sí, muéstralos', message: 'Muéstrame mis contactos enriquecidos' }] } };
  } });
  assert.equal(proposals.length, 1);
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
  // With industries the search goes companies first (search-proposal.ts), and the sentence says so.
  assert.deepEqual(notes, [{ action: 'assistant.note', input: '', result: { reply:
    'Propongo buscar empresas del rubro minería y, dentro de ellas, hasta 25 personas con cargos como Gerente de Operaciones o Superintendente, en Antofagasta, Chile. Revisa los criterios antes de aprobar: la búsqueda no guarda contactos ni revela correos.' } }]);
  // A single people search, asked for, keeps its sentence; «Traer más» continues it.
  const single: unknown[] = [];
  await runCoworkReadLoop({
    message: 'Busca gerentes', signal: new AbortController().signal, authorize: async () => {}, execute: async () => ({}),
    record: async observation => { single.push(observation); }, proposeSearch: async () => {},
    decide: async () => ({ action: 'prospecting.propose_search' as const, query: null, leadId: null, answer: null,
      searchCriteria: { strategy: 'people' as const, titles: ['Gerente de Operaciones', 'Superintendente'], industries: ['minería'], locations: ['Antofagasta, Chile'], limit: 25, page: 2 } }),
  });
  assert.equal((single[0] as { result: { reply: string } }).result.reply,
    'Propongo seguir buscando hasta 25 personas con cargos como Gerente de Operaciones o Superintendente, del rubro minería, en Antofagasta, Chile. Revisa los criterios antes de aprobar: la búsqueda no guarda contactos ni revela correos.');
  // Seen with the real model: a repeated industry was named twice («del rubro retail y retail»).
  const repeated: unknown[] = [];
  await runCoworkReadLoop({
    message: 'Busca gerentes de RR. HH. en retail', signal: new AbortController().signal, authorize: async () => {}, execute: async () => ({}),
    record: async observation => { repeated.push(observation); }, proposeSearch: async () => {},
    decide: async () => ({ action: 'prospecting.propose_search' as const, query: null, leadId: null, answer: null,
      searchCriteria: { titles: ['HR Manager', 'hr manager '], industries: ['retail', 'Retail'], locations: ['Santiago, Chile'], limit: 10 } }),
  });
  assert.equal((repeated[0] as { result: { reply: string } }).result.reply,
    'Propongo buscar empresas del rubro retail y, dentro de ellas, hasta 10 personas con cargos como HR Manager, en Santiago, Chile. Revisa los criterios antes de aprobar: la búsqueda no guarda contactos ni revela correos.');
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

test('filler in the campaign field of another action no longer rejects it; on campaign.create its problem goes back', async () => {
  const filler = { name: 'Prospección', objective: '', criteria: {}, emails: ['N/A-no-destinatarios@invalid'], provider: 'google',
    messages: [{ subject: '', body: 'No usar.', delayDays: 0 }], firstEmails: [] };
  // Seen with the real model on a search: the decision used to fail its schema and cost the turn a decision.
  const search = coworkDecisionSchema.parse({ action: 'prospecting.propose_search', query: null, leadId: null, campaign: filler,
    answer: { reply: 'Propongo buscar 25 jefaturas de selección en retail.', document: null },
    searchCriteria: { titles: ['Jefe de Selección'], industries: ['retail'], locations: ['Chile'], limit: 25 } });
  const proposed: unknown[] = [];
  await runCoworkReadLoop({ message: 'https://www.linkedin.com/in/ana', signal: new AbortController().signal, authorize: async () => {}, record: async () => {},
    execute: async () => ({}), proposeSearch: async given => { proposed.push(given); },
    decide: async () => ({ ...search, searchCriteria: { titles: [], industries: [], locations: [], limit: 1, linkedinUrl: 'https://www.linkedin.com/in/ana' } }) });
  assert.equal(proposed.length, 1);
  // The same filler on campaign.create is still a decision to fix, with what is wrong (also after a second parse).
  const reasons: string[] = [];
  const create = coworkDecisionSchema.parse(coworkDecisionSchema.parse({ action: 'campaign.create', query: null, leadId: null, campaign: filler, answer: null }));
  const fixed = { action: 'answer' as const, query: null, leadId: null, answer: { reply: 'Necesito a quién va la campaña.', document: null, question: '¿A quiénes va?' } };
  await runCoworkReadLoop({ message: 'Crea la campaña', signal: new AbortController().signal, authorize: async () => {}, record: async () => {},
    execute: async () => ({ scope: 'own', campaigns: [] }), proposeEffect: async () => { throw new Error('no debe proponer'); },
    decide: async (_observations, _mustAnswer, rejections = []) => { reasons.push(...rejections.map(rejection => rejection.reason)); return reasons.length ? fixed : create; } });
  assert.match(reasons.join('|'), /no cumple el formato \(campaign\.criteria\.relationship: Required;.*campaign\.emails\.0: Invalid email/);
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
  assert.equal(silent.reply, 'Preparé la campaña «AXIS · RR. HH.» para 1 contacto, con 1 correo. Al aprobarla queda guardada sin enviar: nada sale hasta que la actives, y activarla pide otra aprobación.');
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

test('a campaign keeps the first email of each person; the person\'s exact version stays word for word without them', async () => {
  let proposed: { messages: Array<{ body: string }>; firstEmails: Array<{ email: string; body: string }> } | undefined;
  const campaign = { name: 'AXIS · RR. HH.', objective: 'Primera conversación',
    criteria: { relationship: 'never_contacted', titles: [], industries: [], countries: [], sizes: [], seniorities: [], minimumDaysSinceSent: 0, excludeReplied: true, enrichedOnly: false },
    emails: ['fmunoz@securitas.cl', 'cfuentes@adecco.cl'], provider: 'google',
    messages: [{ subject: 'AXIS', body: 'Hola {{nombre}},\nTe escribo por AXIS.\nNicolás', delayDays: 0 }, { subject: '¿Lo vemos?', body: 'Hola {{nombre}},\n¿Te sirve?\nNicolás', delayDays: 2 }],
    firstEmails: [{ email: 'cfuentes@adecco.cl', subject: 'Camila, AXIS para Adecco', body: 'Hola Camila,\nvi que Adecco abrió 40 vacantes.\nNicolás' }] };
  const reply = await runCoworkReadLoop({
    message: 'Arma la campaña para Felipe y Camila', runId: '00000000-0000-4000-8000-0000000000aa', signal: new AbortController().signal,
    authorize: async () => {}, record: async () => {}, execute: async () => ({ scope: 'own', campaigns: [] }),
    proposeEffect: async proposal => { proposed = proposal.campaign; },
    decide: async () => coworkDecisionSchema.parse({ action: 'campaign.create', query: null, leadId: null, campaign, answer: null }),
  });
  assert.deepEqual(proposed?.messages.map(message => message.body.split('\n')[0]), ['Hola {{nombre}},', 'Hola {{nombre}},']);
  assert.deepEqual(proposed?.firstEmails.map(item => [item.email, item.body.split('\n')[0]]), [['cfuentes@adecco.cl', 'Hola Camila,']]);
  assert.match(reply.reply, /El primer correo va escrito para 1 de ellas\. Al aprobarla queda guardada sin enviar/);
  // The person's exact version is never rewritten, and first emails the model wrote would replace it, so they go.
  const exact = coworkCampaignWithExactEmails(coworkCampaignDraftSchema.parse(campaign),
    [{ subject: 'Antecedentes', body: 'Hola,\nEscribí esto yo.', day: 1 }]);
  assert.deepEqual([exact.messages[0].body, exact.firstEmails], ['Hola,\nEscribí esto yo.', []]);
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

test('artifact.create hands the brief to the Designer, whose answer ends the turn; without it the coordinator answers in the chat', async () => {
  const brief = { title: 'Pipeline por etapa', goal: 'Ver cuántos contactos hay en cada etapa.', tables: ['pipeline' as const], previous: null, change: null };
  const create = coworkDecisionSchema.parse({ action: 'artifact.create', query: null, leadId: null, answer: null, design: brief });
  const designed = { reply: 'Armé el tablero del pipeline.', document: null, blocks: null, question: '¿Lo comparo con el mes pasado?',
    suggestions: [{ label: 'Sí', message: 'Sí, compáralo' }] };
  const closed = { action: 'answer' as const, query: null, leadId: null, answer: { reply: 'Tus contactos por etapa, en la tabla.', document: null } };
  const base = { message: 'Muéstrame mi pipeline en un gráfico', signal: new AbortController().signal, authorize: async () => {}, record: async () => {}, execute: async () => ({}) };
  const briefs: unknown[] = [];
  assert.deepEqual(await runCoworkReadLoop({ ...base, decide: async () => create, design: async given => { briefs.push(given); return designed; } }), designed);
  assert.deepEqual(briefs, [brief]);
  // Artifacts off, a Designer that fails, or a decision without its brief: the coordinator hears why and answers itself.
  for (const [decision, designer, reason] of [
    [create, undefined, /no están disponibles/],
    [create, async () => { throw new Error('timeout'); }, /no pudo esta vez \(timeout\)/],
    [{ ...create, design: null }, async () => designed, /sin encargo/],
  ] as const) {
    const reasons: string[] = [];
    const fallback = await runCoworkReadLoop({ ...base, ...(designer ? { design: designer } : {}), decide: async (_observations, _mustAnswer, rejections = []) => {
      reasons.push(...rejections.map(rejection => rejection.reason));
      return rejections.length ? closed : decision;
    } });
    assert.equal(fallback.reply, 'Tus contactos por etapa, en la tabla.');
    assert.match(reasons.join('|'), reason);
  }
  // On the last decision nobody is left to answer: the turn says so and offers to try again, instead of failing.
  const late = await runCoworkReadLoop({ ...base, ceiling: { decisions: 1, reads: 3, softDeadlineMs: 50_000 }, decide: async () => create,
    design: async () => { throw new Error('timeout'); } });
  assert.match(late.reply, /no pude armar el artefacto/);
  assert.equal(late.suggestions?.[0]?.message, 'Inténtalo de nuevo');
  // A turn resumed after the specialists may hand it to the Designer too.
  assert.deepEqual(await runCoworkReadLoop({ ...base, resumedObservations: [{ action: 'crm.search', input: '', result: { items: [] } }],
    decide: async () => create, design: async () => designed }), designed);
});

test('analysis.write hands the question to the Analyst after the reads, whose answer ends the turn; without it the coordinator answers', async () => {
  const brief = { question: '¿Cómo me ha ido este mes?', focus: 'correo contra LinkedIn', notes: null };
  const analyze = coworkDecisionSchema.parse({ action: 'analysis.write', query: null, leadId: null, answer: null, analysis: brief });
  const rates = coworkDecisionSchema.parse({ action: 'metrics.rates', query: 'last_30_days', leadId: null, answer: null });
  const analyzed = { reply: 'Respondieron 4 de 46 contactos por correo, el 8,7 %.', document: null, blocks: null, question: null,
    suggestions: [{ label: 'Ver los que respondieron', message: 'Muéstrame quiénes respondieron' }] };
  const closed = { action: 'answer' as const, query: null, leadId: null, answer: { reply: 'Este mes respondieron 4 personas.', document: null } };
  const base = { message: '¿Cómo me ha ido este mes?', signal: new AbortController().signal, authorize: async () => {}, record: async () => {},
    execute: async () => ({ scope: 'own', sent: 46, replies: 4 }) };
  const seen: unknown[] = [];
  let decisions = 0;
  assert.deepEqual(await runCoworkReadLoop({ ...base, decide: async () => (decisions++ ? analyze : rates),
    analyze: async (given, observations) => { seen.push(given, observations.map(item => item.action)); return analyzed; } }), analyzed);
  assert.deepEqual(seen, [brief, ['metrics.rates']]);
  // Before reading, without the Analyst, with an Analyst that fails or without the brief: the coordinator hears why and answers itself.
  for (const [first, analyst, reason] of [
    [analyze, async () => analyzed, /primero consulta los datos/],
    [rates, undefined, /no está disponible/],
    [rates, async () => { throw new Error('timeout'); }, /no pudo esta vez/],
    [rates, async () => analyzed, /sin encargo/],
  ] as const) {
    const reasons: string[] = [];
    let turn = 0;
    const missingBrief = reason.source === 'sin encargo';
    const fallback = await runCoworkReadLoop({ ...base, ...(analyst ? { analyze: analyst } : {}), decide: async (_observations, _mustAnswer, rejections = []) => {
      reasons.push(...rejections.map(rejection => rejection.reason));
      if (rejections.length) return closed;
      return turn++ === 0 ? first : missingBrief ? { ...analyze, analysis: null } : analyze;
    } });
    assert.equal(fallback.reply, 'Este mes respondieron 4 personas.');
    assert.match(reasons.join('|'), reason);
  }
  // On the last decision nobody is left to answer: the turn says so and offers the request again, instead of failing.
  let last = 0;
  const late = await runCoworkReadLoop({ ...base, ceiling: { decisions: 2, reads: 3, softDeadlineMs: 50_000 }, decide: async () => (last++ ? analyze : rates),
    analyze: async () => { throw new Error('timeout'); } });
  assert.match(late.reply, /No alcancé a terminar el análisis/);
  assert.equal(late.suggestions?.[0]?.message, '¿Cómo me ha ido este mes?');
});

test('an answer that offers a read it could make gets it made, once, with room for it; the offered answer stands if that fails', async () => {
  const offers = { action: 'answer' as const, query: null, leadId: null,
    answer: { reply: 'Tienes 5 contactos guardados.', document: null, question: '¿Reviso a quiénes ya les escribiste?',
      suggestions: [{ label: 'Sí, revísalo', message: 'Sí, revisa a quiénes ya les escribí' }] } };
  const done = { action: 'answer' as const, query: null, leadId: null,
    answer: { reply: 'Tienes 5 contactos guardados; a Marcela ya le escribiste, así que partiría por Felipe y Camila.', document: null,
      question: '¿Les preparo el correo?', suggestions: [{ label: 'Sí, prepáralo', message: 'Sí, prepara el correo para Felipe y Camila' }] } };
  const readSent = { action: 'contacted.search' as const, query: '', leadId: null, answer: null };
  const base = { message: '¿A quién le escribo?', signal: new AbortController().signal, authorize: async () => {}, record: async () => {},
    execute: async () => ({ items: [{ name: 'Marcela Rojas' }] }), offeredReads: true };
  // Off by default (COWORK_OFFERED_READS_ENABLED): the answer is shown as it came.
  let off = 0;
  const shown = await runCoworkReadLoop({ ...base, offeredReads: false, decide: async () => { off++; return offers; } });
  assert.equal(shown.reply, offers.answer.reply);
  assert.equal(off, 1);
  const seen: Array<{ mustAnswer: boolean; reasons: string[] }> = [];
  const verdicts: unknown[] = [];
  const made = await runCoworkReadLoop({ ...base, onCorrection: verdict => verdicts.push(verdict),
    decide: async (_observations, mustAnswer, rejections = []) => {
      seen.push({ mustAnswer, reasons: rejections.map(rejection => rejection.reason) });
      return [offers, readSent][seen.length - 1] ?? done;
    } });
  assert.equal(made.reply, done.answer.reply);
  assert.match(seen[1].reasons.join('|'), /termina ofreciendo una consulta \(«¿Reviso a quiénes ya les escribiste\?»\) que puedes hacer ahora/);
  // The edit adds what the read found and keeps the rest: a «me equivoqué» or a heads-up does not get lost (Plan 13, chat-error).
  assert.match(seen[1].reasons.join('|'), /agrega lo que encuentres y conserva lo demás que ya decía \(lo que reconociste, las cifras, los avisos\)/);
  assert.deepEqual(seen.map(item => item.mustAnswer), [false, false, true], 'after the offered read it answers');
  assert.deepEqual(verdicts, [], 'not reported as a judge correction');
  // Asked once: offering it again, or failing to read, leaves the first answer.
  let again = 0;
  const insists = await runCoworkReadLoop({ ...base, decide: async () => (again++ === 1 ? readSent : offers) });
  assert.equal(insists.reply, offers.answer.reply);
  let broken = 0;
  const failed = await runCoworkReadLoop({ ...base, decide: async () => (broken++ === 0 ? offers : { action: 'answer', query: null, leadId: null, answer: null }) as never });
  assert.equal(failed.reply, offers.answer.reply);
  // A turn that spent its decisions reading gets the two the read needs, up to the ledger's five coordinator calls.
  let late = 0;
  const reads = { action: 'reads.parallel' as const, query: null, leadId: null, answer: null,
    reads: [{ action: 'leads.search' as const, input: 'a' }, { action: 'leads.search' as const, input: 'b' }] };
  const extended = await runCoworkReadLoop({ ...base, decide: async () => [readSent, reads, offers, readSent][late++] ?? done });
  assert.equal(extended.reply, done.answer.reply);
  assert.equal(late, 5);
  // Past those five calls it stands; offers that need approval or write are not reads.
  let later = 0;
  const another = { action: 'leads.search' as const, query: 'c', leadId: null, answer: null };
  const lastOne = await runCoworkReadLoop({ ...base, ceiling: { decisions: 5, reads: 6, softDeadlineMs: 50_000 },
    decide: async () => [readSent, reads, another, offers][later++] ?? done });
  assert.equal(lastOne.reply, offers.answer.reply);
  for (const question of ['¿Busco su correo con el proveedor?', '¿Te redacto la respuesta?', '¿Preparo la campaña pausada?']) {
    let asked = 0;
    const kept = await runCoworkReadLoop({ ...base, decide: async () => { asked++; return { ...offers, answer: { ...offers.answer, question } }; } });
    assert.equal(kept.question, question);
    assert.equal(asked, 1, question);
  }
});

test('a sequence asked with its campaign: the Writer writes it and the same turn proposes the campaign with that exact text', async () => {
  const brief = { kind: 'sequence' as const, recipients: ['Jose'], objective: 'Una reunión sobre AXIS', angle: null, tone: null, steps: 2, notes: null, findings: null, campaign: true };
  const write = coworkDecisionSchema.parse({ action: 'draft.write', query: null, leadId: null, answer: null, write: brief });
  const written = { reply: 'Te dejo la secuencia de 2 correos.', document: null, question: '¿Creo la campaña pausada?', suggestions: [{ label: 'Sí', message: 'Sí, créala' }],
    blocks: [{ type: 'sequence' as const, title: 'Secuencia AXIS', to: ['Jose'], steps: [
      { day: 1, subject: 'AXIS para GrupoExpro', body: 'Hola Jose,\nTexto de la Redactora.\nNicolás' },
      { day: 4, subject: 'Re: AXIS', body: 'Hola Jose,\nSeguimiento.\nNicolás' }] }] };
  const campaign = { name: 'AXIS', objective: 'Primera conversación',
    criteria: { relationship: 'never_contacted', titles: [], industries: [], countries: [], sizes: [], seniorities: [], minimumDaysSinceSent: 0, excludeReplied: true, enrichedOnly: false },
    emails: ['jcastro@grupoexpro.com'], provider: 'google', messages: [{ subject: 'Otro asunto', body: 'Otro texto que el modelo resumió', delayDays: 0 }] };
  const create = coworkDecisionSchema.parse({ action: 'campaign.create', query: null, leadId: null, campaign, answer: { reply: 'Te dejo la campaña pausada.', document: null } });
  const base = { message: 'Escríbele una secuencia de 2 correos a Jose y créala como campaña', runId: '00000000-0000-4000-8000-0000000000aa',
    signal: new AbortController().signal, authorize: async () => {}, record: async () => {}, execute: async () => ({ scope: 'own', campaigns: [] }) };
  const seen: unknown[][] = [];
  const proposed: Array<{ kind: string; campaign?: { messages: Array<{ subject: string; body: string; delayDays: number }> } }> = [];
  const result = await runCoworkReadLoop({ ...base, write: async () => written, proposeEffect: async proposal => { proposed.push(proposal); },
    decide: async observations => { seen.push(observations.map(item => item.action)); return seen.length === 1 ? write : create; } });
  // The coordinator reads the emails (the loop checks the campaigns before proposing, as always).
  assert.deepEqual(seen[1], ['assistant.written']);
  assert.equal(proposed[0].kind, 'campaign_create');
  // The Writer's text goes word for word, spaced by its days.
  assert.deepEqual(proposed[0].campaign?.messages, [
    { subject: 'AXIS para GrupoExpro', body: 'Hola Jose,\nTexto de la Redactora.\nNicolás', delayDays: 0 },
    { subject: 'Re: AXIS', body: 'Hola Jose,\nSeguimiento.\nNicolás', delayDays: 3 }]);
  assert.notEqual(result.reply, written.reply);
  // The coordinator answers instead, or the proposal fails: the Writer's emails are the answer, as before.
  const answered = await runCoworkReadLoop({ ...base, write: async () => written, proposeEffect: async () => {},
    decide: async observations => observations.length ? { action: 'answer' as const, query: null, leadId: null, answer: { reply: 'No hay a quién.', document: null } } : write });
  assert.deepEqual(answered, written);
  const failed = await runCoworkReadLoop({ ...base, write: async () => written, proposeEffect: async () => { throw new Error('El destinatario ya no está disponible.'); },
    decide: async observations => observations.length ? create : write });
  assert.deepEqual(failed, written);
  // Without the campaign asked, on the last decision, or with one email per person, nothing changes.
  for (const options of [
    { decision: coworkDecisionSchema.parse({ ...write, write: { ...brief, campaign: null } }), ceiling: undefined, blocks: written.blocks },
    { decision: write, ceiling: { decisions: 1, reads: 3, softDeadlineMs: 50_000 }, blocks: written.blocks },
    { decision: write, ceiling: undefined, blocks: [
      { type: 'email_draft' as const, title: 'Jose', to: ['Jose'], subject: 'A', body: 'Hola Jose' },
      { type: 'email_draft' as const, title: 'Ana', to: ['Ana'], subject: 'B', body: 'Hola Ana' }] },
  ]) {
    let decisions = 0;
    const plain = await runCoworkReadLoop({ ...base, ...(options.ceiling ? { ceiling: options.ceiling } : {}), write: async () => ({ ...written, blocks: options.blocks }),
      proposeEffect: async () => { throw new Error('no debía proponer'); }, decide: async () => { decisions++; return options.decision; } });
    assert.equal(plain.reply, written.reply);
    assert.equal(decisions, 1);
  }
});

test('the judge reads the final answer once; its correction may read once, and the judged answer stands if it fails', async () => {
  const ask = { action: 'answer' as const, query: null, leadId: null,
    answer: { reply: 'Tienes 5 contactos guardados.', document: null, question: '¿Quieres saber a quiénes ya les escribiste?',
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
    answer: { reply: 'Tienes 5 contactos guardados.', document: null, question: '¿Quieres saber a quiénes ya les escribiste?',
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

test('the summary of your contacts needs no argument: asked without one, it runs instead of costing a decision', async () => {
  const executed: Array<[string, string]> = [];
  const decisions = [
    { action: 'leads.summary' as const, query: null, leadId: null, answer: null },
    { action: 'answer' as const, query: null, leadId: null, answer: { reply: 'Tienes 21 contactos con correo de 256.', document: null,
      question: '¿Armo una campaña pausada para esos 21?', suggestions: [{ label: 'Sí, ármala', message: 'Arma una campaña pausada para mis 21 contactos con correo' }] } },
  ];
  let turn = 0;
  const reasons: string[] = [];
  const answer = await runCoworkReadLoop({ message: '¿Cuántos tienen correo?', signal: new AbortController().signal, authorize: async () => {}, record: async () => {},
    execute: async (action, value) => { executed.push([action, value]); return { withEmail: 21, total: 256 }; },
    decide: async (_observations, _mustAnswer, rejections = []) => { reasons.push(...rejections.map(rejection => rejection.reason)); return decisions[turn++]; } });
  assert.deepEqual(executed, [['leads.summary', '']]);
  assert.equal(answer.reply, 'Tienes 21 contactos con correo de 256.');
  assert.deepEqual(reasons, []);
});

test('a closing correction says how to close: a step that needs approval or a decision, never a read Cowork can make', async () => {
  const flat = { action: 'answer' as const, query: null, leadId: null, answer: { reply: 'Tienes 256 contactos y 21 tienen correo.', document: null,
    question: null, suggestions: [{ label: 'Ver los contactos', message: 'Muéstrame cuáles de mis contactos tienen correo.' }] } };
  const closed = { action: 'answer' as const, query: null, leadId: null, answer: { ...flat.answer, question: '¿Armo una campaña pausada para esos 21?' } };
  const reasons: string[] = [];
  let turn = 0;
  // After a read: a chat answer that read nothing closes on its quick replies (next test).
  await runCoworkReadLoop({ message: '¿Cuántos tienen correo?', signal: new AbortController().signal, authorize: async () => {}, record: async () => {},
    execute: async () => ({}), decide: async (_observations, _mustAnswer, rejections = []) => { reasons.push(...rejections.map(rejection => rejection.reason)); return [search, flat, closed][turn++] ?? closed; } });
  assert.match(reasons.join('|'), /Cierre incompleto: completa answer\.question con la pregunta del siguiente paso \(regla 4\): ofrece el paso que sigue y lleva aprobación/);
  assert.match(reasons.join('|'), /nunca ofrezcas una consulta que puedes hacer tú ahora/);
});

test('a chat answer that read nothing closes on its quick replies, without another call for a question (Plan 13)', async () => {
  const chat = (reply: string, suggestions: Array<{ label: string; message: string }>) => ({ action: 'answer' as const, query: null, leadId: null,
    answer: { reply, document: null, question: null, suggestions } });
  const run = async (first: ReturnType<typeof chat>, withRead = false) => {
    const reasons: string[] = [];
    let calls = 0;
    const result = await runCoworkReadLoop({ message: '¿Cómo escribo un buen asunto?', signal: new AbortController().signal, authorize: async () => {},
      record: async () => {}, execute: async () => ({}), decide: async (_observations, _mustAnswer, rejections = []) => {
        reasons.push(...rejections.map(rejection => rejection.reason));
        calls++;
        if (withRead && calls === 1) return search;
        return rejections.length ? { ...first, answer: { ...first.answer, question: '¿Redacto un correo con estos asuntos?' } } : first;
      } });
    return { reasons, calls, result };
  };
  const advice = chat('Un buen asunto es breve y concreto: «¿Revisión de antecedentes en minutos?».', [
    { label: 'Redactar un correo', message: 'Redacta un correo en frío para gerentes de RR. HH.' }, { label: 'Más asuntos', message: 'Dame cinco asuntos más.' }]);
  // Seen with the real model: the correction cost a call and its question repeated a chip («¿Te preparo más asuntos?»).
  const plain = await run(advice);
  assert.equal(plain.calls, 1);
  assert.deepEqual(plain.reasons, []);
  assert.equal(plain.result.question ?? null, null);
  // After a read the next step is the account's: the question is still asked for.
  assert.match((await run(advice, true)).reasons.join('|'), /completa answer\.question/);
  // Leaving something for later, or a chip that says yes to a question that is not there, still gets the correction.
  assert.match((await run(chat('Tienes 3 contactos sin correo. Después los reviso.', advice.answer.suggestions))).reasons.join('|'), /completa answer\.question/);
  assert.match((await run(chat('Te dejé la secuencia.', [{ label: 'Sí, créala', message: 'Sí, crea la campaña pausada' }]))).reasons.join('|'), /completa answer\.question/);
  // Without quick replies it is not a close: they are asked for, as before.
  assert.match((await run(chat('Un buen asunto es breve.', []))).reasons.join('|'), /respuestas sugeridas/);
});

test('more ways of offering a read are seen; offers that write or need approval are not', () => {
  const offered = (question: string) => coworkOfferedRead({ reply: 'Listo.', question });
  for (const question of ['¿Quieres que te resuma toda la información de tu perfil?', '¿Comparo tus resultados de lunes y martes?',
    '¿Te listo los 21 contactos?', '¿Verifico el dominio?', '¿Te muestro cuáles tienen correo?']) assert.ok(offered(question), question);
  for (const question of ['¿Te redacto el correo?', '¿Busco el correo de los 235 que no lo tienen?', '¿Armo una campaña pausada para esos 21?',
    '¿Cuento con tu aprobación para crearla?', '¿Listo para enviarlo?']) assert.equal(offered(question), null, question);
});

test('an offered read the turn could not make leaves the answer: it closes on its quick replies, never asking permission for it', async () => {
  const chips = [{ label: 'Ver los contactos', message: 'Muéstrame cuáles de mis contactos tienen correo.' }];
  assert.deepEqual(coworkWithoutOfferedRead({ reply: 'Tienes 256 contactos y 21 tienen correo.', question: '¿Te muestro cuáles tienen correo?', suggestions: chips }),
    { reply: 'Tienes 256 contactos y 21 tienen correo.', question: null, suggestions: chips });
  // Also when the model wrote it into the reply: only the asking sentence goes.
  assert.equal(coworkWithoutOfferedRead({ reply: 'En tu perfil figura AXIS. ¿Quieres que revise qué otros datos tienes guardados?',
    question: '¿Quieres que revise qué otros datos tienes guardados?', suggestions: chips }).reply, 'En tu perfil figura AXIS.');
  // A step that needs approval stays, and so does an offer with no quick replies to take its place.
  const approval = { reply: 'Tienes 3 contactos sin correo.', question: '¿Busco sus correos?', suggestions: chips };
  assert.equal(coworkWithoutOfferedRead(approval), approval);
  const alone = { reply: 'Tienes 5 contactos.', question: '¿Reviso a quiénes ya les escribiste?', suggestions: null };
  assert.equal(coworkWithoutOfferedRead(alone), alone);
  // In the loop: offered again after the correction, it leaves; with offered reads off, the answer is shown as it came.
  const offers = { action: 'answer' as const, query: null, leadId: null, answer: { reply: 'Tienes 5 contactos guardados.', document: null,
    question: '¿Reviso a quiénes ya les escribiste?', suggestions: [{ label: 'Ver envíos', message: 'Muéstrame a quiénes ya les escribí' }] } };
  const base = { message: '¿A quién le escribo?', signal: new AbortController().signal, authorize: async () => {}, record: async () => {}, execute: async () => ({}) };
  const insisted = await runCoworkReadLoop({ ...base, offeredReads: true, decide: async () => offers });
  assert.equal(insisted.question, null);
  assert.equal(insisted.reply, 'Tienes 5 contactos guardados.');
  assert.equal((await runCoworkReadLoop({ ...base, offeredReads: false, decide: async () => offers })).question, offers.answer.question);
});

test('a search keeps the place asked for, and one with no place gets the person\'s market (Plan 14, 1)', async () => {
  const base = { signal: new AbortController().signal, authorize: async () => {}, execute: async () => ({}), record: async () => {},
    searchDefaults: { places: ['Chile'], source: 'default' as const } };
  const search = (locations: string[], reply: string | null = null) => ({ action: 'prospecting.propose_search' as const, query: null, leadId: null,
    answer: reply ? { reply, document: null } : null,
    searchCriteria: { strategy: 'people' as const, titles: ['Jefe de Reclutamiento'], industries: [], locations, limit: 25 } });

  // Asked for Chile and proposed with no place: one correction, and the corrected search is the one proposed.
  const proposed: Array<{ locations: string[] }> = [];
  const seen: CoworkRejection[][] = [];
  await runCoworkReadLoop({ ...base, message: 'Busca empresas de Chile y personas de reclutamiento',
    proposeSearch: async criteria => { proposed.push(criteria as unknown as { locations: string[] }); },
    decide: async (_observations, _mustAnswer, rejections = []) => { seen.push(rejections); return rejections.length ? search(['Chile']) : search([]); } });
  assert.match(seen[1]?.[0]?.reason || '', /nombra Chile y la búsqueda no tiene ubicación/);
  assert.deepEqual(proposed.map(item => item.locations), [['Chile']]);

  // Widened on purpose and said so: it stands.
  const widened: Array<{ locations: string[] }> = [];
  await runCoworkReadLoop({ ...base, message: 'jefes de reclutamiento en Calama',
    proposeSearch: async criteria => { widened.push(criteria as unknown as { locations: string[] }); },
    decide: async () => search(['Antofagasta, Chile'], 'En Calama hay pocos: amplié a la región de Antofagasta.') });
  assert.deepEqual(widened.map(item => item.locations), [['Antofagasta, Chile']]);

  // Changed again after the correction: the card shows the criteria, the turn does not spend another decision on it.
  let calls = 0;
  const again: Array<{ locations: string[] }> = [];
  await runCoworkReadLoop({ ...base, message: 'jefes de reclutamiento en Calama',
    proposeSearch: async criteria => { again.push(criteria as unknown as { locations: string[] }); },
    decide: async () => { calls++; return search(['Chile']); } });
  assert.equal(calls, 2);
  assert.deepEqual(again.map(item => item.locations), [['Chile']]);

  // Nobody said where: the market fills it without another call, and the explanation says it once.
  const notes: unknown[] = [];
  const filled: Array<{ locations: string[] }> = [];
  let asked = 0;
  await runCoworkReadLoop({ ...base, message: 'ayúdame a buscar jefes de reclutamiento',
    record: async observation => { notes.push(observation); },
    proposeSearch: async criteria => { filled.push(criteria as unknown as { locations: string[] }); },
    decide: async () => { asked++; return search([], 'Propongo buscar jefes de reclutamiento.'); } });
  assert.equal(asked, 1);
  assert.deepEqual(filled.map(item => item.locations), [['Chile']]);
  assert.deepEqual(notes, [{ action: 'assistant.note', input: '', result: { reply:
    'Propongo buscar jefes de reclutamiento. Busco en Chile porque no dijiste dónde; si es en otro lugar, dímelo.' } }]);

  // On the turn's last decision there is nobody left to correct it: the search goes as proposed.
  const last: Array<{ locations: string[] }> = [];
  await runCoworkReadLoop({ ...base, message: 'gerentes de RRHH en Santiago', ceiling: { ...COWORK_TURN_DEFAULTS, decisions: 1 },
    proposeSearch: async criteria => { last.push(criteria as unknown as { locations: string[] }); },
    decide: async () => search(['Chile']) });
  assert.deepEqual(last.map(item => item.locations), [['Chile']]);
});

test('inside a long task a search keeps the place of the approved plan, not of the automatic message (Plan 14, 1)', async () => {
  const proposed: Array<{ locations: string[] }> = [];
  const seen: CoworkRejection[][] = [];
  await runCoworkReadLoop({ signal: new AbortController().signal, authorize: async () => {}, execute: async () => ({}), record: async () => {},
    message: 'Sigue con el siguiente paso de la tarea.', scopeRequest: 'Escribirles a los gerentes de RR. HH. de retail en Santiago. Buscar 25 gerentes de RR. HH. de retail en Santiago',
    searchDefaults: { places: ['Chile'], source: 'default' },
    proposeSearch: async criteria => { proposed.push(criteria as unknown as { locations: string[] }); },
    decide: async (_observations, _mustAnswer, rejections = []) => {
      seen.push(rejections);
      return { action: 'prospecting.propose_search' as const, query: null, leadId: null, answer: null,
        searchCriteria: { strategy: 'people' as const, titles: ['Gerente de RR. HH.'], industries: [], locations: rejections.length ? ['Santiago, Chile'] : ['Chile'], limit: 25 } };
    } });
  assert.match(seen[1]?.[0]?.reason || '', /nombra Santiago/);
  assert.deepEqual(proposed.map(item => item.locations), [['Santiago, Chile']]);
});

test('a turn about to fail gets one answer from the rescue model instead of an error (Plan 14, 2)', async () => {
  const base = { message: 'revisa mis contactos', signal: new AbortController().signal, authorize: async () => {}, execute: async () => ({ items: [] }), record: async () => {} };
  const read = { action: 'leads.search' as const, query: 'gerente', leadId: null, answer: null };
  const rescueAnswer = { action: 'answer' as const, query: null, leadId: null,
    answer: { reply: 'Revisé tus contactos, pero no alcancé a ordenarlos. ¿Los ordeno por cargo?', document: null } };
  const failures: string[] = [];
  const asked: CoworkRejection[][] = [];

  // Reading until the last decision: the rescue answers with what was read.
  const saved = await runCoworkReadLoop({ ...base, decide: async () => read,
    rescue: async (_observations, rejections, failure) => { asked.push(rejections); failures.push(failure); return rescueAnswer; },
    onRescue: failure => failures.push(`rescued:${failure}`) });
  assert.equal(saved.reply, rescueAnswer.answer.reply);
  assert.deepEqual(failures, ['reads_at_last_decision', 'rescued:reads_at_last_decision']);
  // Without a rescue, or when it cannot answer, the turn fails as before.
  await assert.rejects(runCoworkReadLoop({ ...base, decide: async () => read }), /Cowork tool budget exhausted/);
  await assert.rejects(runCoworkReadLoop({ ...base, decide: async () => read, rescue: async () => null }), /Cowork tool budget exhausted/);
  await assert.rejects(runCoworkReadLoop({ ...base, decide: async () => read, rescue: async () => read }), /Cowork tool budget exhausted/, 'it may only answer');
  await assert.rejects(runCoworkReadLoop({ ...base, decide: async () => read, rescue: async () => { throw new Error('OPENAI_HTTP_500'); } }), /Cowork tool budget exhausted/);

  // A model that times out: the rescue answers on the first decision already.
  const timeout = Object.assign(new Error('The operation timed out.'), { name: 'TimeoutError' });
  let calls = 0;
  const late = await runCoworkReadLoop({ ...base, decide: async () => { calls++; throw timeout; },
    rescue: async (_observations, _rejections, failure) => { assert.equal(failure, 'model_unavailable'); return rescueAnswer; } });
  assert.equal(calls, 1);
  assert.equal(late.reply, rescueAnswer.answer.reply);

  // Never for lost access, budgets or a refused proposal, which have their own message; and only once.
  let rescues = 0;
  const count = async () => { rescues++; return rescueAnswer; };
  for (const error of [Object.assign(new Error('Cowork no está disponible para esta cuenta.'), { name: 'AuthError' }),
    new Error('COWORK_DAILY_MODEL_BUDGET: No se pudo reservar presupuesto para continuar este trabajo.'),
    new Error('Thread effect budget exhausted')]) {
    await assert.rejects(runCoworkReadLoop({ ...base, decide: async () => { throw error; }, rescue: count }), error);
  }
  // The server refused the proposal with its reason on the last decision: «No pude preparar la acción: …» says it best.
  const leadId = '00000000-0000-4000-8000-000000000021';
  await assert.rejects(runCoworkReadLoop({ ...base, runId: '00000000-0000-4000-8000-000000000010', ceiling: { ...COWORK_TURN_DEFAULTS, decisions: 2 }, rescue: count,
    execute: async () => ({ items: [{ id: leadId, name: 'José C.', company: 'GrupoExpro' }], scope: 'own_saved_contacts' }),
    proposeEffect: async () => { throw new Error('El destinatario no es un contacto guardado'); },
    decide: async observations => observations.length
      ? { action: 'lead.enrich' as const, query: null, leadId, answer: null }
      : { action: 'leads.search' as const, query: 'José', leadId: null, answer: null } }),
  (error: Error & { userFacing?: boolean }) => error.userFacing === true);
  assert.equal(rescues, 0);
});

test('a turn that already has an answer keeps it instead of rescuing (Plan 14, 2)', async () => {
  // The closing correction failed on the last decision: the first answer stands, as before, and no rescue call is made.
  let rescues = 0;
  const first = { action: 'answer' as const, query: null, leadId: null, answer: { reply: 'Revisé tus 12 contactos.', document: null } };
  const kept = await runCoworkReadLoop({ message: 'revisa mis contactos', signal: new AbortController().signal, authorize: async () => {},
    execute: async () => ({ items: [] }), record: async () => {}, ceiling: { ...COWORK_TURN_DEFAULTS, decisions: 2 },
    rescue: async () => { rescues++; return null; },
    decide: async (_observations, _mustAnswer, rejections = []) => {
      if (!rejections.length) return first;
      throw Object.assign(new Error('The operation timed out.'), { name: 'TimeoutError' });
    } });
  assert.equal(kept.reply, 'Revisé tus 12 contactos.');
  assert.equal(rescues, 0);
});
