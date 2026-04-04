// Cliente de lectura/seguimiento en Gmail (replies)
// Nota: Gmail no garantiza "read receipts" universales.
// Estrategia: buscar respuestas en el hilo (threadId) o por query.

import { googleAuthService } from './google-auth-service';

export type GmailMessage = {
  id: string;
  threadId: string;
  snippet: string;
  internalDate: string; // epoch ms en string
  from?: string;
  to?: string;
  subject?: string;
};

export type GmailMessageDetail = GmailMessage & {
  html?: string;
  text?: string;
};

function header(hs: any[], name: string): string | undefined {
  return (hs || []).find((x: any) => x?.name?.toLowerCase() === name.toLowerCase())?.value;
}

function decodeBase64Url(data?: string): string {
  if (!data) return '';
  try {
    const normalized = data.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return '';
  }
}

function extractBodies(payload: any): { html?: string; text?: string } {
  let html = '';
  let text = '';

  const visit = (node: any) => {
    if (!node) return;
    const mime = String(node.mimeType || '').toLowerCase();
    const bodyData = decodeBase64Url(node?.body?.data);

    if (bodyData) {
      if (!html && mime === 'text/html') html = bodyData;
      if (!text && mime === 'text/plain') text = bodyData;
    }

    const parts = Array.isArray(node.parts) ? node.parts : [];
    for (const part of parts) visit(part);
  };

  visit(payload);
  return { html: html || undefined, text: text || undefined };
}

export const gmailClient = {
  // Busca respuestas en un hilo específico (threadId)
  async findRepliesByThread(threadId: string): Promise<GmailMessage[]> {
    const token = await googleAuthService.getReadToken();
    const r = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject`,
      { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' }
    );
    if (!r.ok) throw new Error('No se pudo leer el hilo de Gmail');
    const j = await r.json();
    const messages = (j?.messages ?? []) as any[];
    // Consideramos respuesta si el From NO es el usuario (heurística)
    const me = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    }).then(x => x.ok ? x.json() : null).catch(() => null);
    const myEmail = me?.email?.toLowerCase?.();

    return messages
      .map((m: any) => {
        const hs = m?.payload?.headers ?? [];
        return {
          id: m?.id,
          threadId: m?.threadId,
          snippet: m?.snippet,
          internalDate: m?.internalDate,
          from: header(hs, 'From'),
          to: header(hs, 'To'),
          subject: header(hs, 'Subject'),
        } as GmailMessage;
      })
      .filter(m => (m.from || '').toLowerCase() !== (myEmail || ''));
  },

  // Búsqueda por query para ver si hay respuestas recientes del lead
  // Ejemplo de query: `from:lead@dominio.com newer_than:7d`
  async searchRepliesByQuery(query: string): Promise<GmailMessage[]> {
    const token = await googleAuthService.getReadToken();
    const base = 'https://gmail.googleapis.com/gmail/v1/users/me/messages';
    const list = await fetch(`${base}?q=${encodeURIComponent(query)}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    if (!list.ok) throw new Error('No se pudo listar mensajes de Gmail');
    const l = await list.json();
    const ids: string[] = (l?.messages ?? []).map((x: any) => x.id);
    const out: GmailMessage[] = [];
    for (const id of ids) {
      const msg = await fetch(`${base}/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      }).then(r => r.ok ? r.json() : null);
      if (!msg) continue;
      const hs = msg?.payload?.headers ?? [];
      out.push({
        id: msg.id,
        threadId: msg.threadId,
        snippet: msg.snippet,
        internalDate: msg.internalDate,
        from: header(hs, 'From'),
        to: header(hs, 'To'),
        subject: header(hs, 'Subject'),
      });
    }
    return out;
  },

  async getMessageById(id: string): Promise<GmailMessageDetail | null> {
    const token = await googleAuthService.getReadToken();
    const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    if (!res.ok) return null;

    const msg = await res.json();
    const hs = msg?.payload?.headers ?? [];
    const bodies = extractBodies(msg?.payload);

    return {
      id: msg?.id,
      threadId: msg?.threadId,
      snippet: msg?.snippet,
      internalDate: msg?.internalDate,
      from: header(hs, 'From'),
      to: header(hs, 'To'),
      subject: header(hs, 'Subject'),
      html: bodies.html,
      text: bodies.text,
    };
  },
};
