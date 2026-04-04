type ProviderLike = 'gmail' | 'outlook' | 'linkedin' | 'phone' | string;

export function buildThreadKey(input: {
  provider?: ProviderLike | null;
  threadId?: string | null;
  conversationId?: string | null;
  internetMessageId?: string | null;
  messageId?: string | null;
}) {
  const provider = String(input.provider || '').trim().toLowerCase();
  const threadId = String(input.threadId || '').trim();
  const conversationId = String(input.conversationId || '').trim();
  const internetMessageId = String(input.internetMessageId || '').trim().replace(/^<|>$/g, '');
  const messageId = String(input.messageId || '').trim();

  if (provider === 'gmail' && threadId) return `gmail:${threadId}`;
  if (provider === 'outlook' && conversationId) return `outlook:${conversationId}`;
  if (internetMessageId) return `msg:${internetMessageId}`;
  if (messageId) return `${provider || 'mail'}:${messageId}`;
  return null;
}

export function deriveLifecycleState(current: string | null | undefined, eventType: string | null | undefined) {
  const event = String(eventType || '').trim().toLowerCase();
  const curr = String(current || '').trim().toLowerCase();
  const order = ['queued', 'sent', 'delivered', 'opened', 'clicked', 'replied'];
  if (event === 'bounce' || event === 'bounced' || event === 'blocked' || event === 'dropped' || event === 'deferred') return 'bounced';
  if (event === 'failed') return 'failed';
  if (event === 'reply' || event === 'replied' || event === 'inbound') return 'replied';
  if (event === 'click' || event === 'clicked') return 'clicked';
  if (event === 'open' || event === 'opened') return 'opened';
  if (event === 'delivered' || event === 'delivery') return curr && order.includes(curr) ? curr : 'delivered';
  if (event === 'send' || event === 'sent') return curr || 'sent';
  return curr || 'sent';
}

export async function safeInsertEmailEvent(supabase: any, payload: Record<string, any>) {
  try {
    return await supabase.from('email_events').insert(payload);
  } catch (error) {
    return { error };
  }
}
