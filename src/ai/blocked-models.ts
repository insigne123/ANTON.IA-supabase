/**
 * The models ANTON.IA never calls, whatever an environment variable, a flag or a caller asks for. The owner ruled out Astra on
 * 6 Oct 2026 and every other expensive tier on 23 Oct 2026, when the Anthropic credits ran out: OpenAI's Sol, Terra and Astra (Luna
 * costs a twentieth of Sol) and Anthropic's Opus and Fable. The same day, when the pilot of the harness was authorised, Sonnet went too
 * («ni Opus ni Sonnet en nada de la app»): what stays is Luna and Haiku, which cost the same.
 * Each place a call goes out checks it, so a setting cannot pick one: the call is skipped for the next allowed model or fails
 * before any request.
 */
// No lookbehind: harness-config.ts imports this and also runs in the browser, where older Safari refuses the whole script over one.
const BLOCKED_MODEL = /astra|(?:^|[^a-z0-9])(?:sol|terra|opus|sonnet|fable|mythos)(?![a-z])/i;

export function isBlockedModel(model: string | null | undefined) {
  return BLOCKED_MODEL.test(String(model ?? ''));
}

export function blockedModelMessage(model: string) {
  return `El modelo ${model} no está permitido en ANTON.IA.`;
}
