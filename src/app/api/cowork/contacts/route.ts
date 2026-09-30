import { NextResponse } from 'next/server';
import { requireCoworkAccess } from '@/lib/server/cowork/access';
import { queryCoworkLeads } from '@/lib/server/cowork/lead-tools';
import { AuthError, handleAuthError } from '@/lib/server/auth-utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const privateHeaders = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
/** Contacts the «@» list shows at most. */
const SHOWN = 6;
const plain = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('es');

/**
 * Your saved contacts for the composer's «@» (plan 2, V6): the same search Cowork's `leads.search`
 * runs, on your own contacts only, through your session. It never calls the prospect provider or
 * spends credits. Without a query, the most recent ones. The page gets what the list shows.
 */
export async function GET(request: Request) {
  try {
    const auth = await requireCoworkAccess();
    const asked = (new URL(request.url).searchParams.get('q') || '').slice(0, 60);
    // Only signs are no search at all: nothing to look for, not an error.
    const query = asked.replace(/[^\p{L}\p{N}\s@.-]/gu, ' ').trim();
    if (asked.trim() && !query) return NextResponse.json({ contacts: [] }, { headers: privateHeaders });
    // One letter is too little for the search (it takes two): the most recent ones whose name starts with it.
    const initial = query.split(/\s+/).some(term => term.length >= 2) ? '' : plain(query);
    const result = await queryCoworkLeads(auth.supabase, { userId: auth.user.id, organizationId: auth.organizationId }, 'leads.search', initial ? '' : query);
    const contacts = (result.items as Array<{ id: string; name?: string | null; title?: string | null; company?: string | null; email?: string | null }>)
      .filter(row => row.name?.trim() && (!initial || plain(row.name).split(/\s+/).some(word => word.startsWith(initial)))).slice(0, SHOWN)
      .map(row => ({ id: row.id, name: String(row.name).trim(), title: row.title || null, company: row.company || null, hasEmail: Boolean(row.email) }));
    return NextResponse.json({ contacts }, { headers: privateHeaders });
  } catch (error) {
    if (error instanceof AuthError) {
      const response = handleAuthError(error);
      response.headers.set('Cache-Control', 'private, no-store');
      return response;
    }
    return NextResponse.json({ error: 'No se pudieron buscar tus contactos.' }, { status: 503, headers: privateHeaders });
  }
}
