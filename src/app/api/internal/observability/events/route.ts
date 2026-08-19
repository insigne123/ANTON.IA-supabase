import { NextRequest, NextResponse } from 'next/server';
import {
  queryAntoniaDailyRollups,
  queryAntoniaEvents,
  summarizeAntoniaEvents,
} from '@/lib/server/antonia-event-ledger';
import { isTrustedInternalRequest } from '@/lib/server/internal-api-auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

function optionalUuid(value: string | null) {
  const normalized = String(value || '').trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)
    ? normalized
    : undefined;
}

export async function GET(req: NextRequest) {
  if (!isTrustedInternalRequest(req)) {
    return NextResponse.json({ error: 'UNAUTHORIZED_INTERNAL_REQUEST' }, { status: 401 });
  }

  const url = new URL(req.url);
  const filters = {
    organizationId: optionalUuid(url.searchParams.get('organization_id')),
    actorUserId: optionalUuid(url.searchParams.get('actor_user_id')),
    eventType: url.searchParams.get('event_type') || undefined,
    entityType: url.searchParams.get('entity_type') || undefined,
    from: url.searchParams.get('from') || undefined,
    to: url.searchParams.get('to') || undefined,
    limit: Number(url.searchParams.get('limit') || 200),
  };

  try {
    if (url.searchParams.get('mode') === 'summary') {
      const data = await summarizeAntoniaEvents(filters);
      return NextResponse.json({ data, mode: 'summary' }, { headers: { 'Cache-Control': 'no-store' } });
    }

    if (url.searchParams.get('mode') === 'rollups') {
      const data = await queryAntoniaDailyRollups({
        organizationId: filters.organizationId,
        actorUserId: filters.actorUserId,
        eventType: filters.eventType,
        from: filters.from,
        to: filters.to,
        limit: filters.limit,
      });
      return NextResponse.json({ data, mode: 'rollups' }, { headers: { 'Cache-Control': 'no-store' } });
    }

    const data = await queryAntoniaEvents(filters);
    return NextResponse.json({ data, mode: 'events' }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[internal/observability/events] query failed', error);
    return NextResponse.json(
      { error: 'OBSERVABILITY_QUERY_FAILED', message: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
