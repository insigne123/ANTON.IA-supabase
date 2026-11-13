'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowRight, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { dropHref } from '@/lib/lead-drops';
import type { DropBoard } from './TodayContacts';

type Pull = 'first' | 'today' | 'preparing' | 'profile';
type Plan = { size: number; days: number };
/** What «Hoy» reads once about the contacts of the day (/api/lead-drops/latest) and hands to this line and to TodayContacts. */
export type HomeDrops = {
  drop: { id: string; dropDate: string; total: number; left: number; lookup?: boolean; campaigns?: boolean;
    next?: { name: string; company: string | null; why: string; lookup?: boolean } } | null;
  pull?: Pull | null;
  /** The team's own plan, when it gets several contacts a day (organizations.lead_drop_size). */
  plan?: Plan | null;
  /** Several contacts, shown in full at the top of «Hoy» (TodayContacts): this line then says nothing. */
  board?: DropBoard | null;
};

/** What «Hoy» offers when there is no contact to save (src/lib/server/lead-drops.ts, pullStatus). */
const OFFER: Record<Pull, { text: string; action: string; href: string }> = {
  first: { text: 'Un contacto nuevo elegido con tu cliente ideal, con por qué te lo recomendamos, un primer correo y tres seguimientos.', action: 'Ver mi primer contacto', href: dropHref('nuevo') },
  today: { text: 'Hoy te toca un contacto nuevo, con por qué te lo recomendamos, un primer correo y tres seguimientos.', action: 'Ver mi contacto de hoy', href: dropHref('nuevo') },
  preparing: { text: 'Estamos preparando tu contacto de hoy, con su investigación, un primer correo y sus seguimientos.', action: 'Ver cómo va', href: dropHref('nuevo') },
  profile: { text: 'Cuéntanos a quién le vendes y tres días a la semana te elegimos un contacto nuevo.', action: 'Completar mi cliente ideal', href: '/profile#icp-heading' },
};
/** The same offers for a team that gets several contacts a day: how many, and each with its campaign written. */
function planOffer(pull: Pull, { size, days }: Plan): { text: string; action: string; href: string } {
  const often = days >= 5 ? 'cada día hábil' : `${days} ${days === 1 ? 'día' : 'días'} a la semana`;
  if (pull === 'first') return { ...OFFER.first, text: `${size} contactos nuevos elegidos con tu cliente ideal, cada uno con por qué te lo recomendamos y su campaña lista.`, action: 'Ver mis primeros contactos' };
  if (pull === 'today') return { ...OFFER.today, text: `Hoy te tocan ${size} contactos nuevos, cada uno con por qué te lo recomendamos y su campaña lista.`, action: 'Ver mis contactos de hoy' };
  if (pull === 'preparing') return { ...OFFER.preparing, text: `Estamos preparando tus ${size} contactos de hoy, cada uno con su investigación y su campaña.` };
  return { ...OFFER.profile, text: `Cuéntanos a quién le vendes y ${often} te elegimos ${size} contactos nuevos.` };
}

function Banner({ text, children, accent }: { text: ReactNode; children: ReactNode; accent?: boolean }) {
  return <Card className={accent ? 'rounded-2xl border-primary/25 bg-primary/5' : 'rounded-2xl'} data-tour="lead-drop">
    <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="min-w-0 space-y-1">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold"><Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />Contacto del día</h2>
        {/* On the tinted card the muted grey fell under 4.5:1 (axe, 9 Nov 2026): the same grey the rest of «Hoy» uses for secondary text. */}
        <div className="text-sm text-foreground/75">{text}</div>
      </div>
      <div className="sm:w-56 sm:shrink-0">{children}</div>
    </CardContent>
  </Card>;
}

/**
 * «Contacto del día» in «Hoy» (src/lib/lead-drops.ts): the contact while it is left to save; otherwise, for whoever gets
 * no email too, today's on Tuesdays, Wednesdays and Fridays (any day for the first one), made at that moment. It sits in the
 * main column, under the next step, so on a phone it is the second thing and not the fourth. `quietProfile`: when the next
 * step already leads to «Perfil», its own offer to fill in the ideal customer would be a second button to the same place.
 * «Hoy» reads the contacts once and hands them here (`data`): several contacts are the section at the top of the page instead.
 */
export function LeadDropBanner({ data, quietProfile = false }: { data: HomeDrops | null | undefined; quietProfile?: boolean }) {
  const drop = data?.drop;
  if (!drop) {
    if (quietProfile && data?.pull === 'profile') return null;
    const offer = data?.pull ? (data.plan && data.plan.size > 1 ? planOffer(data.pull, data.plan) : OFFER[data.pull]) : null;
    if (!offer) return null;
    return <Banner text={<p>{offer.text}</p>}>
      <Button asChild size="sm" variant="outline" className="w-full justify-between">
        <Link href={offer.href}>{offer.action}<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
      </Button>
    </Banner>;
  }
  const next = drop.next;
  // Found with Apollo (since 3 Nov 2026), its email is looked up on saving: one credit, said before the click.
  const text = drop.total === 1 && next
    ? <><p className="font-medium text-foreground">{next.name}{next.company ? `, ${next.company}` : ''}</p>
      <p>{next.why} {next.lookup ? 'Trae un primer correo y tres seguimientos; ver su correo y guardarlo usa 1 crédito.' : 'Ya tiene su correo verificado: guardarlo no gasta créditos.'}</p></>
    // Several found with Apollo: no email is promised (each is looked up, a credit each), and each brings its campaign to approve.
    : drop.lookup ? <p>{drop.left === drop.total
      ? `${drop.total} contactos nuevos para ti${drop.campaigns ? ', cada uno con su campaña lista' : ''}. Ver el correo de cada uno usa 1 crédito.`
      : `Te ${drop.left === 1 ? 'queda 1 contacto' : `quedan ${drop.left} contactos`} de ${drop.total} por revisar. Ver el correo de cada uno usa 1 crédito.`}</p>
    : <p>{drop.left === drop.total
      ? `${drop.total === 1 ? 'Un contacto nuevo' : `${drop.total} contactos nuevos`} para ti, con correo verificado. Guardarlos no gasta créditos.`
      : `Te ${drop.left === 1 ? 'falta guardar 1' : `faltan guardar ${drop.left}`} de ${drop.total}.`}</p>;
  return <Banner accent text={text}>
    <Button asChild size="sm" variant="outline" className="w-full justify-between">
      <Link href={dropHref(drop.id)}>{drop.lookup && drop.total > 1 ? 'Revisar mis contactos' : 'Ver y guardar'}<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
    </Button>
  </Banner>;
}
