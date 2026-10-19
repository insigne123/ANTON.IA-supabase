import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';

// «Llamadas y LinkedIn» with the database, the model and the transcription in memory.
async function load(entry: string) {
  const stubs: Record<string, string> = {
    '@/ai/openai-json': 'export async function generateStructured(input){ (globalThis.__calls ||= []).push(input); return globalThis.__answer(input) }',
    '@/lib/server/crm-autopilot': 'export async function syncLeadAutopilotToCrm(client, update){ (globalThis.__crm ||= []).push(update) }',
  };
  const bundle = await build({
    stdin: { contents: `export * from '${entry}';`, loader: 'ts', resolveDir: process.cwd() },
    bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external',
    plugins: [{ name: 'stubs', setup(builder) {
      const filter = new RegExp(`(${Object.keys(stubs).map(name => name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')).join('|')})$`);
      builder.onResolve({ filter }, args => ({ path: args.path, namespace: 'stub' }));
      builder.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ loader: 'js', contents: stubs[Object.keys(stubs).find(name => args.path.endsWith(name))!] }));
    } }],
  });
  const compiled: { exports: any } = { exports: {} };
  new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), compiled, compiled.exports);
  return compiled.exports;
}

/** The tables in memory, with the query methods the module uses. */
function memory(seed: Record<string, any[]>) {
  const tables: Record<string, any[]> = { contact_touches: [], ...seed };
  let serial = 0;
  const from = (name: string) => {
    const filters: Array<(row: any) => boolean> = [];
    let action: { kind: string; values?: any; conflict?: string[]; ignore?: boolean; count?: boolean } = { kind: 'select' };
    let one: 'single' | 'maybe' | null = null; let limit = Infinity; let returning = false;
    const run = () => {
      const rows = tables[name] ||= [];
      if (action.kind === 'upsert' || action.kind === 'insert') {
        const values = (Array.isArray(action.values) ? action.values : [action.values]).map((value: any) => ({ id: `${name}-${++serial}`, state: 'open', created_at: new Date().toISOString(), ...value }));
        const written: any[] = [];
        for (const value of values) {
          const clash = action.conflict && rows.find(row => action.conflict!.every(key => row[key] === value[key]));
          if (clash) { if (!action.ignore) Object.assign(clash, value); continue; }
          rows.push(value); written.push(value);
        }
        return { data: one ? written[0] ?? null : written, error: null };
      }
      const found = rows.filter(row => filters.every(filter => filter(row)));
      if (action.kind === 'update') { found.forEach(row => Object.assign(row, action.values)); return { data: returning ? (one ? found[0] ?? null : found) : null, error: null }; }
      if (action.count) return { data: null, error: null, count: found.length };
      const page = found.slice(0, limit);
      if (one === 'single') return page.length ? { data: page[0], error: null } : { data: null, error: { code: 'PGRST116' } };
      if (one === 'maybe') return { data: page[0] ?? null, error: null };
      return { data: page, error: null };
    };
    const chain: any = {
      select: (_columns?: string, options?: { count?: string; head?: boolean }) => { if (options?.head) action.count = true; if (action.kind !== 'select') returning = true; return chain; },
      insert: (values: any) => { action = { kind: 'insert', values }; return chain; },
      upsert: (values: any, options: any) => { action = { kind: 'upsert', values, conflict: options?.onConflict?.split(','), ignore: options?.ignoreDuplicates }; return chain; },
      update: (values: any) => { action = { kind: 'update', values }; return chain; },
      eq: (key: string, value: any) => { filters.push(row => row[key] === value); return chain; },
      in: (key: string, values: any[]) => { filters.push(row => values.includes(row[key])); return chain; },
      gte: (key: string, value: any) => { filters.push(row => row[key] !== null && row[key] !== undefined && String(row[key]) >= String(value)); return chain; },
      not: (key: string, _op: string, _value: null) => { filters.push(row => row[key] !== null && row[key] !== undefined); return chain; },
      order: () => chain,
      limit: (n: number) => { limit = n; return chain; },
      single: () => { one = 'single'; return chain; },
      maybeSingle: () => { one = 'maybe'; return chain; },
      then: (resolve: any, reject: any) => Promise.resolve().then(run).then(resolve, reject),
    };
    return chain;
  };
  return { tables, client: { from } as any };
}

