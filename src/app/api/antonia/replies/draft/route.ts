import { NextRequest, NextResponse } from 'next/server';

import { handleAuthError, requireAuth } from '@/lib/server/auth-utils';
import { draftAutonomousReply } from '@/lib/server/antonia-reply-drafting';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { maybeEscalateAutonomousReplyReview } from '@/lib/server/antonia-reply-escalation';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const { user, organizationId } = await requireAuth();
    const body = await req.json().catch(() => ({}));

    const contactedId = String(body?.contactedId || '').trim();
    if (!contactedId) {
      return NextResponse.json({ error: 'Missing contactedId' }, { status: 400 });
    }

    const result = await draftAutonomousReply({
      organizationId,
      userId: user.id,
      contactedId,
      rawReply: typeof body?.rawReply === 'string' ? body.rawReply : undefined,
      replySubject: typeof body?.replySubject === 'string' ? body.replySubject : undefined,
      assets: Array.isArray(body?.assets) ? body.assets : undefined,
    });

    let exception = null;
    if (body?.escalate === true) {
      exception = await maybeEscalateAutonomousReplyReview({
        supabase: getSupabaseAdminClient(),
        organizationId,
        missionId: result.contactedLead.missionId || null,
        leadId: result.contactedLead.leadId || null,
        contactedId,
        lead: {
          name: result.contactedLead.name,
          fullName: result.contactedLead.name,
          email: result.contactedLead.email,
          company: result.contactedLead.company,
          companyName: result.contactedLead.company,
          title: result.contactedLead.role,
        },
        classification: result.classification,
        decision: result.decision,
        preview: result.classification.summary || null,
        suggestedReply: result.draft?.bodyText || null,
        validationIssues: result.validation?.issues || [],
      });
    }

    return NextResponse.json({ ...result, exception }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return handleAuthError(error);
  }
}
