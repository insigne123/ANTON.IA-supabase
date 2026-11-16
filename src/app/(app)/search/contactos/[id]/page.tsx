import { redirect } from 'next/navigation';
import { dropHref } from '@/lib/lead-drops';

/**
 * Where «Contacto del día» lived until 16 Nov 2026, under «Buscar prospectos». Emails already sent link here: they open the same
 * contacts where they live now, under «Hoy», with what the link asked for.
 */
export default async function MovedLeadDropPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const kept = new URLSearchParams();
  for (const [name, value] of Object.entries(query)) if (typeof value === 'string') kept.set(name, value);
  const search = kept.toString();
  redirect(`${dropHref(id)}${search ? `?${search}` : ''}`);
}
