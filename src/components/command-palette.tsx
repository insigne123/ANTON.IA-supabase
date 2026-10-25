'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ArrowRight, Bot, Search } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { isPaletteShortcut, paletteItems, type PaletteAccess, type PaletteItem } from '@/lib/command-palette';
import { cn } from '@/lib/utils';

/**
 * The ⌘K box (APP-24, src/lib/command-palette.ts): a field and the options under it, grouped. Arrows move between the options, Enter
 * opens the one marked and Escape closes. The buttons of the top bars open it too, and say the shortcut.
 */
const OPEN_EVENT = 'command-palette:open';

/** The button of the top bar: there is one on the phone's bar and one on the computer's, and a single box listens. */
export function CommandPaletteButton() {
  const [mac, setMac] = useState(false);
  useEffect(() => { setMac(/mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent || '')); }, []);
  return <Button variant="ghost" size="sm" className="gap-2 rounded-2xl px-2.5 text-muted-foreground" onClick={() => window.dispatchEvent(new Event(OPEN_EVENT))}
    aria-label="Buscar e ir a…" aria-keyshortcuts={mac ? 'Meta+K' : 'Control+K'}>
    <Search className="h-4 w-4" aria-hidden="true" />
    <kbd className="hidden rounded-md border border-border bg-muted/60 px-1.5 font-sans text-[11px] text-muted-foreground lg:inline">{mac ? '⌘K' : 'Ctrl K'}</kbd>
  </Button>;
}

export function CommandPalette({ access }: { access: PaletteAccess }) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [mac, setMac] = useState(false);
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => { setMac(/mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent || '')); }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !isPaletteShortcut(event, mac, pathname)) return;
      event.preventDefault();
      setOpen(value => !value);
    };
    const onOpen = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener(OPEN_EVENT, onOpen); };
  }, [mac, pathname]);
  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => { if (!open) { setQuery(''); setActive(0); } }, [open]);

  const items = useMemo(() => paletteItems(query, access), [query, access]);
  useEffect(() => { setActive(0); }, [query]);
  useEffect(() => { list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView?.({ block: 'nearest' }); }, [active]);

  const go = (item: PaletteItem | undefined) => {
    if (!item) return;
    setOpen(false);
    router.push(item.href);
  };
  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); setActive(index => Math.min(items.length - 1, index + 1)); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive(index => Math.max(0, index - 1)); }
    else if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); go(items[active]); }
  };

  const groups = items.reduce<Array<{ name: PaletteItem['group']; items: Array<PaletteItem & { index: number }> }>>((all, item, index) => {
    const group = all.find(entry => entry.name === item.group);
    if (group) group.items.push({ ...item, index }); else all.push({ name: item.group, items: [{ ...item, index }] });
    return all;
  }, []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent hideClose className="top-[18%] max-w-xl translate-y-0 gap-0 overflow-hidden p-0 sm:rounded-2xl">
        <DialogTitle className="sr-only">Buscar e ir a…</DialogTitle>
        <DialogDescription className="sr-only">Escribe para ir a una pantalla, buscar en tus datos o preguntarle a Cowork. Las flechas eligen y Enter abre.</DialogDescription>
        <div className="flex items-center gap-2 border-b px-4">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <input autoFocus value={query} onChange={event => setQuery(event.target.value)} onKeyDown={onKeyDown}
            role="combobox" aria-expanded={items.length > 0} aria-controls="command-palette-list" aria-autocomplete="list"
            aria-activedescendant={items[active] ? `command-palette-${active}` : undefined} aria-label="Buscar e ir a…"
            placeholder="Ir a, buscar una persona o preguntarle a Cowork"
            className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
        </div>
        {items.length ? <ul ref={list} id="command-palette-list" role="listbox" aria-label="Opciones" className="max-h-[50dvh] overflow-y-auto p-2">
          {groups.map(group => <li key={group.name} role="presentation">
            <p className="px-2 pb-1 pt-2 text-xs font-medium text-muted-foreground" aria-hidden="true">{group.name}</p>
            <ul role="group" aria-label={group.name}>
              {group.items.map(item => <li key={item.id} id={`command-palette-${item.index}`} data-index={item.index} role="option" aria-selected={item.index === active}
                onMouseMove={() => setActive(item.index)} onClick={() => go(item)}
                className={cn('flex cursor-pointer items-center gap-3 rounded-xl px-2 py-2 text-sm', item.index === active ? 'bg-muted text-foreground' : 'text-foreground/85')}>
                {item.group === 'Preguntar a Cowork' ? <Bot className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" /> : item.group === 'Buscar en tus datos' ? <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" /> : <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {item.hint ? <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">{item.hint}</span> : null}
              </li>)}
            </ul>
          </li>)}
        </ul> : <p role="status" className="px-4 py-6 text-center text-sm text-muted-foreground">No hay una pantalla con ese nombre. Escribe al menos dos letras para buscar en tus datos.</p>}
      </DialogContent>
    </Dialog>
  );
}
