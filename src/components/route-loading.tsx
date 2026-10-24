import { Loader2 } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * What a screen built on the server shows while it arrives (APP-18): its shape in quiet blocks, so a click in the menu answers
 * at once instead of leaving the previous screen still until the server responds. `centered`: a spinner and its words, for the
 * screens that fill the whole height (Cowork).
 */
export function RouteLoading({ label, rows = 3, centered = false }: { label: string; rows?: number; centered?: boolean }) {
  if (centered) {
    return (
      <div role="status" className="flex min-h-[60dvh] flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        {label}
      </div>
    );
  }
  return (
    <div role="status" className="mx-auto w-full max-w-[1320px] space-y-5 pb-10">
      <span className="sr-only">{label}</span>
      <div className="space-y-2 border-b border-border/60 pb-5" aria-hidden="true">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-full max-w-xl" />
      </div>
      <div className="space-y-3" aria-hidden="true">
        {Array.from({ length: rows }).map((_, index) => <Skeleton key={index} className="h-24 rounded-2xl" />)}
      </div>
    </div>
  );
}
