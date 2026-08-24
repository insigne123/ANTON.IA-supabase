import { hasUnsubscribeContent, validateOutboundEmail } from '@/lib/email-outbound';
import { type MessagingDraftV1, MessagingDraftV1Schema } from '@/lib/messaging-contracts';
import { generateUnsubscribeLink } from '@/lib/unsubscribe-helpers';
import { getCurrentMessagingDraftVersionV1 } from '@/lib/server/messaging-drafts';
import { isEmailSuppressedForScope } from '@/lib/server/privacy-subject-data';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';

const REVIEW_LIST_LIMIT = 100;
const REVIEW_BATCH_SIZE = 25;
const REVIEW_NOTE_MAX_LENGTH = 500;

const REVIEW_ITEM_COLUMNS = [
  'id',
  'organization_id',
  'item_type',
  'messaging_draft_id',
  'antonia_report_id',
  'requested_by_user_id',
  'sender_user_id',
  'title',
  'summary',
  'status',
  'severity',
  'metadata',
  'reviewed_by_user_id',
  'reviewed_at',
  'resolution_note',
  'created_at',
  'updated_at',
].join(',');

export type SupliaReviewItemType = 'outbound_email' | 'antonia_report';
export type SupliaReviewItemStatus = 'pending' | 'approved' | 'dismissed' | 'resolved';
export type SupliaReviewSeverity = 'normal' | 'attention' | 'critical';

type SupliaReviewItemRecord = {
  id: string;
  organizationId: string;
  itemType: SupliaReviewItemType;
  messagingDraftId: string | null;
  antoniaReportId: string | null;
  requestedByUserId: string | null;
  senderUserId: string | null;
  title: string;
  summary: string;
  status: SupliaReviewItemStatus;
  severity: SupliaReviewSeverity;
  metadata: Record<string, unknown>;
  reviewedByUserId: string | null;
  reviewedAt: string | null;
  resolutionNote: string | null;
  createdAt: string;
  updatedAt: string;
};

type AntoniaReportRow = {
  id: string;
  type: string | null;
  content: string | null;
  summary_data: unknown;
  created_at: string | null;
};

type MessagingDraftRow = {
  id: string;
  user_id: string | null;
  current_version_id: string | null;
  lifecycle: string | null;
  current_revision: number | null;
  created_at: string | null;
  updated_at: string | null;
};

type MessagingDraftVersionRow = {
  id: string;
  draft_id: string;
  payload: unknown;
};

type OutboundDispatchRow = {
  id: string;
  draft_id: string;
  status: string | null;
  provider: string | null;
  requested_at: string | null;
  completed_at: string | null;
  error_code: string | null;
};

export type SupliaReviewInboxDependencies = {
  admin?: any;
  getCurrentDraft?: (input: { organizationId: string; userId: string; draftId: string }) => Promise<MessagingDraftV1 | null>;
  isSuppressed?: (email: string, scope: { userId: string; organizationId: string }) => Promise<boolean>;
  generateUnsubscribeUrl?: (email: string, userId: string, organizationId: string) => string;
  now?: () => string;
};

export class SupliaReviewInboxError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'SupliaReviewInboxError';
  }
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
}

function nullableText(value: unknown) {
  return text(value) || null;
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function truncate(value: string, maxLength: number) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function chunks<T>(items: T[], size = REVIEW_BATCH_SIZE) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

function unique(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => text(value)).filter(Boolean))];
}

function isUniqueViolation(error: any) {
  return error?.code === '23505';
}

function isMessagingApprovalConflict(error: any) {
  const code = text(error?.code);
  const message = text(error?.message).toLowerCase();
  return code === '40001'
    || code === '40400'
    || message.includes('is not current')
    || message.includes('stale messaging draft');
}

function asItemType(value: unknown): SupliaReviewItemType {
  if (value === 'outbound_email' || value === 'antonia_report') return value;
  throw new Error('Invalid suplia review item type.');
}

