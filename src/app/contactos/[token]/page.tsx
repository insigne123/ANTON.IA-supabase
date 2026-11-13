import type { Metadata } from 'next';
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { DropMailFlow } from '@/components/lead-drops/DropMailFlow';
import { Button } from '@/components/ui/button';
import { mailDropView, resolveDropLink } from '@/lib/server/lead-drop-mail';
import { LeadDropsError } from '@/lib/server/lead-drops';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';

export const dynamic = 'force-dynamic';
// The address is the way in: it is not indexed, and it is not handed to the pages it links to.
export const metadata: Metadata = { title: 'Tus contactos de hoy', robots: { index: false, follow: false }, referrer: 'no-referrer' };

const single = (value: string | string[] | undefined) => typeof value === 'string' ? value : null;
/** Whether this browser is signed in as the person the link names. A session that cannot be read is no session. */
async function signedInAs(userId: string) {
  try {
    const { data: { user } } = await createServerComponentClient({ cookies }).auth.getUser();
    return user?.id === userId;
  } catch { return false; }
}
/** «Hoy», told which email's contacts to bring into view (src/components/home/TodayContacts.tsx). */
const inApp = (token: string, leadId: string | null) => `/dashboard?contactos=${encodeURIComponent(token)}${leadId ? `&c=${encodeURIComponent(leadId)}` : ''}`;

/**
 * «Contacto del día» from the person's inbox (docs/contacto-del-dia.md): the page the buttons of its emails open, outside the app and
 * without signing in. The signed link in the address says whose drop it is (src/lib/server/lead-drop-link.ts). Opening it only reads:
 * each step is a button on the page.
 *
 * Whoever is already signed in as that person gets the same contacts inside the app, in «Hoy» (13 Nov 2026, the owner: «si nos vas a
 * llevar para la app, que sea realmente dentro de la app»); nobody is asked to sign in for it. «Hoy» sends back here, with `aqui=1`,
 * the links it cannot show (an earlier email's, another team's), and coming back from connecting a mailbox (`correo`) stays here.
 */
export default async function Page({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ token }, query] = await Promise.all([params, searchParams]);
  const focus = single(query.c);
  const stay = single(query.aqui) === '1';
  let inside = false;
  try {
    const admin = getSupabaseAdminClient();
    const { dropId, scope } = await resolveDropLink(admin, token);
    inside = !stay && !single(query.correo) && await signedInAs(scope.userId);
    if (!inside) {
      const view = await mailDropView(admin, scope, dropId);
      // From «Hoy» there is no way back into it: it sent the person here.
      return <DropMailFlow token={token} initial={view} focus={focus} mailboxNotice={single(query.correo)} appHref={stay ? null : inApp(token, null)} />;
    }
  } catch (error) {
    const known = error instanceof LeadDropsError;
    const expired = known && error.status === 410;
    const down = !known || error.status >= 500;
    return <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-4 py-12">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">ANTON.IA</p>
      <h1 className="mt-1 font-headline text-2xl font-semibold tracking-tight">{down ? 'No pudimos abrir tus contactos' : expired ? 'Este enlace venció' : 'Este enlace no está disponible'}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{down ? 'Inténtalo de nuevo en unos minutos.'
        : 'Abre el correo más reciente de tus contactos: cada uno trae su propio enlace. También puedes verlos entrando a ANTON.IA.'}</p>
      <div className="mt-6"><Button asChild variant="outline"><Link href="/login">Entrar a ANTON.IA</Link></Button></div>
    </main>;
  }
  // Outside the try: a redirect is thrown, and it is not an error of the link.
  redirect(inApp(token, focus));
}
