import { NextResponse } from 'next/server';
import { z } from 'zod';

import {
  PAGE_GUIDES, PAGE_GUIDES_METADATA_KEY, PRODUCT_TOUR_METADATA_KEY, PRODUCT_TOUR_VERSION, productTourRecord, seenPageGuides,
  shouldOfferProductTour,
} from '@/lib/onboarding/product-tour';
import { requestAuthErrorResponse, requireSessionRequestAuth } from '@/lib/server/request-auth';

export const dynamic = 'force-dynamic';

const noStore = { 'Cache-Control': 'private, no-store' };
const TourStatusSchema = z.object({ status: z.enum(['completed', 'skipped']) }).strict();
const GuideId = z.enum(PAGE_GUIDES.map((guide) => guide.id) as [string, ...string[]]);
/** One guide seen or declined, or several at once (the ones the app tour walked through). */
const GuideSeenSchema = z.union([
  z.object({ guide: GuideId }).strict(),
  z.object({ guides: z.array(GuideId).min(1).max(PAGE_GUIDES.length) }).strict(),
]);

/** Whether the guided tour opens on its own for the signed-in person. */
export async function GET() {
  try {
    const { user } = await requireSessionRequestAuth();
    const record = productTourRecord(user.user_metadata);
    return NextResponse.json(
      { record, offer: shouldOfferProductTour({ record, createdAt: user.created_at }), guides: seenPageGuides(user.user_metadata) },
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
    const raw = await request.json().catch(() => null);
    const guide = GuideSeenSchema.safeParse(raw);
    if (guide.success) {
      // A screen guide seen or declined: it is not offered on its own again (it stays in «?»).
      const ids = 'guide' in guide.data ? [guide.data.guide] : guide.data.guides;
      const guides = { ...seenPageGuides(auth.user.user_metadata), ...Object.fromEntries(ids.map((id) => [id, true])) };
      const { error } = await auth.supabase.auth.updateUser({ data: { [PAGE_GUIDES_METADATA_KEY]: guides } });
      if (error) throw error;
      return NextResponse.json({ guides }, { headers: noStore });
    }
    const body = TourStatusSchema.safeParse(raw);
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