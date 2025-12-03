// src/lib/campaigns-storage.ts
import { contactedLeadsStorage } from './contacted-leads-storage';

export type CampaignStepAttachment = {
  name: string;
  contentBytes: string;     // base64
  contentType?: string;     // opcional
};

export type CampaignStep = {
  id: string;
  name: string;
  offsetDays: number;       // días desde el último contacto/seguimiento anterior
  subject: string;
  bodyHtml: string;         // permite HTML e imágenes embebidas (base64) o links
  attachments?: CampaignStepAttachment[];
};

export type Campaign = {
  id: string;
  name: string;
  isPaused: boolean;
  createdAt: string;
  updatedAt: string;
  steps: CampaignStep[];
  excludedLeadIds: string[];                        // leads que NO participan en esta campaña
  // Progreso por lead (independiente por campaña)
  sentRecords: Record<string, { lastStepIdx: number; lastSentAt: string }>;
};

const KEY = 'leadflow-campaigns/v1';

function nowIso() { return new Date().toISOString(); }

function sanitize(items: any[]): Campaign[] {
  return (items || []).map((c) => ({
    id: String(c.id),
    name: String(c.name || 'Campaña'),
    isPaused: !!c.isPaused,
    createdAt: c.createdAt || nowIso(),
    updatedAt: c.updatedAt || c.createdAt || nowIso(),
    steps: Array.isArray(c.steps) ? c.steps.map((s: any) => ({
      id: String(s.id),
      name: String(s.name || 'Paso'),
      offsetDays: Number.isFinite(+s.offsetDays) ? Number(s.offsetDays) : 0,
      subject: String(s.subject || s.subjectTemplate || ''),
      bodyHtml: String(s.bodyHtml || s.bodyTemplate || ''),
      attachments: Array.isArray(s.attachments) ? s.attachments.map((a: any) => ({
        name: String(a.name || 'file'),
        contentBytes: String(a.contentBytes || ''),
        contentType: a.contentType ? String(a.contentType) : undefined,
      })) : [],
    })) : [],
    excludedLeadIds: Array.isArray(c.excludedLeadIds) ? c.excludedLeadIds.map(String) : [],
    sentRecords: c.sentRecords && typeof c.sentRecords === 'object' ? c.sentRecords : {},
  }));
}

export const campaignsStorage = {
  get(): Campaign[] {
    if (typeof window === 'undefined') return [];
    const raw = localStorage.getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    return sanitize(list);
  },
  set(items: Campaign[]) {
    if (typeof window === 'undefined') return;
    localStorage.setItem(KEY, JSON.stringify(items));
  },
  add(input: Omit<Campaign, 'id' | 'createdAt' | 'updatedAt' | 'isPaused' | 'sentRecords'> & { id?: string }) {
    const all = this.get();
    const id = input.id || crypto.randomUUID();
    const item: Campaign = {
      id,
      name: input.name,
      steps: input.steps,
      excludedLeadIds: input.excludedLeadIds || [],
      isPaused: false,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      sentRecords: {},
    };
    all.unshift(item);
    this.set(all);
    return item;
  },
  update(id: string, patch: Partial<Omit<Campaign, 'id' | 'createdAt'>>) {
    const all = this.get();
    const i = all.findIndex((c) => c.id === id);
    if (i < 0) return;
    all[i] = { ...all[i], ...patch, updatedAt: nowIso() };
    this.set(all);
    return all[i];
  },
  getById(id: string): Campaign | null {
    return this.get().find(c => c.id === id) || null;
  },
  remove(id: string) {
    const all = this.get();
    const next = all.filter((c) => c.id !== id);
    this.set(next);
    return all.length - next.length;
  },
  togglePause(id: string, paused: boolean) {
    return this.update(id, { isPaused: paused });
  },
  setExclusions(id: string, excludedLeadIds: string[]) {
    return this.update(id, { excludedLeadIds: Array.from(new Set(excludedLeadIds)) });
  }
};
