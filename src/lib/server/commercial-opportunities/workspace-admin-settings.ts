import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { AuthError } from '@/lib/server/auth-utils';
import { assignmentRuleSchema, MAX_RULES, MAX_SEARCHES, readAdminSettings, sameSearch, savedSearchSchema, type AdminSettings, type SavedSearch } from '@/lib/commercial-opportunities/admin-settings';
import type { WorkScope } from '@/lib/commercial-opportunities/workspace';
import { assertOpportunityAdmin } from './workspace-access';
import { opportunityDb } from './workspace-store';

/**
 * What an administrator changes of the workspace's rules and searches (admin-settings.ts): the whole list of rules at once (the dialog
 * edits them together), a search saved (again: renamed, the same filters never twice), one removed, and whether the person who asks
 * hears of what is new in one. Saved searches are of the whole team; each person turns their own notice on and off.
 */
export const adminSettingsInputSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('rules'), rules: z.array(assignmentRuleSchema.extend({ id: assignmentRuleSchema.shape.id.optional() })).max(MAX_RULES) }).strict(),
  z.object({ op: z.literal('search'), search: savedSearchSchema.pick({ name: true, filter: true, source: true, query: true, categories: true }).extend({ notify: z.boolean().default(true) }).strict() }).strict(),
  z.object({ op: z.literal('search_remove'), id: z.string().max(40) }).strict(),
  z.object({ op: z.literal('search_notify'), id: z.string().max(40), on: z.boolean() }).strict(),
]);
export type AdminSettingsInput = z.infer<typeof adminSettingsInputSchema>;

const withPerson = (list: string[], userId: string, on: boolean) => (on ? [...new Set([...list, userId])] : list.filter(id => id !== userId));

/** The settings after the change, written whole; the offer must be confirmed first, since they live beside it. */
export async function saveAdminSettings(client: SupabaseClient, scope: WorkScope, input: AdminSettingsInput): Promise<AdminSettings> {
  assertOpportunityAdmin(scope);
  const row = opportunityDb(await client.from('opportunity_company_context').select('admin_settings').eq('organization_id', scope.organizationId).maybeSingle()) as { admin_settings?: unknown } | null;
  if (!row) throw new AuthError('Confirma primero la oferta de tu empresa.', 409);
  const current = readAdminSettings(row.admin_settings);
  let next: AdminSettings;
  if (input.op === 'rules') {
    const people = input.rules.map(rule => rule.userId);
    const members = people.length ? new Set(((opportunityDb(await client.from('organization_members').select('user_id').eq('organization_id', scope.organizationId).in('user_id', [...new Set(people)])) || []) as Array<{ user_id: string }>).map(member => member.user_id)) : new Set<string>();
    if (people.some(userId => !members.has(userId))) throw new AuthError('Una de las personas ya no está en la organización: elige a otra.', 422);
    next = { ...current, rules: input.rules.map(rule => ({ ...rule, id: rule.id || randomUUID() })) };
  } else if (input.op === 'search') {
    const existing = current.searches.find(search => sameSearch(search, input.search));
    if (!existing && current.searches.length >= MAX_SEARCHES) throw new AuthError(`Puedes guardar hasta ${MAX_SEARCHES} búsquedas: borra una antes.`, 422);
    const { notify, ...filters } = input.search;
    const saved: SavedSearch = existing ? { ...existing, name: filters.name, notify: withPerson(existing.notify, scope.userId, notify) }
      : { id: randomUUID(), ...filters, notify: notify ? [scope.userId] : [], createdBy: scope.userId };
    next = { ...current, searches: existing ? current.searches.map(search => (search === existing ? saved : search)) : [...current.searches, saved] };
  } else if (input.op === 'search_remove') {
    next = { ...current, searches: current.searches.filter(search => search.id !== input.id) };
  } else {
    if (!current.searches.some(search => search.id === input.id)) throw new AuthError('Esa búsqueda ya no está guardada.', 404);
    next = { ...current, searches: current.searches.map(search => (search.id === input.id ? { ...search, notify: withPerson(search.notify, scope.userId, input.on) } : search)) };
  }
  opportunityDb(await client.from('opportunity_company_context').update({ admin_settings: next }).eq('organization_id', scope.organizationId));
  return next;
}
