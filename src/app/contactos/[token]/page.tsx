import type { Metadata } from 'next';
import Link from 'next/link';
import { DropMailFlow } from '@/components/lead-drops/DropMailFlow';
import { Button } from '@/components/ui/button';
import { mailDropView, resolveDropLink } from '@/lib/server/lead-drop-mail';
import { LeadDropsError } from '@/lib/server/lead-drops';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';

export const dynamic = 'force-dynamic';
// The address is the way in: it is not indexed, and it is not handed to the pages it links to.
export const metadata: Metadata = { title: 'Tus contactos de hoy', robots: { index: false, follow: false }, referrer: 'no-referrer' };

const single = (value: string | string[] | undefined) => typeof value === 'string' ? value : null;

/**
 * «Contacto del día» from the person's inbox (docs/contacto-del-dia.md): the page the buttons of its emails open, outside the app and
 * without signing in. The signed link in the address says whose drop it is (src/lib/server/lead-drop-link.ts). Opening it only reads:
 * each step is a button on the page.
 */
export default async function Page({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ token }, query] = await Promise.all([params, searchParams]);
  try {
    const admin = getSupabaseAdminClient();
    const { dropId, scope } = await resolveDropLink(admin, token);
    const view = await mailDropView(admin, scope, dropId);
    return <DropMailFlow token={token} initial={view} focus={single(query.c)} mailboxNotice={single(query.correo)} />;
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
}
