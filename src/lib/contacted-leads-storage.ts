// src/lib/contacted-leads-storage.ts
import type { ContactedLead } from './types';

const KEY = 'leadflow-contacted-leads';

function sanitize(items: any[]): ContactedLead[] {
  return (items || []).map((x) => {
    // convertir opened -> sent (compatibilidad con versiones previas)
    const status = x.status === 'opened' ? 'sent' : x.status;

    // quitar campos de tracking antiguos si existían
    const { readReceiptRequested, trackingToken, ...rest } = x || {};

    // Asegurar nuevos campos opcionales sin romper nada
    return {
      openedAt: x.openedAt || undefined,
      deliveredAt: x.deliveredAt || undefined,
      readReceiptMessageId: x.readReceiptMessageId || undefined,
      deliveryReceiptMessageId: x.deliveryReceiptMessageId || undefined,
      ...rest,
      status,
    } as ContactedLead;
  });
}

export const contactedLeadsStorage = {
  get(): ContactedLead[] {
    if (typeof window === 'undefined') return [];
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return sanitize(parsed);
  },
  findByLeadId(leadId: string): ContactedLead | null {
    const all = this.get();
    const id = (leadId || '').trim().toLowerCase();
    return all.find(x => (x.leadId || '').toLowerCase() === id) || null;
  },
  set(items: ContactedLead[]) {
    if (typeof window === 'undefined') return;
    localStorage.setItem(KEY, JSON.stringify(items));
  },
  add(item: ContactedLead) {
    const all = this.get();
    const k = (v: ContactedLead) => (v.messageId || `${v.email}|${v.subject}|${v.sentAt}`).toLowerCase();
    const seen = new Set(all.map(k));
    if (!seen.has(k(item))) {
      all.unshift({ ...item, followUpCount: 0, lastStepIdx: -1 });
      this.set(all);
    }
  },
  upsertByThreadId(threadId: string, patch: Partial<ContactedLead>) {
    const all = this.get();
    const i = all.findIndex(x => x.threadId === threadId);
    if (i >= 0) {
      all[i] = { ...all[i], ...patch, lastUpdateAt: new Date().toISOString() };
      this.set(all);
    }
  },
  upsertByMessageId(messageId: string, patch: Partial<ContactedLead>) {
    const all = this.get();
    const i = all.findIndex(x => x.messageId === messageId);
    if (i >= 0) {
      all[i] = { ...all[i], ...patch, lastUpdateAt: new Date().toISOString() };
      this.set(all);
    }
  },
  updateStatusByConversationId(conversationId: string, patch: Partial<ContactedLead>) {
    const all = this.get();
    const i = all.findIndex(x => x.conversationId === conversationId);
    if (i >= 0) {
      all[i] = { ...all[i], ...patch, lastUpdateAt: new Date().toISOString() };
      this.set(all);
    }
  },
  updateStatusByThreadId(threadId: string, patch: Partial<ContactedLead>) {
    const all = this.get();
    const i = all.findIndex(x => x.threadId === threadId);
    if (i >= 0) {
      all[i] = { ...all[i], ...patch, lastUpdateAt: new Date().toISOString() };
      this.set(all);
    }
  },
  markRepliedByConversationId(conversationId: string, replySnippet?: string) {
    this.updateStatusByConversationId(conversationId, {
      status: 'replied',
      replyPreview: replySnippet,
      repliedAt: new Date().toISOString(),
    });
  },
  markRepliedByThreadId(threadId: string, replySnippet?: string) {
    this.updateStatusByThreadId(threadId, {
      status: 'replied',
      replyPreview: replySnippet,
      repliedAt: new Date().toISOString(),
    });
  },
  /** Marca acuses (lectura/entrega) por conversationId. Idempotente. */
  markReceiptsByConversationId(conversationId: string, patch: {
    openedAt?: string;
    deliveredAt?: string;
    readReceiptMessageId?: string;
    deliveryReceiptMessageId?: string;
  }) {
    this.updateStatusByConversationId(conversationId, { ...patch });
  },
  /** Marca acuses por threadId (Gmail). */
  markReceiptsByThreadId(threadId: string, patch: {
    openedAt?: string;
    deliveredAt?: string;
    readReceiptMessageId?: string;
    deliveryReceiptMessageId?: string;
  }) {
    this.updateStatusByThreadId(threadId, { ...patch });
  },
  bumpFollowupByConversationId(conversationId: string, stepIdx: number) {
    const all = this.get();
    const i = all.findIndex(x => x.conversationId === conversationId);
    if (i >= 0) {
      const it = all[i];
      all[i] = {
        ...it,
        followUpCount: Number(it.followUpCount ?? 0) + 1,
        lastFollowUpAt: new Date().toISOString(),
        lastStepIdx: stepIdx,
        lastUpdateAt: new Date().toISOString(),
      };
      this.set(all);
    }
  },
  bumpFollowupByThreadId(threadId: string, stepIdx: number) {
    const all = this.get();
    const i = all.findIndex(x => x.threadId === threadId);
    if (i >= 0) {
      const it = all[i];
      all[i] = {
        ...it,
        followUpCount: Number(it.followUpCount ?? 0) + 1,
        lastFollowUpAt: new Date().toISOString(),
        lastStepIdx: stepIdx,
        lastUpdateAt: new Date().toISOString(),
      };
      this.set(all);
    }
  },
  isContacted(email?: string, leadId?: string): boolean {
    const all = this.get();
    const e = (email || '').trim().toLowerCase();
    const id = (leadId || '').trim().toLowerCase();
    return all.some(x =>
      (x.email && x.email.toLowerCase() === e && !!e) ||
      (x.leadId && x.leadId.toLowerCase() === id && !!id)
    );
  },
  /** Elimina elementos que cumplan la condición. Devuelve cantidad eliminada. */
  removeWhere(pred: (x: ContactedLead) => boolean): number {
    const all = this.get();
    const next = all.filter(x => !pred(x));
    this.set(next);
    return all.length - next.length;
  },
};
