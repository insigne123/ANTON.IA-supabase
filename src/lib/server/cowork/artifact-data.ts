import type { SupabaseClient } from '@supabase/supabase-js';
import { PIPELINE_STAGES } from '@/lib/crm-types';
import type { CoworkArtifactTableName } from '@/lib/cowork/design-brief';
import type { CoworkHiringItem, CoworkProjectItem, CoworkTenderItem } from '@/lib/commercial-opportunities/cowork';
import { COWORK_ARTIFACT_DATA_MAX_ROWS, type CoworkArtifactCell, type CoworkArtifactData, type CoworkArtifactTable } from './code-artifact';

/**
 * The data a code artifact draws from (Plan 12, 3b): fixed columns of the person's own tables, read on
 * the server for their organization, at most 2,000 rows each. The Designer only sees the columns and a
 * few short samples; the page gets every row in `antonia.data`. No email addresses or phone numbers:
 * whether there is one is enough to draw with.
 */

type Scope = { userId: string; organizationId: string };
type Row = Record<string, CoworkArtifactCell>;

const yes = (value: unknown) => (value ? 'Sí' : 'No');
const text = (value: unknown, max = 160) => (typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null);
const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)) ? Number(value) : null);
const date = (value: unknown) => (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) ? value : null);
const table = (label: string, source: string, columns: CoworkArtifactTable['columns'], rows: Row[], total = rows.length): CoworkArtifactTable => ({
  label, source, columns, rows: rows.slice(0, COWORK_ARTIFACT_DATA_MAX_ROWS), total: Math.max(total, rows.length),
  truncated: Math.max(total, rows.length) > Math.min(rows.length, COWORK_ARTIFACT_DATA_MAX_ROWS),
});

const STAGE_LABEL = new Map<string, string>(PIPELINE_STAGES.map(stage => [stage.id, stage.label]));
// States as the app names them: an artifact never shows «draft» or «replied» to the person.
const STATUS_LABEL: Record<string, string> = {
  draft: 'Borrador', approved: 'Aprobada', paused: 'Pausada', rejected: 'Rechazada', active: 'Activa', sending: 'Enviando', completed: 'Terminada',
  stopped: 'Detenida', blocked: 'Bloqueada', scheduled: 'Programado', pending: 'Pendiente', queued: 'En cola', sent: 'Enviado', delivered: 'Entregado',
  opened: 'Abierto', clicked: 'Con clic', replied: 'Respondió', bounced: 'Rebotó', failed: 'Falló', unknown: 'Sin dato', saved: 'Guardado',
  enriched: 'Enriquecido', contacted: 'Contactado', new: 'Nuevo', interested: 'Interesado', not_interested: 'No interesado',
  meeting_request: 'Pide reunión', meeting: 'Reunión', unsubscribe: 'Pidió no recibir más', out_of_office: 'Fuera de oficina', auto_reply: 'Respuesta automática',
  referral: 'Derivó a otra persona', question: 'Pregunta', negative: 'Negativa', positive: 'Positiva', neutral: 'Neutral', other: 'Otra',
};
const status = (value: unknown) => {
  const raw = text(value, 40);
  return raw ? STATUS_LABEL[raw.toLowerCase()] ?? raw : null;
};

// ---- Shapers: rows of the database into rows of the artifact (pure, tested) ----

export function coworkArtifactContacts(leads: Array<Record<string, unknown>>, total = leads.length): CoworkArtifactTable {
  const rows = leads.map(lead => ({
    name: text(lead.name), title: text(lead.title), company: text(lead.company), industry: text(lead.industry),
    location: text(lead.location) || [text(lead.city), text(lead.country)].filter(Boolean).join(', ') || null,
    has_email: yes(text(lead.email)), has_linkedin: yes(text(lead.linkedin_url)), status: status(lead.status), created_at: date(lead.created_at),
  }));
  return table('Contactos guardados', 'Tus contactos guardados en ANTON.IA', [
    { key: 'name', label: 'Nombre', type: 'text' }, { key: 'title', label: 'Cargo', type: 'text' }, { key: 'company', label: 'Empresa', type: 'text' },
    { key: 'industry', label: 'Rubro', type: 'text' }, { key: 'location', label: 'Ubicación', type: 'text' },
    { key: 'has_email', label: 'Con correo', type: 'text' }, { key: 'has_linkedin', label: 'Con LinkedIn', type: 'text' },
    { key: 'status', label: 'Estado', type: 'text' }, { key: 'created_at', label: 'Guardado', type: 'date' },
  ], rows, total);
}

