// A period written in a contacted.search query («últimos 7 días», «esta semana», «last_7_days»). The read looked for
// that text in names, emails, companies and subjects, found nothing, and Cowork answered «¿cómo voy?» without knowing
// to whom the user wrote. Now the period filters by send date and the rest of the query still searches as before.
export type CoworkSentPeriod = { days: number; rest: string };

const PERIODS: Array<[RegExp, (match: RegExpMatchArray) => number]> = [
  [/(?:últimos|ultimos|pasados)\s+(\d{1,3})\s+d[ií]as/i, match => Number(match[1])],
  [/last_(\d{1,3})_days/i, match => Number(match[1])],
  [/(?:últimos|ultimos)\s+siete\s+d[ií]as|(?:esta|la\s+última|la\s+ultima|última|ultima)\s+semana/i, () => 7],
  [/(?:últimos|ultimos)\s+treinta\s+d[ií]as|(?:este|el\s+último|el\s+ultimo|último|ultimo)\s+mes/i, () => 30],
  [/(?:^|\s)hoy(?=\s|$)/i, () => 1],
];
// Words left around the period that would otherwise become a text filter: «en los últimos 7 días», «envíos de esta semana».
const EDGE_WORDS = new Set(['en', 'de', 'del', 'durante', 'desde', 'los', 'las']);
const ONLY_SENDS = /^(?:(?:mis|tus|los|las)\s+)?(?:env[ií]os|enviados|correos(?:\s+enviados)?|contactados|mensajes)$/i;

export function coworkSentPeriod(query: string): CoworkSentPeriod | null {
  for (const [pattern, daysOf] of PERIODS) {
    const match = query.match(pattern);
    if (!match) continue;
    const days = daysOf(match);
    if (!days || days > 365) return null;
    const words = query.replace(match[0], ' ').split(/\s+/).filter(Boolean);
    while (words.length && EDGE_WORDS.has(words[0].toLowerCase())) words.shift();
    while (words.length && EDGE_WORDS.has(words[words.length - 1].toLowerCase())) words.pop();
    const rest = words.join(' ');
    return { days, rest: ONLY_SENDS.test(rest) ? '' : rest };
  }
  return null;
}
