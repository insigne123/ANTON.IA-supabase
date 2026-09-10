import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { canonicalSha256 } from '@/lib/messaging-contracts';
import { OUTSOURCING_EMAIL_STYLE_PRESETS, outsourcingEmailStylePresetSelection, styleProfileFromOutsourcingEmailStylePreset } from '@/lib/outsourcing-email-style-presets';
import { canPublishEmailTemplates } from '@/lib/email-studio/library-contract';
import { GRUPOEXPRO_REFERENCE_TEMPLATES } from '@/lib/email-studio/grupoexpro-templates';
import { handleAuthError, requireAuth, type AuthContext } from '@/lib/server/auth-utils';
import { materializedOutsourcingEmailStylePresetId, type EmailStyleProfileRow } from '@/lib/server/email-style-profiles';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';
const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' };
const STYLE_FIELDS = 'id,name,profile,content_hash,revision,is_default,updated_at,user_id,library_scope,archived_at,source_collection,published_by,published_at';

const InputSchema = z.object({
  action: z.enum(['save', 'duplicate', 'archive']).default('save'),
  id: z.string().trim().toLowerCase().uuid().optional(),
  expectedRevision: z.number().int().min(1).max(2147483646).optional(),
  name: z.string().trim().min(1).max(120),
  profile: z.record(z.unknown()),
  isDefault: z.boolean(),
  libraryScope: z.enum(['personal', 'team']).default('personal'),
  publishConfirmed: z.boolean().default(false),
  sourceCollection: z.literal('grupoexpro').nullable().optional(),
}).strict();

function parseEmailStyleBody(value: unknown) {
  const parsed = InputSchema.safeParse(value);
  const invalid = (): never => { throw new Error('EMAIL_STYLE_INVALID_REQUEST'); };
  if (!parsed.success) return invalid();
  const input = parsed.data;
  if (Boolean(input.id) !== (input.expectedRevision !== undefined)) invalid();
  if (input.action !== 'save' && !input.id) invalid();
  if (input.libraryScope === 'team' && !input.publishConfirmed) invalid();
  const validate = (item: unknown, depth = 0): void => {
    if (depth > 32) invalid();
    if (item === null || typeof item === 'boolean') return;
    if (typeof item === 'string') { if (item.includes('\0')) invalid(); return; }
    if (typeof item === 'number' && Number.isFinite(item)) return;
    if (Array.isArray(item)) { item.forEach((child) => validate(child, depth + 1)); return; }
    if (item && typeof item === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(item))) {
      for (const [key, child] of Object.entries(item)) { validate(key, depth + 1); validate(child, depth + 1); }
      return;
    }
    invalid();
  };
  validate(input.name);
  validate(input.profile);
  if (new TextEncoder().encode(JSON.stringify(input.profile)).byteLength > 256 * 1024) invalid();
  delete input.profile.presetId;
  return input;
}

function serializeEmailStyle(row: EmailStyleProfileRow) {
  return {
    id: row.id, name: row.name, profile: row.profile, revision: row.revision,
    isDefault: row.is_default, updatedAt: row.updated_at,
    libraryScope: row.library_scope || 'personal', ownerId: row.user_id,
    archivedAt: row.archived_at || null, sourceCollection: row.source_collection || null,
    publishedBy: row.published_by || null, publishedAt: row.published_at || null,
  };
}

