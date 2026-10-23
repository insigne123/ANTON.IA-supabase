import type { StructuredTelemetry } from '@/ai/openai-json';
export type OpportunityRole = 'screen' | 'extract' | 'specialist' | 'report' | 'chat';
/** Every role is Haiku, the report's writer included: Sonnet is out of the app (src/ai/blocked-models.ts), and Luna can be named instead. */
export function opportunityModel(role: OpportunityRole, env: Record<string,string|undefined> = process.env) {
  const wanted = env[`OPPORTUNITIES_${role.toUpperCase()}_MODEL`] || 'claude-haiku-5-5';
  if (!['claude-haiku-5-5','gpt-6-luna'].includes(wanted)) throw new Error('El modelo configurado no está permitido para Oportunidades.');
  return wanted;
}
export function opportunityUsageCost(telemetry: StructuredTelemetry, price: { input:number;output:number;cache:number;write:number }) {
  const u = telemetry.usage as any;
  const input=u?.prompt_tokens, output=u?.completion_tokens;
  const cached=u?.prompt_tokens_details?.cached_tokens??0;
  const write=u?.cache_creation_input_tokens??u?.prompt_tokens_details?.cache_creation_tokens??0;
  if (![input,output,cached,write].every(v=>Number.isSafeInteger(v)&&v>=0)||input===0||cached+write>input) return null;
  return Math.ceil((input-cached-write)*price.input+output*price.output+cached*price.cache+write*price.write);
}
