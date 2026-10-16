import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { generateStructured } from '@/ai/openai-json';
import { mapProfileToForm } from '@/lib/profile/profile-mappings';
import {
  LEAD_FIT_BATCH, LEAD_FIT_MODEL, LEAD_FIT_SYSTEM, LeadFitAnswerSchema, leadFitFacts, leadFitKey, leadFitOutcomeStats, leadFitPrompt,
  leadFitResearch, normalizeLeadFitAssessment, type LeadFitFactor, type LeadFitLead, type LeadFitOutcomeRow, type LeadFitProfile,
  type LeadFitResearch, type LeadFitStage, type LeadFitStats,
} from '@/lib/lead-fit/core';

export type LeadFitStored = { probability: number; summary: string; factors: LeadFitFactor[]; model: string; updatedAt: string };
export type LeadFitPerson = Partial<Record<LeadFitStage, LeadFitStored>>;
export type LeadFitResponse = {
  results: Record<string, LeadFitPerson>;
  /** «Perfil» has no offer nor customer: nothing to measure against, so nothing is estimated. */
  needsProfile: boolean;
  /** The organization reached today's estimates; the kept ones still show. */
  limited: boolean;
  /** The model failed this time; the kept ones still show and the next visit tries again. */
  failed: boolean;
};

type Scope = { userId: string; organizationId: string };
type Deps = { generate: typeof generateStructured; now: () => Date };
const defaultDeps: Deps = { generate: generateStructured, now: () => new Date() };

/** Estimates a day per organization: each is a fraction of a cent, the cap keeps an accident from becoming a bill. */
const dailyLimit = () => Math.max(0, Number(process.env.LEAD_FIT_DAILY_LIMIT || 1500));
export const leadFitEnabled = () => process.env.LEAD_FIT_ENABLED !== 'false';

const split = (value: string, pattern: RegExp, max = 8) => value.split(pattern).map(item => item.trim()).filter(Boolean).slice(0, max);
const clip = (value: string, max: number) => value.replace(/\s+/g, ' ').trim().slice(0, max) || null;

/** The offer and the customer declared in «Perfil», as the model reads them. */
export function leadFitProfile(row: unknown): LeadFitProfile {
  const form = mapProfileToForm((row || {}) as Parameters<typeof mapProfileToForm>[0]);
  return {
    empresa: clip(form.companyName, 120), oferta: clip(form.description, 500), propuesta: clip(form.valueProposition, 400),
    servicios: clip(form.services, 400), cargos: split(form.targetRoles, /[,;\n]/), industrias: split(form.targetIndustries, /[,;\n]/),
    tamano: clip(form.targetCompanySize, 60), ubicaciones: split(form.targetLocations, /[,;\n]/, 5),
    dolores: split(form.painPoints, /\n/, 5), clientesReferencia: split(form.referenceClients, /[,;\n]/, 6),
  };
}
export function leadFitProfileDefined(profile: LeadFitProfile) {
  return Boolean(profile.cargos.length || profile.industrias.length || profile.oferta || profile.propuesta || profile.servicios);
}

/** A change in the person's facts or in «Perfil» asks for a new estimate; the same ones keep the one there is. */
export function leadFitInputHash(stage: LeadFitStage, facts: unknown, profile: LeadFitProfile) {
  return createHash('sha256').update(JSON.stringify({ v: 1, stage, facts, profile })).digest('hex').slice(0, 32);
}

const statsCache = new Map<string, { at: number; stats: LeadFitStats }>();
/** The organization's last 2,000 sends, aggregated; kept ten minutes so a page of results reads them once. */
export async function readLeadFitStats(admin: SupabaseClient, organizationId: string, now = Date.now()) {
  const cached = statsCache.get(organizationId);
  if (cached && now - cached.at < 10 * 60_000) return cached.stats;
  const { data, error } = await admin.from('contacted_leads').select('role,industry,replied_at,reply_intent,bounced_at')
    .eq('organization_id', organizationId).not('sent_at', 'is', null).order('sent_at', { ascending: false }).limit(2000);
  if (error) throw new Error('No se pudieron leer los resultados del equipo.');
  const stats = leadFitOutcomeStats((data || []) as LeadFitOutcomeRow[]);
  statsCache.set(organizationId, { at: now, stats });
  return stats;
}

