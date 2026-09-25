import { ChevronDown, ShieldCheck, Zap } from 'lucide-react';
import type { CoworkExecutionMode } from '@/lib/cowork/execution-policy';

export const COWORK_MODE_HELP: Record<CoworkExecutionMode, string> = {
  approval: 'Antes de consultar un proveedor o cambiar algo, revisarás la propuesta.',
  autonomous: 'Aprueba por ti búsquedas y efectos exactos dentro de topes estrictos (máximo 3 pasos automáticos y 1 búsqueda externa por hilo). Notas, envíos y campañas siempre pasan por tu revisión.',
};

/** Compact mode picker for the composer. Native select keeps it accessible. */
export function ExecutionMode({ id, value, onChange, disabled }: {
  id: string; value: CoworkExecutionMode; onChange: (value: CoworkExecutionMode) => void; disabled: boolean;
}) {
  const Icon = value === 'autonomous' ? Zap : ShieldCheck;
  return <div className="relative inline-flex items-center" title={COWORK_MODE_HELP[value]}>
    <label htmlFor={id} className="sr-only">Modo de trabajo</label>
    <Icon className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-cw-muted" aria-hidden="true" />
    <select id={id} value={value} disabled={disabled} onChange={event => onChange(event.target.value as CoworkExecutionMode)}
      aria-describedby={`${id}-help`}
      className="h-8 cursor-pointer appearance-none rounded-lg border border-transparent bg-transparent pl-7 pr-7 text-[13px] font-medium text-cw-muted hover:bg-cw-hover hover:text-cw-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cw-accent-ring)] disabled:opacity-50">
      <option value="approval">Con aprobaciones</option>
      <option value="autonomous">Autónomo</option>
    </select>
    <ChevronDown className="pointer-events-none absolute right-2 h-3.5 w-3.5 text-cw-muted" aria-hidden="true" />
    <span id={`${id}-help`} className="sr-only">{COWORK_MODE_HELP[value]}</span>
  </div>;
}
