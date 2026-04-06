import { NextResponse } from 'next/server';
import { checkAndConsumeDailyQuota } from '@/lib/server/daily-quota-store';
import { sanitizeHeaderText } from '@/lib/email-header-utils';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { generateUnsubscribeLink } from '@/lib/unsubscribe-helpers';
import { prepareOutboundEmail, validateOutboundEmail } from '@/lib/email-outbound';
import { isEmailSuppressedForScope } from '@/lib/server/privacy-subject-data';

function escapeODataLiteral(s: string) {
  return s.replace(/'/g, "''");
}

function toISO(dt: Date) {
  return dt.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

async function findRecentlySentByToAndSubject(token: string, params: { to: string; subject: string; lookbackMinutes?: number }) {
  const { to, subject, lookbackMinutes = 15 } = params;
  const since = new Date(Date.now() - lookbackMinutes * 60 * 1000);
  const select = '$select=id,subject,conversationId,internetMessageId,toRecipients,sentDateTime';
  const order = '$orderby=sentDateTime desc';
  const top = '$top=25';
  const filter = `$filter=sentDateTime ge ${escapeODataLiteral(toISO(since))}`;
  const res = await fetch(`https://graph.microsoft.com/v1.0/me/mailFolders('SentItems')/messages?${filter}&${order}&${top}&${select}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ConsistencyLevel: 'eventual',
    },
    cache: 'no-store',
  });
  if (!res.ok) return null;
  const data = await res.json();
  const list = Array.isArray(data?.value) ? data.value : [];
  const wantedTo = to.trim().toLowerCase();
  const wantedSubject = subject.trim();
  return list.find((m: any) => {
    const okSubj = String(m.subject || '').trim() === wantedSubject;
    const okTo = (m.toRecipients || []).some((r: any) => String(r?.emailAddress?.address || '').trim().toLowerCase() === wantedTo);
    return okSubj && okTo;
  }) || null;
}

export async function POST(req: Request) {
  try {
    const supabase = createRouteHandlerClient({ cookies });
    const { data: { user } } = await supabase.auth.getUser();
    const userId = user?.id || req.headers.get('x-user-id')?.trim() || '';
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

    const { to, subject, body, isHtml = false, attachments = [], requestReceipts = false } = await req.json();
    const safeSubject = sanitizeHeaderText(subject || '');

    if (!to || !safeSubject || !body) {
      return NextResponse.json({ error: 'to, subject y body son requeridos' }, { status: 400 });
    }

    let orgId: string | null = null;
    if (user?.id) {
      const { data: member } = await supabase
        .from('organization_members')
        .select('organization_id')
        .eq('user_id', user.id)
        .limit(1)
        .maybeSingle();
      if (member) orgId = member.organization_id;

      const blocked = await isEmailSuppressedForScope(to, { userId: user.id, organizationId: orgId });
      if (blocked) return NextResponse.json({ error: 'El destinatario se ha dado de baja de tus envíos.' }, { status: 403 });

      const domain = String(to).split('@')[1]?.toLowerCase().trim();
      if (domain && orgId) {
        const { data: blockedDomain } = await supabase
          .from('excluded_domains')
          .select('id')
          .eq('organization_id', orgId)
          .eq('domain', domain)
          .maybeSingle();
        if (blockedDomain) return NextResponse.json({ error: `El dominio ${domain} está bloqueado por tu organización.` }, { status: 403 });
      }
    }

    const unsubscribeUrl = generateUnsubscribeLink(to, userId, orgId);
    const prepared = prepareOutboundEmail({
      html: isHtml ? body : undefined,
      text: isHtml ? undefined : body,
      unsubscribeUrl,
    });
    const preflight = validateOutboundEmail({ to, subject: safeSubject, html: prepared.html, text: prepared.text, requireUnsubscribe: true, unsubscribeUrl });
    if (!preflight.ok) return NextResponse.json({ error: preflight.errors.join(' ') }, { status: 400 });

    const graphBody = {
      message: {
        subject: safeSubject,
        body: { contentType: 'HTML', content: prepared.html },
        toRecipients: [{ emailAddress: { address: to } }],
        isDeliveryReceiptRequested: !!requestReceipts,
        isReadReceiptRequested: !!requestReceipts,
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

    await new Promise((resolve) => setTimeout(resolve, 1500));
    const sentMeta = await findRecentlySentByToAndSubject(token, { to, subject: safeSubject }).catch(() => null);

    return NextResponse.json({ ok: true, status: res.status, messageId: sentMeta?.id, conversationId: sentMeta?.conversationId, internetMessageId: sentMeta?.internetMessageId });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Server error' }, { status: 500 });
  }
}
