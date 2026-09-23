/** Deterministic auto-reply detection (stage 6.2). Headers first: a provider
 * header is evidence even when the body is empty or ambiguous. Body patterns
 * stay conservative so a terse human reply is never labeled automatic. The
 * sender address alone never decides. */

export type HeaderLike = { name?: unknown; value?: unknown } | Record<string, string>;

function headerEntries(headers: unknown): Array<[string, string]> {
  if (!headers) return [];
  if (Array.isArray(headers)) {
    return headers
      .map((header) => [
        String((header as { name?: unknown })?.name || '').toLowerCase(),
        String((header as { value?: unknown })?.value || '').toLowerCase(),
      ] as [string, string])
      .filter(([name]) => name.length > 0);
  }
  if (typeof headers === 'object') {
    return Object.entries(headers as Record<string, string>).map(([name, value]) => [name.toLowerCase(), String(value || '').toLowerCase()]);
  }
  return [];
}

function headerValue(entries: Array<[string, string]>, name: string) {
  return entries.filter(([key]) => key === name).map(([, value]) => value).join(' ');
}

/** Provider headers that prove an automatic message. Returns the reason or null. */
export function detectAutoReplyHeaders(headers: unknown): string | null {
  const entries = headerEntries(headers);
  if (!entries.length) return null;
  const autoSubmitted = headerValue(entries, 'auto-submitted');
  if (autoSubmitted && autoSubmitted !== 'no') return `auto-submitted:${autoSubmitted.split(';')[0].trim() || 'yes'}`;
  const suppress = headerValue(entries, 'x-auto-response-suppress');
  if (/(autoreponder|ooto|ofo|autoreply)/.test(suppress.replace(/[-_]/g, ''))) return 'x-auto-response-suppress';
  const precedence = headerValue(entries, 'precedence');
  if (/^(bulk|list|junk|auto_reply)$/.test(precedence.trim())) return `precedence:${precedence.trim()}`;
  if (headerValue(entries, 'x-autoreply') || headerValue(entries, 'x-autorespond')) return 'x-autoreply';
  if (/^(auto-replied|auto-generated)$/.test(headerValue(entries, 'x-ms-exchange-autoresponse').trim())) return 'x-ms-exchange-autoresponse';
  return null;
}

const AUTO_REPLY_BODY_PATTERNS: RegExp[] = [
  /out of office|out-of-office|fuera de la oficina|fuera de oficina/i,
  /respuesta autom[aá]tica|automatic reply|automated response|auto[-\s]?reply/i,
  /estoy de vacaciones|vacation|on leave|licencia (maternal|paternal|m[eé]dica)|de vacaciones hasta/i,
  /i (am|will be) (out of|away from|unavailable)|currently out of|back on/i,
  /no estar[eé] disponible|estar[eé] ausente|ausente hasta|regreso el/i,
  /this is an automated|este es un mensaje autom[aá]tico|no responda a este mensaje/i,
  /do not reply|do-not-reply|no-reply@[a-z0-9.-]+/i,
  /your message has been received and (i will|we will)|hemos recibido tu mensaje/i,
  /i['’]ll (get back|respond|reply)|me pondr[eé] en contacto a mi regreso/i,
  /for (urgent|immediate) (matters|assistance),?\s*(please )?contact/i,
  /para asuntos urgentes/i,
];

export function matchesAutoReplyBody(text?: string | null): boolean {
  const body = String(text || '').slice(0, 4000);
  if (!body.trim()) return false;
  return AUTO_REPLY_BODY_PATTERNS.some((pattern) => pattern.test(body));
}

export function detectAutoReply(input: { headers?: unknown; subject?: string | null; text?: string | null }): { matched: boolean; reason: string | null; source: 'headers' | 'body' | null } {
  const headerReason = detectAutoReplyHeaders(input.headers);
  if (headerReason) return { matched: true, reason: headerReason, source: 'headers' };
  const body = `${String(input.subject || '')}\n${String(input.text || '')}`;
  if (matchesAutoReplyBody(body)) return { matched: true, reason: 'body-pattern', source: 'body' };
  return { matched: false, reason: null, source: null };
}
