import { Star } from 'lucide-react';
import { cn } from '@/lib/utils';
import { starsFor, starsText } from '@/lib/commercial-opportunities/priority';

/**
 * One to five stars for how well an opportunity fits the company (priority.ts), in the pipeline and in the list, after the
 * word «Calce» so they do not read as a rating. The words are on the group, so a screen reader says «Calce 4 de 5: calza bien
 * con tu oferta» once, and the word and the icons stay quiet.
 */
export function PriorityStars({ score, className }: { score: number | null | undefined; className?: string }) {
  const stars = starsFor(score);
  const text = starsText(score);
  return <span role="img" aria-label={text} title={text} className={cn('inline-flex shrink-0 items-center gap-px', className)}>
    <span aria-hidden="true" className="mr-1 text-[11px] text-muted-foreground">Calce</span>
    {[1, 2, 3, 4, 5].map(position => <Star key={position} aria-hidden="true" className={cn('h-3.5 w-3.5',
      position <= stars ? 'fill-amber-500 text-amber-600 dark:fill-amber-400 dark:text-amber-400' : 'text-muted-foreground/35')} />)}
  </span>;
}
