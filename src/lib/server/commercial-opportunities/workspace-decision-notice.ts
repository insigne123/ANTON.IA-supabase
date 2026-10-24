import type { SupabaseClient } from '@supabase/supabase-js';
import { decisionEmail, type DecisionNoticeKind } from '@/lib/commercial-opportunities/decision-email';
import type { WorkScope } from '@/lib/commercial-opportunities/workspace';
import { readAlertsEmail } from '@/lib/server/daily-alerts';
import { isTestAddress, sendReportEmail, type SelfEmail } from '@/lib/server/self-email';

type Send = (input: SelfEmail) => Promise<{ ok: boolean }>;
type Row = Record<string, any>;

/**
 * Who hears about it: a decision, a proposal not to apply or a block goes to the administrators and whoever is in charge; an answer, to
 * whoever asked and whoever is in charge; a note or tasks, to the people named or given them. Never to the person who did it.
 */
async function recipients(client: SupabaseClient, scope: WorkScope, id: string, kind: DecisionNoticeKind, asker: string | null, users?: string[]) {
  if (users) return [...new Set(users.filter(user => user && user !== scope.userId))];
  const work = await client.from('opportunity_work').select('responsible_id').eq('organization_id', scope.organizationId).eq('opportunity_id', id).maybeSingle();
  const responsible = (work.data as Row | null)?.responsible_id ? String((work.data as Row).responsible_id) : null;
  if (kind === 'reply') return [...new Set([asker, responsible].filter((user): user is string => Boolean(user) && user !== scope.userId))];
  const admins = await client.from('organization_members').select('user_id').eq('organization_id', scope.organizationId).in('role', ['owner', 'admin']).limit(50);
  return [...new Set([...((admins.data || []) as Row[]).map(row => String(row.user_id)), responsible].filter((user): user is string => Boolean(user) && user !== scope.userId))];
}

/**
 * The email of something on an opportunity that waits for someone (decision-email.ts), after the line in «Novedades». Whoever turned the
 * app's emails off in «Tu semana», has no address or a test one gets none, and a send that fails never fails what was done.
 * OPPORTUNITY_DECISION_EMAIL=off stops them all.
 */
export async function notifyDecisionByEmail(client: SupabaseClient, scope: WorkScope, id: string,
  input: { kind: DecisionNoticeKind; text: string; dueAt?: string | null; asker?: string | null; users?: string[]; count?: number },
  deps: { send?: Send; appUrl?: string; env?: Record<string, string | undefined> } = {}) {
  const env = deps.env ?? process.env;
  const result = { sent: 0, skipped: 0, failed: 0 };
  if (env.OPPORTUNITY_DECISION_EMAIL === 'off') return result;
  const to = await recipients(client, scope, id, input.kind, input.asker ?? null, input.users);
  if (!to.length) return result;
  const [item, people] = await Promise.all([
    client.from('commercial_opportunities').select('title').eq('organization_id', scope.organizationId).eq('id', id).maybeSingle(),
    client.from('profiles').select('id,email,full_name,signatures').in('id', [...to, scope.userId]),
  ]);
  if (!item.data || people.error) return { ...result, skipped: to.length };
  const profiles = new Map(((people.data || []) as Row[]).map(row => [String(row.id), row]));
  const actor = profiles.get(scope.userId);
  const actorName = String(actor?.full_name || '').trim() || String(actor?.email || '').trim() || null;
  const appUrl = deps.appUrl ?? String(env.NEXT_PUBLIC_APP_URL || env.NEXT_PUBLIC_BASE_URL || 'https://app.antonia.ai');
  const send: Send = deps.send ?? (email => sendReportEmail(client, email));
  for (const user of to) {
    const profile = profiles.get(user);
    const address = String(profile?.email || '').trim();
    if (!address || isTestAddress(address) || !readAlertsEmail(profile?.signatures)) { result.skipped++; continue; }
    try {
      const email = decisionEmail({ name: String(profile?.full_name || '').trim(), actor: actorName, kind: input.kind, title: String((item.data as Row).title || ''),
        text: input.text, dueAt: input.dueAt ?? null, opportunityId: id, appUrl, ...(input.count ? { count: input.count } : {}) });
      const sent = await send({ userId: user, to: address, ...email });
      if (sent.ok) result.sent++; else result.failed++;
    } catch {
      result.failed++;
    }
  }
  return result;
}
