import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';

import { isTrustedInternalRequest } from '@/lib/server/internal-api-auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

const DEFAULT_LEAD_RESEARCH_URL = 'https://studio--studio-6624658482-61b7b.us-central1.hosted.app/api/lead-research';

function getLeadResearchUrl() {
  return process.env.ANTONIA_LEAD_RESEARCH_URL || process.env.LEAD_RESEARCH_URL || DEFAULT_LEAD_RESEARCH_URL;
}

async function resolveUserId(req: NextRequest) {
  const userIdFromHeader = req.headers.get('x-user-id')?.trim() || '';
  if (userIdFromHeader) {
    if (!isTrustedInternalRequest(req)) {
      return { error: NextResponse.json({ error: 'UNAUTHORIZED_INTERNAL_REQUEST' }, { status: 401 }) };
    }
    return { userId: userIdFromHeader };
  }

  const supabase = createRouteHandlerClient({ cookies: (() => req.cookies) as any });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.id) {
    return { error: NextResponse.json({ error: 'UNAUTHORIZED', message: 'User must be logged in' }, { status: 401 }) };
  }

  return { userId: user.id };
}

async function proxyResponse(res: Response) {
  const text = await res.text();
  let body: any = null;

  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }

  return NextResponse.json(body, {
    status: res.status,
    headers: {
      'Cache-Control': 'no-store',
    },
  });
}

export async function GET() {
  return NextResponse.json({ ok: true, endpoint: getLeadResearchUrl() }, { status: 200 });
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await resolveUserId(req);
    if ('error' in ctx) return ctx.error;

    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'BAD_JSON' }, { status: 400 });
    }

    const outgoing = {
      ...body,
      user_id: body?.user_id || ctx.userId,
    };

    const res = await fetch(getLeadResearchUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      cache: 'no-store',
      body: JSON.stringify(outgoing),
    });

    return proxyResponse(res);
  } catch (error: any) {
    console.error('[lead-research] proxy error:', error);
    return NextResponse.json({ error: 'LEAD_RESEARCH_PROXY_ERROR', message: error?.message || 'Unknown proxy error' }, { status: 500 });
  }
}
