/** Pure stage-8 builders: DNS record evaluation, bounce-cause diagnosis and
 * sender-identity contrast. Live lookups stay in the server readers with an
 * injectable resolver so unit tests never touch the network. */

export const BOUNCE_RATE_THRESHOLD = 0.02;
export const DKIM_SELECTORS = ['google', 'default', 'selector1', 'selector2', 'k1', 'mail', 'email', 'mandrill', 's1', 's2'] as const;

export type CheckStatus = 'pass' | 'warn' | 'fail' | 'unknown';
export type RecordCheck = { status: CheckStatus; detail: string; raw?: string | null };

const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;

/** Strict domain validation: nothing but a bare domain ever reaches DNS. */
export function normalizeDomain(value: unknown): string | null {
  const domain = String(value || '').trim().toLowerCase().replace(/\.$/, '');
  if (!DOMAIN_RE.test(domain)) return null;
  return domain;
}

function firstTxt(records: string[][]): string | null {
  for (const record of records || []) {
    const joined = record.join('');
    if (joined) return joined.slice(0, 2000);
  }
  return null;
}

export function evaluateSpf(records: string[][]): RecordCheck {
  const spfRecords = (records || []).map((record) => record.join('')).filter((text) => /^v=spf1/i.test(text.trim()));
  if (!spfRecords.length) return { status: 'fail', detail: 'Sin registro SPF: cualquiera puede suplantar el dominio.', raw: firstTxt(records) };
  if (spfRecords.length > 1) return { status: 'fail', detail: 'Más de un registro SPF: los receptores lo invalidan (permerror).', raw: spfRecords[0] };
  const spf = spfRecords[0];
  const all = spf.match(/(^|\s)([+\-~?])all(\s|$)/);
  const includes = (spf.match(/include:/gi) || []).length + (spf.match(/redirect=/gi) || []).length;
  if (includes > 8) return { status: 'warn', detail: `SPF con ${includes} includes: cerca del límite de 10 consultas DNS.`, raw: spf };
  if (!all) return { status: 'warn', detail: 'SPF sin mecanismo all: el descarte queda ambiguo.', raw: spf };
  const qualifier = all[2];
  if (qualifier === '-') return { status: 'pass', detail: 'SPF estricto (-all).', raw: spf };
  if (qualifier === '~') return { status: 'warn', detail: 'SPF en softfail (~all): autoriza pero no exige descarte.', raw: spf };
  if (qualifier === '?') return { status: 'warn', detail: 'SPF neutral (?all): no protege contra suplantación.', raw: spf };
  return { status: 'fail', detail: 'SPF con +all: autoriza a todo el mundo.', raw: spf };
}

export function evaluateDmarc(records: string[][]): RecordCheck {
  const dmarc = (records || []).map((record) => record.join('')).find((text) => /^v=dmarc1/i.test(text.trim()));
  if (!dmarc) return { status: 'fail', detail: 'Sin DMARC: sin política ante suplantación.', raw: firstTxt(records) };
  const policy = dmarc.match(/(^|;)\s*p\s*=\s*(none|quarantine|reject)/i)?.[2]?.toLowerCase();
  if (policy === 'reject') return { status: 'pass', detail: 'DMARC con p=reject.', raw: dmarc };
  if (policy === 'quarantine') return { status: 'pass', detail: 'DMARC con p=quarantine.', raw: dmarc };
  if (policy === 'none') return { status: 'warn', detail: 'DMARC en p=none: solo monitorea, no actúa.', raw: dmarc };
  return { status: 'fail', detail: 'DMARC sin política válida.', raw: dmarc };
}

export function evaluateDkim(foundSelector: string | null, tried: number): RecordCheck {
  if (foundSelector) return { status: 'pass', detail: `DKIM publicado (selector ${foundSelector}).`, raw: `v=DKIM1; s=${foundSelector}` };
  return { status: 'unknown', detail: `Sin DKIM en ${tried} selectores comunes: un selector personalizado seguiría siendo posible.`, raw: null };
}

export function evaluateMx(count: number): RecordCheck {
  if (count > 0) return { status: 'pass', detail: `MX publicado (${count}).`, raw: null };
  return { status: 'warn', detail: 'Sin MX: el dominio no recibe correo (enviar sigue siendo posible).', raw: null };
}

export type DomainReport = {
  domain: string;
  checkedAt: string;
  source: 'live' | 'cache';
  mx: RecordCheck;
  spf: RecordCheck;
  dmarc: RecordCheck;
  dkim: RecordCheck;
  overall: CheckStatus;
};

export function summarizeDomain(input: { domain: string; checkedAt: string; source: 'live' | 'cache'; mx: RecordCheck; spf: RecordCheck; dmarc: RecordCheck; dkim: RecordCheck }): DomainReport {
  const checks = [input.mx, input.spf, input.dmarc, input.dkim];
  const overall: CheckStatus = checks.some((check) => check.status === 'fail') ? 'fail'
    : checks.some((check) => check.status === 'warn' || check.status === 'unknown') ? 'warn' : 'pass';
  return { ...input, overall };
}

