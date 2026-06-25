import type { AuthContext } from '@/lib/server/auth-utils';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';

export type SupliaAppContext = {
  user: {
    id: string;
    email?: string | null;
  };
  organizationId: string;
  profile: Record<string, unknown> | null;
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
};

function safeCount(result: { count?: number | null } | null | undefined) {
  return Number(result?.count || 0);
}

export async function buildSupliaContext(auth: AuthContext): Promise<SupliaAppContext> {
  const admin = getSupabaseAdminClient();
  const userId = auth.user.id;
  const organizationId = auth.organizationId;

  const [profileRes, tokenRes, leadsRes, contactedRes, campaignsRes, missionsRes, exceptionsRes] = await Promise.all([
    admin.from('profiles').select('*').eq('id', userId).maybeSingle(),
    admin.from('provider_tokens').select('provider').eq('user_id', userId),
    admin.from('leads').select('*', { count: 'exact', head: true }).eq('organization_id', organizationId),
    admin.from('contacted_leads').select('*', { count: 'exact', head: true }).eq('organization_id', organizationId),
    admin.from('campaigns').select('*', { count: 'exact', head: true }).eq('organization_id', organizationId),
    admin.from('antonia_missions').select('*', { count: 'exact', head: true }).eq('organization_id', organizationId).eq('status', 'active'),
    admin.from('antonia_exceptions').select('*', { count: 'exact', head: true }).eq('organization_id', organizationId).eq('status', 'open'),
  ]);

  const providers = new Set((tokenRes.data || []).map((row: any) => String(row.provider || '').toLowerCase()));

  return {
    user: {
      id: userId,
      email: auth.user.email || null,
    },
    organizationId,
    profile: (profileRes.data as Record<string, unknown> | null) || null,
    emailConnections: {
      google: providers.has('google'),
      outlook: providers.has('outlook'),
    },
    counts: {
      leads: safeCount(leadsRes),
      contacted: safeCount(contactedRes),
      campaigns: safeCount(campaignsRes),
      activeMissions: safeCount(missionsRes),
      openExceptions: safeCount(exceptionsRes),
    },
  };
}
