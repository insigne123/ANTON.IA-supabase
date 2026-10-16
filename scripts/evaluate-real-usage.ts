// «Evaluación con uso real» (src/lib/usage-eval/core.ts): grades each section by what people did in production and reads their
// Cowork conversations, without emails, phones or RUTs, optionally graded by a judge model with the battery's rubric.
// Read-only: it calls the two service-role usage RPCs and selects cowork_runs and cowork_run_events; it never writes.
// Explicit opt-in only. Never loads env files: the service key and, with --judge, the model key come from the environment.
//
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//   node --loader ./scripts/ts-test-loader.mjs scripts/evaluate-real-usage.ts --read-production \
//     --from=2026-10-01 --to=2026-10-16 (--orgs=uuid,uuid | --all) --output=dir \
//     [--people] [--exclude-domains=yago.cl] [--judge --judge-model=gpt-6-sol --max-calls=60]
//
// --people adds the per-person table (enrichments first) with names: share that report only with each team's own lead.
// --exclude-domains leaves internal accounts (the owner, QA) out of the usage numbers; their Cowork conversations still count.
// The output directory gets report.md and data.json (pseudonymous ids, redacted text).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import type { CreditDay, UsageFact } from '../src/lib/admin/usage';
import { coworkRunIsAutomatic } from '../src/lib/server/cowork/runs';
import { generateStructuredWithTelemetry } from '../src/ai/openai-json';
import { COWORK_JUDGE_INSTRUCTIONS, COWORK_JUDGE_NOW_RULE, coworkJudgePrompt, coworkJudgeSchema, coworkShownFromAnswer } from '../src/lib/cowork/judge';
import {
  buildRealConversations, conversationSignals, peopleUsage, renderRealUsageReport, sectionHealth,
  type JudgedTurn, type RealEvent, type RealRun,
} from '../src/lib/usage-eval/core';