const scope = { organizationId: 'org-1', userId: 'u-1' };
const contact = (id: string, sentAt: string, extra: Record<string, unknown> = {}) => ({ id, organization_id: 'org-1', user_id: 'u-1', lead_id: `lead-${id}`,
  name: `Persona ${id}`, email: `${id}@empresa.cl`, company: 'Retail Sur', role: 'Jefa de Selección', industry: 'Retail', subject: 'Antecedentes de postulantes',
  sent_at: sentAt, replied_at: null, conversation_resolved_at: null, bounced_at: null, status: 'sent', delivery_status: null, data: {}, conversation_close_outcome: null, ...extra });
const profile = (cadence: unknown) => ({ id: 'u-1', full_name: 'Nicolás Yarur', company_name: 'AXIS', signatures: { touches: cadence, profile_extended: { valueProposition: 'Verificamos antecedentes judiciales.' } } });
const cadence = { call: { on: true, day: 3 }, linkedin: { on: true, day: 1 }, since: '2026-10-10' };

test('«Hoy» creates the touches whose day came, a call only with a phone, and cancels what an answer made unnecessary', async () => {
  const { readTouches } = await load('./src/lib/server/touches');
  const { client, tables } = memory({
    profiles: [profile(cadence)],
    contacted_leads: [
      contact('a', '2026-10-15T13:00:00Z'),
      contact('b', '2026-10-15T13:00:00Z', { replied_at: '2026-10-16T10:00:00Z' }),
      contact('c', '2026-10-18T13:00:00Z'),
      contact('d', '2026-10-05T13:00:00Z'),
    ],
    enriched_leads: [{ organization_id: 'org-1', email: 'a@empresa.cl', primary_phone: '+56 9 1234 5678', phone_numbers: [], linkedin_url: 'https://www.linkedin.com/in/persona-a' }],
    leads: [],
  });
  const now = new Date('2026-10-19T15:00:00Z');
  const first = await readTouches(client, scope, now);
  assert.deepEqual(tables.contact_touches.map(row => `${row.contacted_id}:${row.rule_key}`).sort(), ['a:call:3', 'a:linkedin:1', 'c:linkedin:1'],
    'b answered, c has no phone for a call yet, d was written to before the cadence');
  assert.deepEqual(first.touches.map((touch: any) => `${touch.contact.contactedId}:${touch.channel}`), ['a:call', 'a:linkedin', 'c:linkedin'], 'calls first, then oldest due first');
  const call = first.touches.find((touch: any) => touch.channel === 'call');
  assert.equal(call.contact.tel, 'tel:+56912345678');
  assert.deepEqual(call.contact.linkedin, { href: 'https://www.linkedin.com/in/persona-a', search: false });
  assert.equal(first.touches.find((touch: any) => touch.contact.contactedId === 'c').contact.linkedin.search, true, 'without a profile, a search');

  // A answers: what was left for A is cancelled the next time «Hoy» opens.
  tables.contacted_leads[0].replied_at = '2026-10-19T16:00:00Z';
  const second = await readTouches(client, scope, now);
  assert.deepEqual(second.touches.map((touch: any) => touch.contact.contactedId), ['c']);
  assert.deepEqual(tables.contact_touches.filter(row => row.contacted_id === 'a').map(row => [row.state, row.reason]), [['cancelled', 'replied'], ['cancelled', 'replied']]);
  // Nothing is created twice.
  await readTouches(client, scope, now);
  assert.equal(tables.contact_touches.length, 3);
});

test('without a cadence it only says whether the person writes to people; a week late a touch leaves', async () => {
  const { readTouches } = await load('./src/lib/server/touches');
  const empty = memory({ profiles: [profile(undefined)], contacted_leads: [contact('a', '2026-10-15T13:00:00Z')] });
  const result = await readTouches(empty.client, scope, new Date('2026-10-19T15:00:00Z'));
  assert.deepEqual([result.cadence, result.touches.length, result.writesToPeople], [null, 0, true]);
  const late = memory({ profiles: [profile(cadence)], contacted_leads: [contact('a', '2026-10-11T13:00:00Z')], enriched_leads: [], leads: [] });
  const old = await readTouches(late.client, scope, new Date('2026-10-19T15:00:00Z'));
  assert.deepEqual(old.touches, []);
  assert.deepEqual(late.tables.contact_touches.map(row => [row.rule_key, row.state, row.reason]), [['linkedin:1', 'skipped', 'expired']], 'due on the 12th, eight days ago');
});

