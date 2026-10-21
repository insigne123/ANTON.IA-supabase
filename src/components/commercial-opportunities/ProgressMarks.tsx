import { AlertTriangle, Check, Eye, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ProgressChip } from '@/lib/commercial-opportunities/progress';

/** The marks of a card about its own work (progress.ts), in the tones of the rest of the board; the Pipeline and the list draw them alike. */
const TONES: Record<ProgressChip['tone'], string> = {
  active: 'bg-primary/10 text-primary', done: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  warning: 'bg-amber-500/10 text-amber-800 dark:text-amber-200', quiet: 'bg-muted text-muted-foreground',
};
const icon = (mark: ProgressChip) => mark.key === 'opened' ? <Eye className="h-3 w-3" aria-hidden="true" />
  : mark.tone === 'active' ? <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" aria-hidden="true" />
    : mark.tone === 'warning' ? <AlertTriangle className="h-3 w-3" aria-hidden="true" /> : <Check className="h-3 w-3" aria-hidden="true" />;

export function ProgressMarks({ marks }: { marks: ProgressChip[] }) {
  return <>{marks.map(mark => <span key={mark.key} title={mark.title}
    className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs', mark.key === 'opened' ? 'font-normal' : 'font-medium', TONES[mark.tone])}>{icon(mark)}{mark.label}</span>)}</>;
}
