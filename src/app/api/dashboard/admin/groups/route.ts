import { NextRequest, NextResponse } from 'next/server';

import {
  adminDashboardAuthErrorResponse,
  requireAdminDashboardAccess,
} from '@/lib/server/admin-dashboard-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COLOR_RE = /^#[0-9a-f]{6}$/i;

function slugify(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function validUuid(value: unknown) {
  return UUID_RE.test(String(value || '').trim());
}

export async function GET() {
  try {
    const auth = await requireAdminDashboardAccess();
    const { data, error } = await auth.supabase
      .from('organization_reporting_groups')
      .select('id, name, slug, country_code, color, is_active, created_at')
      .eq('organization_id', auth.organizationId)
      .order('name', { ascending: true });

    if (error) throw error;
    return NextResponse.json({ groups: data || [] }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return adminDashboardAuthErrorResponse(error) || NextResponse.json({ error: 'Unable to load groups' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAdminDashboardAccess();
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || 'create').trim().toLowerCase();

    if (action === 'assign' || action === 'remove') {
      const groupId = String(body?.groupId || '').trim();
      const userId = String(body?.userId || '').trim();
      if (!validUuid(groupId) || !validUuid(userId)) {
        return NextResponse.json({ error: 'Grupo o usuario inválido.' }, { status: 400 });
      }

      const [{ data: group, error: groupError }, { data: member, error: memberError }] = await Promise.all([
        auth.supabase
          .from('organization_reporting_groups')
          .select('id')
          .eq('id', groupId)
          .eq('organization_id', auth.organizationId)
          .maybeSingle(),
        auth.supabase
          .from('organization_members')
          .select('user_id')
          .eq('organization_id', auth.organizationId)
          .eq('user_id', userId)
          .maybeSingle(),
      ]);

      if (groupError || memberError) throw groupError || memberError;
      if (!group || !member) return NextResponse.json({ error: 'Grupo o usuario no pertenece a esta organización.' }, { status: 404 });

      if (action === 'remove') {
        const { error } = await auth.supabase
          .from('organization_reporting_group_members')
          .update({ is_primary: false, unassigned_at: new Date().toISOString() })
          .eq('organization_id', auth.organizationId)
          .eq('group_id', groupId)
          .eq('user_id', userId)
          .is('unassigned_at', null);
        if (error) throw error;
        return NextResponse.json({ ok: true });
      }

      const isPrimary = Boolean(body?.isPrimary);
      if (isPrimary) {
        const { error } = await auth.supabase
          .from('organization_reporting_group_members')
          .update({ is_primary: false })
          .eq('organization_id', auth.organizationId)
          .eq('user_id', userId)
          .is('unassigned_at', null);
        if (error) throw error;
      }

      const { error } = await auth.supabase
        .from('organization_reporting_group_members')
        .upsert({
          organization_id: auth.organizationId,
          group_id: groupId,
          user_id: userId,
          is_primary: isPrimary,
          unassigned_at: null,
        }, { onConflict: 'group_id,user_id' });
      if (error) throw error;
      return NextResponse.json({ ok: true }, { status: 201 });
    }

    const name = String(body?.name || '').trim();
    const slug = slugify(String(body?.slug || name));
    const countryCode = String(body?.countryCode || '').trim().toUpperCase().slice(0, 3) || null;
    const color = String(body?.color || '').trim() || null;
    if (name.length < 2 || name.length > 80 || !slug) {
      return NextResponse.json({ error: 'El nombre del grupo debe tener entre 2 y 80 caracteres.' }, { status: 400 });
    }
    if (color && !COLOR_RE.test(color)) {
      return NextResponse.json({ error: 'El color del grupo no es válido.' }, { status: 400 });
    }

    const { data, error } = await auth.supabase
      .from('organization_reporting_groups')
      .insert({
        organization_id: auth.organizationId,
        name,
        slug,
        country_code: countryCode,
        color,
      })
      .select('id, name, slug, country_code, color, is_active')
      .single();

    if (error) {
      if (error.code === '23505') return NextResponse.json({ error: 'Ya existe un grupo con ese nombre.' }, { status: 409 });
      throw error;
    }
    return NextResponse.json({ group: data }, { status: 201 });
  } catch (error) {
    return adminDashboardAuthErrorResponse(error) || NextResponse.json({ error: 'Unable to update groups' }, { status: 500 });
  }
}
