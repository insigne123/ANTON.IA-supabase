'use client';

import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { COWORK_COMPOSER_KEYS, COWORK_SHORTCUTS } from '@/lib/cowork/shortcuts';

function Keys({ keys }: { keys: string[] }) {
  return <span className="flex shrink-0 items-center gap-1">
    {keys.map(key => <kbd key={key} className="min-w-[1.75rem] rounded-md border border-cw-border bg-cw-panel px-1.5 py-0.5 text-center font-sans text-[12px] font-medium text-cw-text">{key}</kbd>)}
  </span>;
}

function Section({ title, rows }: { title: string; rows: Array<{ label: string; keys: string[] }> }) {
  return <section>
    <h3 className="mb-1.5 text-[12.5px] font-semibold text-cw-text">{title}</h3>
    <ul className="divide-y divide-cw-border rounded-xl border border-cw-border bg-cw-elevated">
      {rows.map(row => <li key={row.label} className="flex items-center justify-between gap-3 px-3.5 py-2">
        <span className="text-[13.5px] text-cw-text">{row.label}</span>
        <Keys keys={row.keys} />
      </li>)}
    </ul>
  </section>;
}

/** «Atajos de teclado» (Plan 13): Cowork's shortcuts with the keys of the person's system, and the composer's own keys. */
export function CoworkShortcuts({ open, onOpenChange, mac }: { open: boolean; onOpenChange: (open: boolean) => void; mac: boolean }) {
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-w-md gap-0 overflow-hidden border-cw-border bg-cw-bg p-0 text-cw-text sm:rounded-2xl">
      <div className="border-b border-cw-border px-5 pb-3.5 pt-5 pr-12">
        <DialogTitle className="text-[16px] font-semibold text-cw-text">Atajos de teclado</DialogTitle>
        <DialogDescription className="mt-1 text-[13px] leading-5 text-cw-muted">
          Para ir más rápido. También puedes empezar a escribir en cualquier momento: el texto va al mensaje.
        </DialogDescription>
      </div>
      <div className="space-y-4 px-5 py-4">
        <Section title="En Cowork" rows={COWORK_SHORTCUTS.map(item => ({ label: item.label, keys: item.keys(mac) }))} />
        <Section title="Al escribir" rows={[...COWORK_COMPOSER_KEYS]} />
      </div>
    </DialogContent>
  </Dialog>;
}
