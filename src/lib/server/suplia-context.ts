import type { AuthContext } from '@/lib/server/auth-utils';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';

export type SupliaAppContext = {
  user: {
    id: string;
    email?: string | null;
  };
  organizationId: string;
  profile: Record<string, unknown> | null;
  offer: string | null;
  emailConnections: {
    google: boolean;
    outlook: boolean;
  };
  counts: {
    leads: number;
    contacted: number;
    campaigns: number;
    activeMissions: number;
    openExceptions: number;
  };
  performance: {
    contacted: number;
    replied: number;
    replyRate: number;
  } | null;
  memories: Array<{
    type: string;
    key: string;
    text: string;
  }>;
};

function safeCount(result: { count?: number | null } | null | undefined) {
  return Number(result?.count || 0);
}

function safeText(value: unknown) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function memoryValueText(value: unknown) {
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return safeText(record.text || record.summary || JSON.stringify(record));
  }
  return safeText(value);
}

const OFFER_TEXT_KEYS = ['valueProposition', 'value_proposition', 'offer', 'summary', 'description', 'pitch', 'businessDescription'];

function presentText(value: unknown) {
  return typeof value === 'string' && value.trim() ? safeText(value) : '';
}

/** company_profile is JSON: never let String(object) reach a prompt as "[object Object]". */
export function offerText(value: unknown): string {
  if (typeof value === 'string') return safeText(value);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  const record = value as Record<string, unknown>;
  for (const key of OFFER_TEXT_KEYS) {
    const text = presentText(record[key]);
    if (text) return text.slice(0, 600);
  }
  const name = presentText(record.companyName) || presentText(record.company_name) || presentText(record.name);
  const products = (Array.isArray(record.products) ? record.products : []).map(product => {
    if (typeof product === 'string') return presentText(product);
    if (!product || typeof product !== 'object') return '';
    const item = product as Record<string, unknown>;
    return [presentText(item.name), presentText(item.summary) || presentText(item.description)].filter(Boolean).join(': ');
  }).filter(Boolean).slice(0, 5);
  return [name, products.length ? `Productos: ${products.join('; ')}` : ''].filter(Boolean).join('. ').slice(0, 600);
}

function profileOffer(profile: Record<string, unknown> | null) {
  if (!profile) return null;
  for (const candidate of [profile.company_profile, profile.value_proposition, profile.offer,
    profile.companyName, profile.company, profile.businessDescription]) {
    const text = offerText(candidate);
    if (text) return text;
  }
  return null;
}

export async function buildSupliaContext(auth: AuthContext): Promise<SupliaAppContext> {
  const admin = getSupabaseAdminClient();
  const userId = auth.user.id;
  const organizationId = auth.organizationId;

  const [profileRes, tokenRes, leadsRes, contactedRes, campaignsRes, missionsRes, exceptionsRes, repliedRes, memoriesRes] = await Promise.all([
    admin.from('profiles').select('*').eq('id', userId).maybeSingle(),
    admin.from('provider_tokens').select('provider').eq('user_id', userId),
    admin.from('leads').select('*', { count: 'exact', head: true }).eq('organization_id', organizationId),
    admin.from('contacted_leads').select('*', { count: 'exact', head: true }).eq('organization_id', organizationId),
    admin.from('campaigns').select('*', { count: 'exact', head: true }).eq('organization_id', organizationId),
    admin.from('antonia_missions').select('*', { count: 'exact', head: true }).eq('organization_id', organizationId).eq('status', 'active'),
    admin.from('antonia_exceptions').select('*', { count: 'exact', head: true }).eq('organization_id', organizationId).eq('status', 'open'),
    admin.from('contacted_leads').select('*', { count: 'exact', head: true }).eq('organization_id', organizationId).not('replied_at', 'is', null),
    admin.from('suplia_memories').select('memory_type, key, value').eq('organization_id', organizationId).eq('status', 'approved').order('updated_at', { ascending: false }).limit(8),
  ]);

  const providers = new Set((tokenRes.data || []).map((row: any) => String(row.provider || '').toLowerCase()));
  const profile = (profileRes.data as Record<string, unknown> | null) || null;
  const contacted = safeCount(contactedRes);
  const replied = safeCount(repliedRes);

  return {
    user: {
      id: userId,
      email: auth.user.email || null,
    },
    organizationId,
    profile,
    offer: profileOffer(profile),
    emailConnections: {
      google: providers.has('google'),
      outlook: providers.has('outlook'),
    },
    counts: {
      leads: safeCount(leadsRes),
      contacted,
      campaigns: safeCount(campaignsRes),
      activeMissions: safeCount(missionsRes),
      openExceptions: safeCount(exceptionsRes),
    },
    performance: contacted > 0 ? { contacted, replied, replyRate: Math.round((replied / contacted) * 100) } : null,
    memories: (memoriesRes.data || []).map((memory: any) => ({
      type: safeText(memory.memory_type) || 'preference',
      key: safeText(memory.key),
      text: memoryValueText(memory.value),
    })).filter((memory) => memory.key || memory.text),
  };
}

export function formatContextBrief(ctx: SupliaAppContext): string {
  const mail = [
    ctx.emailConnections.google ? 'Gmail' : '',
    ctx.emailConnections.outlook ? 'Outlook' : '',
  ].filter(Boolean).join(' + ') || 'sin email conectado';

  const lines = [
    `Oferta del usuario: ${ctx.offer || 'sin descripcion de oferta configurada'}.`,
    `Canales de correo: ${mail}.`,
    `Volumen: ${ctx.counts.leads} leads, ${ctx.counts.contacted} contactados, ${ctx.counts.campaigns} campanas.`,
    ctx.performance ? `Desempeno historico: ${ctx.performance.replied}/${ctx.performance.contacted} respondieron (${ctx.performance.replyRate}% reply rate).` : 'Sin historico de respuestas aun.',
  ];

  if (ctx.memories.length > 0) {
    lines.push('Memoria aprobada por el usuario:');
    for (const memory of ctx.memories) {
      lines.push(`- ${memory.key || memory.type}: ${memory.text}`);
    }
  }

  return lines.join('\n');
}

export async function getWinningSubjects(auth: AuthContext, limit = 5) {
  const admin = getSupabaseAdminClient();
  const { data, error } = await admin
    .from('contacted_leads')
    .select('subject, replied_at, sent_at')
    .eq('organization_id', auth.organizationId)
    .not('subject', 'is', null)
    .order('sent_at', { ascending: false })
    .limit(500);

  if (error) return [];

  const bySubject = new Map<string, { sent: number; replied: number }>();
  for (const row of (data || []) as any[]) {
    const subject = safeText(row.subject);
    if (!subject) continue;
    const item = bySubject.get(subject) || { sent: 0, replied: 0 };
    item.sent += 1;
    if (row.replied_at) item.replied += 1;
    bySubject.set(subject, item);
  }

  return [...bySubject.entries()]
    .map(([subject, item]) => ({
      subject,
      sent: item.sent,
      replied: item.replied,
      replyRate: item.sent ? Math.round((item.replied / item.sent) * 100) : 0,
    }))
    .filter((item) => item.sent >= 3)
    .sort((a, b) => b.replyRate - a.replyRate || b.sent - a.sent)
    .slice(0, Math.max(1, Math.min(Math.floor(limit), 12)));
}
