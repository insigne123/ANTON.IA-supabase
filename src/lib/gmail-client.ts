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

function header(hs: any[], name: string): string | undefined {
  return (hs || []).find((x: any) => x?.name?.toLowerCase() === name.toLowerCase())?.value;
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
};