function asItemStatus(value: unknown): SupliaReviewItemStatus {
  if (value === 'pending' || value === 'approved' || value === 'dismissed' || value === 'resolved') return value;
  throw new Error('Invalid suplia review item status.');
}

function asSeverity(value: unknown): SupliaReviewSeverity {
  if (value === 'attention' || value === 'critical') return value;
  return 'normal';
}

function toReviewItemRecord(row: any): SupliaReviewItemRecord {
  return {
    id: text(row?.id),
    organizationId: text(row?.organization_id),
    itemType: asItemType(row?.item_type),
    messagingDraftId: nullableText(row?.messaging_draft_id),
    antoniaReportId: nullableText(row?.antonia_report_id),
    requestedByUserId: nullableText(row?.requested_by_user_id),
    senderUserId: nullableText(row?.sender_user_id),
    title: text(row?.title),
    summary: text(row?.summary),
    status: asItemStatus(row?.status),
    severity: asSeverity(row?.severity),
    metadata: object(row?.metadata),
    reviewedByUserId: nullableText(row?.reviewed_by_user_id),
    reviewedAt: nullableText(row?.reviewed_at),
    resolutionNote: nullableText(row?.resolution_note),
    createdAt: text(row?.created_at),
    updatedAt: text(row?.updated_at),
  };
}

function adminFrom(dependencies?: SupliaReviewInboxDependencies) {
  return dependencies?.admin ?? getSupabaseAdminClient();
}

function currentDraftFrom(dependencies?: SupliaReviewInboxDependencies) {
  return dependencies?.getCurrentDraft ?? getCurrentMessagingDraftVersionV1;
}

function suppressionCheckFrom(dependencies?: SupliaReviewInboxDependencies) {
  return dependencies?.isSuppressed ?? isEmailSuppressedForScope;
}

function unsubscribeUrlFrom(dependencies?: SupliaReviewInboxDependencies) {
  return dependencies?.generateUnsubscribeUrl ?? generateUnsubscribeLink;
}

function nowFrom(dependencies?: SupliaReviewInboxDependencies) {
  return dependencies?.now?.() ?? new Date().toISOString();
}

function normalizedRequestedProvider(value: unknown) {
  const provider = text(value).toLowerCase();
  if (provider === 'google' || provider === 'gmail') return 'google';
  if (provider === 'outlook') return 'outlook';
  return null;
}

function metadataText(value: unknown) {
  return truncate(text(value), 200) || null;
}

function emailReviewProvenance(metadata: Record<string, unknown>) {
  return {
    conversationId: metadataText(metadata.conversationId),
    actionId: metadataText(metadata.actionId),
    requestedProvider: normalizedRequestedProvider(metadata.requestedProvider),
  };
}

