import { canonicalSha256 } from '@/lib/messaging-contracts';
import {
  getOutsourcingEmailStylePresetById,
  getOutsourcingEmailStylePresetFromSelection,
  styleProfileFromOutsourcingEmailStylePreset,
} from '@/lib/outsourcing-email-style-presets';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';

type SupabaseClientLike = ReturnType<typeof getSupabaseAdminClient>;

export type EmailStyleProfileRow = {
  id: string;
  name: string;
  profile: Record<string, unknown>;
  content_hash: string;
  revision: number;
  is_default: boolean;
  updated_at: string;
  user_id?: string;
  library_scope?: 'personal' | 'team';
  archived_at?: string | null;
  source_collection?: string | null;
  published_by?: string | null;
  published_at?: string | null;
};

const STYLE_FIELDS = 'id,name,profile,content_hash,revision,is_default,updated_at,library_scope,archived_at,source_collection,published_by,published_at';
const ORGANIZATION_STYLE_FIELDS = `${STYLE_FIELDS},user_id`;
const MAX_MATERIALIZATION_ATTEMPTS = 8;
const STYLE_PAGE_SIZE = 1_000;

function profilePresetId(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const presetId = (value as Record<string, unknown>).presetId;
  return typeof presetId === 'string' ? presetId.trim().toLowerCase() : null;
}

export function materializedOutsourcingEmailStylePresetId(
  row: Pick<EmailStyleProfileRow, 'name' | 'profile' | 'content_hash'>,
) {
  const preset = getOutsourcingEmailStylePresetById(profilePresetId(row.profile));
  if (!preset) return null;
  if (canonicalSha256(row.profile) !== row.content_hash) return null;
  const canonicalProfile = {
    ...styleProfileFromOutsourcingEmailStylePreset(preset),
    name: row.name,
  };
  return canonicalSha256(canonicalProfile) === row.content_hash ? preset.id : null;
}

type OrganizationEmailStyleProfileRow = EmailStyleProfileRow & { user_id: string };

async function listOrganizationStyles(input: {
  client: SupabaseClientLike;
  organizationId: string;
  userId: string;
}) {
  const rows: OrganizationEmailStyleProfileRow[] = [];
  for (let from = 0; ; from += STYLE_PAGE_SIZE) {
    const result = await input.client
      .from('email_style_profiles')
      .select(ORGANIZATION_STYLE_FIELDS)
      .eq('organization_id', input.organizationId)
      .eq('user_id', input.userId)
      .eq('library_scope', 'personal')
      .is('archived_at', null)
      .order('id', { ascending: true })
      .range(from, from + STYLE_PAGE_SIZE - 1);
    if (result.error) throw result.error;
    const page = (result.data || []) as OrganizationEmailStyleProfileRow[];
    rows.push(...page);
    if (page.length < STYLE_PAGE_SIZE) return rows;
  }
}

function availablePresetName(presetLabel: string, usedNames: Set<string>) {
  if (!usedNames.has(presetLabel.toLowerCase())) return presetLabel;
  let suffix = 2;
  let candidate = `${presetLabel} · Integrado`;
  while (usedNames.has(candidate.toLowerCase())) {
    candidate = `${presetLabel} · Integrado ${suffix}`;
    suffix += 1;
  }
  return candidate;
}

export async function materializeOutsourcingEmailStylePreset(input: {
  selection: unknown;
  organizationId: string;
  userId: string;
  client?: SupabaseClientLike;
}) {
  const preset = getOutsourcingEmailStylePresetFromSelection(input.selection);
  if (!preset) return null;

  const client = input.client ?? getSupabaseAdminClient();
  const membership = await client.from('organization_members').select('role')
    .eq('organization_id', input.organizationId).eq('user_id', input.userId).maybeSingle();
  if (membership.error) throw membership.error;
  if (!['owner', 'admin', 'member'].includes(membership.data?.role)) throw new Error('EMAIL_STYLE_FORBIDDEN');
  let current = await listOrganizationStyles({
    client,
    organizationId: input.organizationId,
    userId: input.userId,
  });
  let lastConflict: unknown = null;

  for (let attempt = 0; attempt < MAX_MATERIALIZATION_ATTEMPTS; attempt += 1) {
    const existing = current.find((row) => (
      row.user_id === input.userId
      && materializedOutsourcingEmailStylePresetId(row) === preset.id
    ));
    if (existing) return existing;

    // Match the active-name index's lower(btrim(name)) collision rules.
    const name = availablePresetName(preset.label, new Set(current.map((row) => row.name.replace(/^ +| +$/g, '').toLowerCase())));
    const profile = {
      ...styleProfileFromOutsourcingEmailStylePreset(preset),
      name,
    };
    const result = await client
      .from('email_style_profiles')
      .insert({
        organization_id: input.organizationId,
        user_id: input.userId,
        library_scope: 'personal',
        name,
        profile,
        content_hash: canonicalSha256(profile),
        revision: 1,
        is_default: false,
        updated_at: new Date().toISOString(),
      })
      .select(STYLE_FIELDS)
      .single();
    if (!result.error) return result.data as EmailStyleProfileRow;
    if (String(result.error.code || '') !== '23505') throw result.error;

    lastConflict = result.error;
    current = await listOrganizationStyles({
      client,
      organizationId: input.organizationId,
      userId: input.userId,
    });
  }

  throw lastConflict;
}

/** Native loader contract: explicit ID, then personal name, team name, personal default, team default.
 * Returns the persisted UUID/hash/revision, never a branded virtual selection.
 * Membership is rechecked because the supplied client may bypass RLS.
 */
export async function resolveEmailStyleProfile(input: {
  organizationId: string;
  userId: string;
  styleProfileId?: string | null;
  styleName?: string | null;
  client?: SupabaseClientLike;
}): Promise<EmailStyleProfileRow | null> {
  const client = input.client ?? getSupabaseAdminClient();
  const membership = await client.from('organization_members').select('role')
    .eq('organization_id', input.organizationId).eq('user_id', input.userId).maybeSingle();
  if (membership.error) throw membership.error;
  if (!['owner', 'admin', 'member'].includes(membership.data?.role)) throw new Error('EMAIL_STYLE_FORBIDDEN');
  const id = input.styleProfileId?.trim();
  if (id?.startsWith('preset:')) {
    const preset = await materializeOutsourcingEmailStylePreset({ ...input, selection: id, client });
    if (!preset) throw new Error('NATIVE_DRAFT_STYLE_NOT_FOUND');
    return preset;
  }
  if (id && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error('NATIVE_DRAFT_STYLE_NOT_FOUND');
  }
  const name = input.styleName?.trim();
  for (const scope of ['personal', 'team'] as const) {
    let query = client.from('email_style_profiles').select(`${STYLE_FIELDS},user_id`)
      .eq('organization_id', input.organizationId).eq('library_scope', scope).is('archived_at', null);
    if (scope === 'personal') query = query.eq('user_id', input.userId);
    query = id ? query.eq('id', id) : name ? query.eq('name', name) : query.eq('is_default', true);
    const result = await query.maybeSingle();
    if (result.error) throw result.error;
    if (result.data) return result.data as EmailStyleProfileRow;
  }
  if (id || name) throw new Error('NATIVE_DRAFT_STYLE_NOT_FOUND');
  return null;
}
