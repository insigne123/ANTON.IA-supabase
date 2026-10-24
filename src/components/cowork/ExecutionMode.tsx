import { ChevronDown, ShieldCheck, Zap } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import type { CoworkExecutionMode } from '@/lib/cowork/execution-policy';
import { CwButton } from './ui';

export const COWORK_MODE_HELP: Record<CoworkExecutionMode, string> = {
  approval: 'Antes de consultar un proveedor o cambiar algo, revisarás la propuesta.',
  autonomous: 'Aprueba por ti buscar prospectos (1 búsqueda por hilo), guardar contactos, investigar, pedir borradores, buscar un correo (usa 1 crédito) y crear campañas en pausa, con tope de 3 pasos automáticos por hilo. Lo que sale de una búsqueda en la web, los envíos, las activaciones y las notas siempre los apruebas tú.',
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

/** What «Autónomo» approves by itself, and what it never does, as a list to read before turning it on (COW-17). */
export const COWORK_AUTONOMOUS_DOES = ['Buscar prospectos (una búsqueda por conversación)', 'Guardar contactos', 'Investigar a un contacto',
  'Pedir borradores de correo', 'Buscar un correo (usa 1 crédito)', 'Crear campañas en pausa'];
export const COWORK_AUTONOMOUS_NEVER = 'Enviar correos, activar campañas, escribir notas y usar lo que sale de una búsqueda en la web: eso siempre lo apruebas tú.';
/** The line under the box while «Autónomo» is on, so it is not a secret in a tooltip (and it reads on a phone). */
export const COWORK_AUTONOMOUS_NOTE = 'Autónomo: aprueba por ti hasta 3 pasos por conversación. Los envíos y las activaciones los apruebas tú.';

/** The first time someone picks «Autónomo»: what it approves alone and what it never does, and one clear way to turn it on. */
export function AutonomousConfirm({ open, onConfirm, onCancel }: { open: boolean; onConfirm: () => void; onCancel: () => void }) {
  return <Dialog open={open} onOpenChange={next => { if (!next) onCancel(); }}>
    <DialogContent className="max-w-md gap-0 border-cw-border bg-cw-bg p-6 text-cw-text sm:rounded-2xl">
      <DialogTitle className="flex items-center gap-2 text-[16px] font-semibold text-cw-text"><Zap className="h-4 w-4 text-cw-accent" aria-hidden="true" />Trabajar en modo Autónomo</DialogTitle>
      <DialogDescription className="mt-1.5 text-[13px] leading-5 text-cw-muted">Cowork aprobará por ti hasta 3 pasos en cada conversación:</DialogDescription>
      <ul className="mt-3 space-y-1.5 text-[13.5px] leading-5">
        {COWORK_AUTONOMOUS_DOES.map(item => <li key={item} className="flex gap-2"><span aria-hidden="true" className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-cw-accent" />{item}</li>)}
      </ul>
      <p className="mt-3 rounded-xl bg-cw-hover px-3 py-2.5 text-[13px] leading-5">{COWORK_AUTONOMOUS_NEVER}</p>
      <div className="mt-5 flex justify-end gap-2">
        <CwButton variant="ghost" onClick={onCancel}>Seguir con aprobaciones</CwButton>
        <CwButton variant="primary" onClick={onConfirm}>Activar Autónomo</CwButton>
      </div>
    </DialogContent>
  </Dialog>;
}
