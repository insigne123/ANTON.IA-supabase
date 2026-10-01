import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireCoworkAccess } from '@/lib/server/cowork/access';
import { AuthError, handleAuthError } from '@/lib/server/auth-utils';
import { saveCoworkContact } from '@/lib/server/cowork/save-contact';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';

export const dynamic = 'force-dynamic';
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireCoworkAccess();
    const id = z.string().uuid().parse((await context.params).id);
    const input = await req.json();
    const result = await saveCoworkContact(auth, id, input);
    // Saving from the panel stays in the conversation: the next turns see who was saved and never propose saving them again.
    const lead = (result.lead || {}) as { id?: unknown; name?: unknown; company?: unknown };
    await getSupabaseAdminClient().from('cowork_run_events').insert({
      run_id: id, user_id: auth.user.id, organization_id: auth.organizationId, kind: 'contact.saved',
      payload: { leadId: String(lead.id || ''), name: lead.name ?? null, company: lead.company ?? null, providerId: String(input?.providerId || ''),
        reused: result.reused, source: 'panel' },
    }).then(() => undefined, () => undefined);
    return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof AuthError) return handleAuthError(error);
    return NextResponse.json({ error: 'No se pudo confirmar el guardado. Reintentar no reemplaza los datos del contacto.' },
      { status: error instanceof z.ZodError || error instanceof SyntaxError ? 400 : 503, headers: { 'Cache-Control': 'private, no-store' } });
  }
}
