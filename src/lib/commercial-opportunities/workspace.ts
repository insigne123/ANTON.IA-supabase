import { z } from 'zod';

/** Separate rollout from the existing opportunity and research pipelines. */
export const opportunityWorkspaceEnabled = (env = process.env) => env.OPPORTUNITIES_WORKSPACE_ENABLED === 'true';
export const opportunityAutomationEnabled = (env = process.env) => opportunityWorkspaceEnabled(env) && env.OPPORTUNITIES_AUTOMATION_ENABLED === 'true';
export const OPPORTUNITY_MONTHLY_MICRO_USD = 20_000_000;
export const OPPORTUNITY_BUCKET = 'opportunity-documents';
export function opportunityLocalClock(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone:'America/Santiago',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23' }).formatToParts(now);
  const value=(key:string)=>parts.find(p=>p.type===key)?.value||'';
  return {day:`${value('year')}-${value('month')}-${value('day')}`,hour:Number(value('hour'))};
}
export const isOpportunityAdmin = (role?: string | null) => role === 'owner' || role === 'admin';
export const WORK_STATES = ['unassigned', 'assigned', 'working', 'blocked', 'submitted', 'won', 'lost', 'archived'] as const;
export const EVIDENCE_STATES = ['documented', 'calculated', 'proposed', 'unknown'] as const;
const text = (max: number) => z.string().trim().max(max);
export const privateOpportunitySchema = z.object({
  requestId:z.string().uuid().optional(),
  title: text(500).min(3), company: text(300).min(2), kind: z.enum(['private_tender', 'proposal', 'quote', 'commercial']).default('private_tender'),
  description: text(40_000).default(''), url: z.string().url().max(2000).refine(v=>/^https?:\/\//i.test(v),'Usa un enlace web.').nullable().default(null),
  deadline: z.string().datetime({ offset: true }).nullable().default(null), currency: text(8).default('CLP'),
  amount: z.number().finite().nonnegative().nullable().default(null),
}).strict();
export const assignmentSchema = z.object({
  expectedRevision: z.number().int().nonnegative(), teamId: z.string().uuid().nullable(),
  participantIds: z.array(z.string().uuid()).max(50).transform(ids => [...new Set(ids)]),
  responsibleId: z.string().uuid().nullable(), objective: text(2000), dueAt: z.string().datetime({ offset: true }).nullable(),
}).strict().refine(value => !value.responsibleId || value.participantIds.includes(value.responsibleId), 'Incluye al responsable en el equipo de trabajo.');
export const activitySchema = z.object({
  kind: z.enum(['note', 'progress', 'blocked', 'decision', 'meeting', 'submitted']), text: text(4000).min(1),
  dueAt: z.string().datetime({ offset: true }).nullable().default(null),
}).strict();
export const taskSchema = z.object({ title: text(500).min(2), ownerId: z.string().uuid().nullable(), dueAt: z.string().datetime({ offset: true }).nullable(),
  status: z.enum(['pending', 'working', 'done', 'blocked']).default('pending'), evidence: text(4000).default('') }).strict();
export const companyContextSchema = z.object({
  offer: text(10_000).min(20), services: z.array(text(500).min(2)).min(1).max(30), territories: z.array(text(100)).max(20),
  exclusions: z.array(text(300)).max(30), priority: z.enum(['hiring', 'posts', 'balanced']),
  automation: z.boolean(), hour: z.number().int().min(0).max(23).default(8),
}).strict();
export type WorkScope = { organizationId: string; userId: string; role?: string };
export type WorkItem = { id: string; kind: string; title: string; company_name: string | null; buyer_name: string | null;
  company_domain: string | null; url: string | null; score: number; reasons: string[]; deadline_at: string | null;
  amount: number | null; currency: string | null; data: Record<string, unknown>; updated_at: string };
export type WorkRecord = { opportunity_id: string; revision: number; state: typeof WORK_STATES[number]; team_id: string | null;
  responsible_id: string | null; objective: string; due_at: string | null; assigned_by: string | null; updated_at: string };
export type WorkspaceMember = { user_id: string; name: string; role: string };
export type WorkspaceOverview = { mode: 'management' | 'assigned'; items: WorkItem[]; work: WorkRecord[];
  notifications: Array<{ id: string; opportunity_id: string; title: string; created_at: string; read_at: string | null }>;
  members: WorkspaceMember[]; groups: Array<{ id: string; name: string }>; context: Record<string, unknown> | null;
  budget: { spent: number; reserved: number; cap: number }; sourceStatus: Record<string, boolean> };

/** Pure arithmetic, shared by charts and exports. Missing tax is not silently assumed. */
export function opportunityFinancialScenario(input: { monthlyCost: number; months: number; overheadPercent: number; marginPercent: number; taxPercent: number | null; paymentDelayMonths: number; guaranteePercent: number }) {
  for (const key of ['monthlyCost','months','overheadPercent','marginPercent','taxPercent','paymentDelayMonths','guaranteePercent'] as const) {
    const value=input[key];
    if (value !== null && (!Number.isFinite(value) || value < 0)) throw new Error('Revisa los valores del escenario.');
  }
  if (input.months < 1 || input.overheadPercent + input.marginPercent >= 100) throw new Error('Los porcentajes o el plazo no permiten calcular el escenario.');
  const monthlyNet = input.monthlyCost / (1 - (input.overheadPercent + input.marginPercent) / 100);
  const totalNet = monthlyNet * input.months;
  return { monthlyNet, totalNet, totalWithTax: input.taxPercent === null ? null : totalNet * (1 + input.taxPercent / 100),
    workingCapital: input.monthlyCost * input.paymentDelayMonths, guarantee: totalNet * input.guaranteePercent / 100 };
}

export function canonicalLinkedInPost(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !/^(www\.)?linkedin\.com$/.test(url.hostname)) return null;
    const id = value.match(/(?:activity[-:]|ugcPost:)(\d{10,30})/)?.[1];
    if (id) return { id, url: `https://www.linkedin.com/feed/update/urn:li:activity:${id}/` };
    if (!/^\/posts\//.test(url.pathname)) return null;
    return { id: url.pathname.replace(/\/$/, ''), url: `https://www.linkedin.com${url.pathname.replace(/\/$/, '')}` };
  } catch { return null; }
}
