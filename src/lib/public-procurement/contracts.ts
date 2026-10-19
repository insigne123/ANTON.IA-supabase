// «Contratos por vencer» (propuesta 11): what a contract that ends looks like on the page and in the pipeline. Pure: the
// server reads the contracts (workspace-market.ts) and the page shows them.
import { opportunityLocalClock } from '@/lib/commercial-opportunities/workspace';
import { formatRut, isPersonRut, moneyLabel } from './market';

export type ExpiringContract = {
  tenderId: number; code: string; name: string; agency: string | null; region: string | null; category: string | null;
  awardedOn: string | null; durationMonths: number | null; endsOn: string | null; amount: number | null; currency: string | null;
  winnerRut: string | null; winnerName: string | null; winners: number; fit: 'alta' | 'media'; reason: string;
};

/** The window read: contracts that ended a month ago (the buyer may be tendering it now) up to 15 months ahead. */
export function contractsWindow(now = new Date()) {
  const day = opportunityLocalClock(now).day;
  const at = (months: number) => { const date = new Date(`${day}T12:00:00Z`); date.setUTCMonth(date.getUTCMonth() + months); return date.toISOString().slice(0, 10); };
  return { from: at(-1), to: at(15) };
}

/** The contract's total in pesos, or null: below $50.000 the file writes a unit price ($1 for contracts paid per unit). */
export function contractTotal(contract: Pick<ExpiringContract, 'amount' | 'currency'>) {
  if (contract.amount === null || !Number.isFinite(contract.amount)) return null;
  return contract.currency && contract.currency !== 'CLP' ? contract.amount : contract.amount >= 50_000 ? contract.amount : null;
}

/** «15 de enero de 2025». */
export const humanDay = (day: string | null | undefined) => day && /^\d{4}-\d{2}-\d{2}/.test(day)
  ? new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${day.slice(0, 10)}T12:00:00Z`)) : null;

/** The opportunity to prepare the renewal: what is bought, who holds it, until when and for how much. */
export function contractOpportunityDraft(contract: ExpiringContract) {
  const amount = contractTotal(contract) === null ? null : moneyLabel(contract.amount, contract.currency);
  return {
    title: `Renovación: ${contract.name}`.slice(0, 500),
    company: (contract.agency || 'Organismo público').slice(0, 300),
    kind: 'commercial' as const,
    description: [
      `${contract.agency || 'El organismo'} adjudicó «${contract.name}» (${contract.code}) a ${contract.winnerName || 'otro proveedor'}${contract.winnerRut && !isPersonRut(contract.winnerRut) ? ` (RUT ${formatRut(contract.winnerRut)})` : ''}${contract.awardedOn ? ` el ${humanDay(contract.awardedOn)}` : ''}${contract.durationMonths ? ` por ${contract.durationMonths} meses` : ''}${amount ? `, por ${amount}` : ''}.`,
      contract.endsOn ? `El contrato vence cerca del ${humanDay(contract.endsOn)}: el organismo suele volver a licitarlo unos meses antes.` : '',
      contract.reason ? `Por qué calza: ${contract.reason}` : '',
      'Conviene conversar antes con el área que usa el servicio y preparar la oferta. La fecha de término es estimada (adjudicación más duración del contrato) y puede cambiar con prórrogas.',
    ].filter(Boolean).join('\n'),
    amount: contract.currency === 'CLP' || !contract.currency ? contractTotal(contract) : null, currency: 'CLP',
  };
}
