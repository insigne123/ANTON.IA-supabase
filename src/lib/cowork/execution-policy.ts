export type CoworkExecutionMode = 'approval' | 'autonomous';

/** New capabilities require an explicit policy decision, never implicit opt-in. */
const AUTOMATIC_EFFECTS = new Set(['save_contact', 'start_research', 'request_draft', 'enrich_contact', 'campaign_create']);

/** `fromWeb`: the turn that proposed it read the open web. Nothing a page could have steered approves itself: the person decides, as in the other mode. */
export function coworkEffectCanAutoApprove(mode: CoworkExecutionMode, enabled: boolean, kind: string, options: { fromWeb?: boolean } = {}) {
  return mode === 'autonomous' && enabled && AUTOMATIC_EFFECTS.has(kind) && !options.fromWeb;
}

/**
 * The effects a person's own words approve: they spend at most one credit and send nothing. «Sí, investiga a Cristian Heyden antes de
 * escribirle» got a card that never came and a second «¿Investigo a Cristian Heyden…?» (6 Nov 2026): the person had already decided.
 * An order in this message («investiga a…», «investígalo»), or a yes to the previous answer's «¿Investigo a…?», approves the research
 * of this turn. A question («¿lo investigo?»), a «no» or a condition never does: the card waits for the person, as before.
 */
const REQUESTABLE_EFFECTS: Record<string, { orders: RegExp; offered: RegExp }> = {
  start_research: {
    orders: /(?<!\p{L})invest[ií]g(?:a|á|ar|ues|uen|uemos)(?:lo|la|los|las)?(?!\p{L})/iu,
    offered: /^¿\s*(?:lo\s+|la\s+|los\s+|las\s+|te\s+|le\s+)?invest[ií]g(?:o|amos)(?!\p{L})/iu,
  },
};
// «Más tarde», «después», «mañana» or «otro día» put it off: the card waits, it is not done now.
const DECLINES = /(?<!\p{L})(?:no|nunca|todav[íi]a no|a[úu]n no|sin|espera|mejor no|m[áa]s tarde|despu[ée]s|ma[ñn]ana|otro d[íi]a)(?!\p{L})/iu;
const CONDITION = /^\s*(?:si|cuando|en caso)(?!\p{L})(?!\s*[,.!]|\s*$)/iu;
const ACCEPTS = /^\s*(?:s[íi]|dale|ok(?:ey)?|perfecto|listo|bueno|adelante|h[áa]zlo|por favor|porfa)(?!\p{L})/iu;

function closingQuestion(reply: string | null | undefined) {
  const last = String(reply || '').trim().split(/\n\s*\n/).pop()?.trim() || '';
  return /^¿[^?]+\?$/u.test(last) ? last : null;
}

export function coworkRequestApprovesEffect(kind: string, message: string, previousReply?: string | null): boolean {
  const rule = REQUESTABLE_EFFECTS[kind];
  const text = String(message || '').trim();
  if (!rule || !text || text.length > 600 || /\?\s*$/u.test(text) || CONDITION.test(text) || DECLINES.test(text)) return false;
  if (rule.orders.test(text)) return true;
  const offer = closingQuestion(previousReply);
  return Boolean(offer && rule.offered.test(offer) && ACCEPTS.test(text));
}

/** Versioned policy for capabilities that actually exist, enforced outside the model. */
export function coworkExecutionPolicy(mode: CoworkExecutionMode, autonomousEnabled: boolean) {
  const autonomous = mode === 'autonomous' && autonomousEnabled;
  return {
    version: 'cowork-execution/v1' as const,
    effectiveMode: autonomous ? 'autonomous' as const : 'approval' as const,
    automaticExternalSearch: autonomous,
    maxExternalSearchesPerRun: 1,
    maxExternalResults: 25,
    noteRequiresApproval: true,
    automaticEffects: autonomous ? [...AUTOMATIC_EFFECTS] : [],
  };
}

export function assertCoworkModeAvailable(mode: CoworkExecutionMode, enabled: boolean) {
  if (mode === 'autonomous' && !enabled) throw new Error('COWORK_AUTONOMY_UNAVAILABLE');
}
