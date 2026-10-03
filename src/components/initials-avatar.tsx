import { cn } from '@/lib/utils';

/** Up to two initials of a name («Andrea Soto» → «AS»), or of an email's local part. */
export function initialsOf(name?: string | null, email?: string | null) {
  const source = String(name || '').trim() || String(email || '').split('@')[0].replace(/[._-]+/g, ' ').trim();
  const words = source.split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  const letters = words.length === 1 ? words[0].slice(0, 2) : `${words[0][0]}${words[words.length - 1][0]}`;
  return letters.toLocaleUpperCase('es-CL');
}

const SIZES = { sm: 'h-7 w-7 text-[11px]', md: 'h-9 w-9 text-xs', lg: 'h-12 w-12 text-sm' } as const;
const TONES = ['bg-primary/10 text-primary', 'bg-cw-success-soft text-cw-success', 'bg-cw-warning-soft text-cw-warning', 'bg-muted text-foreground'] as const;

/**
 * A person's initials in a circle, drawn here: no third-party avatar service ever receives a prospect's name. The tone
 * follows the name, so the same person keeps the same color across the app.
 */
export function InitialsAvatar({ name, email, size = 'md', className }: { name?: string | null; email?: string | null; size?: keyof typeof SIZES; className?: string }) {
  const initials = initialsOf(name, email);
  let hash = 0;
  for (const char of `${name || ''}${email || ''}`) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return (
    <span aria-hidden="true" className={cn('inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold', SIZES[size], TONES[hash % TONES.length], className)}>
      {initials}
    </span>
  );
}
