// Envío Gmail: arma RFC822 correcto y usa base64url en `raw`
import { NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { generateUnsubscribeLink } from '@/lib/unsubscribe-helpers';

type SendReq = {
  to: string;
  from: string; // la cuenta conectada (mismo remitente del token)
  subject: string;
  html: string; // body HTML ya con firma aplicada
  text?: string; // opcional: versión texto plano
  cc?: string[];
  bcc?: string[];
  replyTo?: string;
  attachments?: Array<{ name: string; contentBytes: string; contentType?: string }>;
};

function encodeBase64Url(input: string | Uint8Array) {
  const b64 = Buffer.from(input).toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

// RFC 2047 para headers con UTF-8
function encodeHeaderRFC2047(value: string) {
  // si solo ASCII, devolver tal cual
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  const b64 = Buffer.from(value, 'utf8').toString('base64');
  return `=?UTF-8?B?${b64}?=`;
}

// Construye RFC822 con multipart/mixed (attachments) e incluye multipart/alternative (text/html)
function buildRfc822Raw({ from, to, subject, html, text, cc = [], bcc = [], replyTo, attachments = [] }: SendReq) {
  const mixedBoundary = `=_mixed_${Math.random().toString(36).slice(2)}`;
  const altBoundary = `=_alt_${Math.random().toString(36).slice(2)}`;

  const date = new Date().toUTCString();
  const headers: string[] = [
    `MIME-Version: 1.0`,
    `Date: ${date}`,
    `From: ${encodeHeaderRFC2047(from)}`,
    `To: ${encodeHeaderRFC2047(to)}`,
    ...(cc.length ? [`Cc: ${cc.map(encodeHeaderRFC2047).join(', ')}`] : []),
    ...(bcc.length ? [`Bcc: ${bcc.map(encodeHeaderRFC2047).join(', ')}`] : []),
    ...(replyTo ? [`Reply-To: ${encodeHeaderRFC2047(replyTo)}`] : []),
    `Subject: ${encodeHeaderRFC2047(subject)}`,
    `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`
  ];

  const parts: string[] = [];

  // 1) multipart/alternative (text+html) como primera parte de multipart/mixed
  const altParts: string[] = [];
  if (text && text.trim()) {
    const textB64 = Buffer.from(text, 'utf8').toString('base64');
    altParts.push(
      `--${altBoundary}`,
      `Content-Type: text/plain; charset=UTF-8`,
      `Content-Transfer-Encoding: base64`,
      ``,
      textB64
    );
  }
  // Parte HTML (requerida). Encoding base64 (no quoted-printable).
  const htmlB64 = Buffer.from(html, 'utf8').toString('base64');
  altParts.push(
    `--${altBoundary}`,
    `Content-Type: text/html; charset=UTF-8`,
    `Content-Transfer-Encoding: base64`,
    ``,
    htmlB64
  );
  altParts.push(`--${altBoundary}--`, ``);

  // Ensamblar la parte multipart/alternative dentro de multipart/mixed
  parts.push(
    `--${mixedBoundary}`,
    `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
    ``,
    ...altParts
  );

  // 2) Adjuntos (si hubiera)
  for (const a of attachments) {
    const mime = a.contentType || 'application/octet-stream';
    const b64 = a.contentBytes || '';
    const safeName = encodeHeaderRFC2047(a.name || 'file');
    parts.push(
      `--${mixedBoundary}`,
      `Content-Type: ${mime}; name="${safeName}"`,
      `Content-Transfer-Encoding: base64`,
      `Content-Disposition: attachment; filename="${safeName}"`,
      ``,
      b64
    );
  }

  parts.push(`--${mixedBoundary}--`, ``);

  // CRLF estricto como exige RFC
  const rfc822 = [...headers, ``, ...parts].join(`\r\n`);
  return rfc822;
}

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as SendReq;

    // Validate 'from' ONLY if provided. If not provided, we will try to fetch it from Google using the token.
    if (body.from && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.from)) {
      return NextResponse.json({ error: 'Remitente inválido' }, { status: 400 });
    }

    let accessToken = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');

    // --- Authenticate Local User (for Unsubscribe Link & Blacklist) ---
    const supabase = createRouteHandlerClient({ cookies });
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized (No Session)' }, { status: 401 });
    }

    // Fallback: If no client access token, try to get from server-side stored refresh token
    if (!accessToken) {
      console.log('[gmail/send] No client token, attempting server-side refresh for user', user.id);
      const { tokenService } = await import('@/lib/services/token-service');
      const tokenRecord = await tokenService.getToken(supabase, user.id, 'google');

      if (tokenRecord?.refresh_token) {
        try {
          const params = new URLSearchParams({
            client_id: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID!,
            client_secret: process.env.GOOGLE_CLIENT_SECRET!,
            refresh_token: tokenRecord.refresh_token,
            grant_type: 'refresh_token',
          });

          const refreshRes = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params
          });

          const refreshData = await refreshRes.json();
          if (refreshRes.ok && refreshData.access_token) {
            accessToken = refreshData.access_token;
            console.log('[gmail/send] Successfully refreshed server-side token');
          } else {
            console.error('[gmail/send] Refresh failed', refreshData);
          }
        } catch (err) {
          console.error('[gmail/send] Refresh exception', err);
        }
      }
    }

    if (!accessToken) return NextResponse.json({ error: 'Missing access token (Client or Server)' }, { status: 401 });

    // Try to find Org ID (optional)
    let orgId: string | null = null;
    const { data: member } = await supabase
      .from('organization_members')
      .select('organization_id')
      .eq('user_id', user.id)
      .limit(1)
      .maybeSingle();
    if (member) orgId = member.organization_id;

    // --- Blacklist Check ---
    let blacklistQuery = supabase
      .from('unsubscribed_emails')
      .select('id')
      .eq('email', body.to);

    if (orgId) {
      blacklistQuery = blacklistQuery.or(`user_id.eq.${user.id},organization_id.eq.${orgId}`);
    } else {
      blacklistQuery = blacklistQuery.eq('user_id', user.id);
    }
    const { data: blocked } = await blacklistQuery.maybeSingle();

    if (blocked) {
      console.warn(`[gmail/send] Blocked email to ${body.to} (User: ${user.id})`);
      return NextResponse.json({ error: 'El destinatario se ha dado de baja de tus envíos.' }, { status: 403 });
    }

    // --- Inject Unsubscribe Link ---
    const unsubscribeUrl = generateUnsubscribeLink(body.to, user.id, orgId);
    console.log('[Gmail] Generated Unsubscribe Link:', unsubscribeUrl);

    const footerHtml = `
        <br/><br/>
        <div style="font-family: sans-serif; font-size: 12px; color: #888; border-top: 1px solid #eee; padding-top: 10px; margin-top: 20px; display: block;">
            <p style="margin: 0;">Si no deseas recibir más correos de nosotros, puedes <a href="${unsubscribeUrl}" target="_blank" style="color: #666; text-decoration: underline;">darte de baja aquí</a>.</p>
        </div>
    `;

    let safeHtml = (body.html && body.html.trim().length) ? body.html : '<div></div>';
    const bodyTagRegex = /<\/body>/i;
    if (bodyTagRegex.test(safeHtml)) {
      safeHtml = safeHtml.replace(bodyTagRegex, `${footerHtml}</body>`);
    } else {
      safeHtml += footerHtml;
    }

    // --- If 'from' is missing, fetch it from Google ---
    if (!body.from) {
      try {
        const profileRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
          headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        if (profileRes.ok) {
          const profile = await profileRes.json();
          body.from = profile.emailAddress;
          console.log('[gmail/send] Resolved sender email:', body.from);
        } else {
          console.warn('[gmail/send] Failed to fetch profile for sender email', await profileRes.text());
          return NextResponse.json({ error: 'No se pudo determinar el remitente (el token puede ser inválido o faltan scopes).' }, { status: 400 });
        }
      } catch (err) {
        console.error('[gmail/send] Profile fetch error', err);
        return NextResponse.json({ error: 'Error interno obteniendo perfil de remitente' }, { status: 500 });
      }
    }

    // --- Build & Send ---
    const rawRfc822 = buildRfc822Raw({ ...body, html: safeHtml });
    const raw = encodeBase64Url(rawRfc822);

    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ raw })
    });

    if (!res.ok) {
      const t = await res.text();
      console.error('[gmail/send] upsteam', res.status, t);
      // Clean error message for user
      return NextResponse.json({ error: t || 'gmail upstream error' }, { status: 500 });
    }

    const data = await res.json();
    return NextResponse.json({ ok: true, id: data.id, threadId: data.threadId });
  } catch (e: any) {
    console.error('[gmail/send] error', e);
    return NextResponse.json({ error: e?.message || 'internal error' }, { status: 500 });
  }
}
