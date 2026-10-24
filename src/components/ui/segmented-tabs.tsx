'use client';
// One accessible pattern for views and sections (OPP-43): a tab list whose tabs move with the arrow keys, Home and End, with only
// the selected one in the Tab order (roving tabindex), and that says «tab 3 of 8» to a screen reader. On a narrow screen the row
// scrolls sideways instead of wrapping, and keeps the selected tab in view. The page renders the panel with `tabPanelProps`.
import * as React from 'react';
import { cn } from '@/lib/utils';

export type SegmentedTab<T extends string> = { value: T; label: React.ReactNode; icon?: React.ReactNode; count?: number | null };

/** Where the arrow keys, Home and End take the focus from tab `index` of `count`; the row wraps around. Null: not a key it handles. */
export function nextTabIndex(key: string, index: number, count: number): number | null {
  if (key === 'ArrowRight') return index === count - 1 ? 0 : index + 1;
  if (key === 'ArrowLeft') return index === 0 ? count - 1 : index - 1;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return null;
}

const LIST = {
  // A view switcher: quiet segments on a muted track.
  segmented: 'inline-flex max-w-full items-center gap-1 rounded-xl bg-muted p-1',
  // The sections of a page: a row of pills, the selected one filled.
  pills: 'flex max-w-full items-center gap-1.5 pb-1',
  // The sections of a record: a quiet row over a hairline, the selected one underlined, so they never read as filters.
  underline: 'flex max-w-full items-end gap-1 border-b',
} as const;
const TAB = {
  segmented: 'rounded-lg px-3 py-1.5 font-medium text-foreground/70 hover:text-foreground aria-selected:bg-background aria-selected:text-foreground aria-selected:shadow-sm',
  pills: 'rounded-full border border-border px-3 py-1.5 text-foreground/80 hover:bg-muted/60 aria-selected:border-foreground aria-selected:bg-foreground aria-selected:text-background aria-selected:hover:bg-foreground',
  underline: '-mb-px rounded-t-md border-b-2 border-transparent px-3 py-2 text-foreground/70 hover:text-foreground aria-selected:border-foreground aria-selected:font-medium aria-selected:text-foreground',
} as const;

export function SegmentedTabs<T extends string>({ tabs, value, onChange, label, idPrefix, variant = 'segmented', className }: {
  tabs: ReadonlyArray<SegmentedTab<T>>; value: T; onChange: (value: T) => void;
  /** What the row is, for a screen reader: «Vistas de Oportunidades», «Secciones de la oportunidad». */
  label: string; idPrefix: string; variant?: keyof typeof LIST; className?: string;
}) {
  const list = React.useRef<HTMLDivElement | null>(null);
  const buttons = React.useRef(new Map<string, HTMLButtonElement>());
  // The selected tab stays in view when the row is wider than the screen; only the row scrolls, never the page.
  React.useEffect(() => {
    const row = list.current, tab = buttons.current.get(value);
    if (!row || !tab || row.scrollWidth <= row.clientWidth) return;
    const start = tab.offsetLeft - row.offsetLeft, end = start + tab.offsetWidth;
    if (start < row.scrollLeft) row.scrollLeft = Math.max(0, start - 16);
    else if (end > row.scrollLeft + row.clientWidth) row.scrollLeft = end - row.clientWidth + 16;
  }, [value]);
  const keyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = nextTabIndex(event.key, index, tabs.length);
    if (next === null) return;
    event.preventDefault();
    onChange(tabs[next].value);
    buttons.current.get(tabs[next].value)?.focus();
  };
  return <div ref={list} role="tablist" aria-label={label} aria-orientation="horizontal"
    className={cn(LIST[variant], 'overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden', className)}>
    {tabs.map((tab, index) => {
      const selected = tab.value === value;
      return <button key={tab.value} type="button" role="tab" id={`${idPrefix}-tab-${tab.value}`} aria-selected={selected} aria-controls={`${idPrefix}-panel`}
        tabIndex={selected ? 0 : -1} ref={node => { if (node) buttons.current.set(tab.value, node); else buttons.current.delete(tab.value); }}
        onClick={() => onChange(tab.value)} onKeyDown={event => keyDown(event, index)}
        className={cn('inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1', TAB[variant])}>
        {tab.icon}{tab.label}{typeof tab.count === 'number' ? <span className="tabular-nums opacity-70">{tab.count}</span> : null}
      </button>;
    })}
  </div>;
}

/** The panel the selected tab shows, named by its tab. Its own controls come right after the row with Tab: the panels of the app
 * always hold some, so the panel itself is not one more stop. */
export const tabPanelProps = (idPrefix: string, value: string) =>
  ({ role: 'tabpanel', id: `${idPrefix}-panel`, 'aria-labelledby': `${idPrefix}-tab-${value}` }) as const;