export function coworkArtifactActivity(sends: Array<Record<string, unknown>>, total = sends.length): CoworkArtifactTable {
  const rows = sends.map(send => ({
    name: text(send.name), company: text(send.company), channel: text(send.provider, 30) || 'correo', subject: text(send.subject, 140),
    sent_at: date(send.sent_at), replied: yes(send.replied_at), replied_at: date(send.replied_at),
    reply_intent: status(send.reply_intent), bounced: yes(send.bounced_at || send.delivery_status === 'bounced'), status: status(send.status),
  }));
  return table('Envíos y respuestas', 'Lo enviado desde ANTON.IA por tu organización en los últimos 180 días', [
    { key: 'name', label: 'Persona', type: 'text' }, { key: 'company', label: 'Empresa', type: 'text' }, { key: 'channel', label: 'Canal', type: 'text' },
    { key: 'subject', label: 'Asunto', type: 'text' }, { key: 'sent_at', label: 'Enviado', type: 'date' }, { key: 'replied', label: 'Respondió', type: 'text' },
    { key: 'replied_at', label: 'Respuesta', type: 'date' }, { key: 'reply_intent', label: 'Tipo de respuesta', type: 'text' },
    { key: 'bounced', label: 'Rebotó', type: 'text' }, { key: 'status', label: 'Estado', type: 'text' },
  ], rows, total);
}

export function coworkArtifactCampaigns(campaigns: Array<Record<string, unknown>>): CoworkArtifactTable {
  const rows = campaigns.map(campaign => {
    const definition = (campaign.definition || {}) as { name?: unknown; steps?: unknown[] };
    return {
      name: text(definition.name) || 'Campaña', status: status(campaign.status), recipients: Array.isArray(campaign.recipients) ? campaign.recipients.length : 0,
      steps: Array.isArray(definition.steps) ? definition.steps.length : null, created_at: date(campaign.created_at),
    };
  });
  return table('Campañas', 'Tus campañas en ANTON.IA', [
    { key: 'name', label: 'Campaña', type: 'text' }, { key: 'status', label: 'Estado', type: 'text' }, { key: 'recipients', label: 'Destinatarios', type: 'number' },
    { key: 'steps', label: 'Correos', type: 'number' }, { key: 'created_at', label: 'Creada', type: 'date' },
  ], rows);
}

/** The pipeline: each saved contact with its stage (Nuevos when it has none), owner, next step and, when kept, its value. */
export function coworkArtifactPipeline(leads: Array<Record<string, unknown>>, custom: Array<Record<string, unknown>>, total = leads.length): CoworkArtifactTable {
  const byId = new Map(custom.map(row => [String(row.id), row]));
  const withValue = custom.some(row => row.deal_value !== undefined);
  const rows = leads.map(lead => {
    const crm = byId.get(`lead_saved|${String(lead.id)}`) || {};
    const stageId = typeof crm.stage === 'string' && STAGE_LABEL.has(crm.stage) ? crm.stage : 'inbox';
    return {
      name: text(lead.name), company: text(lead.company), title: text(lead.title), stage: STAGE_LABEL.get(stageId)!,
      stage_order: PIPELINE_STAGES.findIndex(item => item.id === stageId) + 1,
      ...(withValue ? { value: num(crm.deal_value) } : {}),
      owner: text(crm.owner, 80), next_action: text(crm.next_action, 140), next_action_due: date(crm.next_action_due_at),
      stage_changed_at: date(crm.stage_changed_at) || date(crm.updated_at), created_at: date(lead.created_at),
    };
  });
  return table('Pipeline', 'El pipeline de tus contactos guardados', [
    { key: 'name', label: 'Contacto', type: 'text' }, { key: 'company', label: 'Empresa', type: 'text' }, { key: 'title', label: 'Cargo', type: 'text' },
    { key: 'stage', label: 'Etapa', type: 'text' }, { key: 'stage_order', label: 'Orden de la etapa', type: 'number' }, ...(withValue ? [{ key: 'value', label: 'Monto', type: 'money' as const }] : []),
    { key: 'owner', label: 'Responsable', type: 'text' }, { key: 'next_action', label: 'Próximo paso', type: 'text' },
    { key: 'next_action_due', label: 'Para el', type: 'date' }, { key: 'stage_changed_at', label: 'Cambió de etapa', type: 'date' },
    { key: 'created_at', label: 'Creado', type: 'date' },
  ], rows, total);
}

