// Refuerzo de buildUnifiedRows: robusto ante estructuras variables y sin throws globales

import { getEnrichedLeads } from '@/lib/saved-enriched-leads-storage';
import { getSavedLeads } from '@/lib/saved-leads-storage';
import { contactedLeadsStorage } from '@/lib/contacted-leads-storage';
import { savedOpportunitiesStorage } from '@/lib/saved-opportunities-storage';
import { getCustom } from '@/lib/unified-sheet-storage';
import type { UnifiedRow } from './unified-sheet-types';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

function normalizeStr(v: unknown): string | null {
  if (typeof v === 'string') {
    const s = v.trim();
    return s.length ? s : null;
  }
  return null;
}

function dedupe<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

function safeArray<T = any>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function safeUUID() {
  try {
    const g = globalThis as any;
    if (g?.crypto?.randomUUID) return g.crypto.randomUUID();
  } catch { /* noop */ }
  // fallback suficientemente único para UI local
  return `uid_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

// --- Extractores de email --- //

function extractEmailFromEnriched(e: any): string | null {
  if (!e || typeof e !== 'object') return null;

  const candidatesRaw: unknown[] = [
    e.email,
    e.work_email,
    e.personal_email,
    e.primaryEmail,
    e.primary_email,
    e?.contact?.email,
    e.contact_email,
    e.foundEmail,
    e?.apollo?.email,
    e?.apollo_contact?.email,
    // arreglos
    ...safeArray(e.emails).map((x: any) => x?.address ?? x?.email ?? x),
    ...safeArray(e.contacts).map((c: any) => c?.email),
  ];

  const candidates = dedupe(
    candidatesRaw.map(normalizeStr).filter(Boolean) as string[]
  );

  const valid = candidates.find((c) => EMAIL_RE.test(c));
  if (!valid && candidates.length) {
    console.warn('[sheet] extractEmailFromEnriched: candidatos sin formato válido', candidates);
  }
  return valid ?? null;
}

function extractEmailFromSavedLead(l: any): string | null {
  if (!l || typeof l !== 'object') return null;

  const candidatesRaw: unknown[] = [
    l.email,
    l.work_email,
    l.primaryEmail,
    ...safeArray(l.emails).map((x: any) => x?.address ?? x?.email ?? x),
  ];

  const candidates = dedupe(
    candidatesRaw.map(normalizeStr).filter(Boolean) as string[]
  );

  const valid = candidates.find((c) => EMAIL_RE.test(c));
  return valid ?? null;
}

// --- Mapeos seguros --- //

function mapSavedLead(l: any): UnifiedRow | null {
  try {
    const idBase = l?.id ?? (l as any)?._id ?? (l as any)?.gid ?? safeUUID();
    const gid = `lead_saved|${String(idBase)}`;
    const custom = getCustom(gid);
    const email = extractEmailFromSavedLead(l);

    return {
      gid,
      sourceId: String(l?.id ?? (l as any)?._id ?? ''),
      name: normalizeStr(l?.name ?? `${(l as any)?.first_name ?? ''} ${(l as any)?.last_name ?? ''}`) || null,
      company: normalizeStr(l?.company ?? (l as any)?.companyName) || null,
      title: normalizeStr(l?.title ?? (l as any)?.position) || null,
      email,
      linkedinUrl: normalizeStr((l as any)?.linkedin_url ?? l?.linkedinUrl) || null,
      status: 'saved',
      kind: 'lead_saved',
      createdAt: (l as any)?.createdAt ?? null,
      updatedAt: (l as any)?.updatedAt ?? null,
      stage: custom?.stage ?? null,
      owner: custom?.owner ?? null,
      notes: custom?.notes ?? null,
      hasEmail: !!email,
    };
  } catch (err) {
    console.error('[sheet] mapSavedLead error', err, { l });
    return null;
  }
}

function mapEnrichedLead(e: any): UnifiedRow | null {
  try {
    const idBase = e?.id ?? (e as any)?._id ?? (e as any)?.gid ?? safeUUID();
    const gid = `lead_enriched|${String(idBase)}`;
    const custom = getCustom(gid);
    const email = extractEmailFromEnriched(e);

    if (!email) {
      console.warn('[sheet] enriched sin email válido', {
        id: e?.id ?? (e as any)?._id,
        hasEmailsArray: Array.isArray((e as any)?.emails),
        // cuidado con objetos enormes:
        presentKeys: e ? Object.keys(e).slice(0, 20) : [],
      });
    }

    return {
      gid,
      sourceId: String(e?.id ?? (e as any)?._id ?? ''),
      name: normalizeStr(e?.fullName ?? e?.name ?? `${(e as any)?.firstName ?? ''} ${(e as any)?.lastName ?? ''}`) || null,
      company: normalizeStr(e?.company ?? e?.companyName) || null,
      title: normalizeStr(e?.title ?? (e as any)?.position) || null,
      email,
      linkedinUrl: normalizeStr(e?.linkedinUrl ?? (e as any)?.linkedin_url) || null,
      status: 'enriched',
      kind: 'lead_enriched',
      createdAt: e?.createdAt ?? null,
      updatedAt: (e as any)?.updatedAt ?? null,
      stage: custom?.stage ?? null,
      owner: custom?.owner ?? null,
      notes: custom?.notes ?? null,
      hasEmail: !!email,
    };
  } catch (err) {
    console.error('[sheet] mapEnrichedLead error', err, { e });
    return null;
  }
}

function mapOpportunity(o: any): UnifiedRow | null {
  try {
    const idBase = o?.id ?? (o as any)?._id ?? safeUUID();
    const gid = `opportunity|${String(idBase)}`;
    const custom = getCustom(gid);

    return {
      gid,
      sourceId: String(o?.id ?? (o as any)?._id ?? ''),
      name: normalizeStr(o?.role ?? o?.title ?? o?.name) || null,
      company: normalizeStr(o?.company ?? o?.companyName) || null,
      title: normalizeStr(o?.seniority ?? o?.level) || null,
      email: null,
      linkedinUrl: normalizeStr(o?.jobUrl) || null,
      status: 'saved',
      kind: 'opportunity',
      createdAt: (o as any)?.createdAt ?? null,
      updatedAt: (o as any)?.updatedAt ?? null,
      stage: custom?.stage ?? null,
      owner: custom?.owner ?? null,
      notes: custom?.notes ?? null,
      hasEmail: false,
    };
  } catch (err) {
    console.error('[sheet] mapOpportunity error', err, { o });
    return null;
  }
}

function mapContacted(c: any): UnifiedRow | null {
  try {
    const idBase = c?.id ?? (c as any)?._id ?? safeUUID();
    const gid = `contacted|${String(idBase)}`;
    const custom = getCustom(gid);
    const email = normalizeStr(c?.to ?? c?.email ?? c?.recipient) || null;

    return {
      gid,
      sourceId: String(c?.id ?? (c as any)?._id ?? ''),
      name: normalizeStr(c?.name) || null,
      company: normalizeStr(c?.company) || null,
      title: normalizeStr(c?.title) || null,
      email,
      linkedinUrl: normalizeStr(c?.linkedinUrl) || null,
      status: (normalizeStr(c?.status) as UnifiedRow['status']) ?? 'sent',
      kind: 'contacted',
      createdAt: (c as any)?.createdAt ?? null,
      updatedAt: (c as any)?.updatedAt ?? null,
      stage: custom?.stage ?? null,
      owner: custom?.owner ?? null,
      notes: custom?.notes ?? null,
      hasEmail: !!email,
    };
  } catch (err) {
    console.error('[sheet] mapContacted error', err, { c });
    return null;
  }
}

// --- Principal --- //

export async function buildUnifiedRows(): Promise<UnifiedRow[]> {
  const rows: UnifiedRow[] = [];

  try {
    const [savedRaw, enrichedRaw, oppsRaw, contactedRaw] = await Promise.all([
      (async () => {
        try { return getSavedLeads(); }
        catch (e) { console.error('[sheet] getSavedLeads error', e); return []; }
      })(),
      (async () => {
        try { return getEnrichedLeads(); }
        catch (e) { console.error('[sheet] getEnrichedLeads error', e); return []; }
      })(),
      (async () => {
        try { return savedOpportunitiesStorage.get(); }
        catch (e) { console.error('[sheet] getSavedOpportunities error', e); return []; }
      })(),
      (async () => {
        try { return contactedLeadsStorage.get(); }
        catch (e) { console.error('[sheet] getContactedLeads error', e); return []; }
      })(),
    ]);

    for (const l of safeArray(savedRaw)) {
      const row = mapSavedLead(l);
      if (row) rows.push(row);
    }
    for (const e of safeArray(enrichedRaw)) {
      const row = mapEnrichedLead(e);
      if (row) rows.push(row);
    }
    for (const o of safeArray(oppsRaw)) {
      const row = mapOpportunity(o);
      if (row) rows.push(row);
    }
    for (const c of safeArray(contactedRaw)) {
      const row = mapContacted(c);
      if (row) rows.push(row);
    }
  } catch (err) {
    // Nunca tirar la app: devolvemos lo que haya y dejamos trazas.
    console.error('[sheet] buildUnifiedRows fallo general', err);
  }

  return rows;
}
