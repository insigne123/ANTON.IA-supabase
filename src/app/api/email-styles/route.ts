import { NextRequest, NextResponse } from 'next/server';

import { canonicalSha256 } from '@/lib/messaging-contracts';
import { handleAuthError, requireAuth, type AuthContext } from '@/lib/server/auth-utils';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

const STYLE_FIELDS = 'id,name,profile,revision,is_default,updated_at';
const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' };
const mutationQueues = new Map<string, Promise<void>>();

type EmailStyleInput = {
  id?: string;
  name: string;
  profile: Record<string, unknown>;
  isDefault: boolean;
};

type EmailStyleRow = {
  id: string;
  name: string;
  profile: Record<string, unknown>;
  revision: number;
  is_default: boolean;
  updated_at: string;
};

function parseEmailStyleBody(value: unknown): EmailStyleInput {
  const invalid = (): never => {
    throw new Error('EMAIL_STYLE_INVALID_REQUEST');
  };
  const isPlainObject = (item: unknown): item is Record<string, unknown> => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
    const prototype = Object.getPrototypeOf(item);
    return prototype === Object.prototype || prototype === null;
  };
  const validateJson = (item: unknown, depth = 0): void => {
    if (depth > 32) invalid();
    if (item === null || typeof item === 'boolean') return;
    if (typeof item === 'string') {
      if (item.includes('\0')) invalid();
      return;
    }
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) invalid();
      return;
    }
    if (Array.isArray(item)) {
      for (const child of item) validateJson(child, depth + 1);
      return;
    }
    if (isPlainObject(item)) {
      for (const [key, child] of Object.entries(item)) {
        if (key.includes('\0')) invalid();
        validateJson(child, depth + 1);
      }
      return;
    }
    invalid();
  };

  if (!isPlainObject(value)) return invalid();
  const body = value;
  const allowedKeys = new Set(['id', 'name', 'profile', 'isDefault']);
  if (Object.keys(body).some((key) => !allowedKeys.has(key))) invalid();

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 120 || name.includes('\0')) invalid();
  if (!isPlainObject(body.profile)) return invalid();
  const isDefault = body.isDefault;
  if (typeof isDefault !== 'boolean') return invalid();

  let id: string | undefined;
  if (body.id !== undefined) {
    if (typeof body.id !== 'string') return invalid();
    const normalizedId = body.id.trim().toLowerCase();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(normalizedId)) invalid();
    id = normalizedId;
  }

  validateJson(body.profile);
  let serializedProfile = '';
  try {
    serializedProfile = JSON.stringify(body.profile);
  } catch {
    return invalid();
  }
  if (new TextEncoder().encode(serializedProfile).byteLength > 256 * 1024) invalid();

  return { ...(id ? { id } : {}), name, profile: body.profile, isDefault };
}

function serializeEmailStyle(row: EmailStyleRow) {
  return {
    id: row.id,
    name: row.name,
    profile: row.profile,
    revision: row.revision,
    isDefault: row.is_default,
    updatedAt: row.updated_at,
  };
}

async function withMutationLock<T>(key: string, mutation: () => Promise<T>): Promise<T> {
  const previous = mutationQueues.get(key) || Promise.resolve();
  let release = () => {};
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  mutationQueues.set(key, current);
  await previous;

  try {
    return await mutation();
  } finally {
    release();
    if (mutationQueues.get(key) === current) mutationQueues.delete(key);
  }
}

