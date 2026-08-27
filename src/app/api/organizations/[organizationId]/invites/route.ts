import { createHash, randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { requireAuth } from '@/lib/server/auth-utils';
import { assertOrganizationAccess, organizationApiError, organizationNoStoreHeaders } from '@/lib/server/organization-api';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ParamsSchema = z.object({ organizationId: z.string().uuid() }).strict();
const InviteSchema = z.object({
  email: z.string().trim().email().max(320),
  role: z.enum(['admin', 'member']),
}).strict();

export async function POST(request: Request, context: { params: Promise<{ organizationId: string }> }) {
  try {
    const auth = await requireAuth();
    const params = ParamsSchema.parse(await context.params);
    assertOrganizationAccess(auth, params.organizationId);
    const body = InviteSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) {
      return NextResponse.json({ error: 'Invitation data is invalid' }, { status: 400, headers: organizationNoStoreHeaders });
    }

    const token = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(token, 'utf8').digest('hex');
    const { data, error } = await auth.supabase.rpc('create_organization_invite_v1', {
      p_organization_id: params.organizationId,
      p_email: body.data.email,
      p_role: body.data.role,
      p_token_hash: tokenHash,
    });
    if (error) throw error;

    const origin = String(
      process.env.CANONICAL_APP_URL || process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin,
    ).trim().replace(/\/$/, '');
    return NextResponse.json({
      inviteUrl: `${origin}/invite/${encodeURIComponent(token)}`,
      expiresAt: data.expiresAt,
    }, { status: 201, headers: organizationNoStoreHeaders });
  } catch (error) {
    return organizationApiError(error, 'ORGANIZATION_INVITE_CREATE_FAILED');
  }
}
