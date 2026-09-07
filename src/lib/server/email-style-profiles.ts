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
};

const STYLE_FIELDS = 'id,name,profile,content_hash,revision,is_default,updated_at';
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
}) {
  const rows: OrganizationEmailStyleProfileRow[] = [];
  for (let from = 0; ; from += STYLE_PAGE_SIZE) {
    const result = await input.client
      .from('email_style_profiles')
      .select(ORGANIZATION_STYLE_FIELDS)
      .eq('organization_id', input.organizationId)
      .order('id', { ascending: true })
      .range(from, from + STYLE_PAGE_SIZE - 1);
    if (result.error) throw result.error;
    const page = (result.data || []) as OrganizationEmailStyleProfileRow[];
    rows.push(...page);
    if (page.length < STYLE_PAGE_SIZE) return rows;
  }
}

function availablePresetName(presetLabel: string, usedNames: Set<string>) {
  if (!usedNames.has(presetLabel)) return presetLabel;
  let suffix = 2;
  let candidate = `${presetLabel} · Integrado`;
  while (usedNames.has(candidate)) {
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
  let current = await listOrganizationStyles({
    client,
    organizationId: input.organizationId,
  });
  let lastConflict: unknown = null;

  for (let attempt = 0; attempt < MAX_MATERIALIZATION_ATTEMPTS; attempt += 1) {
    const existing = current.find((row) => (
      row.user_id === input.userId
      && materializedOutsourcingEmailStylePresetId(row) === preset.id
    ));
    if (existing) return existing;

    const name = availablePresetName(preset.label, new Set(current.map((row) => row.name)));
    const profile = {
      ...styleProfileFromOutsourcingEmailStylePreset(preset),
      name,
    };
    const result = await client
      .from('email_style_profiles')
      .insert({
        organization_id: input.organizationId,
        user_id: input.userId,
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
    });
  }

  throw lastConflict;
}
