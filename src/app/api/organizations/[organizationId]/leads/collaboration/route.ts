import { NextResponse } from 'next/server';
import { z } from 'zod';

import { requireAuth } from '@/lib/server/auth-utils';
import {
  leadCollaborationPermissions,
  requireOrganizationCollaborationEnabled,
} from '@/lib/server/lead-collaboration';
import { assertOrganizationAccess, organizationApiError, organizationNoStoreHeaders } from '@/lib/server/organization-api';

export const dynamic = 'force-dynamic';

const ParamsSchema = z.object({ organizationId: z.string().uuid() }).strict();
const BodySchema = z.object({
  leadIds: z.array(z.string().uuid()).min(1).max(100).transform((ids) => [...new Set(ids)]),
}).strict();

export async function POST(request: Request, context: { params: Promise<{ organizationId: string }> }) {
  try {
    const auth = await requireAuth();
    const params = ParamsSchema.parse(await context.params);
    const body = BodySchema.parse(await request.json().catch(() => null));
    assertOrganizationAccess(auth, params.organizationId);
    await requireOrganizationCollaborationEnabled(auth, params.organizationId);

    const leadsResult = await auth.supabase
      .from('leads')
      .select('id,email')
      .eq('organization_id', params.organizationId)
      .in('id', body.leadIds);
    if (leadsResult.error) throw leadsResult.error;
    const leads = leadsResult.data || [];
    if (leads.length === 0) {
      return NextResponse.json({ members: [], results: {} }, { headers: organizationNoStoreHeaders });
    }

    const leadIds = leads.map((lead: any) => String(lead.id));
    const emails = [...new Set(leads
      .map((lead: any) => String(lead.email || '').trim().toLowerCase())
      .filter(Boolean))];
    const [collaborationsResult, membersResult, leadThreadsResult, emailThreadsResult] = await Promise.all([
      auth.supabase
        .from('organization_lead_collaboration')
        .select('*')
        .eq('organization_id', params.organizationId)
        .in('lead_id', leadIds),
      auth.supabase
        .from('organization_members')
        .select('user_id,role,profiles:user_id(full_name,email,avatar_url)')
        .eq('organization_id', params.organizationId)
        .order('created_at', { ascending: true }),
      auth.supabase
        .from('organization_contact_threads')
        .select('*')
        .eq('organization_id', params.organizationId)
        .in('active_lead_id', leadIds)
        .order('updated_at', { ascending: false }),
      emails.length > 0
        ? auth.supabase
          .from('organization_contact_threads')
          .select('*')
          .eq('organization_id', params.organizationId)
          .eq('channel', 'email')
          .in('recipient_key', emails)
        : Promise.resolve({ data: [], error: null }),
    ]);
    for (const result of [collaborationsResult, membersResult, leadThreadsResult, emailThreadsResult]) {
      if (result.error) throw result.error;
    }

    const collaborations = new Map((collaborationsResult.data || []).map((row: any) => [String(row.lead_id), row]));
    const leadThreads = new Map<string, any>();
    for (const row of leadThreadsResult.data || []) {
      const id = String(row.active_lead_id || '');
      if (id && !leadThreads.has(id)) leadThreads.set(id, row);
    }
    const emailThreads = new Map((emailThreadsResult.data || []).map((row: any) => [String(row.recipient_key), row]));
    const role = auth.memberships?.find((membership) => membership.organizationId === params.organizationId)?.role || 'member';
    const results: Record<string, unknown> = {};

    for (const lead of leads) {
      const leadId = String(lead.id);
      const collaboration = collaborations.get(leadId) || null;
      const contactThread = leadThreads.get(leadId)
        || emailThreads.get(String(lead.email || '').trim().toLowerCase())
        || null;
      results[leadId] = {
        collaboration,
        contactThread,
        permissions: leadCollaborationPermissions({
          role,
          userId: auth.user.id,
          collaboration,
          contactThread,
        }),
      };
    }

    return NextResponse.json({ members: membersResult.data || [], results }, { headers: organizationNoStoreHeaders });
  } catch (error) {
    return organizationApiError(error, 'LEAD_COLLABORATION_BATCH_READ_FAILED');
  }
}