export function coworkArtifactOpportunities(input: { hiring: CoworkHiringItem[]; tenders: CoworkTenderItem[]; projects: CoworkProjectItem[] }): CoworkArtifactTable {
  const rows: Row[] = [
    ...input.tenders.filter(item => item.status !== 'dismissed').map(item => ({
      kind: item.kind === 'compra_agil' ? 'Compra Ágil' : 'Licitación', name: text(item.title, 200), organization: text(item.buyer), region: text(item.region, 80),
      amount: item.currency === 'CLP' || !item.currency ? num(item.amount) : null, deadline: date(item.deadlineAt), score: num(item.score), ads: null,
      investment_musd: null, status: item.status === 'new' ? 'Nueva' : item.status === 'interested' ? 'Te interesa' : 'Convertida',
    })),
    ...input.hiring.filter(item => item.status !== 'dismissed').map(item => ({
      kind: 'Empresa contratando', name: text(item.company), organization: text(item.company), region: text(item.region, 80), amount: null, deadline: null,
      score: num(item.score), ads: num(item.ads), investment_musd: null, status: item.status === 'new' ? 'Nueva' : item.status === 'interested' ? 'Te interesa' : 'Convertida',
    })),
    ...input.projects.filter(item => item.status !== 'dismissed').map(item => ({
      kind: 'Proyecto SEIA', name: text(item.title, 200), organization: text(item.owner), region: text(item.region, 80), amount: null, deadline: null,
      score: num(item.score), ads: null, investment_musd: num(item.data.investmentMusd), status: item.status === 'new' ? 'Nueva' : item.status === 'interested' ? 'Te interesa' : 'Convertida',
    })),
  ];
  return table('Oportunidades', 'Licitaciones, Compra Ágil, empresas contratando y proyectos SEIA de «Oportunidades»', [
    { key: 'kind', label: 'Tipo', type: 'text' }, { key: 'name', label: 'Oportunidad', type: 'text' }, { key: 'organization', label: 'Organización', type: 'text' },
    { key: 'region', label: 'Región', type: 'text' }, { key: 'amount', label: 'Monto (CLP)', type: 'money' }, { key: 'deadline', label: 'Cierre', type: 'date' },
    { key: 'score', label: 'Puntaje', type: 'number' }, { key: 'ads', label: 'Avisos', type: 'number' },
    { key: 'investment_musd', label: 'Inversión (MUS$)', type: 'number' }, { key: 'status', label: 'Estado', type: 'text' },
  ], rows);
}

// ---- Loaders ----

const LEAD_COLUMNS = 'id,name,title,company,email,status,industry,linkedin_url,location,city,country,created_at';
const CRM_COLUMNS = 'id,stage,owner,next_action,next_action_due_at,updated_at';

async function leadsOf(client: SupabaseClient, scope: Scope) {
  const { data, error, count } = await client.from('leads').select(LEAD_COLUMNS, { count: 'exact' })
    .eq('organization_id', scope.organizationId).eq('user_id', scope.userId)
    .order('created_at', { ascending: false }).limit(COWORK_ARTIFACT_DATA_MAX_ROWS);
  if (error) throw new Error('No se pudieron leer los contactos guardados.');
  return { rows: (data || []) as Array<Record<string, unknown>>, total: count ?? data?.length ?? 0 };
}

async function crmOf(client: SupabaseClient, scope: Scope) {
  // The value of each deal only exists once its migration is applied (Plan 11, 4b): without it, the stages alone.
  const read = (withValue: boolean) => client.from('unified_crm_data')
    .select(withValue ? `${CRM_COLUMNS},deal_value,deal_currency,stage_changed_at` : CRM_COLUMNS)
    .eq('organization_id', scope.organizationId).limit(5000);
  let { data, error } = await read(true);
  if (error && error.code === '42703') ({ data, error } = await read(false));
  if (error) throw new Error('No se pudo leer el pipeline.');
  return (data || []) as unknown as Array<Record<string, unknown>>;
}