async function persistEmailStyle(auth: AuthContext, input: EmailStyleInput) {
  const { organizationId, supabase, user } = auth;
  const userId = String(user.id);
  const updatedAt = new Date().toISOString();
  const contentHash = canonicalSha256(input.profile);
  let row: EmailStyleRow;
  let created = false;

  if (input.id) {
    const { data: existing, error: findError } = await supabase
      .from('email_style_profiles')
      .select('id,revision')
      .eq('id', input.id)
      .eq('organization_id', organizationId)
      .eq('user_id', userId)
      .maybeSingle();
    if (findError) throw findError;
    if (!existing) throw new Error('EMAIL_STYLE_NOT_FOUND');

    const currentRevision = Number(existing.revision);
    if (!Number.isInteger(currentRevision) || currentRevision < 1) {
      throw new Error('EMAIL_STYLE_INVALID_REVISION');
    }

    const { data, error } = await supabase
      .from('email_style_profiles')
      .update({
        name: input.name,
        profile: input.profile,
        content_hash: contentHash,
        revision: currentRevision + 1,
        is_default: false,
        updated_at: updatedAt,
      })
      .eq('id', input.id)
      .eq('organization_id', organizationId)
      .eq('user_id', userId)
      .eq('revision', currentRevision)
      .select(STYLE_FIELDS)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('EMAIL_STYLE_REVISION_CONFLICT');
    row = data as EmailStyleRow;
  } else {
    const { data, error } = await supabase
      .from('email_style_profiles')
      .insert({
        organization_id: organizationId,
        user_id: userId,
        name: input.name,
        profile: input.profile,
        content_hash: contentHash,
        revision: 1,
        is_default: false,
        updated_at: updatedAt,
      })
      .select(STYLE_FIELDS)
      .single();
    if (error) throw error;
    row = data as EmailStyleRow;
    created = true;
  }

  if (input.isDefault) {
    const { data, error: defaultError } = await supabase
      .from('email_style_profiles')
      .update({ is_default: true, updated_at: updatedAt })
      .eq('id', row.id)
      .eq('organization_id', organizationId)
      .eq('user_id', userId)
      .eq('revision', row.revision)
      .select(STYLE_FIELDS)
      .maybeSingle();
    if (defaultError) throw defaultError;
    if (!data) throw new Error('EMAIL_STYLE_REVISION_CONFLICT');
    row = data as EmailStyleRow;

    const { error: clearError } = await supabase
      .from('email_style_profiles')
      .update({ is_default: false, updated_at: updatedAt })
      .eq('organization_id', organizationId)
      .eq('user_id', userId)
      .eq('is_default', true)
      .neq('id', row.id);
    if (clearError) throw clearError;
  }

  return { created, style: serializeEmailStyle(row) };
}

export async function GET() {
  try {
    const auth = await requireAuth();
    const { data, error } = await auth.supabase
      .from('email_style_profiles')
      .select(STYLE_FIELDS)
      .eq('organization_id', auth.organizationId)
      .eq('user_id', auth.user.id)
      .order('is_default', { ascending: false })
      .order('updated_at', { ascending: false });
    if (error) throw error;

    return NextResponse.json({
      styles: (data || []).map((row: EmailStyleRow) => serializeEmailStyle(row)),
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
    const result = await withMutationLock(
      `${auth.organizationId}:${auth.user.id}`,
      () => persistEmailStyle(auth, input),
    );
    return NextResponse.json({ style: result.style }, {
      status: result.created ? 201 : 200,
      headers: NO_STORE_HEADERS,
    });
  } catch (error: any) {
    if (error?.name === 'AuthError') return handleAuthError(error);
    if (error?.message === 'EMAIL_STYLE_INVALID_REQUEST' || error instanceof SyntaxError) {
      return NextResponse.json({ error: 'EMAIL_STYLE_INVALID_REQUEST' }, { status: 400, headers: NO_STORE_HEADERS });
    }
    if (error?.message === 'EMAIL_STYLE_NOT_FOUND') {
      return NextResponse.json({ error: 'EMAIL_STYLE_NOT_FOUND' }, { status: 404, headers: NO_STORE_HEADERS });
    }
    if (error?.message === 'EMAIL_STYLE_REVISION_CONFLICT' || String(error?.code || '') === '23505') {
      const code = String(error?.code || '') === '23505'
        ? 'EMAIL_STYLE_NAME_CONFLICT'
        : 'EMAIL_STYLE_REVISION_CONFLICT';
      return NextResponse.json({ error: code }, { status: 409, headers: NO_STORE_HEADERS });
    }

    console.error('[email-styles] save failed:', error);
    return NextResponse.json({ error: 'EMAIL_STYLE_SAVE_FAILED' }, { status: 500, headers: NO_STORE_HEADERS });
  }
}
