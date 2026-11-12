import { NextResponse } from 'next/server';
import { z } from 'zod';
import { AuthError, handleAuthError } from '@/lib/server/auth-utils';
import { requireHomeAuth } from '@/lib/server/home-auth';
import { LeadDropsError, keepDropLead, linkDropLead, readDrop, saveDropLeads } from '@/lib/server/lead-drops';
import { approveDropCampaign, dropEmailsSchema, dropFeedbackSchema, editDropEmails, saveDropFeedback } from '@/lib/server/lead-drop-campaign';
import { requestAuthErrorResponse } from '@/lib/server/request-auth';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';

export const dynamic = 'force-dynamic';
const noStore = { 'Cache-Control': 'private, no-store' };
const failure = (error: unknown) => requestAuthErrorResponse(error) || handleAuthError(error instanceof LeadDropsError ? new AuthError(error.message, error.status) : error);
const Id = z.string().uuid();

/** «Contacto del día» (src/lib/lead-drops.ts) of the signed-in person: never the email or the phone before they save it. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { organizationId, user } = await requireHomeAuth(request);
    const id = Id.safeParse((await context.params).id);
    if (!id.success) throw new AuthError('No encontramos esos contactos.', 404);
    const admin = getSupabaseAdminClient();
    const drop = await readDrop(admin, { organizationId, userId: user.id }, id.data);
    if (!drop.opened_at) await admin.from('lead_drops').update({ opened_at: new Date().toISOString() }).eq('id', drop.id);
    return NextResponse.json({ id: drop.id, date: drop.drop_date, criteria: drop.criteria, items: drop.items }, { headers: noStore });
  } catch (error) {
    return failure(error);
  }
}

const LeadId = z.string().regex(/^(?:lf_)?[0-9a-f]{24}$/i);
const BodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('save'), leadIds: z.array(LeadId).max(10).optional() }).strict(),
  // «Enriquecer y guardar» of an Apollo contact: kept as a saved contact, its email looked up from the browser, then linked.
  z.object({ action: z.literal('keep'), leadId: LeadId }).strict(),
  z.object({ action: z.literal('link'), leadId: LeadId }).strict(),
  // The person's own text for the emails, what they think of the contact, and «Aprobar y programar» (lead-drop-campaign.ts).
  z.object({ action: z.literal('edit'), leadId: LeadId, emails: dropEmailsSchema }).strict(),
  z.object({ action: z.literal('feedback'), leadId: LeadId, feedback: dropFeedbackSchema }).strict(),
  z.object({ action: z.literal('approve'), leadId: LeadId }).strict(),
]);

/**
 * Saves contacts of the drop: with `save`, those whose email came with the search, in «Por escribir», without credits; with
 * `keep` and `link`, an Apollo contact, before and after its email is looked up (src/lib/server/lead-drops.ts, keepDropLead).
 * `edit` keeps the person's text for a contact's emails, `feedback` what they think of it, and `approve` starts its campaign
 * from their mailbox.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireHomeAuth(request);
    const scope = { organizationId: auth.organizationId, userId: auth.user.id };
    const id = Id.safeParse((await context.params).id);
    if (!id.success) throw new AuthError('No encontramos esos contactos.', 404);
    const body = BodySchema.safeParse(await request.json().catch(() => null));
    if (!body.success) throw new AuthError('Solicitud no válida.', 400);
    const admin = getSupabaseAdminClient();
    if (body.data.action === 'keep') {
      return NextResponse.json(await keepDropLead(auth, admin, id.data, body.data.leadId), { headers: noStore });
    }
    if (body.data.action === 'link') {
      return NextResponse.json(await linkDropLead(admin, scope, id.data, body.data.leadId), { headers: noStore });
    }
    if (body.data.action === 'edit') {
      return NextResponse.json(await editDropEmails(admin, scope, id.data, body.data.leadId, body.data.emails), { headers: noStore });
    }
    if (body.data.action === 'feedback') {
      return NextResponse.json(await saveDropFeedback(admin, scope, id.data, body.data.leadId, body.data.feedback), { headers: noStore });
    }
    if (body.data.action === 'approve') {
      return NextResponse.json(await approveDropCampaign(auth, admin, id.data, body.data.leadId), { headers: noStore });
    }
    const result = await saveDropLeads(admin, scope, id.data, body.data.leadIds);
    return NextResponse.json({ saved: result.saved.length, expired: result.expired.length, items: result.items }, { headers: noStore });
  } catch (error) {
    return failure(error);
  }
}
