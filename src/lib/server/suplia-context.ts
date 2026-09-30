import type { SupabaseClient } from '@supabase/supabase-js';
import type { AuthContext } from '@/lib/server/auth-utils';
import { normalizeSellerProfile } from '@/lib/server/seller-profile';
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

export function memoryValueText(value: unknown) {
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

/** What «Perfil» stores about the offer, trimmed for a prompt. */
export type ProfileOfferDetails = {
  offer: string | null;
  role: string | null;
  sector: string | null;
  services: string[];
  proofPoints: string[];
};

const OFFER_LENGTH = 600;
// The shared seller normalizer rejects fields over 2,000 characters (company names over 300),
// and «Perfil» has no limit: everything is clipped before it gets there.
const SELLER_FIELD_LENGTH = 1_900;
const SELLER_NAME_LENGTH = 300;

function clipped(value: string, max: number) {
  if (value.length <= max) return value;
  const cut = value.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

function sellerInput(value: unknown, max: number): unknown {
  if (typeof value === 'string') return value.slice(0, max);
  if (Array.isArray(value)) return value.slice(0, 50).map(item => typeof item === 'string' ? item.slice(0, max) : item);
  return value;
}

/**
 * The offer as «Perfil» saves it: `signatures.profile_extended` (description, services, value
 * proposition, proof points, sector and role), read with the same normalizer as drafts and
 * research. Never the email signatures stored next to it.
 */
export function profileOfferDetails(profile: Record<string, unknown> | null): ProfileOfferDetails {
  const none: ProfileOfferDetails = { offer: null, role: null, sector: null, services: [], proofPoints: [] };
  const signatures = profile?.signatures;
  const extended = signatures && typeof signatures === 'object' && !Array.isArray(signatures)
    ? (signatures as Record<string, unknown>).profile_extended : null;
  if (!extended || typeof extended !== 'object' || Array.isArray(extended)) return none;
  try {
    const seller = normalizeSellerProfile({
      full_name: sellerInput(profile?.full_name, SELLER_FIELD_LENGTH),
      job_title: sellerInput(profile?.job_title, SELLER_FIELD_LENGTH),
      company_name: sellerInput(profile?.company_name, SELLER_NAME_LENGTH),
      company_domain: sellerInput(profile?.company_domain, SELLER_FIELD_LENGTH),
      signatures: { profile_extended: Object.fromEntries(Object.entries(extended as Record<string, unknown>)
        .map(([key, value]) => [key, sellerInput(value, SELLER_FIELD_LENGTH)])) },
    });
    const parts: string[] = [];
    const add = (part: string | null | undefined) => {
      const text = safeText(part);
      if (!text) return;
      if (!parts.length) parts.push(clipped(text, OFFER_LENGTH));
      else if (parts.join(' ').length + 1 + text.length <= OFFER_LENGTH) parts.push(text);
    };
    add(seller.valueProposition);
    add(seller.description);
    if (seller.services.length) add(`Productos y servicios: ${seller.services.slice(0, 6).join('; ')}.`);
    return {
      offer: parts.length ? parts.join(' ') : null,
      role: seller.jobTitle,
      sector: seller.sector,
      services: seller.services,
      proofPoints: seller.proofPoints,
    };
  } catch {
    return none;
  }
}

/** The person's own offer: «Perfil» first, then the older profile fields some workspaces still
 * have. A company name is not an offer. */
export function profileOffer(profile: Record<string, unknown> | null) {
  if (!profile) return null;
  const own = profileOfferDetails(profile).offer;
  if (own) return own;
  for (const candidate of [profile.company_profile, profile.value_proposition, profile.offer, profile.businessDescription]) {
    const text = offerText(candidate);
    if (text) return text;
  }
  return null;
}

/** What the organization sells, as configured for research (products). */
export async function readOrganizationOffer(client: SupabaseClient | undefined, organizationId: string) {
  if (!client) return null;
  try {
    const { data, error } = await client.from('antonia_workflow_settings')
      .select('user_company_profile').eq('organization_id', organizationId).maybeSingle();
    if (error || !data) return null;
    return offerText((data as { user_company_profile?: unknown }).user_company_profile) || null;
  } catch {
    return null;
  }
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
