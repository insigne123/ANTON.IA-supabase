// No env-file loading. Live calls require explicit opt-in; no external effects.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { z } from 'zod';
import { axisConversations } from './fixtures/cowork-axis-conversations';
import { coworkCommercialBehavior } from '../src/lib/cowork/commercial-behavior';
import { generateStructuredWithTelemetry } from '../src/ai/openai-json';
import { coworkModelUsage } from '../src/lib/server/cowork/model-usage';
import { applicableCommercialRules, commercialRate, conversationTurn } from '../src/lib/cowork/commercial-facts';

const live = process.argv.includes('--live');
const selection = process.argv.find(arg => arg.startsWith('--cases='))?.slice(8).split(',');
const cases = selection ? axisConversations.filter(c => selection.includes(c.id)) : axisConversations;
assert.equal(new Set(axisConversations.map(c => c.id)).size, 12);
assert.ok(cases.length > 0 && (!selection || cases.length === selection.length), 'Unknown or duplicate case');
for (const c of axisConversations) {
  assert.ok(c.turns.length && c.expected.length && c.capabilities.length);
  assert.ok(JSON.stringify(c.evidence).length < 5000);
  c.mustMention.forEach(pattern => new RegExp(pattern, 'i'));
}
if (live && (!process.env.OPENAI_API_KEY || !process.env.COWORK_MODEL)) throw new Error('Missing explicit model/key');
const schema = z.object({ reply:z.string().max(4000), evidenceUsed:z.array(z.string()).max(12),
  limitations:z.array(z.string()).max(6) }).strict();
const results: unknown[] = [];
let failed = false;
let reservedInput = 0;
let reservedOutput = 0;
for (const c of cases) {
  // Rubrics are never passed to the model. Character bound is a conservative
  // UTF-8 byte token reservation; cap output before each request, no retries.
  let computed: unknown = null;
  if (c.id === '05-referidores') computed = { responseRate:commercialRate(1,40,'emails'),
    distinctManagersContacted:null,recruiterResponseRate:null };
  if (c.id === '07-regla-contextual') computed = { applicableRuleIds:applicableCommercialRules([
    {id:'exclude_assistants_cold_email',kind:'commercial',channels:['email'],goals:['decision_makers']},
    {id:'privacy_suppression',kind:'suppression'},
  ],'linkedin','referrals').map(rule=>rule.id),assistantExclusionApplies:false };
  if (c.id === '03-ya-respondi') {
    const inboundAt = Date.parse('2026-08-04T11:46:00-04:00');
    const outboundAt = Date.parse('2026-08-04T11:55:00-04:00');
    const turn = conversationTurn([
      {id:'in',direction:'inbound',at:'2026-08-04T11:46:00-04:00',kind:'human',confirmed:true},
      {id:'out',direction:'outbound',at:'2026-08-04T11:55:00-04:00',kind:'human',confirmed:true},
    ],{coverageComplete:true,observedAt:'2026-08-04T16:00:00Z',now:'2026-08-04T16:00:00Z',maxAgeMs:60000});
    computed = { ...turn, elapsedHours: Math.round((turn.elapsedHours || 0) * 100) / 100,
      replyGapMinutes: (outboundAt - inboundAt) / 60000 };
  }
  const prompt = JSON.stringify({ turns:c.turns, observations:c.evidence,computed });
  const system = `${coworkCommercialBehavior}\nEvaluación aislada con observaciones suministradas. No has ejecutado herramientas ni acciones. Usa solo esa evidencia y entrega la respuesta al último turno. Las fechas y datos pertenecen al escenario, no al mundo actual. Si se entrega un bloque computed con un cálculo verificado, úsalo literalmente en vez de recalcularlo.`;
  const input = Buffer.byteLength(prompt + system, 'utf8') + 2500;
  if (reservedInput + input > 120000 || reservedOutput + 900 > 12000) { failed=true; break; }
  reservedInput += input; reservedOutput += 900;
  if (!live) { results.push({id:c.id,fixtureValid:true,capabilities:c.capabilities}); continue; }
  try {
    const response = await generateStructuredWithTelemetry({schema,systemPrompt:system,prompt,
      provider:'openai',openAiModel:process.env.COWORK_MODEL,allowDefaultModelFallback:false,
      maxAttempts:1,maxOutputTokens:900,timeoutMs:25000});
    const text = response.data.reply;
    const missing = c.mustMention.filter(pattern => !new RegExp(pattern,'i').test(text));
    // Conservative regression: flag even qualified wording for human review.
    // This cannot turn semantic evaluation into a keyword-only certificate.
    if (c.id === '02-afirmacion' && /alternativa más rentable|la misma función que buscas/i.test(text)) missing.push('unsupported_comparative_copy');
    failed ||= missing.length > 0;
    results.push({id:c.id,lexicalChecksPassed:missing.length===0,missing,answer:response.data,
      rubricForHumanReview:c.expected,usage:coworkModelUsage(response.telemetry)});
  } catch(error) {
    failed=true;
    results.push({id:c.id,error:(error instanceof Error?error.message:'').match(/(?:OPENAI|GLM)_HTTP_\d{3}/)?.[0] || 'generation_failed'});
    break;
  }
}
const report = JSON.stringify({corpus:'axis-conversations-v1',mode:live?'live_with_fixed_observations':'fixture_validation',
  completed:results.length,selected:cases.length,passed:!failed,
  budget:{maxCalls:cases.length,reservedInput,reservedOutput},results,
  limitation:'Lexical checks are screening, not semantic certification. No tool selection, complete history replay, database, browser actions or authenticated end-to-end flow is certified.'},null,2);
const output = process.argv.find(arg => arg.startsWith('--output='))?.slice(9);
if (output) writeFileSync(output, report + '\n', 'utf8');
console.log(report);
if(failed) process.exitCode=1;
