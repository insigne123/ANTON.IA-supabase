import type { HiringOpportunityData, OpportunityStatus } from './records';
import { sourceLabel } from './view';

/**
 * The signal of a company that is hiring, written as a fact with its source and its date, ready to cite («publicó 14 avisos de
 * empleo en 30 días, según LinkedIn»). The extension shows it next to a company (server/extension-company.ts). Cowork no longer
 * reads «Oportunidades» (owner's decision, 24 oct 2026: the section has its own assistant and a chat in each opportunity).
 */
export type HiringItem = {
  id: string; company: string; domain: string | null; region: string | null; url: string | null; score: number; reasons: string[];
  status: OpportunityStatus; mine: boolean; ads: number; firstSeenAt: string; lastSeenAt: string; data: HiringOpportunityData;
};

export const OPPORTUNITIES_PAGE = '/opportunities';
const dateFormat = new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/Santiago' });
/** «28 sept 2026», or null without a date. A date without time reads as that day in Chile. */
const day = (value: string | null | undefined) => {
  if (!value) return null;
  const time = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00-03:00` : value);
  return Number.isFinite(time) ? dateFormat.format(new Date(time)).replace('.', '') : null;
};
const list = (items: string[]) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`);

/** «Falabella publicó 14 avisos de empleo en los últimos 30 días (6 de operario y 4 de bodeguero), el último el 28 sept 2026, según LinkedIn». */
export function hiringSignal(item: Pick<HiringItem, 'company' | 'ads' | 'data'>) {
  const roles = item.data.roles.slice(0, 2).map(role => `${role.ads} de ${role.role}`);
  const where = (item.data.publishers.length ? item.data.publishers : item.data.sources.map(sourceLabel)).slice(0, 3);
  const last = day(item.data.lastPostedAt);
  return `${item.company} publicó ${item.ads} ${item.ads === 1 ? 'aviso' : 'avisos'} de empleo en los últimos ${item.data.windowDays} días`
    + (roles.length ? ` (${list(roles)})` : '') + (last ? `, el último el ${last}` : '') + (where.length ? `, según ${list(where)}` : '') + '.';
}
