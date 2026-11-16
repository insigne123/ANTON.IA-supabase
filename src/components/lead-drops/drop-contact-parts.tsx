'use client';

import { dropInitials, dropTint, needsLookup, type DropItem } from '@/lib/lead-drops';
import { cn } from '@/lib/utils';

/**
 * The small pieces every view of a «Contacto del día» shares (16 Nov 2026, the redesign the owner asked for: «se siente como mucho
 * texto y poco organizado»): who a contact is at a glance (its initials on a tint of its own) and where it stands (one chip, said
 * the same way in the list, in its card and in «Hoy»).
 */

const TINTS = [
  'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-200',
  'bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-200',
  'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200',
  'bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200',
  'bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-200',
  'bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-200',
];

export function DropAvatar({ item, size = 'md', className }: { item: Pick<DropItem, 'name' | 'leadId'>; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  return <span aria-hidden="true" className={cn('inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold',
    size === 'lg' ? 'h-12 w-12 text-base' : size === 'sm' ? 'h-8 w-8 text-xs' : 'h-10 w-10 text-sm', TINTS[dropTint(item.leadId, TINTS.length)], className)}>{dropInitials(item)}</span>;
}

export type DropStage = { key: 'running' | 'paused' | 'approve' | 'saved' | 'missed' | 'enrich' | 'save'; label: string; tone: 'done' | 'next' | 'warn' | 'idle' };

/** Where a contact stands, as one short label: its email to look up, its campaign to approve, or its campaign going out. */
export function dropStage(item: DropItem): DropStage {
  if (item.campaign) return item.campaign.pausedAt ? { key: 'paused', label: 'Campaña detenida', tone: 'warn' } : { key: 'running', label: 'Campaña en curso', tone: 'done' };
  if (item.savedLeadId) return item.draft ? { key: 'approve', label: 'Campaña por aprobar', tone: 'next' } : { key: 'saved', label: 'Guardado', tone: 'done' };
  if (needsLookup(item)) return item.lookup?.missed ? { key: 'missed', label: 'Sin correo', tone: 'warn' } : { key: 'enrich', label: 'Por enriquecer', tone: 'idle' };
  return { key: 'save', label: 'Por guardar', tone: 'idle' };
}

const CHIP: Record<DropStage['tone'], string> = {
  done: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300',
  next: 'bg-primary/10 text-primary',
  warn: 'bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-300',
  idle: 'bg-muted text-foreground/75',
};
const DOT: Record<DropStage['tone'], string> = { done: 'bg-emerald-500', next: 'bg-primary', warn: 'bg-amber-500', idle: 'bg-muted-foreground/50' };

export function DropStageChip({ stage, className }: { stage: DropStage; className?: string }) {
  return <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium', CHIP[stage.tone], className)}>
    <span aria-hidden="true" className={cn('h-1.5 w-1.5 rounded-full', DOT[stage.tone])} />{stage.label}</span>;
}
export const stageDotClass = (stage: DropStage) => DOT[stage.tone];
