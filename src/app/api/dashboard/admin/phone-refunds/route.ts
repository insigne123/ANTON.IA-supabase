import { NextResponse } from 'next/server';
import { z } from 'zod';

import { adminDashboardAuthErrorResponse, AdminDashboardAuthError, requireAdminDashboardAccess } from '@/lib/server/admin-dashboard-auth';
import { loadCreditPrices } from '@/lib/server/credit-prices';
import { PhoneRefundError, listPhoneRefunds, phoneRefundsEnabled, reportPhoneRefunds, reviewPhoneRefund } from '@/lib/server/phone-refunds';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const headers = { 'Cache-Control': 'private, no-store' };
const body = z.union([
  z.object({ action: z.literal('report'), phones: z.string().min(1).max(6000) }).strict(),
  z.object({ action: z.literal('review'), id: z.string().uuid(), decision: z.enum(['confirmed', 'rejected']), note: z.string().max(300).optional() }).strict(),
]);

const failure = (error: unknown) => {
  if (error instanceof PhoneRefundError) return NextResponse.json({ error: error.message }, { status: error.status, headers });
  if (error instanceof AdminDashboardAuthError) return adminDashboardAuthErrorResponse(error);
  console.warn('[phone-refunds] failed');
  return NextResponse.json({ error: 'No pudimos completar la solicitud. Intenta nuevamente.' }, { status: 503, headers });
};

/** «Teléfonos que no existen» in Administración (src/lib/phone-refunds.ts): the organization's reported phones, and whether the reader answers them. */
export async function GET() {
  try {
    const auth = await requireAdminDashboardAccess();
    const [enabled, claims, prices] = await Promise.all([
      phoneRefundsEnabled(auth.supabase, auth.organizationId), listPhoneRefunds(auth.supabase, auth.organizationId), loadCreditPrices(auth.organizationId, auth.supabase),
    ]);
    return NextResponse.json({ enabled, claims, canReview: auth.canManageCredits, phoneCredits: prices.phone }, { headers });
  } catch (error) { return failure(error); }
}

/** `report`: the administrator sends the numbers. `review`: an ANTON.IA operator answers one, once. */
export async function POST(request: Request) {
  try {
    const parsed = body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: 'Solicitud inválida.' }, { status: 400, headers });
    if (parsed.data.action === 'review') {
      const auth = await requireAdminDashboardAccess({ manageCredits: true });
      await reviewPhoneRefund(auth.supabase, auth.organizationId, parsed.data.id, parsed.data.decision, parsed.data.note ?? null);
      return NextResponse.json({ claims: await listPhoneRefunds(auth.supabase, auth.organizationId), canReview: true }, { headers });
    }
    const auth = await requireAdminDashboardAccess();
    const report = await reportPhoneRefunds(auth.supabase, { organizationId: auth.organizationId, userId: String(auth.user.id) }, parsed.data.phones);
    return NextResponse.json({ report, claims: await listPhoneRefunds(auth.supabase, auth.organizationId), canReview: auth.canManageCredits }, { headers });
  } catch (error) { return failure(error); }
}
