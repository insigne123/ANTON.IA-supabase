type ContactMetricRow = {
  id?: string | null;
  mission_id?: string | null;
  missionId?: string | null;
  lead_id?: string | null;
  leadId?: string | null;
  email?: string | null;
  replied_at?: string | null;
  repliedAt?: string | null;
  reply_intent?: string | null;
  replyIntent?: string | null;
  last_reply_text?: string | null;
  lastReplyText?: string | null;
};

type LeadResponseMetricRow = {
  mission_id?: string | null;
  missionId?: string | null;
  contacted_id?: string | null;
  contactedId?: string | null;
  lead_id?: string | null;
  leadId?: string | null;
  type?: string | null;
};

function normalize(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

function buildIdentity(input: {
  contactedId?: string | null;
  id?: string | null;
  leadId?: string | null;
  email?: string | null;
}) {
  const leadId = normalize(input.leadId);
  if (leadId) return `lead:${leadId}`;

  const email = normalize(input.email);
  if (email) return `email:${email}`;

  const contactedId = normalize(input.contactedId || input.id);
  if (contactedId) return `contacted:${contactedId}`;

  return null;
}

export function hasReplySignal(row: ContactMetricRow) {
  const intent = normalize(row.replyIntent || row.reply_intent);
  return Boolean(
    row.repliedAt ||
    row.replied_at ||
    row.lastReplyText ||
    row.last_reply_text ||
    ['meeting_request', 'positive', 'negative', 'unsubscribe', 'auto_reply', 'neutral', 'delivery_failure'].includes(intent)
  );
}

export function hasPositiveReplySignal(row: ContactMetricRow) {
  const intent = normalize(row.replyIntent || row.reply_intent);
  return intent === 'positive' || intent === 'meeting_request';
}

export function hasMeetingRequestSignal(row: ContactMetricRow) {
  const intent = normalize(row.replyIntent || row.reply_intent);
  return intent === 'meeting_request';
}

export function countUniqueReplyContacts(contactRows: ContactMetricRow[], responseRows: LeadResponseMetricRow[] = []) {
  const identities = new Set<string>();

  for (const response of responseRows || []) {
    if (normalize(response.type) !== 'reply') continue;
    const identity = buildIdentity({
      contactedId: response.contactedId || response.contacted_id,
      leadId: response.leadId || response.lead_id,
    });
    if (identity) identities.add(identity);
  }

  for (const row of contactRows || []) {
    if (!hasReplySignal(row)) continue;
    const identity = buildIdentity({
      id: row.id,
      leadId: row.leadId || row.lead_id,
      email: row.email,
    });
    if (identity) identities.add(identity);
  }

  return identities.size;
}

export function countUniquePositiveReplyContacts(contactRows: ContactMetricRow[]) {
  const identities = new Set<string>();
  for (const row of contactRows || []) {
    if (!hasPositiveReplySignal(row)) continue;
    const identity = buildIdentity({ id: row.id, leadId: row.leadId || row.lead_id, email: row.email });
    if (identity) identities.add(identity);
  }
  return identities.size;
}

export function countUniqueMeetingRequestContacts(contactRows: ContactMetricRow[]) {
  const identities = new Set<string>();
  for (const row of contactRows || []) {
    if (!hasMeetingRequestSignal(row)) continue;
    const identity = buildIdentity({ id: row.id, leadId: row.leadId || row.lead_id, email: row.email });
    if (identity) identities.add(identity);
  }
  return identities.size;
}

export function percentWithFloor(part: number, total: number) {
  if (!total || part <= 0) return 0;
  const raw = (part / total) * 100;
  const rounded = Math.round(raw * 10) / 10;
  return rounded === 0 ? 0.1 : rounded;
}
