import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ResearchSnapshotV1Schema } from '@/lib/research-contracts';

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

/** Read existing research only. Never enqueues or consumes a provider quota. */
export async function readCoworkResearch(client: SupabaseClient, scope: Scope, leadId: string) {
  z.string().uuid().parse(leadId);
  const lead = await client.from('leads').select('id').eq('id', leadId)
    .eq('user_id', scope.userId).eq('organization_id', scope.organizationId).maybeSingle();
  if (lead.error || !lead.data) throw new Error('Contact unavailable');
  const job = await client.from('lead_research_jobs').select('status,research_snapshot_id,updated_at')
    .eq('lead_id', leadId).eq('user_id', scope.userId).eq('organization_id', scope.organizationId)
    .order('updated_at', { ascending: false }).limit(1).maybeSingle();
  if (job.error) throw new Error('Research lookup failed');
  if (!job.data) return { leadId, availability: 'not_found', message: 'No hay investigación guardada para este contacto.' };
  if (!job.data.research_snapshot_id) return { leadId, availability: 'without_snapshot', status: job.data.status, updatedAt: job.data.updated_at };
  const row = await client.from('research_snapshots').select('payload').eq('id', job.data.research_snapshot_id)
    .eq('user_id', scope.userId).eq('organization_id', scope.organizationId).maybeSingle();
  if (row.error || !row.data) throw new Error('Research snapshot unavailable');
  return { leadId, availability: 'available', research: summarizeCoworkResearch(row.data.payload, scope, leadId) };
}
