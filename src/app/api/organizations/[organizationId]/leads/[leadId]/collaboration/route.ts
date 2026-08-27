import { NextResponse } from 'next/server';
import { z } from 'zod';

import { requireAuth } from '@/lib/server/auth-utils';
import {
  leadCollaborationPermissions,
  requireOrganizationCollaborationEnabled,
} from '@/lib/server/lead-collaboration';
import { assertOrganizationAccess, organizationApiError, organizationNoStoreHeaders } from '@/lib/server/organization-api';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ParamsSchema = z.object({
  organizationId: z.string().uuid(),
  leadId: z.string().uuid(),
}).strict();
const AssignmentSchema = z.object({ assignedToUserId: z.string().uuid() }).strict();
const ActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('claim'), minutes: z.number().int().min(1).max(60).default(15) }).strict(),
  z.object({
    action: z.literal('reopen'),
    contactThreadId: z.string().uuid(),
    reason: z.string().trim().min(3).max(1000),
  }).strict(),
]);

async function readLead(auth: Awaited<ReturnType<typeof requireAuth>>, organizationId: string, leadId: string) {
  const { data, error } = await auth.supabase
    .from('leads')
    .select('id,email')
    .eq('id', leadId)
    .eq('organization_id', organizationId)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    const notFound = new Error('Lead not found');
    (notFound as any).code = 'P0002';
    throw notFound;
  }
  return data;
}

async function readContactThread(auth: Awaited<ReturnType<typeof requireAuth>>, organizationId: string, leadId: string, email: string | null) {
  const leadThread = await auth.supabase
    .from('organization_contact_threads')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('active_lead_id', leadId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (leadThread.error) throw leadThread.error;
  if (leadThread.data) return leadThread.data;

  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail) return null;
  const emailThread = await auth.supabase
    .from('organization_contact_threads')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('channel', 'email')
    .eq('recipient_key', normalizedEmail)
    .maybeSingle();
  if (emailThread.error) throw emailThread.error;
  return emailThread.data || null;
}

async function collaborationResponse(
  auth: Awaited<ReturnType<typeof requireAuth>>,
  organizationId: string,
  leadId: string,
) {
  const lead = await readLead(auth, organizationId, leadId);
  const [collaborationResult, membersResult, contactThread] = await Promise.all([
    auth.supabase
      .from('organization_lead_collaboration')
      .select('*')
      .eq('lead_id', leadId)
      .eq('organization_id', organizationId)
      .maybeSingle(),
    auth.supabase
      .from('organization_members')
      .select('user_id,role,profiles:user_id(full_name,email,avatar_url)')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: true }),
    readContactThread(auth, organizationId, leadId, lead.email),
  ]);
  if (collaborationResult.error) throw collaborationResult.error;
  if (membersResult.error) throw membersResult.error;

  const role = auth.memberships?.find((membership) => membership.organizationId === organizationId)?.role || 'member';
  return {
    collaboration: collaborationResult.data || null,
    members: membersResult.data || [],
    contactThread,
    permissions: leadCollaborationPermissions({
      role,
      userId: auth.user.id,
      collaboration: collaborationResult.data,
      contactThread,
    }),
  };
}

async function paramsAndAuth(context: { params: Promise<{ organizationId: string; leadId: string }> }) {
  const auth = await requireAuth();
  const params = ParamsSchema.parse(await context.params);
  assertOrganizationAccess(auth, params.organizationId);
  await requireOrganizationCollaborationEnabled(auth, params.organizationId);
  await readLead(auth, params.organizationId, params.leadId);
  return { auth, params };
}

export async function GET(_request: Request, context: { params: Promise<{ organizationId: string; leadId: string }> }) {
  try {
    const { auth, params } = await paramsAndAuth(context);
    return NextResponse.json(
      await collaborationResponse(auth, params.organizationId, params.leadId),
      { headers: organizationNoStoreHeaders },
    );
  } catch (error) {
    return organizationApiError(error, 'LEAD_COLLABORATION_READ_FAILED');
  }
}

export async function PUT(request: Request, context: { params: Promise<{ organizationId: string; leadId: string }> }) {
  try {
    const { auth, params } = await paramsAndAuth(context);
    const body = AssignmentSchema.parse(await request.json().catch(() => null));
    const { error } = await auth.supabase.rpc('assign_organization_lead_v1', {
      p_lead_id: params.leadId,
      p_assigned_to_user_id: body.assignedToUserId,
    });
    if (error) throw error;
    return NextResponse.json({ updated: true }, { headers: organizationNoStoreHeaders });
  } catch (error) {
    return organizationApiError(error, 'LEAD_ASSIGNMENT_FAILED');
  }
}

export async function POST(request: Request, context: { params: Promise<{ organizationId: string; leadId: string }> }) {
  try {
    const { auth, params } = await paramsAndAuth(context);
    const body = ActionSchema.parse(await request.json().catch(() => null));
    if (body.action === 'claim') {
      const { error } = await auth.supabase.rpc('claim_organization_lead_v1', {
        p_lead_id: params.leadId,
        p_minutes: body.minutes,
      });
      if (error) throw error;
      return NextResponse.json({ claimed: true }, { headers: organizationNoStoreHeaders });
    }

    const lead = await readLead(auth, params.organizationId, params.leadId);
    const contactThread = await readContactThread(auth, params.organizationId, params.leadId, lead.email);
    if (!contactThread || contactThread.id !== body.contactThreadId) {
      return NextResponse.json({ error: 'Contact thread not found' }, { status: 404, headers: organizationNoStoreHeaders });
    }
    const { error } = await auth.supabase.rpc('reopen_organization_contact_thread_v1', {
      p_contact_thread_id: body.contactThreadId,
      p_reason: body.reason,
    });
    if (error) throw error;
    return NextResponse.json({ reopened: true }, { headers: organizationNoStoreHeaders });
  } catch (error) {
    return organizationApiError(error, 'LEAD_COLLABORATION_ACTION_FAILED');
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ organizationId: string; leadId: string }> }) {
  try {
    const { auth, params } = await paramsAndAuth(context);
    const { error } = await auth.supabase.rpc('release_organization_lead_claim_v1', { p_lead_id: params.leadId });
    if (error) throw error;
    return NextResponse.json({ released: true }, { headers: organizationNoStoreHeaders });
  } catch (error) {
    return organizationApiError(error, 'LEAD_CLAIM_RELEASE_FAILED');
  }
}
