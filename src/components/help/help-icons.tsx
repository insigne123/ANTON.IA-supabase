import {
<<<<<<< HEAD
  BarChart3, Bot, Building2, CalendarCheck, Contact, CreditCard, FileSignature, KanbanSquare, Mail, MessagesSquare, PenLine,
=======
  BarChart3, Building2, CalendarCheck, CalendarCheck2, Contact, CreditCard, FileSignature, KanbanSquare, Mail, MessagesSquare, PenLine,
>>>>>>> claude/informe-semanal
  Plug, Rocket, Search, Send, Shield, Sparkles, Table2, UserCircle, type LucideIcon,
} from 'lucide-react';
import { HELP_ICONS, type HelpIconKey } from '@/lib/help/manual';

/** The icon set of the «Centro de ayuda»: one per section of the manual (HELP_ICONS). */
export const HELP_ICON_SET: Record<HelpIconKey, LucideIcon> = {
  start: Rocket, today: CalendarCheck, report: CalendarCheck2, search: Search, opportunities: Sparkles, contacts: Contact, write: PenLine, mail: Send,
  companies: Building2, table: Table2, conversations: MessagesSquare, campaigns: Mail, pipeline: KanbanSquare, profile: UserCircle,
  connections: Plug, signature: FileSignature, privacy: Shield, credits: CreditCard, admin: BarChart3, assistant: Bot,
};

export function HelpIcon({ section, className }: { section: string; className?: string }) {
  const Icon = HELP_ICON_SET[HELP_ICONS[section] || 'start'];
  return <Icon className={className} aria-hidden="true" />;
}
