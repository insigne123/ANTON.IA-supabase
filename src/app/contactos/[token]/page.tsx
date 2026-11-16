import type { Metadata } from 'next';
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { dropHref } from '@/lib/lead-drops';
import { resolveDropLink } from '@/lib/server/lead-drop-mail';
import { LeadDropsError } from '@/lib/server/lead-drops';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';

export const dynamic = 'force-dynamic';
// The address is the way in: it is not indexed, and it is not handed to the pages it links to.
export const metadata: Metadata = { title: 'Tus contactos de hoy', robots: { index: false, follow: false }, referrer: 'no-referrer' };

const single = (value: string | string[] | undefined) => typeof value === 'string' ? value : null;
/** Who is signed in on this browser, if anyone. A session that cannot be read is no session. */
async function viewerId() {
  try {
    const { data: { user } } = await createServerComponentClient({ cookies }).auth.getUser();
    return user?.id ?? null;
  } catch { return null; }
}
/** The contacts' own page inside the app (LeadDropFlow), told what the email's button asked for. */
function inApp(dropId: string, query: Record<string, string | string[] | undefined>) {
  const params = new URLSearchParams();
  const focus = single(query.c);
  const todos = single(query.todos);
  if (focus) params.set('c', focus);
  if (todos === 'correo' || todos === 'telefono') params.set('todos', todos);
  // «Enriquecer y revisar · 1 crédito» of one contact: inside the app, behind the session, the lookup starts on arrival.
  if (focus && single(query.enriquecer) === '1') params.set('enriquecer', '1');
  if (focus && single(query.llamar) === '1') params.set('llamar', '1');
  const search = params.toString();
  return `${dropHref(dropId)}${search ? `?${search}` : ''}`;
}
const Notice = ({ title, text, href, action }: { title: string; text: string; href: string; action: string }) => <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-4 py-12">
  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">ANTON.IA</p>
  <h1 className="mt-1 font-headline text-2xl font-semibold tracking-tight">{title}</h1>
  <p className="mt-2 text-sm text-muted-foreground">{text}</p>
  <div className="mt-6"><Button asChild variant="outline"><Link href={href}>{action}</Link></Button></div>
</main>;

/**
 * The address the buttons of the «Contacto del día» emails open (docs/contacto-del-dia.md). It shows nothing of its own: it sends
 * the person to those contacts inside the app, in their account (16 Nov 2026, the owner: «lo que quería era que el redireccionamiento
 * lo llevara a su cuenta en la app, porque estos mails solo le llegarán a usuarios que hayan iniciado sesión alguna vez»). The signed
 * link says which contacts (src/lib/server/lead-drop-link.ts); the app's own page shows them (`/search/contactos/<id>`, LeadDropFlow),
 * with the contact, «Enriquecer los N» or the call the button asked for. Without a session the app asks to sign in and then opens
 * them; signed in with another account, the person is told which one the email is for, since that account has no such contacts.
 *
 * Opening it only reads: every step is a button inside the app.
 */
export default async function Page({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ token }, query] = await Promise.all([params, searchParams]);
  let target: string;
  try {
    const { dropId, scope } = await resolveDropLink(getSupabaseAdminClient(), token);
    const viewer = await viewerId();
    if (viewer && viewer !== scope.userId) {
      return <Notice title="Estos contactos son de otra cuenta" action="Ir a ANTON.IA" href="/dashboard"
        text="Este correo llegó para otra cuenta de ANTON.IA que la que tienes abierta en este navegador. Cierra sesión, entra con la cuenta que recibió el correo y vuelve a tocar el botón." />;
    }
    target = inApp(dropId, query);
  } catch (error) {
    const known = error instanceof LeadDropsError;
    const expired = known && error.status === 410;
    const down = !known || error.status >= 500;
    return <Notice title={down ? 'No pudimos abrir tus contactos' : expired ? 'Este enlace venció' : 'Este enlace no está disponible'} action="Entrar a ANTON.IA" href="/login"
      text={down ? 'Inténtalo de nuevo en unos minutos.' : 'Abre el correo más reciente de tus contactos: cada uno trae su propio enlace. También puedes verlos entrando a ANTON.IA.'} />;
  }
  // Outside the try: a redirect is thrown, and it is not an error of the link.
  redirect(target);
}
