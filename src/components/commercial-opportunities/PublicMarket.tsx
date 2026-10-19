'use client';

// «Mercado público»: the admin's view of what the State will buy (Plan Anual de Compras), the contracts that end and will
// be tendered again, and the competitors. One view with three parts, so the section keeps four views at the top.
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { PurchasePlanDemand } from './PurchasePlanDemand';
import { ExpiringContracts } from './ExpiringContracts';
import { CompetitorRadar } from './CompetitorRadar';

const PARTS = [['demand', 'Demanda futura'], ['contracts', 'Contratos por vencer'], ['competitors', 'Competidores']] as const;
type Part = typeof PARTS[number][0];
const KEY = 'anton.opportunities.market-part';

export function PublicMarket({ onOpen, onCriteria, onProfile }: { onOpen: (id: string) => void; onCriteria?: () => void; onProfile?: () => void }) {
  const [part, setPart] = useState<Part>('demand');
  // The part last seen comes back, in this browser only.
  useEffect(() => { try { const saved = window.localStorage.getItem(KEY); if (PARTS.some(([key]) => key === saved)) setPart(saved as Part); } catch { /* private mode */ } }, []);
  const choose = (next: Part) => { setPart(next); try { window.localStorage.setItem(KEY, next); } catch { /* private mode */ } };
  return <div className="space-y-5">
    <div role="tablist" aria-label="Mercado público" className="flex flex-wrap gap-1 border-b pb-2">
      {PARTS.map(([key, label]) => <button key={key} type="button" role="tab" id={`market-tab-${key}`} aria-selected={part === key} aria-controls={`market-panel-${key}`}
        onClick={() => choose(key)}
        className={cn('rounded-lg px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', part === key ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground')}>{label}</button>)}
    </div>
    <div role="tabpanel" id={`market-panel-${part}`} aria-labelledby={`market-tab-${part}`}>
      {part === 'demand' ? <PurchasePlanDemand onOpen={onOpen} onCriteria={onCriteria} />
        : part === 'contracts' ? <ExpiringContracts onOpen={onOpen} onCriteria={onCriteria} />
          : <CompetitorRadar onProfile={onProfile} />}
    </div>
  </div>;
}
