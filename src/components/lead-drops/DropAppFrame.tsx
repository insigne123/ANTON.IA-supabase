import type { ReactNode } from 'react';
import { ArrowRight, Sparkles } from 'lucide-react';
import Logo from '@/components/logo';
import { Button } from '@/components/ui/button';
import { NAV_SECTIONS } from '@/lib/navigation';
import { cn } from '@/lib/utils';

/**
 * The page of «Contacto del día» that an email opens, set inside the app's own frame (16 Nov 2026, the owner: «sigue sin estar como
 * dentro de la app en sí, no hay forma de acceder al resto de la app desde este link… es una forma de acercarlo a la app»). Nobody
 * has to sign in to use the contacts, but the rest of ANTON.IA is now one click away: its menu at the side, as inside, and «Entrar»
 * at its foot. Each entry is the app's own address; without a session the app asks to sign in and then opens that screen.
 *
 * Only the work screens every team has: what depends on a team's plan or on a role cannot be asked of someone not signed in.
 */
const WORK = ['Centro de mando', 'Prospectar', 'Contactos', 'Seguimiento'];
export const dropFrameSections = (todayHref: string) => NAV_SECTIONS.filter(section => WORK.includes(section.label))
  .map(section => ({ label: section.label, items: section.items.filter(item => !item.feature).map(item => ({ href: item.href === '/dashboard' ? todayHref : item.href, icon: item.icon, label: item.label, today: item.href === '/dashboard' })) }))
  .filter(section => section.items.length > 0);

const itemClass = 'flex h-8 items-center gap-2 rounded-xl px-3 text-[0.95rem] font-medium text-sidebar-foreground/80 transition-colors duration-200 hover:bg-sidebar-accent/75 hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring';

export function DropAppFrame({ todayHref, signedIn, children }: {
  /** «Hoy» with these same contacts in view; plain «Hoy» when it was «Hoy» that sent the person here. */
  todayHref: string;
  /** Someone is signed in on this browser: the way in is said as opening, not as signing in. */
  signedIn: boolean;
  children: ReactNode;
}) {
  const sections = dropFrameSections(todayHref);
  const enter = signedIn ? 'Abrir ANTON.IA' : 'Entrar a ANTON.IA';
  return <div className="min-h-screen lg:grid lg:grid-cols-[16rem_minmax(0,1fr)]">
    {/* A wide screen: the app's menu at the side, as inside. */}
    <aside className="hidden border-r border-sidebar-border/70 bg-[linear-gradient(180deg,hsl(var(--sidebar-background))_0%,hsl(var(--sidebar-background))_68%,hsl(var(--background))_100%)] text-sidebar-foreground lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col">
      <div className="border-b border-sidebar-border/70 px-3 py-3"><Logo size="lg" /></div>
      <nav aria-label="Secciones de ANTON.IA" className="flex-1 space-y-2 overflow-y-auto px-2 py-2">
        {sections.map(section => <div key={section.label}>
          <p className="flex h-6 items-center px-3 text-[11px] font-medium uppercase tracking-[0.18em] text-sidebar-foreground/70">{section.label}</p>
          <ul className="space-y-0.5">
            {section.items.map(item => <li key={item.label}>
              <a href={item.href} className={itemClass}><item.icon className="h-4 w-4 shrink-0" aria-hidden="true" />{item.label}</a>
              {/* Where the person is: these contacts are the first thing of «Hoy». */}
              {item.today ? <p aria-current="page" className={cn(itemClass, 'ml-4 mt-0.5 bg-sidebar-accent/95 text-sidebar-accent-foreground hover:bg-sidebar-accent/95')}>
                <Sparkles className="h-4 w-4 shrink-0" aria-hidden="true" />Tus contactos de hoy</p> : null}
            </li>)}
          </ul>
        </div>)}
      </nav>
      <div className="space-y-2 border-t border-sidebar-border/70 px-3 py-3">
        <p className="text-xs leading-5 text-sidebar-foreground/70">{signedIn ? 'Todo lo que hagas aquí queda también dentro de ANTON.IA.'
          : 'Entra con tu cuenta para buscar más prospectos, seguir tus campañas y responder desde un solo lugar.'}</p>
        <Button asChild size="sm" variant="outline" className="w-full justify-between"><a href={todayHref}>{enter}<ArrowRight className="h-4 w-4" aria-hidden="true" /></a></Button>
      </div>
    </aside>
    <div className="min-w-0">
      {/* A phone: the brand and the way in at the top, and the app's screens in a row to slide. */}
      <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 lg:hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-2">
          <Logo size="sm" />
          <Button asChild size="sm" variant="outline"><a href={todayHref}>{enter}<ArrowRight className="ml-1.5 h-4 w-4" aria-hidden="true" /></a></Button>
        </div>
        <nav aria-label="Secciones de ANTON.IA" className="-mb-px flex gap-1 overflow-x-auto px-3 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {sections.flatMap(section => section.items).map(item => <a key={item.label} href={item.href}
            className="flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <item.icon className="h-3.5 w-3.5" aria-hidden="true" />{item.label}</a>)}
        </nav>
      </header>
      {children}
    </div>
  </div>;
}
