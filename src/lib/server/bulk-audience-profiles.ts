import { z } from 'zod';
import { AuthError } from '@/lib/server/auth-utils';
import type { AuthContext } from '@/lib/server/auth-utils';
import { AudienceCriteriaSchema, AudienceProfileSchema, type AudienceProfile } from '@/lib/bulk-campaigns';

const MAX_PROFILES = 20;

function toProfile(row: any): AudienceProfile {
  return {
    id: String(row.id),
    name: String(row.name || ''),
    criteria: AudienceCriteriaSchema.parse(row.criteria),
    created_at: String(row.created_at || ''),
  };
}

export async function listAudienceProfiles(auth: AuthContext): Promise<AudienceProfile[]> {
  const { data, error } = await auth.supabase.from('bulk_audience_profiles')
    .select('id,name,criteria,created_at')
    .eq('organization_id', auth.organizationId).eq('user_id', auth.user.id)
    .order('created_at', { ascending: false }).limit(MAX_PROFILES);
  if (error) throw error;
  return (data || []).map(toProfile);
}

export async function createAudienceProfile(auth: AuthContext, input: unknown): Promise<AudienceProfile> {
  const profile = AudienceProfileSchema.parse(input);
  const existing = await listAudienceProfiles(auth);
  if (existing.length >= MAX_PROFILES) throw new AuthError('Ya guardaste el máximo de perfiles de audiencia.', 409);
  const { data, error } = await auth.supabase.from('bulk_audience_profiles').insert({
    organization_id: auth.organizationId, user_id: auth.user.id,
    name: profile.name, criteria: profile.criteria,
  }).select('id,name,criteria,created_at').single();
  if (error) throw error;
  return toProfile(data);
}

export async function deleteAudienceProfile(auth: AuthContext, id: string): Promise<void> {
  z.string().uuid().parse(id);
  const { data, error } = await auth.supabase.from('bulk_audience_profiles')
    .delete().eq('id', id).eq('organization_id', auth.organizationId).eq('user_id', auth.user.id)
    .select('id');
  if (error) throw error;
  if (!data?.length) throw new AuthError('No encontramos ese perfil.', 404);
}