/**
 * The research reports of these people that the user ran (research is private to whoever ran it): the native report (its
 * latest completed document) or, before it, the legacy one. Keyed by the person's key.
 */
export async function readLeadFitResearch(admin: SupabaseClient, scope: Scope, people: Array<{ key: string; lead: LeadFitLead }>) {
  const found = new Map<string, LeadFitResearch>();
  const byRef = new Map<string, string>();
  for (const { key, lead } of people) {
    for (const ref of [lead.leadId, lead.email?.toLowerCase()]) if (ref && ref.trim()) byRef.set(ref.trim(), key);
  }
  const refs = [...byRef.keys()];
  if (!refs.length) return found;
  const [snapshots, legacy] = await Promise.all([
    admin.from('research_snapshots').select('id,lead_ref,captured_at').eq('organization_id', scope.organizationId).eq('user_id', scope.userId)
      .in('lead_ref', refs).order('captured_at', { ascending: false }).limit(200),
    admin.from('lead_research_reports').select('lead_ref,lead_id,email,report,completed_at').eq('organization_id', scope.organizationId)
      .eq('user_id', scope.userId).not('completed_at', 'is', null).in('lead_ref', refs).order('completed_at', { ascending: false }).limit(200),
  ]);
  if (snapshots.error || legacy.error) throw new Error('No se pudieron leer los informes de investigación.');
  const snapshotKey = new Map<string, string>();
  for (const row of snapshots.data || []) { const key = byRef.get(row.lead_ref); if (key && !snapshotKey.has(row.id)) snapshotKey.set(row.id, key); }
  if (snapshotKey.size) {
    const documents = await admin.from('research_report_documents').select('research_snapshot_id,document,updated_at')
      .in('research_snapshot_id', [...snapshotKey.keys()]).eq('status', 'completed').order('updated_at', { ascending: false }).limit(200);
    if (documents.error) throw new Error('No se pudieron leer los informes de investigación.');
    for (const row of documents.data || []) {
      const key = snapshotKey.get(row.research_snapshot_id);
      const research = key && !found.has(key) ? leadFitResearch(row.document) : null;
      if (key && research) found.set(key, research);
    }
  }
  for (const row of legacy.data || []) {
    const key = byRef.get(row.lead_ref) || byRef.get(String(row.lead_id || '')) || byRef.get(String(row.email || '').toLowerCase());
    const research = key && !found.has(key) ? leadFitResearch(row.report) : null;
    if (key && research) found.set(key, research);
  }
  return found;
}

const PREVIOUS: Record<LeadFitStage, LeadFitStage[]> = { search: [], saved: ['search'], researched: ['saved', 'search'] };

/**
 * The estimates for a page of people at one stage: the kept ones, and new ones from the model for the people whose facts
 * (or «Perfil») changed, when `score` asks for them. Every stage already estimated travels too, for the history in the
 * explanation.
 */