function reviewItemBase(item: SupliaReviewItemRecord) {
  return {
    id: item.id,
    itemType: item.itemType,
    status: item.status,
    severity: item.severity,
    title: item.title,
    summary: item.summary,
    requestedByUserId: item.requestedByUserId,
    senderUserId: item.senderUserId,
    reviewedByUserId: item.reviewedByUserId,
    reviewedAt: item.reviewedAt,
    resolutionNote: item.resolutionNote,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

async function findReviewItemRecord(input: {
  organizationId: string;
  reviewId?: string;
  messagingDraftId?: string;
  antoniaReportId?: string;
}, dependencies?: SupliaReviewInboxDependencies): Promise<SupliaReviewItemRecord | null> {
  const admin = adminFrom(dependencies);
  let query = admin
    .from('suplia_review_items')
    .select(REVIEW_ITEM_COLUMNS)
    .eq('organization_id', input.organizationId);

  if (input.reviewId) query = query.eq('id', input.reviewId);
  if (input.messagingDraftId) query = query.eq('messaging_draft_id', input.messagingDraftId);
  if (input.antoniaReportId) query = query.eq('antonia_report_id', input.antoniaReportId);

  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data ? toReviewItemRecord(data) : null;
}

function reportField(summaryData: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = summaryData[key];
    if (typeof value === 'string' && text(value)) return value;
  }
  return '';
}

export function reviewPlainText(value: unknown, maxLength = 500) {
  const plain = text(value)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return truncate(plain, maxLength);
}

export function createAntoniaReportReviewPreview(input: {
  type?: unknown;
  content?: unknown;
  summaryData?: unknown;
}) {
  const summaryData = object(input.summaryData);
  const reportType = reviewPlainText(input.type, 80) || 'report';
  const title = reviewPlainText(
    reportField(summaryData, ['title', 'reportTitle', 'name']) || `ANTONIA report: ${reportType}`,
    180,
  );
  const summary = reviewPlainText(
    reportField(summaryData, ['summary', 'overview', 'description', 'message']) || input.content,
    500,
  ) || `ANTONIA report: ${reportType}`;

  return {
    title,
    summary,
    severity: asSeverity(summaryData.severity ?? summaryData.priority),
  };
}

export function normalizeSupliaReviewResolutionNote(note: unknown) {
  if (note === undefined || note === null) return null;
  if (typeof note !== 'string') {
    throw new SupliaReviewInboxError('REVIEW_NOTE_INVALID', 'resolution note must be a string.', 400);
  }
  const normalized = note.replace(/\s+/g, ' ').trim();
  if (normalized.length > REVIEW_NOTE_MAX_LENGTH) {
    throw new SupliaReviewInboxError('REVIEW_NOTE_TOO_LONG', `resolution note must be at most ${REVIEW_NOTE_MAX_LENGTH} characters.`, 400);
  }
  return normalized || null;
}

export async function ensureSupliaEmailReviewItem(input: {
  organizationId: string;
  requestedByUserId: string | null;
  senderUserId: string;
  draft: MessagingDraftV1;
  conversationId?: string | null;
  actionId?: string | null;
  requestedProvider?: string | null;
}, dependencies?: SupliaReviewInboxDependencies) {
  const draft = MessagingDraftV1Schema.parse(input.draft);
  if (draft.organizationId !== input.organizationId || draft.userId !== input.senderUserId) {
    throw new Error('SUPL.IA review item draft scope does not match its owner.');
  }

  const existing = await findReviewItemRecord({
    organizationId: input.organizationId,
    messagingDraftId: draft.draftId,
  }, dependencies);
  if (existing) return existing;

  const recipient = draft.recipient.displayName || draft.recipient.email || 'recipient';
  const title = truncate(`Email review: ${recipient}`, 180);
  const summary = truncate(draft.content.subject || `Email to ${draft.recipient.email || 'recipient'}`, 500);
  const metadata = {
    source: 'suplia',
    conversationId: metadataText(input.conversationId),
    actionId: metadataText(input.actionId),
    requestedProvider: normalizedRequestedProvider(input.requestedProvider),
  };
  const admin = adminFrom(dependencies);
  const { data, error } = await admin
    .from('suplia_review_items')
    .insert({
      organization_id: input.organizationId,
      item_type: 'outbound_email',
      messaging_draft_id: draft.draftId,
      antonia_report_id: null,
      requested_by_user_id: input.requestedByUserId,
      sender_user_id: input.senderUserId,
      title,
      summary,
      status: 'pending',
      severity: 'normal',
      metadata,
    })
    .select(REVIEW_ITEM_COLUMNS)
    .maybeSingle();

  if (!error && data) return toReviewItemRecord(data);
  if (isUniqueViolation(error)) {
    const raced = await findReviewItemRecord({
      organizationId: input.organizationId,
      messagingDraftId: draft.draftId,
    }, dependencies);
    if (raced) return raced;
  }
  if (error) throw error;
  throw new Error('SUPL.IA review item was not returned after creation.');
}

export async function synchronizeAntoniaReportReviewItems(input: {
  organizationId: string;
}, dependencies?: SupliaReviewInboxDependencies) {
  const admin = adminFrom(dependencies);
  const { data: reports, error: reportsError } = await admin
    .from('antonia_reports')
    .select('id,type,content,summary_data,created_at')
    .eq('organization_id', input.organizationId)
    .order('created_at', { ascending: false })
    .limit(REVIEW_LIST_LIMIT);
  if (reportsError) throw reportsError;

  const reportRows = ((reports || []) as AntoniaReportRow[]).filter((report) => text(report.id));
  const reportIds = unique(reportRows.map((report) => report.id));
  if (reportIds.length === 0) return { synchronized: 0, created: 0 };

  const existingIds = new Set<string>();
  for (const batch of chunks(reportIds)) {
    const { data, error } = await admin
      .from('suplia_review_items')
      .select('antonia_report_id')
      .eq('organization_id', input.organizationId)
      .eq('item_type', 'antonia_report')
      .in('antonia_report_id', batch)
      .limit(batch.length);
    if (error) throw error;
    for (const row of data || []) {
      const id = nullableText((row as any).antonia_report_id);
      if (id) existingIds.add(id);
    }
  }

  const missing = reportRows.filter((report) => !existingIds.has(report.id));
  for (const batch of chunks(missing)) {
    const payload = batch.map((report) => {
      const preview = createAntoniaReportReviewPreview({
        type: report.type,
        content: report.content,
        summaryData: report.summary_data,
      });
      return {
        organization_id: input.organizationId,
        item_type: 'antonia_report',
        messaging_draft_id: null,
        antonia_report_id: report.id,
        requested_by_user_id: null,
        sender_user_id: null,
        title: preview.title,
        summary: preview.summary,
        status: 'pending',
        severity: preview.severity,
        metadata: {
          source: 'antonia_report',
          reportType: reviewPlainText(report.type, 80) || null,
          reportCreatedAt: nullableText(report.created_at),
        },
      };
    });
    const { error } = await admin.from('suplia_review_items').insert(payload);
    if (!error) continue;
    if (!isUniqueViolation(error)) throw error;

    // A concurrent inbox load may have inserted one source row in this batch.
    for (const item of payload) {
      const { error: itemError } = await admin.from('suplia_review_items').insert(item);
      if (itemError && !isUniqueViolation(itemError)) throw itemError;
    }
  }

  return { synchronized: reportRows.length, created: missing.length };
}

async function loadDraftRows(organizationId: string, draftIds: string[], dependencies?: SupliaReviewInboxDependencies) {
  const admin = adminFrom(dependencies);
  const rows: MessagingDraftRow[] = [];
  for (const batch of chunks(draftIds)) {
    const { data, error } = await admin
      .from('messaging_drafts')
      .select('id,user_id,current_version_id,lifecycle,current_revision,created_at,updated_at')
      .eq('organization_id', organizationId)
      .in('id', batch)
      .limit(batch.length);
    if (error) throw error;
    rows.push(...((data || []) as MessagingDraftRow[]));
  }
  return rows;
}

async function loadDraftVersionRows(organizationId: string, versionIds: string[], dependencies?: SupliaReviewInboxDependencies) {
  const admin = adminFrom(dependencies);
  const rows: MessagingDraftVersionRow[] = [];
  for (const batch of chunks(versionIds)) {
    const { data, error } = await admin
      .from('messaging_draft_versions')
      .select('id,draft_id,payload')
      .eq('organization_id', organizationId)
      .in('id', batch)
      .limit(batch.length);
    if (error) throw error;
    rows.push(...((data || []) as MessagingDraftVersionRow[]));
  }
  return rows;
}

async function loadReportLightRows(organizationId: string, reportIds: string[], dependencies?: SupliaReviewInboxDependencies) {
  const admin = adminFrom(dependencies);
  const rows: Array<Pick<AntoniaReportRow, 'id' | 'type' | 'created_at'>> = [];
  for (const batch of chunks(reportIds)) {
    const { data, error } = await admin
      .from('antonia_reports')
      .select('id,type,created_at')
      .eq('organization_id', organizationId)
      .in('id', batch)
      .limit(batch.length);
    if (error) throw error;
    rows.push(...((data || []) as Array<Pick<AntoniaReportRow, 'id' | 'type' | 'created_at'>>));
  }
  return rows;
}

async function loadLatestDispatchRows(organizationId: string, draftIds: string[], dependencies?: SupliaReviewInboxDependencies) {
  const admin = adminFrom(dependencies);
  const dispatches = new Map<string, OutboundDispatchRow>();

  for (const batch of chunks(draftIds, 10)) {
    const rows = await Promise.all(batch.map(async (draftId) => {
      const { data, error } = await admin
        .from('outbound_dispatches')
        .select('id,draft_id,status,provider,requested_at,completed_at,error_code')
        .eq('organization_id', organizationId)
        .eq('draft_id', draftId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as OutboundDispatchRow | null;
    }));
    for (const row of rows) {
      if (row?.draft_id) dispatches.set(row.draft_id, row);
    }
  }
  return dispatches;
}

function serializeDraftSummary(draft: MessagingDraftRow | undefined, version: MessagingDraftVersionRow | undefined) {
  if (!draft) return null;
  const payload = version && version.draft_id === draft.id
    ? MessagingDraftV1Schema.safeParse(version.payload)
    : null;
  const canonical = payload?.success && payload.data.draftId === draft.id
    ? payload.data
    : null;

  return {
    draftId: draft.id,
    versionId: nullableText(draft.current_version_id),
    ownerUserId: nullableText(draft.user_id),
    lifecycle: canonical?.lifecycle ?? nullableText(draft.lifecycle),
    revision: canonical?.revision ?? draft.current_revision ?? null,
    recipient: canonical ? {
      displayName: canonical.recipient.displayName,
      email: canonical.recipient.email,
      leadRef: canonical.recipient.leadRef,
    } : null,
    subject: canonical?.content.subject ?? null,
    approvalStatus: canonical?.approval.status ?? null,
    preflightStatus: canonical?.preflight.status ?? null,
    createdAt: canonical?.createdAt ?? nullableText(draft.created_at),
    updatedAt: nullableText(draft.updated_at),
  };
}

function serializeDispatch(row: OutboundDispatchRow | null | undefined) {
  if (!row) return null;
  return {
    id: text(row.id),
    status: nullableText(row.status),
    provider: nullableText(row.provider),
    requestedAt: nullableText(row.requested_at),
    completedAt: nullableText(row.completed_at),
    errorCode: nullableText(row.error_code),
  };
}

export async function listSupliaReviewItems(input: {
  organizationId: string;
  userId: string;
}, dependencies?: SupliaReviewInboxDependencies) {
  const userId = text(input.userId);
  if (!userId) throw new Error('SUPL.IA review inbox list requires a user scope.');
  const admin = adminFrom(dependencies);
  const { data, error } = await admin
    .from('suplia_review_items')
    .select(REVIEW_ITEM_COLUMNS)
    .eq('organization_id', input.organizationId)
    .or(`item_type.eq.antonia_report,and(item_type.eq.outbound_email,sender_user_id.eq.${userId})`)
    .order('created_at', { ascending: false })
    .limit(REVIEW_LIST_LIMIT);
  if (error) throw error;

  const items: SupliaReviewItemRecord[] = ((data || []) as any[]).map(toReviewItemRecord);
  const draftIds = unique(items.filter((item) => item.itemType === 'outbound_email').map((item) => item.messagingDraftId));
  const reportIds = unique(items.filter((item) => item.itemType === 'antonia_report').map((item) => item.antoniaReportId));
  const draftRows = await loadDraftRows(input.organizationId, draftIds, dependencies);
  const versionIds = unique(draftRows.map((draft) => draft.current_version_id));
  const [versionRows, dispatches, reportRows] = await Promise.all([
    loadDraftVersionRows(input.organizationId, versionIds, dependencies),
    loadLatestDispatchRows(input.organizationId, draftIds, dependencies),
    loadReportLightRows(input.organizationId, reportIds, dependencies),
  ]);
  const draftsById = new Map(draftRows.map((draft) => [draft.id, draft]));
  const versionsById = new Map(versionRows.map((version) => [version.id, version]));
  const reportsById = new Map(reportRows.map((report) => [report.id, report]));

  return items.map((item) => {
    const base = reviewItemBase(item);
    if (item.itemType === 'outbound_email') {
      const draft = item.messagingDraftId ? draftsById.get(item.messagingDraftId) : undefined;
      const version = draft?.current_version_id ? versionsById.get(draft.current_version_id) : undefined;
      return {
        ...base,
        provenance: emailReviewProvenance(item.metadata),
        email: {
          draft: serializeDraftSummary(draft, version),
          latestDispatch: item.messagingDraftId ? serializeDispatch(dispatches.get(item.messagingDraftId)) : null,
        },
        report: null,
      };
    }

    const report = item.antoniaReportId ? reportsById.get(item.antoniaReportId) : undefined;
    return {
      ...base,
      provenance: null,
      email: null,
      report: {
        reportId: item.antoniaReportId,
        type: report ? reviewPlainText(report.type, 80) || null : null,
        createdAt: report ? nullableText(report.created_at) : null,
      },
    };
  });
}

export async function getSupliaReviewItem(input: {
  organizationId: string;
  reviewId: string;
  userId: string;
}, dependencies?: SupliaReviewInboxDependencies) {
  const item = await findReviewItemRecord({
    organizationId: input.organizationId,
    reviewId: input.reviewId,
  }, dependencies);
  if (!item) return null;

  const base = reviewItemBase(item);
  const admin = adminFrom(dependencies);
  if (item.itemType === 'outbound_email') {
    if (!item.senderUserId || item.senderUserId !== input.userId) {
      throw new SupliaReviewInboxError('REVIEW_EMAIL_OWNER_REQUIRED', 'Only the draft owner can view this email review item.', 403);
    }
    if (!item.messagingDraftId) throw new Error('Outbound email review item is missing its draft.');
    const draft = await currentDraftFrom(dependencies)({
      organizationId: input.organizationId,
      userId: input.userId,
      draftId: item.messagingDraftId,
    });
    const { data: dispatch, error: dispatchError } = await admin
      .from('outbound_dispatches')
      .select('id,draft_id,status,provider,requested_at,completed_at,error_code')
      .eq('organization_id', input.organizationId)
      .eq('draft_id', item.messagingDraftId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (dispatchError) throw dispatchError;

    return {
      ...base,
      provenance: emailReviewProvenance(item.metadata),
      email: {
        draft: draft ? MessagingDraftV1Schema.parse(draft) : null,
        latestDispatch: serializeDispatch(dispatch as OutboundDispatchRow | null),
      },
      report: null,
    };
  }

  if (!item.antoniaReportId) throw new Error('ANTONIA report review item is missing its report.');
  const { data: report, error: reportError } = await admin
    .from('antonia_reports')
    .select('id,type,content,created_at')
    .eq('organization_id', input.organizationId)
    .eq('id', item.antoniaReportId)
    .maybeSingle();
  if (reportError) throw reportError;

  return {
    ...base,
    provenance: null,
    email: null,
    report: report ? {
      reportId: text((report as any).id),
      type: reviewPlainText((report as any).type, 80) || null,
      createdAt: nullableText((report as any).created_at),
      html: typeof (report as any).content === 'string' ? (report as any).content : '',
    } : null,
  };
}

function parseApprovedDraft(data: unknown) {
  const row = Array.isArray(data) ? data[0] : data;
  const payload = row && typeof row === 'object' && 'payload' in row
    ? (row as { payload: unknown }).payload
    : row;
  return MessagingDraftV1Schema.parse(payload);
}

async function markSupliaReviewItemApproved(input: {
  admin: any;
  organizationId: string;
  reviewId: string;
  userId: string;
  reviewedAt: string;
}) {
  const { data, error } = await input.admin
    .from('suplia_review_items')
    .update({
      status: 'approved',
      reviewed_by_user_id: input.userId,
      reviewed_at: input.reviewedAt,
      resolution_note: null,
    })
    .eq('organization_id', input.organizationId)
    .eq('id', input.reviewId)
    .in('status', ['pending', 'approved'])
    .select('id')
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    throw new SupliaReviewInboxError('REVIEW_ITEM_STATUS_CONFLICT', 'The review item changed while the draft was being approved.', 409);
  }
}

export async function approveSupliaReviewEmail(input: {
  organizationId: string;
  userId: string;
  reviewId: string;
  versionId: string;
}, dependencies?: SupliaReviewInboxDependencies): Promise<MessagingDraftV1> {
  const item = await findReviewItemRecord({
    organizationId: input.organizationId,
    reviewId: input.reviewId,
  }, dependencies);
  if (!item) throw new SupliaReviewInboxError('REVIEW_ITEM_NOT_FOUND', 'Review item was not found.', 404);
  if (item.itemType !== 'outbound_email') {
    throw new SupliaReviewInboxError('REVIEW_ITEM_NOT_EMAIL', 'Only outbound email review items can be approved.', 409);
  }
  if (!item.senderUserId || item.senderUserId !== input.userId) {
    throw new SupliaReviewInboxError('REVIEW_EMAIL_OWNER_REQUIRED', 'Only the draft owner can approve this email.', 403);
  }
  if (item.status !== 'pending' && item.status !== 'approved') {
    throw new SupliaReviewInboxError('REVIEW_ITEM_NOT_APPROVABLE', 'This review item is no longer approvable.', 409);
  }
  if (!item.messagingDraftId) throw new Error('Outbound email review item is missing its draft.');

  const current = await currentDraftFrom(dependencies)({
    organizationId: input.organizationId,
    userId: input.userId,
    draftId: item.messagingDraftId,
  });
  if (!current) throw new SupliaReviewInboxError('REVIEW_DRAFT_NOT_FOUND', 'The current email draft was not found.', 404);
  const draft = MessagingDraftV1Schema.parse(current);
  if (draft.versionId !== input.versionId) {
    throw new SupliaReviewInboxError('REVIEW_DRAFT_VERSION_CONFLICT', 'The email draft version is no longer current.', 409);
  }
  if (draft.channel !== 'email') {
    throw new SupliaReviewInboxError('REVIEW_DRAFT_CHANNEL_INVALID', 'The review item does not reference an email draft.', 422);
  }
  const admin = adminFrom(dependencies);
  const reviewedAt = nowFrom(dependencies);
  if (draft.lifecycle === 'ready' && draft.approval.status === 'approved' && draft.preflight.status === 'passed') {
    await markSupliaReviewItemApproved({
      admin,
      organizationId: input.organizationId,
      reviewId: item.id,
      userId: input.userId,
      reviewedAt,
    });
    return draft;
  }

  const recipient = text(draft.recipient.email).toLowerCase();
  const unsubscribeUrl = unsubscribeUrlFrom(dependencies)(recipient, input.userId, input.organizationId);
  const preflight = validateOutboundEmail({
    to: recipient,
    subject: draft.content.subject || undefined,
    html: draft.content.html || undefined,
    text: draft.content.text || undefined,
    requireUnsubscribe: true,
    unsubscribeUrl,
  });
  const hasUnsubscribe = hasUnsubscribeContent(draft.content.html || '') || hasUnsubscribeContent(draft.content.text || '');
  if (!preflight.ok || !hasUnsubscribe) {
    const errors = [
      ...preflight.errors,
      ...(!hasUnsubscribe ? ['Email is missing unsubscribe content.'] : []),
    ];
    throw new SupliaReviewInboxError(
      'REVIEW_EMAIL_PREFLIGHT_FAILED',
      errors.join(' ') || 'Email validation failed.',
      422,
      { errors },
    );
  }

  if (await suppressionCheckFrom(dependencies)(recipient, { userId: input.userId, organizationId: input.organizationId })) {
    throw new SupliaReviewInboxError('REVIEW_EMAIL_SUPPRESSED', 'The recipient is suppressed for this sender or organization.', 403);
  }

  const domain = recipient.split('@')[1]?.trim().toLowerCase();
  if (domain) {
    const { data: blockedDomain, error: domainError } = await admin
      .from('excluded_domains')
      .select('id')
      .eq('organization_id', input.organizationId)
      .eq('domain', domain)
      .maybeSingle();
    if (domainError) throw domainError;
    if (blockedDomain) {
      throw new SupliaReviewInboxError('REVIEW_EMAIL_DOMAIN_BLOCKED', `The domain ${domain} is blocked for this organization.`, 403);
    }
  }

  const { data, error } = await admin.rpc('approve_messaging_draft_v1', {
    p_draft_id: draft.draftId,
    p_version_id: draft.versionId,
    p_organization_id: input.organizationId,
    p_user_id: input.userId,
    p_warnings: preflight.warnings.slice(0, 100),
  });
  if (error) {
    if (isMessagingApprovalConflict(error)) {
      throw new SupliaReviewInboxError('REVIEW_DRAFT_VERSION_CONFLICT', 'The email draft version is no longer current.', 409);
    }
    throw error;
  }
  const approved = parseApprovedDraft(data);
  await markSupliaReviewItemApproved({
    admin,
    organizationId: input.organizationId,
    reviewId: item.id,
    userId: input.userId,
    reviewedAt,
  });
  return approved;
}

export async function updateSupliaReviewItemStatus(input: {
  organizationId: string;
  userId: string;
  reviewId: string;
  status: SupliaReviewItemStatus;
  note?: string | null;
}, dependencies?: SupliaReviewInboxDependencies) {
  if (input.status !== 'dismissed' && input.status !== 'resolved') {
    throw new SupliaReviewInboxError('REVIEW_STATUS_INVALID', 'Only dismissed or resolved are valid review status updates.', 400);
  }
  const note = normalizeSupliaReviewResolutionNote(input.note);
  const item = await findReviewItemRecord({
    organizationId: input.organizationId,
    reviewId: input.reviewId,
  }, dependencies);
  if (!item) throw new SupliaReviewInboxError('REVIEW_ITEM_NOT_FOUND', 'Review item was not found.', 404);
  if (item.itemType === 'outbound_email' && item.senderUserId !== input.userId) {
    throw new SupliaReviewInboxError('REVIEW_EMAIL_OWNER_REQUIRED', 'Only the draft owner can update this email review item.', 403);
  }
  // Auth currently verifies membership, not roles, so any organization member may resolve a report item.

  const { data, error } = await adminFrom(dependencies)
    .from('suplia_review_items')
    .update({
      status: input.status,
      reviewed_by_user_id: input.userId,
      reviewed_at: nowFrom(dependencies),
      resolution_note: note,
    })
    .eq('organization_id', input.organizationId)
    .eq('id', item.id)
    .select(REVIEW_ITEM_COLUMNS)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new SupliaReviewInboxError('REVIEW_ITEM_NOT_FOUND', 'Review item was not found.', 404);
  return reviewItemBase(toReviewItemRecord(data));
}
