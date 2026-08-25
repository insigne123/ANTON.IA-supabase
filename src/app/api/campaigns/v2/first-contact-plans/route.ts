import { NextRequest, NextResponse } from 'next/server';
import { ZodError } from 'zod';

import {
  CampaignV2DraftIdQuerySchema,
  CreateFirstContactPlanBodySchema,
  CreateFirstContactPlanResponseSchema,
  GetFirstContactPlanResponseSchema,
  RetryFirstContactPlanStepBodySchema,
  RetryFirstContactPlanStepResponseSchema,
} from '@/lib/campaigns-v2/contracts';
import { handleAuthError, requireAuth } from '@/lib/server/auth-utils';
import {
  createFirstContactPlan,
  getFirstContactPlan,
  retryFirstContactPlanStep,
  resolveFirstContactPlanOrganization,
} from '@/lib/server/campaigns-v2/plan';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function validationError(error: ZodError) {
  return NextResponse.json({ error: 'CAMPAIGN_V2_INPUT_INVALID', issues: error.issues }, { status: 400 });
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth();
    const query = CampaignV2DraftIdQuerySchema.parse({
      draftId: request.nextUrl.searchParams.get('draftId'),
    });
    const organizationId = await resolveFirstContactPlanOrganization({
      draftId: query.draftId,
      userId: auth.user.id,
      organizationIds: auth.organizationIds,
    });
    if (!organizationId) return NextResponse.json({ error: 'Native draft not found' }, { status: 404 });
    const response = GetFirstContactPlanResponseSchema.parse(await getFirstContactPlan({
      draftId: query.draftId,
      organizationId,
      userId: auth.user.id,
    }));
    return NextResponse.json(response, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error: any) {
    if (error instanceof ZodError) return validationError(error);
    if (error?.name === 'AuthError') return handleAuthError(error);
    console.error('[campaigns-v2] first-contact plan read failed', error);
    return NextResponse.json({ error: 'CAMPAIGN_V2_PLAN_READ_FAILED' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth();
    const body = CreateFirstContactPlanBodySchema.parse(await request.json());
    const organizationId = await resolveFirstContactPlanOrganization({
      draftId: body.draftId,
      userId: auth.user.id,
      organizationIds: auth.organizationIds,
    });
    if (!organizationId) return NextResponse.json({ error: 'Native draft not found' }, { status: 404 });
    const response = CreateFirstContactPlanResponseSchema.parse(await createFirstContactPlan({
      body,
      organizationId,
      userId: auth.user.id,
    }));
    return NextResponse.json(response, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (error: any) {
    if (error instanceof ZodError) return validationError(error);
    if (error?.name === 'AuthError') return handleAuthError(error);
    console.error('[campaigns-v2] first-contact plan creation failed', error);
    return NextResponse.json({ error: 'CAMPAIGN_V2_PLAN_CREATE_FAILED' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const auth = await requireAuth();
    const body = RetryFirstContactPlanStepBodySchema.parse(await request.json());
    const organizationId = await resolveFirstContactPlanOrganization({
      draftId: body.draftId,
      userId: auth.user.id,
      organizationIds: auth.organizationIds,
    });
    if (!organizationId) return NextResponse.json({ error: 'Native draft not found' }, { status: 404 });
    const response = RetryFirstContactPlanStepResponseSchema.parse(await retryFirstContactPlanStep({
      draftId: body.draftId,
      stepId: body.stepId,
      organizationId,
      userId: auth.user.id,
    }));
    return NextResponse.json(response, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error: any) {
    if (error instanceof ZodError) return validationError(error);
    if (error?.name === 'AuthError') return handleAuthError(error);
    console.error('[campaigns-v2] first-contact follow-up retry failed', error);
    return NextResponse.json({ error: 'CAMPAIGN_V2_DRAFT_RETRY_FAILED' }, { status: 500 });
  }
}
