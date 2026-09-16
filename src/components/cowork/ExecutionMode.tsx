import { Label } from '@/components/ui/label';
import type { CoworkExecutionMode } from '@/lib/cowork/execution-policy';

export function ExecutionMode({ id, value, onChange, disabled }: {
  id: string; value: CoworkExecutionMode; onChange: (value: CoworkExecutionMode) => void; disabled: boolean;
}) {
  return <div className="space-y-2">
    <div className="flex flex-wrap items-center gap-3">
      <Label htmlFor={id} className="text-sm">Modo de trabajo</Label>
      <select id={id} value={value} disabled={disabled} onChange={event => onChange(event.target.value as CoworkExecutionMode)}
        className="h-10 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
        <option value="approval">Con aprobaciones</option>
        <option value="autonomous">Autónomo</option>
      </select>
    </div>
    <p className="text-xs text-muted-foreground">{value === 'autonomous'
      ? 'Autoriza consultar datos y una búsqueda externa de hasta 25 contactos en este trabajo. Se aplican tus cuotas. Los cambios de notas se revisan antes de guardar.'
      : 'Antes de consultar un proveedor o cambiar una nota, revisarás la propuesta.'}</p>
  </div>;
}