test('«Hecho» needs what happened in the channel; the script is prepared once and kept', async () => {
  const { finishTouch, prepareTouchScript, saveTouchCadence } = await load('./src/lib/server/touches');
  const { client, tables } = memory({ profiles: [profile(cadence)], contacted_leads: [contact('a', '2026-10-15T13:00:00Z')],
    contact_touches: [{ id: 't1', organization_id: 'org-1', user_id: 'u-1', contacted_id: 'a', rule_key: 'call:3', channel: 'call', state: 'open', due_at: '2026-10-18T13:00:00Z', script: null }] });
  await assert.rejects(finishTouch(client, scope, 't1', { action: 'done', outcome: 'connected' }), /Elige qué pasó/);
  (globalThis as any).__calls = [];
  (globalThis as any).__answer = () => ({ opening: 'Hola, soy Nicolás de AXIS.', questions: ['¿Cómo revisan hoy los antecedentes?'], voicemail: 'Te escribo de nuevo por correo.' });
  const prepared = await prepareTouchScript(client, scope, 't1');
  assert.equal(prepared.script.opening, 'Hola, soy Nicolás de AXIS.');
  assert.match((globalThis as any).__calls[0].prompt, /Persona a, Jefa de Selección, Retail Sur/);
  assert.match((globalThis as any).__calls[0].prompt, /hace 3 días/);
  await prepareTouchScript(client, scope, 't1');
  assert.equal((globalThis as any).__calls.length, 1, 'kept, not asked again');
  await prepareTouchScript(client, scope, 't1', { fresh: true });
  assert.equal((globalThis as any).__calls.length, 2, '«Otra versión» asks again');
  assert.deepEqual(await finishTouch(client, scope, 't1', { action: 'done', outcome: 'voicemail', note: ' Volver a llamar el jueves ' }), { id: 't1', state: 'done' });
  assert.deepEqual([tables.contact_touches[0].outcome, tables.contact_touches[0].note], ['voicemail', 'Volver a llamar el jueves']);

  const saved = await saveTouchCadence(client, scope, { call: { on: true, day: 5 }, linkedin: { on: false, day: 1 }, phone: '+56912345678' }, new Date('2026-10-19T15:00:00Z'));
  assert.deepEqual(saved.cadence, { call: { on: true, day: 5 }, linkedin: { on: false, day: 1 }, since: '2026-10-10', phone: '+56912345678' });
  assert.ok(tables.profiles[0].signatures.profile_extended, 'the rest of the signatures stay');
});

