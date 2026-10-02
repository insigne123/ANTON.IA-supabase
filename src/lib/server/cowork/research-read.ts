import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ResearchSnapshotV1Schema } from '@/lib/research-contracts';
import { ownsContact } from './own-contacts';

type Scope = { userId: string; organizationId: string };

export function summarizeCoworkResearch(payload: unknown, scope: Scope, leadId: string, now = Date.now()) {
  const snapshot = ResearchSnapshotV1Schema.parse(payload);
  if (snapshot.scope.ownerUserId !== scope.userId || snapshot.scope.organizationId !== scope.organizationId
    || snapshot.subject.leadId !== leadId) throw new Error('Research identity mismatch');
  const evidence = snapshot.evidence.slice(0, 25);
  const evidenceIds = new Set(evidence.map(item => item.id));
  const claims = snapshot.claims.filter(claim => [...claim.supportingEvidenceIds, ...claim.contradictingEvidenceIds]
    .every(id => evidenceIds.has(id))).slice(0, 20);
  const sourceIds = new Set(evidence.map(item => item.sourceId));
  return {
    snapshotId: snapshot.id, capturedAt: snapshot.updatedAt, status: snapshot.lifecycle.status,
    sources: snapshot.sources.filter(source => sourceIds.has(source.id)).map(source => ({
      id: source.id, url: source.canonicalUrl, title: source.title, retrievedAt: source.retrievedAt,
    })),
    evidence: evidence.map(item => ({ id: item.id, statement: item.statement.slice(0, 1500), sourceId: item.sourceId, confidence: item.confidence })),
    contradictions: snapshot.contradictions.slice(0, 20),
    claims: claims.map(claim => ({ id: claim.id, statement: claim.statement.slice(0, 1500), classification: claim.classification,
      supportingEvidenceIds: claim.supportingEvidenceIds, contradictingEvidenceIds: claim.contradictingEvidenceIds,
      expired: Date.parse(claim.freshness.validUntil) < now, confidence: claim.confidence })),
    warnings: snapshot.lifecycle.errors.map(error => ({ code: error.code, severity: error.severity })),
    truncated: evidence.length < snapshot.evidence.length || claims.length < snapshot.claims.length || snapshot.contradictions.length > 20,
  };
}

/**
 * The written report Cowork reads (Plan 6, PR-C1). research.get_existing only read the evidence, so Cowork retold a 1,500-word
 * report «en pocas líneas» (the 1 Oct test: «informes muy breves»). These are its prose sections, in the order a person reads
 * them; the rest (sources, committee, volume, gaps, snapshot) are blocks the app composes, and the evidence carries the sources.
 */
const REPORT_SECTIONS = ['verdict', 'contact', 'company', 'fit', 'angle', 'discovery', 'objections', 'signals', 'regulatory', 'risks'] as const;
const SECTION_MAX = 3_000;
const REPORT_MAX = 16_000;
const REPORT_V2 = 'research-report-document/v2';

const StoredReportSchema = z.object({
  sections: z.array(z.object({
    key: z.string(),
    title: z.string().optional(),
    paragraphs: z.array(z.object({ text: z.string() }).passthrough()).optional(),
  }).passthrough()).optional(),
  audit: z.object({ issues: z.array(z.object({ severity: z.string(), fragment: z.string() }).passthrough()).optional() }).passthrough().optional(),
  synthesis: z.object({ status: z.string() }).passthrough().optional(),
}).passthrough();

export type CoworkResearchReport = {
  status: 'completed' | 'partial';
  generatedAt: string | null;
  sections: Array<{ key: string; title: string; text: string }>;
  /** What the review withheld or could not confirm, said once. */
  caveats: string[];
  truncated: boolean;
};