const arg = (name: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const flag = (name: string) => process.argv.includes(`--${name}`);
const DAY = /^\d{4}-\d{2}-\d{2}$/;

async function main() {
  if (!flag('read-production')) throw new Error('Requires --read-production: this reads real usage.');
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment.');
  const from = arg('from'), to = arg('to'), output = arg('output');
  if (!from || !to || !DAY.test(from) || !DAY.test(to) || from > to) throw new Error('Requires --from=YYYY-MM-DD and --to=YYYY-MM-DD.');
  if (!output) throw new Error('Requires --output=dir.');
  const excluded = (arg('exclude-domains') || '').split(',').map(item => item.trim().toLowerCase()).filter(Boolean);
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const orgQuery = client.from('organizations').select('id,name');
  const orgRows = flag('all') ? await orgQuery : await orgQuery.in('id', (arg('orgs') || '').split(',').filter(Boolean));
  if (orgRows.error) throw orgRows.error;
  const organizations = (orgRows.data || []) as Array<{ id: string; name: string }>;
  if (!organizations.length) throw new Error('No organizations: pass --orgs=uuid,... or --all.');
  const ids = organizations.map(org => org.id);

  const members = await client.from('organization_members').select('organization_id,user_id').in('organization_id', ids);
  if (members.error) throw members.error;
  const names = await client.rpc('admin_usage_member_names_v1', { p_orgs: ids });
  if (names.error) throw names.error;
  const identity = new Map(((names.data || []) as Array<{ id: string; email: string; name: string }>).map(user => [user.id, user]));
  const internal = (userId: string | null) => {
    const email = userId ? identity.get(userId)?.email?.toLowerCase() || '' : '';
    return excluded.some(domain => email.endsWith(`@${domain}`));
  };

  const usage = await client.rpc('admin_usage_report_v1', { p_orgs: ids, p_from: from, p_to: to, p_user: null, p_group: null, p_horizon: 30, p_legacy: false });
  if (usage.error) throw usage.error;
  const payload = usage.data as { facts: UsageFact[]; credits: CreditDay[]; captureFrom: string | null };
  const facts = payload.facts.filter(fact => !internal(fact.userId)), credits = payload.credits.filter(credit => !internal(credit.userId));

  // Cowork: the period's runs and their events, paged.
  const runs: RealRun[] = [];
  for (let page = 0; ; page++) {
    const result = await client.from('cowork_runs').select('id,user_id,organization_id,message,status,created_at,parent_run_id,root_run_id,request_id')
      .in('organization_id', ids).gte('created_at', `${from}T00:00:00-03:00`).lte('created_at', `${to}T23:59:59-03:00`)
      .order('created_at', { ascending: true }).range(page * 500, page * 500 + 499);
    if (result.error) throw result.error;
    for (const row of result.data || []) runs.push({ id: row.id, userId: row.user_id, organizationId: row.organization_id, message: row.message || '',
      status: row.status, createdAt: row.created_at, parentRunId: row.parent_run_id, rootRunId: row.root_run_id, automatic: coworkRunIsAutomatic(row) });
    if ((result.data || []).length < 500) break;
  }
  const events: RealEvent[] = [];
  for (let index = 0; index < runs.length; index += 100) {
    const result = await client.from('cowork_run_events').select('run_id,kind,payload,created_at')
      .in('run_id', runs.slice(index, index + 100).map(run => run.id))
      .in('kind', ['run.completed', 'run.failed', 'run.cancelled', 'approval.requested', 'effect.completed', 'tool.completed']);
    if (result.error) throw result.error;
    for (const row of result.data || []) events.push({ runId: row.run_id, kind: row.kind, payload: row.payload, createdAt: row.created_at });
  }
  const conversations = buildRealConversations(runs, events);

  // Optional judge: each answer the person read, with the battery's rubric, by a model that did not write it.
  const judged: JudgedTurn[] = [];
  if (flag('judge')) {
    const judgeModel = arg('judge-model'), maxCalls = Number(arg('max-calls'));
    if (!process.env.OPENAI_API_KEY || !judgeModel) throw new Error('--judge requires OPENAI_API_KEY and --judge-model.');
    if (!Number.isInteger(maxCalls) || maxCalls < 1 || maxCalls > 400) throw new Error('--judge requires --max-calls=1..400.');
    outer: for (const conversation of conversations) {
      const history: Array<{ request: string; reply: string }> = [];
      for (const turn of conversation.turns) {
        if (judged.length >= maxCalls) break outer;
        if (!turn.reply || turn.automatic) { if (turn.reply) history.push({ request: turn.request, reply: turn.reply }); continue; }
        // The answer as the chat drew it (cards included) and every read of the turn within the judge's budget.
        const shown = coworkShownFromAnswer({ ...(turn.answer as Parameters<typeof coworkShownFromAnswer>[0]), reply: turn.reply });
        const prompt = coworkJudgePrompt({ request: turn.request, history, evidence: { now: new Date(turn.at) }, observations: turn.observations,
          shown: { ...shown, proposal: turn.approvals[0] ? { kind: 'aprobación', label: turn.approvals[0], note: null } : null } });
        try {
          const response = await generateStructuredWithTelemetry({ schema: coworkJudgeSchema, systemPrompt: [COWORK_JUDGE_INSTRUCTIONS, COWORK_JUDGE_NOW_RULE].join('\n'),
            prompt, openAiModel: judgeModel, allowDefaultModelFallback: false, provider: 'openai', maxAttempts: 2, timeoutMs: 60000, maxOutputTokens: 1200 });
          judged.push({ conversationId: conversation.id, runId: turn.runId, at: turn.at, scores: response.data.scores, veredicto: response.data.veredicto, problemas: response.data.problemas });
        } catch (error) {
          console.error(`judge failed on ${turn.runId}: ${error instanceof Error ? error.message : error}`);
        }
        history.push({ request: turn.request, reply: turn.reply });
      }
    }
  }

  const memberIds = (org: string) => (members.data || []).filter(row => row.organization_id === org && !internal(row.user_id)).map(row => row.user_id as string);
  const report = renderRealUsageReport({
    from, to, coverageFrom: payload.captureFrom, conversations, judged,
    organizations: organizations.map(org => {
      const people = memberIds(org.id);
      const orgFacts = facts.filter(fact => fact.organizationId === org.id), orgCredits = credits.filter(credit => credit.organizationId === org.id);
      const active = new Set([...orgFacts.filter(fact => fact.actor === 'user' || fact.kind !== 'module_opened').map(fact => fact.userId),
        ...orgCredits.filter(credit => credit.net > 0).map(credit => credit.userId)].filter((id): id is string => Boolean(id) && people.includes(id!))).size;
      return { id: org.id, name: org.name, members: people.length, active, health: sectionHealth({ facts: orgFacts, credits: orgCredits, activePeople: active }),
        ...(flag('people') ? { people: peopleUsage({ facts: orgFacts, credits: orgCredits,
          people: people.map(id => ({ id, name: identity.get(id)?.name || identity.get(id)?.email?.split('@')[0] || 'Persona' })) }) } : {}) };
    }),
  });

  // data.json keeps pseudonymous ids: «Persona N» per user, never an email.
  const pseudonym = new Map<string, string>();
  const alias = (id: string) => pseudonym.get(id) || (pseudonym.set(id, `Persona ${pseudonym.size + 1}`), pseudonym.get(id)!);
  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, 'report.md'), report);
  writeFileSync(join(output, 'data.json'), JSON.stringify({ from, to, coverageFrom: payload.captureFrom, judged,
    conversations: conversations.map(conversation => ({ ...conversation, userId: alias(conversation.userId), signals: conversationSignals(conversation) })) }, null, 2));
  console.log(`${conversations.length} conversaciones, ${judged.length} juzgadas → ${join(output, 'report.md')}`);
}

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
