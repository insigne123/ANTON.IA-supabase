import { NextRequest, NextResponse } from 'next/server';
import { checkAndConsumeDailyQuota } from '@/lib/server/daily-quota-store';
import { sanitizeHeaderText } from '@/lib/email-header-utils';

export async function POST(req: Request) {
  try {
    const userId = req.headers.get('x-user-id')?.trim() || '';
    if (!userId) {
      return NextResponse.json({ error: 'missing user id' }, { status: 400 });
    }

    try {
      const { allowed, count, limit } = await checkAndConsumeDailyQuota({
        userId,
        resource: 'contact',
        limit: 50,
      });
      if (!allowed) {
        return NextResponse.json(
          { error: `Daily quota exceeded for contact. Used ${count}/${limit}.` },
          { status: 429 }
        );
      }
    } catch (e: any) {
      return NextResponse.json({ error: e.message || 'quota check failed' }, { status: e.code === 'DAILY_QUOTA_EXCEEDED' ? 429 : 400 });
    }

    // El cliente nos pasa el token MSAL en el header Authorization
    const auth = req.headers.get('authorization');
    if (!auth?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Missing Bearer token' }, { status: 401 });
    }
    const token = auth.slice(7);

    const { to, subject, body, isHtml = false, attachments = [] } = await req.json();
    const safeSubject = sanitizeHeaderText(subject || '');

    if (!to || !safeSubject || !body) {
      return NextResponse.json({ error: 'to, subject y body son requeridos' }, { status: 400 });
    }

    const graphBody = {
      message: {
        subject: safeSubject,
        body: { contentType: isHtml ? 'HTML' : 'Text', content: body },
        toRecipients: [{ emailAddress: { address: to } }],
        // opcional
        attachments: attachments.map((a: any) => ({
          '@odata.type': '#microsoft.graph.fileAttachment',
          name: a.name,
          contentBytes: a.contentBytes,
        })),
      },
      saveToSentItems: true,
    };

    const res = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(graphBody),
      cache: 'no-store',
    });

    // Graph normalmente responde 202 sin cuerpo
    const text = await res.text();
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text || null; }

    if (!res.ok) {
      // devolvemos el error exacto de Graph para que lo veas en el toast
      return NextResponse.json({ ok: false, status: res.status, graph: data }, { status: res.status });
    }

    return NextResponse.json({ ok: true, status: res.status });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Server error' }, { status: 500 });
  }
}