/** Each prose section whole, in reading order, within one budget; null when the document has no prose. */
export function coworkResearchReport(document: unknown, generatedAt: string | null = null): CoworkResearchReport | null {
  const parsed = StoredReportSchema.safeParse(document);
  if (!parsed.success) return null;
  let budget = REPORT_MAX;
  let truncated = false;
  const sections: CoworkResearchReport['sections'] = [];
  for (const key of REPORT_SECTIONS) {
    const section = parsed.data.sections?.find(item => item.key === key);
    const full = (section?.paragraphs || []).map(paragraph => paragraph.text.trim()).filter(Boolean).join('\n\n');
    if (!full) continue;
    const max = Math.min(SECTION_MAX, budget);
    if (max < 200) { truncated = true; break; }
    const text = full.length > max ? `${full.slice(0, max).trimEnd()}…` : full;
    if (text.length < full.length) truncated = true;
    budget -= text.length;
    sections.push({ key, title: section?.title?.trim() || key, text });
  }
  if (!sections.length) return null;
  const caveats = [...new Set((parsed.data.audit?.issues || []).filter(issue => issue.severity === 'warn')
    .map(issue => issue.fragment.trim()).filter(Boolean))].slice(0, 5);
  return { status: parsed.data.synthesis?.status === 'partial' ? 'partial' : 'completed', generatedAt, sections, caveats, truncated };
}

export type CoworkReportStatus = 'ready' | 'writing' | 'failed' | 'none';

const REPORT_MESSAGES: Record<Exclude<CoworkReportStatus, 'ready'>, string> = {
  writing: 'El informe escrito todavía se está preparando; la evidencia ya está disponible.',
  failed: 'El informe escrito no se pudo preparar; usa la evidencia y dilo una vez.',
  none: 'Esta investigación no tiene informe escrito; usa la evidencia.',
};

/** The visible written report of a snapshot, or why there is none yet. Never throws: the evidence still answers. */
async function readReport(client: SupabaseClient, scope: Scope, snapshotId: string) {
  const document = await client.from('research_report_documents').select('document,generated_at')
    .eq('research_snapshot_id', snapshotId).eq('schema_version', REPORT_V2).eq('delivery_state', 'visible')
    .eq('user_id', scope.userId).eq('organization_id', scope.organizationId)
    .order('revision', { ascending: false }).order('generated_at', { ascending: false }).limit(1).maybeSingle();
  if (!document.error && document.data) {
    const report = coworkResearchReport(document.data.document, document.data.generated_at ?? null);
    if (report) return { reportStatus: 'ready' as CoworkReportStatus, report };
  }
  const state = await client.from('research_report_synthesis_states').select('status,retryable')
    .eq('research_snapshot_id', snapshotId).eq('schema_version', REPORT_V2)
    .eq('user_id', scope.userId).eq('organization_id', scope.organizationId)
    .order('updated_at', { ascending: false }).limit(1).maybeSingle();
  const status = state.error ? '' : String(state.data?.status || '');
  // Queued, running or due for a retry (a partial one is retried): still being written.
  const writing = ['queued', 'running', 'retry_scheduled'].includes(status) || (status === 'partial' && state.data?.retryable === true);
  const reportStatus: Exclude<CoworkReportStatus, 'ready'> = status === 'failed_permanent' ? 'failed' : writing ? 'writing' : 'none';
  return { reportStatus: reportStatus as CoworkReportStatus, report: null, reportMessage: REPORT_MESSAGES[reportStatus] };
}

/** Read existing research only. Never enqueues or consumes a provider quota. Saved contacts and «Por escribir» alike. */
export async function readCoworkResearch(client: SupabaseClient, scope: Scope, leadId: string) {
  z.string().uuid().parse(leadId);
  if (!await ownsContact(client, scope, leadId)) throw new Error('Contact unavailable');
  const job = await client.from('lead_research_jobs').select('status,research_snapshot_id,updated_at')
    .eq('lead_id', leadId).eq('user_id', scope.userId).eq('organization_id', scope.organizationId)
    .order('updated_at', { ascending: false }).limit(1).maybeSingle();
  if (job.error) throw new Error('Research lookup failed');
  if (!job.data) return { leadId, availability: 'not_found', message: 'No hay investigación guardada para este contacto.' };
  if (!job.data.research_snapshot_id) return { leadId, availability: 'without_snapshot', status: job.data.status, updatedAt: job.data.updated_at };
  const row = await client.from('research_snapshots').select('payload').eq('id', job.data.research_snapshot_id)
    .eq('user_id', scope.userId).eq('organization_id', scope.organizationId).maybeSingle();
  if (row.error || !row.data) throw new Error('Research snapshot unavailable');
  const research = summarizeCoworkResearch(row.data.payload, scope, leadId);
  const written = await readReport(client, scope, job.data.research_snapshot_id).catch(() => ({
    reportStatus: 'none' as CoworkReportStatus, report: null, reportMessage: REPORT_MESSAGES.none,
  }));
  return { leadId, availability: 'available', ...written, research };
}
