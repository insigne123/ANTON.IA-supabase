import { after, NextResponse } from 'next/server';
import { z } from 'zod';
import { approveDropCampaign, dropEmailsSchema, dropFeedbackSchema, editDropEmails, mailDropCampaign, saveDropFeedback } from '@/lib/server/lead-drop-campaign';
import { enrichDropLead, linkAuth, mailDropView, resolveDropLink, switchDropCampaign } from '@/lib/server/lead-drop-mail';
import { LeadDropsError, saveDropLeads } from '@/lib/server/lead-drops';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';

export const dynamic = 'force-dynamic';
// A lookup waits for the provider (lead-drop-mail.ts, 100 s at most).
export const maxDuration = 120;
const headers = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' };

const LeadId = z.string().regex(/^(?:lf_)?[0-9a-f]{24}$/i);
const Token = z.string().regex(/^[A-Za-z0-9_-]{48}$/);
const one = <A extends string, S extends z.ZodRawShape>(action: A, shape: S) => z.object({ token: Token, action: z.literal(action), ...shape }).strict();
const Body = z.discriminatedUnion('action', [
  one('read', {}),
  one('enrich', { leadId: LeadId }),
  one('save', { leadId: LeadId }),
  one('edit', { leadId: LeadId, emails: dropEmailsSchema }),
  one('feedback', { leadId: LeadId, feedback: dropFeedbackSchema }),
  one('approve', { leadId: LeadId }),
  one('pause', { leadId: LeadId }),
  one('resume', { leadId: LeadId }),
]);

/**
 * «Contacto del día» used from the person's inbox (src/lib/server/lead-drop-mail.ts): the signed link of the email is who asks, so
 * nothing here reads a session. Always a POST with the link in its body: an address that a mail scanner follows never looks an email
 * up, approves a campaign or stops one. Each answer carries the contacts as they are now.
 */
export async function POST(request: Request) {
  try {
    const body = Body.safeParse(await request.json().catch(() => null));
    if (!body.success) return NextResponse.json({ error: 'Solicitud no válida.' }, { status: 400, headers });
    const data = body.data;
    const admin = getSupabaseAdminClient();
    const { dropId, scope } = await resolveDropLink(admin, data.token);
    let extra: Record<string, unknown> = {};
    // Opened by a person: the first button they press says so (arriving does not, a mail scanner arrives too).
    if (data.action !== 'read') await admin.from('lead_drops').update({ opened_at: new Date().toISOString() }).eq('id', dropId).is('opened_at', null);
    if (data.action === 'enrich') {
      const lookup = await enrichDropLead(admin, scope, dropId, data.leadId);
      extra = { lookup };
      // With its email found, the campaign goes to the person's inbox to read (once).
      if (lookup.outcome === 'found') after(() => mailDropCampaign(admin, scope, dropId, data.leadId).catch(() => null));
    } else if (data.action === 'save') {
      const saved = await saveDropLeads(admin, scope, dropId, [data.leadId]);
      extra = { saved: saved.saved.length, expired: saved.expired.length };
    } else if (data.action === 'edit') {
      await editDropEmails(admin, scope, dropId, data.leadId, data.emails);
    } else if (data.action === 'feedback') {
      await saveDropFeedback(admin, scope, dropId, data.leadId, data.feedback);
    } else if (data.action === 'approve') {
      const done = await approveDropCampaign(linkAuth(admin, scope), admin, dropId, data.leadId);
      extra = { provider: done.provider, schedule: done.schedule };
    } else if (data.action === 'pause' || data.action === 'resume') {
      await switchDropCampaign(admin, scope, dropId, data.leadId, data.action);
    }
    const view = await mailDropView(admin, scope, dropId);
    // A lookup that was still running when the person asked has landed: its campaign goes to their inbox now.
    if (data.action === 'read') {
      const due = view.items.filter(item => view.emails[item.leadId] && item.draft && !item.campaign && !item.campaignMailedAt);
      if (due.length) after(async () => { for (const item of due) await mailDropCampaign(admin, scope, dropId, item.leadId).catch(() => null); });
    }
    return NextResponse.json({ view, ...extra }, { headers });
  } catch (error) {
    if (error instanceof LeadDropsError) return NextResponse.json({ error: error.message }, { status: error.status, headers });
    console.error('[lead-drops/link] failed:', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'No pudimos completar la acción. Inténtalo de nuevo.' }, { status: 500, headers });
  }
}
