import { NextRequest, NextResponse } from 'next/server';

const DEFAULT_LEAD_RESEARCH_URL = 'https://studio--studio-6624658482-61b7b.us-central1.hosted.app/api/lead-research';

function getLeadResearchUrl(reportId: string) {
  const base = process.env.ANTONIA_LEAD_RESEARCH_URL || process.env.LEAD_RESEARCH_URL || DEFAULT_LEAD_RESEARCH_URL;
  return `${base.replace(/\/$/, '')}/${encodeURIComponent(reportId)}`;
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

export async function GET(_req: NextRequest, context: { params: Promise<{ reportId: string }> }) {
  try {
    const { reportId } = await context.params;
    const res = await fetch(getLeadResearchUrl(reportId), {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    return proxyResponse(res);
  } catch (error: any) {
    console.error('[lead-research/:reportId] proxy error:', error);
    return NextResponse.json({ error: 'LEAD_RESEARCH_STATUS_PROXY_ERROR', message: error?.message || 'Unknown proxy error' }, { status: 500 });
  }
}
