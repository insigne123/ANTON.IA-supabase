import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';

// A campaign Cowork proposes with only its first email gets its follow-ups before the card exists (6 Nov 2026: the four campaigns it
// created in ten days had none). The database, the audience and the mailbox are in memory; the people and companies are fictional.
async function load(entry: string, stubs: Record<string, string>) {
  const bundle = await build({
    stdin: { contents: entry, loader: 'ts', resolveDir: process.cwd() },
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

type World = { stored: any; upserts: any[]; audience: any[] };
const world: World = { stored: null, upserts: [], audience: [] };
(globalThis as any).__campaignOps = world;

const loaded = load(`export * from './src/lib/server/cowork/campaign-ops';`, {
  '/supabase-admin': `export function getSupabaseAdminClient() { const w = globalThis.__campaignOps; return { from() {
    let row = null;
    const chain = {
      select: () => chain, eq: () => chain,
      upsert: input => { row = input; return chain; },
      maybeSingle: async () => {
        if (row) { w.upserts.push(row); if (!w.stored) { w.stored = row.definition; return { data: { run_id: row.run_id }, error: null }; } return { data: null, error: null }; }
        return { data: w.stored ? { definition: w.stored } : null, error: null };
      },
    };
    return chain;
  } }; }`,
  './access': 'export async function requireCoworkWorkerAccess() {}',
  './runs': 'export async function getCoworkRun() { return null; }',
  '/bulk-campaign-audience': 'export async function loadAudience() { return globalThis.__campaignOps.audience; }',
  '/server/bulk-campaigns': 'export async function saveBulkCampaign() { throw new Error("unused"); } export async function reviewBulkCampaign() { throw new Error("unused"); }',
  '/mail-sender-preference': 'export async function readMailSenderPreference() { return { connected: ["google"], preferred: "google" }; }',
  './research-read': 'export async function readCoworkResearch() { return { availability: "not_found" }; }',
});

const scope = { userId: '00000000-0000-4000-8000-000000000001', organizationId: '00000000-0000-4000-8000-000000000002' };
const RUN = '00000000-0000-4000-8000-000000000003';
const LEAD = '00000000-0000-4000-8000-000000000004';
const person = (email: string, name: string) => ({ email, name, company: 'Constructora Andes Sur', title: 'Gerente de Operaciones', industry: 'Construcción',
  country: 'Chile', size: '200', seniority: 'manager', leadRef: LEAD, lastSentAt: null, contacted: false, replied: false, blockedReason: null, reasons: [], enriched: true });
const one = {
  name: 'Andes Sur · turnos', objective: 'Reunión para cubrir turnos de guardias', emails: ['ana@andessur.example'], provider: 'google',
  criteria: { relationship: 'never_contacted', titles: [], industries: [], countries: [], sizes: [], seniorities: [], minimumDaysSinceSent: 0, excludeReplied: true, enrichedOnly: true },
  messages: [{ subject: 'Turnos en Temuco', body: 'Hola Ana,\n\nVi la faena nueva en Temuco. ¿Lo conversamos 15 minutos?', delayDays: 0 }],
};
const followUps = [
  { subject: 'Turnos de noche', body: 'Hola Ana,\n\nLos turnos de noche suelen quedar sin cubrir primero. ¿Cómo lo resuelven hoy?', delayDays: 3 },
  { subject: 'Un turno de prueba', body: 'Hola Ana,\n\nPodemos partir con un turno de prueba. ¿Te acomoda esta semana?', delayDays: 4 },
  { subject: 'Por ahora', body: 'Hola Ana,\n\nNo te escribo más por ahora; si te sirve más adelante, aquí estoy.', delayDays: 7 },
];
function reset(audience = [person('ana@andessur.example', 'Ana Pérez')]) {
  process.env.BULK_CAMPAIGNS_ENABLED = 'true';
  Object.assign(world, { stored: null, upserts: [], audience });
}

test('a campaign with only its first email is staged with three follow-ups written from it and the person\'s research', async () => {
  reset();
  const { stageCoworkCampaignDefinition } = await loaded;
  const asked: any[] = [];
  const staged = await stageCoworkCampaignDefinition(scope, RUN, one, 'Sí, créala', {
    writeFollowUps: async (input: any) => { asked.push(input); return followUps; },
    readResearch: async (_client: unknown, _scope: unknown, leadId: string) => (leadId === LEAD ? 'Abrió una faena en Temuco en octubre.' : null),
  });
  assert.deepEqual(staged, { recipients: 1, provider: 'google', messages: 4, followUpsAdded: 3 });
  assert.equal(world.stored.messages.length, 4);
  assert.deepEqual(world.stored.messages.map((message: any) => message.delayDays), [0, 3, 4, 7]);
  assert.equal(asked[0].research, 'Abrió una faena en Temuco en octubre.');
  assert.equal(asked[0].recipients, 1);
  assert.deepEqual(asked[0].followUpDelays, [3, 4, 7]);
  assert.equal(asked[0].first.subject, 'Turnos en Temuco');
});

test('«solo un correo» goes without follow-ups, and a failure to write them leaves the campaign as it came', async () => {
  const { stageCoworkCampaignDefinition, COWORK_SINGLE_EMAIL } = await loaded;
  reset();
  let called = 0;
  const single = await stageCoworkCampaignDefinition(scope, RUN, one, 'Créala con un solo correo, sin seguimientos', {
    writeFollowUps: async () => { called += 1; return followUps; },
  });
  assert.equal(called, 0);
  assert.equal(single.messages, 1);
  for (const phrase of ['solo el primer correo', 'sin seguimiento', 'un único correo', 'nada de seguimientos']) assert.equal(COWORK_SINGLE_EMAIL.test(phrase), true, phrase);
  for (const phrase of ['sí, créala', 'mándale el correo y sigue']) assert.equal(COWORK_SINGLE_EMAIL.test(phrase), false, phrase);

  reset();
  const failed = await stageCoworkCampaignDefinition(scope, RUN, one, 'Sí', { writeFollowUps: async () => { throw new Error('timeout'); } });
  assert.equal(failed.messages, 1);
  assert.equal(failed.followUpsAdded, 0);
});

test('for several people the follow-ups greet with {{nombre}}: one with a fixed name is dropped, not sent', async () => {
  const { stageCoworkCampaignDefinition } = await loaded;
  reset([person('ana@andessur.example', 'Ana Pérez'), person('luis@andessur.example', 'Luis Soto')]);
  const several = { ...one, emails: ['ana@andessur.example', 'luis@andessur.example'],
    messages: [{ subject: 'Turnos en Temuco', body: 'Hola {{nombre}},\n\nVi la faena nueva en Temuco. ¿Lo conversamos 15 minutos?', delayDays: 0 }] };
  const asked: any[] = [];
  const staged = await stageCoworkCampaignDefinition(scope, RUN, several, 'Sí', {
    writeFollowUps: async (input: any) => { asked.push(input); return followUps; },
    readResearch: async () => { throw new Error('not for several people'); },
  });
  assert.equal(asked[0].recipients, 2);
  assert.equal(asked[0].research, null, 'the research of one person does not shape everyone\'s follow-ups');
  assert.equal(staged.messages, 1, 'follow-ups saying «Hola Ana» to everyone are not used');
});

test('a retried turn keeps what was staged, follow-ups included, without writing them again', async () => {
  const { stageCoworkCampaignDefinition } = await loaded;
  reset();
  await stageCoworkCampaignDefinition(scope, RUN, one, 'Sí', { writeFollowUps: async () => followUps });
  let again = 0;
  const retried = await stageCoworkCampaignDefinition(scope, RUN, one, 'Sí', { writeFollowUps: async () => { again += 1; return followUps; } });
  assert.equal(again, 0);
  assert.deepEqual(retried, { recipients: 1, provider: 'google', messages: 4, followUpsAdded: 3 });
  await assert.rejects(stageCoworkCampaignDefinition(scope, RUN, { ...one, name: 'Otra campaña' }, 'Sí', { writeFollowUps: async () => followUps }),
    /ya tiene otra definición/);
});

test('after a campaign is created, Cowork proposes activating it right there instead of sending the person to Campañas', async () => {
  const { coworkContinuationAfter, COWORK_CONTINUE_AFTER_CAMPAIGN, COWORK_CONTINUE_AFTER_EFFECT } = await import('@/lib/cowork/continuation-messages');
  assert.equal(coworkContinuationAfter('campaign_create'), COWORK_CONTINUE_AFTER_CAMPAIGN);
  assert.match(COWORK_CONTINUE_AFTER_CAMPAIGN, /propone campaign\.activate/);
  assert.match(COWORK_CONTINUE_AFTER_CAMPAIGN, /No le digas que vaya a Campañas/);
  assert.equal(coworkContinuationAfter('save_contact'), COWORK_CONTINUE_AFTER_EFFECT);
  const { readFileSync } = await import('node:fs');
  const effects = readFileSync('src/lib/server/cowork/effects.ts', 'utf8');
  assert.doesNotMatch(effects, /Actívala cuando quieras desde Campañas/);
  assert.match(effects, /Nada sale hasta que la actives/);
});