export type BounceCause = {
  category: string;
  count: number;
  share: number | null;
  action: 'do_not_contact_fix_email' | 'review_deliverability' | 'retry_later' | 'monitor';
};

const CAUSE_ACTIONS: Record<string, BounceCause['action']> = {
  mailbox_not_found: 'do_not_contact_fix_email',
  domain_error: 'do_not_contact_fix_email',
  left_company: 'do_not_contact_fix_email',
  policy_block: 'review_deliverability',
  mailbox_full: 'retry_later',
  temporary_failure: 'retry_later',
  generic: 'monitor',
};

export function diagnoseBounces(input: { categories: Array<string | null | undefined>; sent: number }): {
  sent: number; bounces: number; rate: number | null; threshold: number;
  verdict: 'above_threshold' | 'below_threshold' | 'no_data';
  causes: BounceCause[];
} {
  const counts = new Map<string, number>();
  for (const category of input.categories) {
    const key = String(category || 'generic');
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const bounces = [...counts.values()].reduce((sum, count) => sum + count, 0);
  const rate = input.sent > 0 ? bounces / input.sent : null;
  return {
    sent: input.sent, bounces, rate, threshold: BOUNCE_RATE_THRESHOLD,
    verdict: bounces === 0 ? 'no_data' : rate !== null && rate > BOUNCE_RATE_THRESHOLD ? 'above_threshold' : 'below_threshold',
    causes: [...counts.entries()]
      .map(([category, count]) => ({ category, count, share: bounces > 0 ? count / bounces : null, action: CAUSE_ACTIONS[category] || 'monitor' }))
      .sort((a, b) => b.count - a.count),
  };
}

export function recipientDomain(email?: string | null): string | null {
  const match = String(email || '').trim().toLowerCase().match(/@([a-z0-9.-]+\.[a-z]{2,})$/i);
  return match?.[1] || null;
}

export function topRecipientDomains(emails: Array<string | null | undefined>, limit = 5): Array<{ domain: string; count: number }> {
  const counts = new Map<string, number>();
  for (const email of emails) {
    const domain = recipientDomain(email);
    if (domain) counts.set(domain, (counts.get(domain) || 0) + 1);
  }
  return [...counts.entries()].map(([domain, count]) => ({ domain, count }))
    .sort((a, b) => b.count - a.count).slice(0, limit);
}

function authResult(header: string, method: 'spf' | 'dkim' | 'dmarc'): 'pass' | 'fail' | 'unknown' {
  const match = String(header || '').toLowerCase().match(new RegExp(`${method}\\s*=\\s*(pass|fail|softfail|neutral|temperror|permerror|none)`));
  if (!match) return 'unknown';
  return match[1] === 'pass' ? 'pass' : match[1] === 'none' || match[1] === 'neutral' ? 'unknown' : 'fail';
}

export type SenderSample = {
  messageId: string | null;
  subject: string | null;
  sentAt: string | null;
  from: string | null;
  returnPath: string | null;
  auth: { spf: 'pass' | 'fail' | 'unknown'; dkim: 'pass' | 'fail' | 'unknown'; dmarc: 'pass' | 'fail' | 'unknown' };
  identity: 'matches_profile' | 'differs_from_profile' | 'unverified';
  note: string | null;
};

/** Declared profile identity vs the headers the provider actually stamped. */
export function contrastSender(input: {
  profileEmail?: string | null; profileDomain?: string | null;
  from?: string | null; returnPath?: string | null; authHeader?: string | null;
  messageId?: string | null; subject?: string | null; sentAt?: string | null;
}): SenderSample {
  const from = String(input.from || '').trim().toLowerCase();
  const profileEmail = String(input.profileEmail || '').trim().toLowerCase();
  const fromEmail = from.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i)?.[0]?.toLowerCase() || null;
  const auth = {
    spf: authResult(input.authHeader || '', 'spf'),
    dkim: authResult(input.authHeader || '', 'dkim'),
    dmarc: authResult(input.authHeader || '', 'dmarc'),
  };
  let identity: SenderSample['identity'] = 'unverified';
  let note: string | null = 'Sin identidad declarada para contrastar.';
  if (fromEmail && profileEmail) {
    if (fromEmail === profileEmail) {
      identity = 'matches_profile';
      note = null;
    } else {
      const profileDomain = String(input.profileDomain || '').trim().toLowerCase();
      const fromDomain = fromEmail.split('@')[1];
      identity = 'differs_from_profile';
      note = profileDomain && fromDomain !== profileDomain
        ? `Sale desde ${fromEmail}, fuera del dominio declarado ${profileDomain}: revisar suplantación o cuenta compartida.`
        : `Sale desde ${fromEmail} y no desde ${profileEmail}: confirmar cuál cuenta debe enviar.`;
    }
  } else if (fromEmail && !profileEmail) {
    identity = 'unverified';
    note = 'Hay remitente observado pero el perfil no declara email.';
  }
  return {
    messageId: input.messageId || null, subject: input.subject || null, sentAt: input.sentAt || null,
    from: fromEmail, returnPath: String(input.returnPath || '').trim().toLowerCase() || null,
    auth, identity, note,
  };
}