test('a recording becomes the call summary on its task and a note with the next step in the CRM', async () => {
  const { attachCallRecording } = await load('./src/lib/server/touch-calls');
  const { client, tables } = memory({ profiles: [profile(cadence)], contacted_leads: [contact('a', '2026-10-15T13:00:00Z')],
    contact_touches: [{ id: 't1', organization_id: 'org-1', user_id: 'u-1', contacted_id: 'a', rule_key: 'call:3', channel: 'call', state: 'open', due_at: '2026-10-18T13:00:00Z' }],
    unified_crm_data: [{ id: 'lead_saved|lead-a', organization_id: 'org-1', notes: 'Prefiere que le escriban los lunes.' }] });
  const sent: any[] = [];
  const fakeFetch = (async (url: string, init: any) => { sent.push({ url, form: init.body }); return new Response(JSON.stringify({ text: 'Hola Paula, te llamo por el correo de antecedentes. Sí, nos interesa, agendemos una demo el jueves.' }), { status: 200 }); }) as any;
  (globalThis as any).__crm = [];
  (globalThis as any).__answer = () => ({ summary: 'Le interesa revisar antecedentes de postulantes.', agreements: ['Demo el jueves'], nextSteps: [{ text: 'Enviar invitación a la demo', due: '2026-10-23' }],
    objections: [], interest: 'alto', meetingAgreed: true });
  const result = await attachCallRecording(client, scope, 't1', { bytes: new TextEncoder().encode('audio').buffer, name: 'llamada.m4a', type: 'audio/x-m4a', durationSeconds: 312.4, note: 'Decide la gerenta.' },
    { fetch: fakeFetch, env: { OPENAI_API_KEY: 'sk-test', TOUCHES_MODEL: 'claude-haiku-5-5' }, now: new Date('2026-10-19T15:00:00Z') });
  assert.equal(sent[0].url, 'https://api.openai.com/v1/audio/transcriptions');
  assert.equal(sent[0].form.get('model'), 'gpt-4o-mini-transcribe');
  assert.equal(sent[0].form.get('language'), 'es');
  assert.equal(result.summary.durationSeconds, 312);
  assert.deepEqual([tables.contact_touches[0].state, tables.contact_touches[0].outcome, tables.contact_touches[0].note], ['done', 'talked', 'Decide la gerenta.'], 'a recorded call was a conversation, with the note typed before');
  assert.equal(result.crm, true, 'the card says it is in the CRM only when the contact is there');
  assert.equal(tables.contact_touches[0].call_summary.interest, 'alto');
  const crm = (globalThis as any).__crm[0];
  assert.equal(crm.leadId, 'lead-a');
  assert.equal(crm.stage, 'meeting', 'a meeting agreed suggests the stage; the person confirms it');
  assert.equal(crm.nextActionDueAt, '2026-10-23T12:00:00.000Z');
  assert.match(crm.notes, /^Llamada \(19 oct\): Le interesa/);
  assert.match(crm.notes, /Tu nota: Decide la gerenta\.\n\nPrefiere que le escriban los lunes\.$/, 'the call goes on top of the notes written before, never over them');
  assert.equal(crm.nextActionType, 'call_follow_up');

  await assert.rejects(attachCallRecording(client, scope, 't1', { bytes: new ArrayBuffer(0), name: 'x.m4a', type: 'audio/x-m4a' }), /vacío/);
  await assert.rejects(attachCallRecording(client, scope, 't1', { bytes: new TextEncoder().encode('x').buffer, name: 'notas.pdf', type: 'application/pdf' }), /Sube un audio/);
});

test('the Twilio bridge stays off without its settings, escapes what it says and checks Twilio’s signature', async () => {
  const { bridgeConfig, bridgeTwiml, e164, twilioSignature, validTwilioSignature, fetchRecording } = await load('./src/lib/server/call-bridge');
  assert.equal(bridgeConfig({}), null);
  const env = { CALL_BRIDGE_ENABLED: 'true', TWILIO_ACCOUNT_SID: `AC${'a'.repeat(32)}`, TWILIO_AUTH_TOKEN: 'token-de-prueba-123456', TWILIO_FROM_NUMBER: '+56229999999' };
  assert.deepEqual(bridgeConfig(env), { sid: env.TWILIO_ACCOUNT_SID, token: env.TWILIO_AUTH_TOKEN, from: env.TWILIO_FROM_NUMBER });
  assert.equal(bridgeConfig({ ...env, CALL_BRIDGE_ENABLED: 'false' }), null);
  assert.equal(e164('+56 9 1234 5678'), '+56912345678');
  assert.equal(e164('912345678'), '+56912345678', 'a Chilean mobile without the country code');
  assert.equal(e164('22345'), null);
  const twiml = bridgeTwiml({ contactPhone: '+56912345678', contactName: 'Paula <script>', from: '+56229999999', recordingCallback: 'https://app.example/api/touches/twilio/recording?touch=1&x=2' });
  assert.match(twiml, /Paula &lt;script&gt;/);
  assert.match(twiml, /record="record-from-answer-dual"/);
  assert.match(twiml, /touch=1&amp;x=2/);
  assert.match(twiml, /pedirle permiso para grabar/);
  const params = { RecordingSid: `RE${'b'.repeat(32)}`, RecordingStatus: 'completed', RecordingUrl: 'https://api.twilio.com/x' };
  const url = 'https://app.example/api/touches/twilio/recording?touch=1';
  const signature = twilioSignature(env.TWILIO_AUTH_TOKEN, url, params);
  assert.equal(validTwilioSignature(env.TWILIO_AUTH_TOKEN, url, params, signature), true);
  assert.equal(validTwilioSignature(env.TWILIO_AUTH_TOKEN, url, { ...params, RecordingStatus: 'absent' }, signature), false);
  assert.equal(validTwilioSignature(env.TWILIO_AUTH_TOKEN, url, params, null), false);
  assert.equal(await fetchRecording(bridgeConfig(env)!, 'https://evil.example/recording'), null, 'only Twilio’s own host');
});
