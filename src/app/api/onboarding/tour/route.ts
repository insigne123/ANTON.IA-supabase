import { NextResponse } from 'next/server';
import { z } from 'zod';

import {
  PRODUCT_TOUR_METADATA_KEY, PRODUCT_TOUR_VERSION, productTourRecord, shouldOfferProductTour,
} from '@/lib/onboarding/product-tour';
import { requestAuthErrorResponse, requireSessionRequestAuth } from '@/lib/server/request-auth';

export const dynamic = 'force-dynamic';

const noStore = { 'Cache-Control': 'private, no-store' };
const TourStatusSchema = z.object({ status: z.enum(['completed', 'skipped']) }).strict();

/** Whether the guided tour opens on its own for the signed-in person. */
export async function GET() {
  try {
    const { user } = await requireSessionRequestAuth();
    const record = productTourRecord(user.user_metadata);
    return NextResponse.json(
      { record, offer: shouldOfferProductTour({ record, createdAt: user.created_at }) },
      { headers: noStore },
    );
  } catch (error) {
    return failure(error, 'No se pudo leer el estado del tutorial.');
  }
}

/** Remembers that the person finished or skipped the tour, so it does not open on its own again. */
export async function POST(request: Request) {
  try {
    const auth = await requireSessionRequestAuth();
    const body = TourStatusSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) {
      return NextResponse.json({ error: 'Estado del tutorial no válido.' }, { status: 400, headers: noStore });
    }
    const record = { version: PRODUCT_TOUR_VERSION, status: body.data.status, updatedAt: new Date().toISOString() };
    // Saved here with the person's own session: saving it from the browser emits USER_UPDATED,
    // and the auth context would reload the organization and flash its loading state.
    const { error } = await auth.supabase.auth.updateUser({ data: { [PRODUCT_TOUR_METADATA_KEY]: record } });
    if (error) throw error;
    return NextResponse.json({ record }, { headers: noStore });
  } catch (error) {
    return failure(error, 'No se pudo guardar el estado del tutorial.');
  }
}

function failure(error: unknown, message: string) {
  const authResponse = requestAuthErrorResponse(error);
  if (authResponse) {
    authResponse.headers.set('Cache-Control', 'private, no-store');
    return authResponse;
  }
  console.error('[onboarding/tour]', error instanceof Error ? error.message : error);
  return NextResponse.json({ error: message }, { status: 503, headers: noStore });
}