export async function loadCoworkArtifactData(client: SupabaseClient, scope: Scope, tables: CoworkArtifactTableName[],
  options: { opportunities?: boolean; now?: Date } = {}): Promise<CoworkArtifactData> {
  const out: Record<string, CoworkArtifactTable> = {};
  const now = options.now ?? new Date();
  for (const name of new Set(tables)) {
    if (name === 'contacts') {
      const leads = await leadsOf(client, scope);
      out.contacts = coworkArtifactContacts(leads.rows, leads.total);
    } else if (name === 'pipeline') {
      const [leads, custom] = await Promise.all([leadsOf(client, scope), crmOf(client, scope)]);
      out.pipeline = coworkArtifactPipeline(leads.rows, custom, leads.total);
    } else if (name === 'activity') {
      const since = new Date(now.getTime() - 180 * 86_400_000).toISOString();
      const { data, error, count } = await client.from('contacted_leads')
        .select('name,company,provider,subject,status,sent_at,replied_at,reply_intent,bounced_at,delivery_status', { count: 'exact' })
        .eq('organization_id', scope.organizationId).gte('sent_at', since)
        .order('sent_at', { ascending: false }).limit(COWORK_ARTIFACT_DATA_MAX_ROWS);
      if (error) throw new Error('No se pudieron leer los envíos.');
      out.activity = coworkArtifactActivity((data || []) as Array<Record<string, unknown>>, count ?? data?.length ?? 0);
    } else if (name === 'campaigns') {
      const { data, error } = await client.from('bulk_campaigns').select('definition,status,recipients,created_at')
        .eq('organization_id', scope.organizationId).eq('user_id', scope.userId)
        .order('created_at', { ascending: false }).limit(200);
      if (error) throw new Error('No se pudieron leer las campañas.');
      out.campaigns = coworkArtifactCampaigns((data || []) as Array<Record<string, unknown>>);
    } else if (name === 'opportunities') {
      if (!options.opportunities) throw new Error('Esta cuenta no tiene «Oportunidades»: el artefacto no puede usar esa tabla.');
      const { findHiringProfile, listHiringOpportunities, listProjectOpportunities, listTenderOpportunities } = await import('@/lib/server/commercial-opportunities/store');
      const profile = await findHiringProfile(client, scope);
      const [hiring, tenders, projects] = await Promise.all([
        profile ? listHiringOpportunities(client, scope, { minAds: profile.minAds, now: now.toISOString() }) : Promise.resolve([]),
        listTenderOpportunities(client, scope, { now: now.toISOString() }),
        listProjectOpportunities(client, scope),
      ]);
      out.opportunities = coworkArtifactOpportunities({ hiring: hiring as CoworkHiringItem[], tenders: tenders as CoworkTenderItem[], projects: projects as CoworkProjectItem[] });
    }
  }
  return { tables: out, currency: 'CLP', timeZone: 'America/Santiago' };
}

/**
 * The figures of a table the server computes, for the Designer's chat reply (the page computes its own): for each
 * column with few values, how many rows have each (the stages, the states, «Sí» and «No»); for numbers, the sum,
 * the lowest and the highest; for dates, the first and the last. Columns with many different texts (names) are left out.
 */
export function coworkArtifactTableSummary(value: CoworkArtifactTable) {
  const out: Record<string, unknown> = {};
  for (const column of value.columns) {
    const cells = value.rows.map(row => row[column.key]);
    const empty = cells.filter(cell => cell === null || cell === undefined || cell === '').length;
    if (column.type === 'text') {
      const counts = new Map<string, number>();
      for (const cell of cells) if (typeof cell === 'string' && cell) counts.set(cell, (counts.get(cell) || 0) + 1);
      if (!counts.size || counts.size > 12) continue;
      out[column.key] = { ...Object.fromEntries([...counts].sort((a, b) => b[1] - a[1]).slice(0, 8)), ...(empty ? { '(vacío)': empty } : {}) };
    } else if (column.type === 'date') {
      const days = cells.flatMap(cell => (typeof cell === 'string' && /^\d{4}-\d{2}-\d{2}/.test(cell) ? [cell.slice(0, 10)] : [])).sort();
      if (days.length) out[column.key] = { first: days[0], last: days[days.length - 1], ...(empty ? { empty } : {}) };
    } else {
      const numbers = cells.filter((cell): cell is number => typeof cell === 'number' && Number.isFinite(cell));
      if (numbers.length) out[column.key] = { sum: numbers.reduce((sum, cell) => sum + cell, 0), min: Math.min(...numbers), max: Math.max(...numbers), ...(empty ? { empty } : {}) };
    }
  }
  return out;
}

/** What the Designer sees of the data: each table's columns, how many rows, its summary and up to five short rows, never the whole thing. */
export function coworkArtifactDataPreview(data: CoworkArtifactData) {
  return Object.fromEntries(Object.entries(data.tables).map(([name, value]) => [name, {
    label: value.label, rows: value.total, truncated: value.truncated,
    columns: value.columns.map(column => `${column.key} (${column.type}): ${column.label}`),
    summary: coworkArtifactTableSummary(value),
    sample: value.rows.slice(0, 5).map(row => Object.fromEntries(Object.entries(row).map(([key, cell]) => [key, typeof cell === 'string' ? cell.slice(0, 40) : cell]))),
  }]));
}
