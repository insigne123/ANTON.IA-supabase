import {
  BarChart3, Building2, CalendarCheck, Contact, CreditCard, FileSignature, KanbanSquare, Mail, MessagesSquare, PenLine,
  Plug, Rocket, Search, Send, Shield, Sparkles, Table2, UserCircle, type LucideIcon,
} from 'lucide-react';
import { HELP_ICONS, type HelpIconKey } from '@/lib/help/manual';

/** The icon set of the «Centro de ayuda»: one per section of the manual (HELP_ICONS). */
export const HELP_ICON_SET: Record<HelpIconKey, LucideIcon> = {
  start: Rocket, today: CalendarCheck, search: Search, opportunities: Sparkles, contacts: Contact, write: PenLine, mail: Send,
  companies: Building2, table: Table2, conversations: MessagesSquare, campaigns: Mail, pipeline: KanbanSquare, profile: UserCircle,
  connections: Plug, signature: FileSignature, privacy: Shield, credits: CreditCard, admin: BarChart3,
};

export function HelpIcon({ section, className }: { section: string; className?: string }) {
  const Icon = HELP_ICON_SET[HELP_ICONS[section] || 'start'];
  return <Icon className={className} aria-hidden="true" />;
}
