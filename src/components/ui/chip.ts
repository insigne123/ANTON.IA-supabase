import { cn } from '@/lib/utils';

/**
 * The two ways the app marks what is chosen in a row of choices (APP-04), so «seleccionado» reads the same everywhere and never as
 * the ≈1.1:1 gray of a `secondary` button: a filter or an option is a pill that turns dark when on (the one of Oportunidades), and a
 * view is a segment that lifts on a muted track («Hoy | Tu semana»). Both say it with `aria-pressed` too.
 */
export function chipClass(on: boolean, size: 'md' | 'sm' = 'md') {
  return cn('inline-flex shrink-0 items-center gap-1.5 rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
    size === 'md' ? 'h-8 px-3 text-sm' : 'h-7 px-3 text-xs',
    on ? 'border-transparent bg-foreground font-medium text-background' : 'border-border bg-background text-foreground/75 hover:bg-muted hover:text-foreground');
}

/** The track that holds the segments of a view switch. */
export const SEGMENT_TRACK = 'inline-flex items-center gap-1 rounded-full bg-muted p-1';

export function segmentClass(on: boolean) {
  return cn('inline-flex items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
    on ? 'bg-background text-foreground shadow-sm' : 'text-foreground/70 hover:text-foreground');
}
