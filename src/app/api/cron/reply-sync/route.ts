import { NextRequest, NextResponse } from 'next/server';

import { firebaseSchedulerResponseHeaders, isFirebaseSchedulerRequest } from '../_firebase-scheduler-auth';
import { syncRepliesForOrganization } from '@/lib/server/reply-sync';
import { sweepMailboxForOwner } from '@/lib/server/mailbox-sweep';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { replySyncDueFilter } from '@/lib/server/reply-sync-policy';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type ReplySyncOwner = {
  organizationId: string;
  userId: string;
};

function limitInRange(value: string | null, fallback: number, maximum: number) {
  const parsed = Number(value || fallback);
  return Math.min(Math.max(Number.isFinite(parsed) ? Math.trunc(parsed) : fallback, 1), maximum);
}

function addOwner(owners: Map<string, ReplySyncOwner>, row: any) {
  const organizationId = String(row?.organization_id || '').trim();
  const userId = String(row?.user_id || '').trim();
  if (!organizationId || !userId) return;
  owners.set(`${organizationId}:${userId}`, { organizationId, userId });
}

async function runReplySync(req: NextRequest) {
  if (!isFirebaseSchedulerRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const ownerLimit = limitInRange(req.nextUrl.searchParams.get('owners'), 25, 100);
  const perOwnerLimit = limitInRange(req.nextUrl.searchParams.get('limit'), 200, 500);
  const supabase = getSupabaseAdminClient();

  try {
    const owners = new Map<string, ReplySyncOwner>();
    const { data: contactOwners, error: contactOwnersError } = await supabase
      .from('contacted_leads')
      .select('id, organization_id, user_id')
      .in('provider', ['gmail', 'outlook'])
      .not('sent_at', 'is', null)
      .or('status.is.null,status.not.in.(scheduled,failed)')
      .or(replySyncDueFilter())
      .not('organization_id', 'is', null)
      .not('user_id', 'is', null)
      .order('reply_sync_attempted_at', { ascending: true, nullsFirst: true })
      .order('id', { ascending: true })
      .limit(perOwnerLimit);
    if (contactOwnersError) throw contactOwnersError;
    for (const row of contactOwners || []) {
      if (owners.size >= ownerLimit) break;
      addOwner(owners, row);
    }

    const summary = { scanned: 0, synced: 0, skippedNoToken: 0, errors: 0, sweepPages: 0, sweepSynced: 0 };
    for (const owner of Array.from(owners.values()).slice(0, ownerLimit)) {
      try {
        const result = await syncRepliesForOrganization(supabase, {
          organizationId: owner.organizationId,
          userId: owner.userId,
          limit: perOwnerLimit,
          fairQueue: true,
          contactedIds: (contactOwners || []).filter(row => row.organization_id === owner.organizationId && row.user_id === owner.userId).map(row => row.id),
        });
        summary.scanned += result.scanned;
        summary.synced += result.synced;
        summary.skippedNoToken += result.skippedNoToken;
        summary.errors += result.errors.length;
        // Stage 6.3 mailbox sweep: durable cursor, bounded pages, never fails the tick.
        for (const provider of ['gmail', 'outlook'] as const) {
          try {
            const sweep = await sweepMailboxForOwner(supabase, { organizationId: owner.organizationId, userId: owner.userId, provider });
            summary.sweepPages += sweep.pages;
            summary.sweepSynced += sweep.synced;
          } catch (error) {
            console.error('[cron/reply-sync] sweep failed', { organizationId: owner.organizationId, userId: owner.userId, provider, error: error instanceof Error ? error.message : String(error) });
          }
        }
      } catch (error) {
        console.error('[cron/reply-sync] owner sync failed', {
          organizationId: owner.organizationId,
          userId: owner.userId,
          error: error instanceof Error ? error.message : String(error),
        });
        summary.errors += 1;
      }
    }

    return NextResponse.json({
      ok: true,
      ownersProcessed: Math.min(owners.size, ownerLimit),
      ...summary,
    }, { headers: firebaseSchedulerResponseHeaders() });
  } catch (error) {
    console.error('[cron/reply-sync] unexpected error', error);
    return NextResponse.json({ error: 'Reply sync failed.' }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return runReplySync(req);
}

export async function POST(req: NextRequest) {
  return runReplySync(req);
}