async function persistEmailStyle(auth: AuthContext, input: ReturnType<typeof parseEmailStyleBody>) {
  if (input.libraryScope === 'team' && !canPublishEmailTemplates(auth.organizationRole)) {
    throw new Error('EMAIL_STYLE_FORBIDDEN');
  }
  const { data, error } = await auth.supabase.rpc('mutate_email_template_v1', {
    p_organization_id: auth.organizationId, p_action: input.action,
    p_id: input.id || null, p_expected_revision: input.expectedRevision ?? null,
    p_name: input.name, p_profile: input.profile, p_content_hash: canonicalSha256(input.profile),
    p_library_scope: input.libraryScope, p_is_default: input.isDefault,
    p_publish_confirmed: input.publishConfirmed, p_source_collection: input.sourceCollection || null,
  });
  if (error) throw error;
  if (!data) throw new Error('EMAIL_STYLE_SAVE_FAILED');
  return { created: !input.id || input.action === 'duplicate', style: serializeEmailStyle(data) };
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth();
    const rows: EmailStyleProfileRow[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await auth.supabase.from('email_style_profiles').select(STYLE_FIELDS)
        .eq('organization_id', auth.organizationId)
        .or(`library_scope.eq.team,and(library_scope.eq.personal,user_id.eq.${auth.user.id})`)
        .is('archived_at', null)
        .order('is_default', { ascending: false }).order('updated_at', { ascending: false })
        .order('id', { ascending: true }).range(from, from + 999);
      if (error) throw error;
      rows.push(...(data || []));
      if ((data || []).length < 1000) break;
    }
    const persistedPresets = new Set(rows.filter((row) => row.library_scope === 'personal')
      .map(materializedOutsourcingEmailStylePresetId).filter(Boolean));
    const presets = req.nextUrl.searchParams.get('includePresets') === 'true'
      ? OUTSOURCING_EMAIL_STYLE_PRESETS.filter((preset) => !persistedPresets.has(preset.id)).map((preset) => {
        const id = outsourcingEmailStylePresetSelection(preset.id);
        const profile = styleProfileFromOutsourcingEmailStylePreset(preset);
        return { id, name: profile.name, profile: { ...profile, id }, revision: 1,
          isDefault: false, updatedAt: '1970-01-01T00:00:00.000Z', libraryScope: 'reference' };
      }) : [];
    // Explicit request only. References are never presented as organization-approved templates.
    const references = req.nextUrl.searchParams.get('referenceCollection') === 'grupoexpro'
      ? GRUPOEXPRO_REFERENCE_TEMPLATES : [];
    return NextResponse.json({ styles: [...rows.map(serializeEmailStyle), ...presets], references,
      canPublish: canPublishEmailTemplates(auth.organizationRole), organizationId: auth.organizationId,
    }, { headers: NO_STORE_HEADERS });
  } catch (error: any) {
    if (error?.name === 'AuthError') return handleAuthError(error);
    console.error('[email-styles] load failed:', error);
    return NextResponse.json({ error: 'EMAIL_STYLES_LOAD_FAILED' }, { status: 500, headers: NO_STORE_HEADERS });
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth();
    const input = parseEmailStyleBody(await req.json());
    const result = await persistEmailStyle(auth, input);
    return NextResponse.json({ style: result.style }, { status: result.created ? 201 : 200, headers: NO_STORE_HEADERS });
  } catch (error: any) {
    if (error?.name === 'AuthError') return handleAuthError(error);
    const code = error instanceof SyntaxError ? 'EMAIL_STYLE_INVALID_REQUEST'
      : error?.code === '23505' ? 'EMAIL_STYLE_NAME_CONFLICT'
      : error?.code === '42501' ? 'EMAIL_STYLE_FORBIDDEN' : error?.message;
    const statuses: Record<string, number> = { EMAIL_STYLE_INVALID_REQUEST: 400, EMAIL_STYLE_NOT_FOUND: 404,
      EMAIL_STYLE_FORBIDDEN: 403, EMAIL_STYLE_REVISION_CONFLICT: 409, EMAIL_STYLE_NAME_CONFLICT: 409 };
    if (statuses[code]) return NextResponse.json({ error: code }, { status: statuses[code], headers: NO_STORE_HEADERS });
    console.error('[email-styles] save failed:', error);
    return NextResponse.json({ error: 'EMAIL_STYLE_SAVE_FAILED' }, { status: 500, headers: NO_STORE_HEADERS });
  }
}
