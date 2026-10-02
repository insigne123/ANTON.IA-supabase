import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { mapProfileToForm } from '@/lib/profile/profile-mappings';
import { analyzeIcp, type IcpDeclared, type IcpLead, type IcpTouch } from '@/lib/cowork/icp';

type Scope = { userId: string; organizationId: string };
const PAGE = 500;
const PAGES = 10;

const listOf = (value: string, split: RegExp) => value.split(split).map(item => item.trim()).filter(Boolean).slice(0, 12);

/** The customer the person declared in «Perfil», the same fields profile.get reads; null when none is filled. */
export function icpDeclaredFromProfile(row: unknown): IcpDeclared | null {
  const form = mapProfileToForm((row || {}) as Parameters<typeof mapProfileToForm>[0]);
  const declared: IcpDeclared = {
    roles: listOf(form.targetRoles, /[,;\n]/), industries: listOf(form.targetIndustries, /[,;\n]/),
    companySize: form.targetCompanySize.trim().slice(0, 120) || null, locations: listOf(form.targetLocations, /[,;\n]/),
    painPoints: listOf(form.painPoints, /\n/), differentiators: listOf(form.differentiators, /\n/), referenceClients: listOf(form.referenceClients, /[,;\n]/),
  };
  const any = declared.roles.length || declared.industries.length || declared.companySize || declared.locations.length
    || declared.painPoints.length || declared.differentiators.length || declared.referenceClients.length;
  return any ? declared : null;
}

/**
 * icp.analyze (plan 8, phase 2): the organization's sends, saved contacts and pipeline stages next to the customer the
 * person declared. `value` is the offer in play when the person asks about a specific one («¿a quién le ofrezco X?»);
 * it travels back so the answer names it, and does not change the arithmetic.
 */
export async function readCoworkIcp(client: SupabaseClient, scope: Scope, value: string) {
  const offer = z.string().max(300).parse(value).replace(/\s+/g, ' ').trim() || null;
  const userId = z.string().uuid().parse(scope.userId);
  const organizationId = z.string().uuid().parse(scope.organizationId);
  async function scan<T>(table: string, columns: string) {
    const rows: T[] = [];
    for (let page = 0; page < PAGES; page++) {
      const { data, error } = await client.from(table).select(columns).eq('organization_id', organizationId)
        .order('id', { ascending: true }).range(page * PAGE, page * PAGE + PAGE - 1);
      if (error) throw new Error('No se pudo leer tu historial para analizar tu cliente ideal.');
      rows.push(...((data || []) as T[]));
      if ((data || []).length < PAGE) return { rows, complete: true };
    }
    return { rows, complete: false };
  }
  const [profile, touches, leads, stages] = await Promise.all([
    client.from('profiles').select('company_name,signatures').eq('id', userId).maybeSingle(),
    scan<Record<string, string | null>>('contacted_leads', 'id,lead_id,email,role,industry,country,city,sent_at,replied_at,reply_intent,bounced_at'),
    scan<Record<string, string | null>>('leads', 'id,title,industry,country,city'),
    scan<{ id: string; stage: string | null }>('unified_crm_data', 'id,stage'),
  ]);
  if (profile.error) throw new Error('No se pudo leer tu perfil para analizar tu cliente ideal.');
  const analysis = analyzeIcp({
    declared: icpDeclaredFromProfile(profile.data),
    touches: touches.rows.map((row): IcpTouch => ({
      id: String(row.id), leadId: row.lead_id || null, email: row.email || null, role: row.role || null, industry: row.industry || null,
      country: row.country || null, city: row.city || null, sentAt: row.sent_at || null, repliedAt: row.replied_at || null,
      replyIntent: row.reply_intent || null, bouncedAt: row.bounced_at || null,
    })),
    leads: leads.rows.map((row): IcpLead => ({ id: String(row.id), title: row.title || null, industry: row.industry || null, country: row.country || null, city: row.city || null })),
    stages: new Map(stages.rows.filter(row => typeof row.stage === 'string').map(row => [row.id, row.stage as string])),
    now: new Date().toISOString(),
  });
  const complete = touches.complete && leads.complete && stages.complete;
  return {
    scope: 'organization_icp', offer, ...analysis,
    ...(complete ? {} : { partial: `Se leyeron los primeros ${PAGE * PAGES} registros de cada tabla: las cifras son de esa parte.` }),
  };
}
