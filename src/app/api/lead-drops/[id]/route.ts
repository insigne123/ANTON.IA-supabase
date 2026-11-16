import { after, NextResponse } from 'next/server';
import { z } from 'zod';
import { AuthError, handleAuthError } from '@/lib/server/auth-utils';
import { requireHomeAuth } from '@/lib/server/home-auth';
import { LeadDropsError, dropOwner, keepDropLead, linkDropLead, readDrop, saveDropLeads } from '@/lib/server/lead-drops';
import { approveDropCampaign, dropEmailsSchema, dropFeedbackSchema, editDropEmails, mailDropCampaign, saveDropFeedback } from '@/lib/server/lead-drop-campaign';
import { findDropPhone, prepareDropCall, withDropPhones } from '@/lib/server/lead-drop-call';
import { enrichDropLead } from '@/lib/server/lead-drop-mail';
import { mailDropCalls, mailDropReady, prepareDropCalls } from '@/lib/server/lead-drop-ready';
import { requestAuthErrorResponse } from '@/lib/server/request-auth';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';

export const dynamic = 'force-dynamic';
// A mobile's lookup waits for the provider (lead-drop-call.ts, 100 s at most).
export const maxDuration = 120;
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
    const drop = await readDrop(admin, { organizationId, userId: user.id }, id.data).catch(async (error: unknown) => {
      if (!(error instanceof LeadDropsError) || error.status !== 404) throw error;
      // Not this person's in this workspace (16 Nov 2026, the owner opened the email of one account signed in with another, in
      // another workspace, and the app only said it found nothing). Theirs in another workspace: the app moves there and opens
      // them. Another account's: said as such, with nothing of them shown.
      const owner = await dropOwner(admin, id.data).catch(() => null);
      if (owner && owner.userId === user.id && owner.organizationId !== organizationId) return { moved: owner.organizationId };
      if (owner && owner.userId !== user.id) return { other: true as const };
      throw error;
    });
    if ('moved' in drop) return NextResponse.json({ error: 'Estos contactos son de otro de tus espacios de trabajo.', code: 'other_workspace', organizationId: drop.moved }, { status: 409, headers: noStore });
    if ('other' in drop) return NextResponse.json({ error: 'Estos contactos son de otra cuenta de ANTON.IA, no de la que tienes abierta. Cierra sesión y entra con la cuenta que recibió el correo.', code: 'other_account' }, { status: 404, headers: noStore });
    if (!drop.opened_at) await admin.from('lead_drops').update({ opened_at: new Date().toISOString() }).eq('id', drop.id);
    return NextResponse.json({ id: drop.id, date: drop.drop_date, criteria: drop.criteria, items: await withDropPhones(admin, { organizationId, userId: user.id }, drop.items) }, { headers: noStore });
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
  // «Para llamar» (src/lib/server/lead-drop-call.ts): the mobile of a contact already in «Por escribir», and the script of its call.
  z.object({ action: z.literal('phone'), leadId: LeadId }).strict(),
  z.object({ action: z.literal('script'), leadId: LeadId, fresh: z.boolean().optional() }).strict(),
  // «Enriquecer los N» (16 Nov 2026): each contact looked up by the server, one after another, as from the email's page; `ready`
  // sends the one answer for all of them to the person's inbox, in the conversation of the morning email.
  z.object({ action: z.literal('enrich'), leadId: LeadId, phone: z.boolean().optional() }).strict(),
  z.object({ action: z.literal('ready'), phone: z.boolean().optional() }).strict(),
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
    // Every answer brings the contacts as they are now, each saved one with where its mobile stands.
    const shown = async <T extends { items: Parameters<typeof withDropPhones>[2] }>(result: T) => ({ ...result, items: await withDropPhones(admin, scope, result.items) });
    if (body.data.action === 'keep') {
      return NextResponse.json(await shown(await keepDropLead(auth, admin, id.data, body.data.leadId)), { headers: noStore });
    }
    if (body.data.action === 'phone') {
      const phone = await findDropPhone(admin, scope, id.data, body.data.leadId);
      return NextResponse.json(await shown({ phone, items: (await readDrop(admin, scope, id.data)).items }), { headers: noStore });
    }
    if (body.data.action === 'script') {
      return NextResponse.json(await shown(await prepareDropCall(admin, scope, id.data, body.data.leadId, { fresh: body.data.fresh })), { headers: noStore });
    }
    if (body.data.action === 'enrich') {
      const lookup = await enrichDropLead(admin, scope, id.data, body.data.leadId, { phone: body.data.phone });
      return NextResponse.json(await shown({ lookup, items: (await readDrop(admin, scope, id.data)).items }), { headers: noStore });
    }
    if (body.data.action === 'ready') {
      // Within the request: the page waits for this answer to say the email is on its way. With their mobiles asked, the script
      // of each call is written now, so the email that brings each number has it (src/lib/server/lead-drop-ready.ts).
      if (body.data.phone) await prepareDropCalls(admin, scope, id.data).catch(() => null);
      const mailed = await mailDropReady(admin, scope, id.data, { phones: Boolean(body.data.phone) }).catch(() => ({ sent: false as const }));
      if (body.data.phone) await mailDropCalls(admin, scope, id.data).catch(() => null);
      return NextResponse.json(await shown({ mailed: mailed.sent, items: (await readDrop(admin, scope, id.data)).items }), { headers: noStore });
    }
    if (body.data.action === 'link') {
      const leadId = body.data.leadId;
      const linked = await linkDropLead(admin, scope, id.data, leadId);
      // With its email found, the campaign goes to the person's inbox to read (once, and only in a drop of several contacts).
      if (linked.linked) after(() => mailDropCampaign(admin, scope, id.data, leadId).catch(() => null));
      return NextResponse.json(await shown(linked), { headers: noStore });
    }
    if (body.data.action === 'edit') {
      return NextResponse.json(await shown(await editDropEmails(admin, scope, id.data, body.data.leadId, body.data.emails)), { headers: noStore });
    }
    if (body.data.action === 'feedback') {
      return NextResponse.json(await shown(await saveDropFeedback(admin, scope, id.data, body.data.leadId, body.data.feedback)), { headers: noStore });
    }
    if (body.data.action === 'approve') {
      return NextResponse.json(await shown(await approveDropCampaign(auth, admin, id.data, body.data.leadId)), { headers: noStore });
    }
    const result = await saveDropLeads(admin, scope, id.data, body.data.leadIds);
    return NextResponse.json({ saved: result.saved.length, expired: result.expired.length, items: await withDropPhones(admin, scope, result.items) }, { headers: noStore });
  } catch (error) {
    return failure(error);
  }
}
