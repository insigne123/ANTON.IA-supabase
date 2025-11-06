// src/lib/outlook-graph-client.ts
import { microsoftAuthService } from './microsoft-auth-service';

export type MiniMessage = {
  id: string;
  subject?: string;
  webLink?: string;
  conversationId?: string;
  internetMessageId?: string;
  from?: { emailAddress?: { address?: string; name?: string } };
  toRecipients?: Array<{ emailAddress: { address: string } }>;
  receivedDateTime?: string;
  sentDateTime?: string;
};

function esc(s: string) { return s.replace(/'/g, "''"); }

async function graphFetch(path: string) {
  const token = await microsoftAuthService.getReadToken(); // requiere Mail.Read
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'ConsistencyLevel': 'eventual', // importante para queries con $filter/$top
      Accept: 'application/json',
    },
    cache: 'no-store',
  });
  return res;
}

/** === Compat: usado por Contacted === */
export async function graphGetMessage(id: string): Promise<MiniMessage | null> {
  try {
    const select =
      '$select=id,subject,webLink,conversationId,internetMessageId,from,toRecipients,receivedDateTime,sentDateTime';
    const res = await graphFetch(`/me/messages/${encodeURIComponent(id)}?${select}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(await res.text());
    return await res.json();
  } catch {
    return null;
  }
}

/** Respuestas en el hilo (excluye correos enviados por ti) */
export async function graphFindReplies(args: {
  conversationId: string;
  fromEmail?: string;
  internetMessageId?: string;
  top?: number;
}): Promise<MiniMessage[]> {
  const { conversationId, fromEmail, top = 25 } = args;
  if (!conversationId) return [];
  try {
    const me = (microsoftAuthService.getUserIdentity().email || '').toLowerCase();
    const select =
      '$select=id,subject,webLink,conversationId,internetMessageId,from,receivedDateTime';
    const nTop = `$top=${top}`;
    const filter = `$filter=conversationId eq '${esc(conversationId)}'`;

    // ⚠️ NO usar $orderby para evitar "InefficientFilter"
    const res = await graphFetch(`/me/messages?${filter}&${nTop}&${select}`);
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    const items: MiniMessage[] = Array.isArray(data?.value) ? data.value : [];

    const targetFrom = fromEmail ? fromEmail.toLowerCase() : '';

    // ordenamos en cliente por fecha de recepción desc
    return items
      .sort(
        (a, b) =>
          (Date.parse(b.receivedDateTime || '') || 0) -
          (Date.parse(a.receivedDateTime || '') || 0),
      )
      .filter((m) => {
        const from = (m?.from?.emailAddress?.address || '').toLowerCase();
        if (!from) return false;
        if (me && from === me) return false; // descarta mis correos
        if (targetFrom && from !== targetFrom) return false;
        return true;
      });
  } catch (err: any) {
    console.warn('[graph] findReplies failed:', err?.message);
    return [];
  }
}

/** Heurística de acuses en el hilo (lectura/entrega). */
export async function graphFindReadReceipts(
  internetMessageId: string,
): Promise<MiniMessage[]> {
  if (!internetMessageId) return [];
  try {
    // Filtra por header "In-Reply-To" (SingleValueExtendedProperty 0x1042)
    const filter =
      `$filter=microsoft.graph.singleValueLegacyExtendedProperty/id eq 'String 0x1042' ` +
      `and microsoft.graph.singleValueLegacyExtendedProperty/value eq '${esc(internetMessageId)}'`;
    const expand = `$expand=singleValueExtendedProperties($filter=id eq 'String 0x1042')`;
    const select =
      '$select=id,subject,receivedDateTime,from,conversationId,internetMessageId';
    const top = '$top=10';
    const url = `/me/messages?${filter}&${expand}&${select}&${top}`;

    const res = await graphFetch(url);
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    return Array.isArray(data?.value) ? data.value : [];
  } catch (err: any) {
    console.warn('[graph] findReadReceipts failed:', err?.message);
    return [];
  }
}

/** True si existe alguna respuesta (posterior a sinceIso si se provee) */
export async function hasConversationReply(
  conversationId: string,
  sinceIso?: string,
): Promise<boolean> {
  try {
    const replies = await graphFindReplies({ conversationId });
    if (replies.length === 0) return false;

    const since = sinceIso ? new Date(sinceIso).getTime() : 0;
    if (!since) return true;

    return replies.some((r) => {
      const t = r.receivedDateTime ? new Date(r.receivedDateTime).getTime() : 0;
      return t > since;
    });
  } catch (e) {
    console.warn('[graph] hasConversationReply fallback false por error:', e);
    return false;
  }
}
