'use client';
import { useEffect, useState } from 'react';
import { Loader2, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { MAX_RULES, ruleLabel, type AssignmentRule, type RuleGroup } from '@/lib/commercial-opportunities/admin-settings';
import { OPPORTUNITY_CATEGORIES, type OpportunityCategory } from '@/lib/commercial-opportunities/workspace-radar';

type Member = { user_id: string; name: string; open?: number };
type Row = { id?: string; category: OpportunityCategory | ''; minAmount: string; userId: string };
const SELECT = 'h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';
const amountText = (value: number | null) => (value === null ? '' : value.toLocaleString('es-CL'));
const amountOf = (text: string) => { const digits = text.replace(/\D/g, ''); return digits ? Number(digits) : null; };

/** The rules as the dialog edits them, and back: a row without a person is not a rule yet. */
export const rowsOf = (rules: readonly AssignmentRule[]): Row[] => rules.map(rule => ({ id: rule.id, category: rule.category ?? '', minAmount: amountText(rule.minAmount), userId: rule.userId }));
export const rulesOf = (rows: readonly Row[]) => rows.filter(row => row.userId).map(row => ({ ...(row.id ? { id: row.id } : {}), category: row.category || null, minAmount: amountOf(row.minAmount), userId: row.userId }));

/**
 * «Reglas de asignación» (OPP-06): a line of service, and when it matters a minimum amount, gives the recommended ones to a person.
 * The first rule that fits decides. They only propose: «Asignarlas» on the recommended ones assigns what they give, after a look.
 */
export function AssignmentRulesDialog({ open, rules, members, busy, error, onSave, onCancel }: {
  open: boolean; rules: readonly AssignmentRule[]; members: readonly Member[]; busy: boolean; error?: string;
  onSave: (rules: ReturnType<typeof rulesOf>) => void | Promise<unknown>; onCancel: () => void;
}) {
  // The rules saved when it opens, or one empty row to start with; what was typed and cancelled is not kept for the next time.
  const start = () => (rules.length ? rowsOf(rules) : [{ category: '' as const, minAmount: '', userId: '' }]);
  const [rows, setRows] = useState<Row[]>(start);
  useEffect(() => { if (open) setRows(rules.length ? rowsOf(rules) : [{ category: '', minAmount: '', userId: '' }]); }, [open, rules]);
  const set = (index: number, change: Partial<Row>) => setRows(current => current.map((row, at) => (at === index ? { ...row, ...change } : row)));
  const name = (userId: string) => members.find(member => member.user_id === userId)?.name || 'Integrante';
  return <Dialog open={open} onOpenChange={next => { if (!next && !busy) onCancel(); }}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>Reglas de asignación</DialogTitle>
        <DialogDescription>Quién trabaja cada rubro. La primera regla que calce decide, y nada se asigna sin que lo confirmes con «Asignarlas».</DialogDescription>
      </DialogHeader>
      <form className="space-y-4" onSubmit={event => { event.preventDefault(); if (!busy) void onSave(rulesOf(rows)); }}>
        <ol className="space-y-3">
          {rows.map((row, index) => <li key={row.id ?? `new-${index}`} className="grid gap-2 rounded-xl border p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,1fr)_auto] sm:items-end sm:border-0 sm:p-0">
            <label className="space-y-1 text-xs text-muted-foreground">Rubro
              <select className={SELECT} value={row.category} disabled={busy} onChange={event => set(index, { category: event.target.value as Row['category'] })}>
                <option value="">Todos</option>
                {OPPORTUNITY_CATEGORIES.map(category => <option key={category.id} value={category.id}>{category.label}</option>)}
              </select></label>
            <label className="space-y-1 text-xs text-muted-foreground">Desde (CLP) · opcional
              <Input inputMode="numeric" placeholder="Cualquier monto" value={row.minAmount} disabled={busy} onChange={event => set(index, { minAmount: event.target.value })} /></label>
            <label className="space-y-1 text-xs text-muted-foreground">Para
              <select className={SELECT} value={row.userId} disabled={busy} required={Boolean(row.category || row.minAmount)} onChange={event => set(index, { userId: event.target.value })}>
                <option value="">Elegir persona…</option>
                {members.map(member => <option key={member.user_id} value={member.user_id}>{member.name}{typeof member.open === 'number' ? ` · ${member.open} en curso` : ''}</option>)}
              </select></label>
            <Button type="button" variant="ghost" size="icon" className="justify-self-end" disabled={busy} aria-label={row.userId ? `Quitar la regla ${ruleLabel({ category: row.category || null, minAmount: amountOf(row.minAmount) }, name(row.userId))}` : 'Quitar esta regla'}
              onClick={() => setRows(current => current.filter((_, at) => at !== index))}><X className="h-4 w-4" aria-hidden="true" /></Button>
          </li>)}
        </ol>
        {rows.length < MAX_RULES ? <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setRows(current => [...current, { category: '', minAmount: '', userId: '' }])}>
          <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />Agregar regla</Button> : null}
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>Cancelar</Button>
          <Button type="submit" disabled={busy}>{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}Guardar</Button>
        </div>
      </form>
    </DialogContent>
  </Dialog>;
}

/** «Asignarlas»: what the rules give to each person, to look at once before it is assigned and each person is told. */
export function RuleAssignDialog({ groups, titles, busy, error, onConfirm, onCancel }: {
  groups: RuleGroup[] | null; titles: Record<string, string>; busy: boolean; error?: string;
  onConfirm: (groups: RuleGroup[]) => void | Promise<unknown>; onCancel: () => void;
}) {
  const total = groups?.reduce((sum, group) => sum + group.ids.length, 0) ?? 0;
  return <Dialog open={groups !== null} onOpenChange={next => { if (!next && !busy) onCancel(); }}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>{total === 1 ? 'Asignar 1 según tus reglas' : `Asignar ${total} según tus reglas`}</DialogTitle>
        <DialogDescription>Cada persona queda como responsable de las suyas y le avisamos por correo.</DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        {(groups || []).map(group => <section key={group.userId} aria-label={group.name} className="space-y-1.5">
          <h3 className="text-sm font-semibold">{group.name} <span className="font-normal tabular-nums text-muted-foreground">{group.ids.length}</span></h3>
          <p className="text-xs text-muted-foreground">{ruleLabel(group.rule, group.name.split(' ')[0])}</p>
          <ul className="space-y-1 text-sm">{group.ids.map(id => <li key={id} className="truncate">{titles[id] || 'Oportunidad'}</li>)}</ul>
        </section>)}
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>Cancelar</Button>
          <Button type="button" disabled={busy || !total} onClick={() => groups && void onConfirm(groups)}>{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}Asignar y avisar</Button>
        </div>
      </div>
    </DialogContent>
  </Dialog>;
}
