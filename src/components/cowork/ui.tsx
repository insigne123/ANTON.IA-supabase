'use client';

import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from 'react';
import {
  AtSign, Bookmark, BookOpen, Building2, CalendarClock, ChartColumn, Check, CircleStop, Code, FilePenLine, FileText, Globe,
  LayoutGrid, Linkedin, ListChecks, Lock, Megaphone, Pause, PenLine, Play, Reply, Scale, Search, Send, ShieldCheck,
  Sparkles, Target, TriangleAlert, UserCheck, UserPlus, UserRound, Users, UsersRound, type LucideIcon,
} from 'lucide-react';
import type { CoworkIconKey, CoworkStatusTone } from '@/lib/cowork/presentation';
import { cn } from '@/lib/utils';

export const COWORK_ICONS: Record<CoworkIconKey, LucideIcon> = {
  contacts: Users, research: BookOpen, team: UsersRound, crm: Building2, mail: AtSign, reply: Reply, chart: ChartColumn,
  shield: ShieldCheck, scale: Scale, app: LayoutGrid, draft: FilePenLine, campaign: Megaphone, file: FileText,
  bookmark: Bookmark, profile: UserRound, lock: Lock, list: ListChecks, linkedin: Linkedin, target: Target,
  alert: TriangleAlert, audience: Users, pen: PenLine, globe: Globe, calendar: CalendarClock, send: Send, play: Play,
  pause: Pause, code: Code, stop: CircleStop, 'user-plus': UserPlus, 'user-check': UserCheck, sparkles: Sparkles,
  check: Check, search: Search,
};

export function CoworkIcon({ name, className }: { name: CoworkIconKey; className?: string }) {
  const Icon = COWORK_ICONS[name] || Search;
  return <Icon aria-hidden="true" className={className} />;
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'quiet' | 'danger';
type Size = 'xs' | 'sm' | 'md' | 'icon' | 'icon-sm';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-cw-accent text-cw-on-accent shadow-[var(--cw-shadow-sm)] hover:bg-cw-accent-hover',
  secondary: 'border border-cw-border bg-cw-elevated text-cw-text shadow-[var(--cw-shadow-sm)] hover:border-cw-border-strong hover:bg-cw-panel',
  ghost: 'text-cw-muted hover:bg-cw-hover hover:text-cw-text',
  quiet: 'text-cw-text hover:bg-cw-hover',
  danger: 'border border-cw-border bg-cw-elevated text-cw-danger hover:bg-cw-danger-soft',
};

const SIZES: Record<Size, string> = {
  xs: 'h-7 gap-1 rounded-md px-2 text-xs [&_svg]:size-3.5',
  sm: 'h-8 gap-1.5 rounded-lg px-3 text-[13px] [&_svg]:size-4',
  md: 'h-9 gap-2 rounded-[10px] px-3.5 text-sm [&_svg]:size-4',
  icon: 'h-9 w-9 rounded-[10px] [&_svg]:size-[18px]',
  'icon-sm': 'h-8 w-8 rounded-lg [&_svg]:size-4',
};

export type CwButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size };

export const CwButton = forwardRef<HTMLButtonElement, CwButtonProps>(function CwButton(
  { className, variant = 'secondary', size = 'md', type = 'button', ...props }, ref,
) {
  return <button ref={ref} type={type} className={cn(
    'inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap font-medium transition-[background-color,border-color,color,box-shadow] duration-150',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cw-accent-ring)] disabled:pointer-events-none disabled:opacity-45 [&_svg]:shrink-0',
    VARIANTS[variant], SIZES[size], className,
  )} {...props} />;
});

const TONES: Record<CoworkStatusTone, string> = {
  neutral: 'bg-cw-hover text-cw-muted',
  progress: 'bg-cw-accent-soft text-cw-accent',
  attention: 'bg-cw-warning-soft text-cw-warning',
  success: 'bg-cw-success-soft text-cw-success',
  danger: 'bg-cw-danger-soft text-cw-danger',
};

const DOTS: Record<CoworkStatusTone, string> = {
  neutral: 'bg-cw-faint',
  progress: 'bg-cw-accent',
  attention: 'bg-cw-warning',
  success: 'bg-cw-success',
  danger: 'bg-cw-danger',
};

export function CwStatusPill({ tone, children, pulse = false, className }: { tone: CoworkStatusTone; children: ReactNode; pulse?: boolean; className?: string }) {
  return <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-medium', TONES[tone], className)}>
    <span className={cn('h-1.5 w-1.5 rounded-full', DOTS[tone], pulse && 'cw-breathe')} aria-hidden="true" />
    {children}
  </span>;
}

export function CwStatusDot({ tone, pulse = false, className }: { tone: CoworkStatusTone; pulse?: boolean; className?: string }) {
  return <span aria-hidden="true" className={cn('inline-block h-2 w-2 shrink-0 rounded-full', DOTS[tone], pulse && 'cw-breathe', className)} />;
}

/** The ANTON.IA assistant mark used at the start of each reply. */
export function CoworkMark({ working = false, size = 26, className }: { working?: boolean; size?: number; className?: string }) {
  return <span className={cn('relative inline-flex shrink-0 items-center justify-center', className)} style={{ width: size, height: size }} aria-hidden="true">
    {working && <span className="cw-orbit absolute inset-[-3px] rounded-full border-2 border-transparent border-t-cw-accent" />}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src="/icon-192.png" alt="" width={size} height={size} className="h-full w-full rounded-full object-cover ring-1 ring-cw-border" />
  </span>;
}

export function CwCard({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-2xl border border-cw-border bg-cw-elevated shadow-[var(--cw-shadow-sm)]', className)} {...props} />;
}

export function CwKbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-cw-border bg-cw-elevated px-1 font-cw-sans text-[10.5px] font-medium text-cw-muted">{children}</kbd>;
}
