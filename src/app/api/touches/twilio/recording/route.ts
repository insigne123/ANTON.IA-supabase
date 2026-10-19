import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { bridgeConfig, deleteRecording, fetchRecording, validTwilioSignature } from '@/lib/server/call-bridge';
import { attachCallRecording } from '@/lib/server/touch-calls';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * Twilio's «recording ready» for a call started from ANTON.IA (call-bridge.ts). Only with Twilio's signature: the recording
 * is summarized on its touch like an uploaded one and then deleted from Twilio.
 */
export async function POST(req: NextRequest) {
  const config = bridgeConfig();
  if (!config) return new NextResponse(null, { status: 404 });
  const raw = await req.text();
  const params = Object.fromEntries(new URLSearchParams(raw));
  const url = `${String(process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '')}${req.nextUrl.pathname}${req.nextUrl.search}`;
  if (!validTwilioSignature(config.token, url, params, req.headers.get('x-twilio-signature'))) return new NextResponse(null, { status: 403 });
  const touchId = req.nextUrl.searchParams.get('touch') || '';
  if (!/^[0-9a-f-]{36}$/.test(touchId) || params.RecordingStatus !== 'completed' || !params.RecordingUrl) return new NextResponse(null, { status: 204 });
  const admin = getSupabaseAdminClient();
  const touch = await admin.from('contact_touches').select('organization_id,user_id').eq('id', touchId).maybeSingle();
  if (touch.error || !touch.data) return new NextResponse(null, { status: 204 });
  const audio = await fetchRecording(config, params.RecordingUrl);
  if (audio) {
    await attachCallRecording(admin, { organizationId: touch.data.organization_id, userId: touch.data.user_id }, touchId,
      { bytes: audio, name: 'llamada.mp3', type: 'audio/mpeg', durationSeconds: Number(params.RecordingDuration || 0) || null }).catch(error => {
      console.warn('[touches] recording summary failed', error instanceof Error ? error.message.slice(0, 160) : error);
    });
  }
  if (params.RecordingSid) await deleteRecording(config, params.RecordingSid);
  return new NextResponse(null, { status: 204 });
}
