import type { ContactedOpportunity } from './types';
const KEY = 'leadflow-contacted-opportunities';

function sanitize(items: any[]): ContactedOpportunity[] {
  return (items || []).map((x) => {
    const status = x.status === 'opened' ? 'sent' : x.status;
    const { readReceiptRequested, trackingToken, ...rest } = x || {};
    return { ...rest, status };
  });
}

export const contactedOppsStorage = {
  get(): ContactedOpportunity[] {
    if (typeof window === 'undefined') return [];
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return sanitize(parsed);
  },
  set(items: ContactedOpportunity[]) {
    if (typeof window === 'undefined') return;
    localStorage.setItem(KEY, JSON.stringify(items));
  },
  add(item: ContactedOpportunity) {
    const all = this.get();
    const k = (v: ContactedOpportunity) => (v.messageId || `${v.email}|${v.subject}|${v.sentAt}`).toLowerCase();
    const seen = new Set(all.map(k));
    if (!seen.has(k(item))) {
      all.unshift(item);
      this.set(all);
    }
  },
  updateStatusByConversationId(conversationId: string, patch: Partial<ContactedOpportunity>) {
    const all = this.get();
    const i = all.findIndex(x => x.conversationId === conversationId);
    if (i >= 0) {
      all[i] = { ...all[i], ...patch, lastUpdateAt: new Date().toISOString() };
      this.set(all);
    }
  },
};