export async function assessLeadFit(admin: SupabaseClient, scope: Scope, stage: LeadFitStage, leads: LeadFitLead[],
  options: { score: boolean }, deps: Deps = defaultDeps): Promise<LeadFitResponse> {
  const people = new Map<string, LeadFitLead>();
  for (const lead of leads) { const key = leadFitKey(lead); if (key && !people.has(key)) people.set(key, lead); }
  const response: LeadFitResponse = { results: {}, needsProfile: false, limited: false, failed: false };
  if (!people.size) return response;

  const [kept, profileRow] = await Promise.all([
    admin.from('lead_fit_assessments').select('lead_key,stage,probability,summary,factors,model,input_hash,updated_at')
      .eq('organization_id', scope.organizationId).eq('user_id', scope.userId).in('lead_key', [...people.keys()]),
    admin.from('profiles').select('full_name,job_title,company_name,company_domain,signatures').eq('id', scope.userId).maybeSingle(),
  ]);
  if (kept.error) throw new Error('No se pudieron leer las probabilidades guardadas.');
  if (profileRow.error) throw new Error('No se pudo leer tu perfil.');
  const hashes = new Map<string, string>();
  for (const row of kept.data || []) {
    const person = (response.results[row.lead_key] ||= {});
    person[row.stage as LeadFitStage] = { probability: row.probability, summary: row.summary, factors: row.factors || [], model: row.model, updatedAt: row.updated_at };
    if (row.stage === stage) hashes.set(row.lead_key, row.input_hash);
  }

  const profile = leadFitProfile(profileRow.data);
  if (!leadFitProfileDefined(profile)) { response.needsProfile = true; return response; }
  if (!options.score || !leadFitEnabled()) return response;

  const research = stage === 'researched'
    ? await readLeadFitResearch(admin, scope, [...people.entries()].map(([key, lead]) => ({ key, lead })))
    : new Map<string, LeadFitResearch>();
  const stale = [...people.entries()].map(([key, lead]) => {
    const facts = leadFitFacts(stage, lead, research.get(key) || null);
    return { key, facts, hash: leadFitInputHash(stage, facts, profile) };
  }).filter(item => hashes.get(item.key) !== item.hash);
  if (!stale.length) return response;

  const since = new Date(deps.now().getTime() - 24 * 60 * 60_000).toISOString();
  const used = await admin.from('lead_fit_assessments').select('id', { count: 'exact', head: true })
    .eq('organization_id', scope.organizationId).gte('updated_at', since);
  if (used.error) throw new Error('No se pudo revisar el uso de hoy.');
  const room = Math.max(0, dailyLimit() - (used.count || 0));
  if (room < stale.length) response.limited = true;
  const todo = stale.slice(0, room);
  if (!todo.length) return response;

  const stats = await readLeadFitStats(admin, scope.organizationId, deps.now().getTime());
  for (let start = 0; start < todo.length; start += LEAD_FIT_BATCH) {
    const batch = todo.slice(start, start + LEAD_FIT_BATCH);
    const refs = new Map(batch.map((item, index) => [`L${index + 1}`, item]));
    let answer;
    try {
      answer = await deps.generate({
        schema: LeadFitAnswerSchema, systemPrompt: LEAD_FIT_SYSTEM, openAiModel: LEAD_FIT_MODEL, allowDefaultModelFallback: false,
        reasoningEffort: 'low', maxAttempts: 2, timeoutMs: 60_000, maxOutputTokens: 600 + batch.length * 220,
        prompt: leadFitPrompt({ stage, profile, stats, people: [...refs.entries()].map(([ref, item]) => {
          const before = response.results[item.key] || {};
          const previousStage = PREVIOUS[stage].find(candidate => before[candidate]);
          const previous = previousStage ? before[previousStage]! : null;
          return { ref, facts: item.facts, previous: previous && previousStage
            ? { stage: previousStage, probability: previous.probability, summary: previous.summary } : null };
        }) }),
      });
    } catch (error) {
      console.warn('[lead-fit] model failed', error instanceof Error ? error.message.slice(0, 160) : error);
      response.failed = true;
      break;
    }
    const updatedAt = deps.now().toISOString();
    const rows = answer.assessments.flatMap(item => {
      const person = refs.get(item.ref);
      if (!person) return [];
      refs.delete(item.ref);
      const assessment = normalizeLeadFitAssessment(item);
      return [{ organization_id: scope.organizationId, user_id: scope.userId, lead_key: person.key, stage, ...assessment,
        model: LEAD_FIT_MODEL, input_hash: person.hash, updated_at: updatedAt }];
    });
    if (!rows.length) { response.failed = true; continue; }
    const saved = await admin.from('lead_fit_assessments').upsert(rows, { onConflict: 'organization_id,user_id,lead_key,stage' });
    if (saved.error) throw new Error('No se pudieron guardar las probabilidades.');
    for (const row of rows) {
      (response.results[row.lead_key] ||= {})[stage] = { probability: row.probability, summary: row.summary, factors: row.factors, model: row.model, updatedAt };
    }
  }
  return response;
}
