import { NextResponse } from 'next/server';
import { z } from 'zod';

import { requireAuth } from '@/lib/server/auth-utils';
import { assertOrganizationAccess, organizationApiError, organizationNoStoreHeaders } from '@/lib/server/organization-api';

export const dynamic = 'force-dynamic';

const ParamsSchema = z.object({ organizationId: z.string().uuid() }).strict();
const UpdateSchema = z.object({ name: z.string().trim().min(1).max(120) }).strict();

export async function GET(_request: Request, context: { params: Promise<{ organizationId: string }> }) {
  try {
    const auth = await requireAuth();
    const params = ParamsSchema.parse(await context.params);
    assertOrganizationAccess(auth, params.organizationId);

    const [organizationResult, membersResult] = await Promise.all([
      auth.supabase.from('organizations').select('*').eq('id', params.organizationId).single(),
      auth.supabase.from('organization_members').select(`
        organization_id, user_id, role, created_at,
        profiles:user_id (full_name, email, avatar_url)
      `).eq('organization_id', params.organizationId).order('created_at', { ascending: true }),
    ]);
    if (organizationResult.error) throw organizationResult.error;
    if (membersResult.error) throw membersResult.error;

    const currentMembership = (membersResult.data || []).find((member: any) => member.user_id === auth.user.id);
    let invites: any[] = [];
    if (currentMembership?.role === 'owner' || currentMembership?.role === 'admin') {
      const invitesResult = await auth.supabase
        .from('organization_invites')
        .select('id,email,role,created_at,expires_at')
        .eq('organization_id', params.organizationId)
        .is('accepted_at', null)
        .is('revoked_at', null)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false });
      if (invitesResult.error) throw invitesResult.error;
      invites = invitesResult.data || [];
    }

    return NextResponse.json({
      organization: organizationResult.data,
      members: membersResult.data || [],
      invites,
      currentUserRole: currentMembership?.role || 'member',
    }, { headers: organizationNoStoreHeaders });
  } catch (error) {
    return organizationApiError(error, 'ORGANIZATION_READ_FAILED');
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ organizationId: string }> }) {
  try {
    const auth = await requireAuth();
    const params = ParamsSchema.parse(await context.params);
    assertOrganizationAccess(auth, params.organizationId);
    const body = UpdateSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) {
      return NextResponse.json({ error: 'Organization name is invalid' }, { status: 400, headers: organizationNoStoreHeaders });
    }
    const { error } = await auth.supabase.from('organizations').update({ name: body.data.name }).eq('id', params.organizationId);
    if (error) throw error;
    return NextResponse.json({ updated: true }, { headers: organizationNoStoreHeaders });
  } catch (error) {
    return organizationApiError(error, 'ORGANIZATION_UPDATE_FAILED');
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ organizationId: string }> }) {
  try {
    const auth = await requireAuth();
    const params = ParamsSchema.parse(await context.params);
    assertOrganizationAccess(auth, params.organizationId);
    const { error } = await auth.supabase.from('organizations').delete().eq('id', params.organizationId);
    if (error) throw error;
    return NextResponse.json({ deleted: true }, { headers: organizationNoStoreHeaders });
  } catch (error) {
    return organizationApiError(error, 'ORGANIZATION_DELETE_FAILED');
  }
}
