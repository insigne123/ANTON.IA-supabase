import { createClient } from '@supabase/supabase-js';
import { sendGmail, sendOutlook } from '../server-email-sender';
import { refreshGoogleToken, refreshMicrosoftToken } from '../server-auth-helpers';
import { buildAntoniaDailyDashboardHtml, type AntoniaDailyMissionRow } from './antonia-report-email';
import { generateUnsubscribeLink } from '@/lib/unsubscribe-helpers';
import { prepareOutboundEmail, validateOutboundEmail } from '@/lib/email-outbound';

function parseRecipients(raw?: string | null): string[] {
    if (!raw) return [];
    const parts = String(raw)
        .split(/[,;\n\r\t ]+/)
        .map(s => s.trim().toLowerCase())
        .filter(Boolean);

    const unique = new Set<string>();
    const out: string[] = [];
    for (const p of parts) {
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p)) continue;
        if (unique.has(p)) continue;
        unique.add(p);
        out.push(p);
    }
    return out;
}

function getDashboardUrl() {
    const base = String(process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'https://app.antonia.ai').trim().replace(/\/$/, '');
    return `${base}/antonia`;
}

/**
 * Send system email using stored OAuth tokens
 * This function is designed to be called from server-side contexts (workers, cron jobs)
 */
async function sendSystemEmail(to: string, subject: string, html: string, organizationId?: string) {
    try {
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!supabaseUrl || !serviceKey) {
            console.error('[SystemMail] Missing Supabase service credentials');
            return;
        }

        const supabase = createClient(supabaseUrl, serviceKey, {
            auth: { persistSession: false, autoRefreshToken: false }
        });

        const pickTokens = async () => {
            if (organizationId) {
                const { data: members } = await supabase
                    .from('organization_members')
                    .select('user_id')
                    .eq('organization_id', organizationId);
                const memberIds = (members || []).map((m: any) => m.user_id).filter(Boolean);
                if (memberIds.length > 0) {
                    const { data: tokens } = await supabase
                        .from('provider_tokens')
                        .select('*')
                        .in('user_id', memberIds)
                        .order('updated_at', { ascending: false });
                    if (tokens && tokens.length > 0) return tokens;
                }
            }

            const { data: tokens } = await supabase
                .from('provider_tokens')
                .select('*')
                .order('updated_at', { ascending: false })
                .limit(5);
            return tokens || [];
        };

        const tokens = await pickTokens();
        if (!tokens || tokens.length === 0) {
            console.error('[SystemMail] No provider_tokens found');
            console.log(`[SystemMail] Would send: To: ${to} | Subject: ${subject}`);
            return;
        }

        const preferred = tokens.find((t: any) => t.provider === 'google') || tokens[0];
        const provider = preferred.provider as 'google' | 'outlook';
        const refreshToken = preferred.refresh_token;

        let accessToken = '';
        if (provider === 'google') {
            const refreshed = await refreshGoogleToken(refreshToken, process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID!, process.env.GOOGLE_CLIENT_SECRET!);
            accessToken = refreshed.access_token;
        } else {
            const refreshed = await refreshMicrosoftToken(refreshToken, process.env.NEXT_PUBLIC_AZURE_AD_CLIENT_ID!, process.env.AZURE_AD_CLIENT_SECRET!, process.env.NEXT_PUBLIC_AZURE_AD_TENANT_ID!);
            accessToken = refreshed.access_token;
            if (refreshed.refresh_token) {
                await supabase
                    .from('provider_tokens')
                    .update({ refresh_token: refreshed.refresh_token, updated_at: new Date().toISOString() })
                    .eq('user_id', preferred.user_id)
                    .eq('provider', 'outlook');
            }
        }

        if (!accessToken) {
            console.error('[SystemMail] Failed to refresh access token');
            console.log(`[SystemMail] Would send: To: ${to} | Subject: ${subject}`);
            return;
        }

        const unsubscribeUrl = generateUnsubscribeLink(to, preferred.user_id, organizationId || null);
        const prepared = prepareOutboundEmail({ html, unsubscribeUrl });
        const preflight = validateOutboundEmail({ to, subject, html: prepared.html, text: prepared.text, requireUnsubscribe: true, unsubscribeUrl });
        if (!preflight.ok) {
            console.error('[SystemMail] Preflight failed:', preflight.errors);
            return;
        }

        if (provider === 'google') {
            await sendGmail(accessToken, to, subject, prepared.html, { textBody: prepared.text, unsubscribeUrl });
            console.log(`[SystemMail] ✅ Sent via Gmail to: ${to} | Subject: ${subject}`);
        } else {
            await sendOutlook(accessToken, to, subject, prepared.html, { textBody: prepared.text, unsubscribeUrl });
            console.log(`[SystemMail] ✅ Sent via Outlook to: ${to} | Subject: ${subject}`);
        }
    } catch (error) {
        console.error('[SystemMail] Error sending email:', error);
        // Don't throw - we don't want to break the worker if email fails
        console.log(`[SystemMail] Failed to send: To: ${to} | Subject: ${subject}`);
    }
}

export const notificationService = {
    /**
     * Send Immediate Alert
     */
    sendAlert: async (organizationId: string, title: string, message: string) => {
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!supabaseUrl || !serviceKey) return;

        const supabase = createClient(supabaseUrl, serviceKey, {
            auth: { persistSession: false, autoRefreshToken: false }
        });

        const { data: config } = await supabase
            .from('antonia_config')
            .select('notification_email, instant_alerts_enabled')
            .eq('organization_id', organizationId)
            .maybeSingle();

        if (!config || !config.instant_alerts_enabled || !config.notification_email) {
            return;
        }

        await sendSystemEmail(
            config.notification_email,
            `[ANTONIA ALERT] ${title}`,
            `<p>${message}</p>`,
            organizationId // Pass org ID
        );
    },

    /**
     * Send report HTML to configured recipients
     */
    sendReportEmail: async (organizationId: string, subject: string, html: string) => {
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!supabaseUrl || !serviceKey) return { sent: false, recipients: [] as string[] };

        const supabase = createClient(supabaseUrl, serviceKey, {
            auth: { persistSession: false, autoRefreshToken: false }
        });

        const { data: config } = await supabase
            .from('antonia_config')
            .select('notification_email')
            .eq('organization_id', organizationId)
            .maybeSingle();

        const recipients = parseRecipients(config?.notification_email);
        if (recipients.length === 0) {
            console.warn(`[ReportMail] No recipients configured for org ${organizationId}`);
            return { sent: false, recipients: [] as string[] };
        }

        for (const to of recipients) {
            await sendSystemEmail(to, subject, html, organizationId);
        }

        return { sent: true, recipients };
    },

    /**
     * Generate and Send Daily Report
     */
    sendDailyReport: async (organizationId: string) => {
        console.log(`[DailyReport] Starting report generation for org ${organizationId}`);

        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!supabaseUrl || !serviceKey) return { skipped: true, reason: 'missing_credentials' };

        const supabase = createClient(supabaseUrl, serviceKey, {
            auth: { persistSession: false, autoRefreshToken: false }
        });

        const { data: config } = await supabase
            .from('antonia_config')
            .select('*')
            .eq('organization_id', organizationId)
            .maybeSingle();

        if (!config || !config.daily_report_enabled) {
            console.log(`[DailyReport] Skipping report - dailyReportEnabled: ${config?.daily_report_enabled}`);
            return { skipped: true, reason: 'daily_disabled' };
        }

        const rangeEnd = new Date();
        const rangeStart = new Date(rangeEnd.getTime() - 24 * 60 * 60 * 1000);
        const rangeStartIso = rangeStart.toISOString();
        const rangeEndIso = rangeEnd.toISOString();
        const rangeStartDate = rangeStartIso.split('T')[0];
        const rangeEndDate = rangeEndIso.split('T')[0];
        const rangeLabel = `${rangeStart.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })} ${rangeStart.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })} - ${rangeEnd.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })} ${rangeEnd.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}`;

        const { data: usageRows } = await supabase
            .from('antonia_daily_usage')
            .select('leads_searched, leads_enriched, leads_investigated, search_runs, date')
            .eq('organization_id', organizationId)
            .gte('date', rangeStartDate)
            .lte('date', rangeEndDate);

        const usageTotals = ((usageRows as any[]) || []).reduce((acc: any, row: any) => {
            acc.leadsSearched += Number(row?.leads_searched || 0);
            acc.leadsEnriched += Number(row?.leads_enriched || 0);
            acc.leadsInvestigated += Number(row?.leads_investigated || 0);
            acc.searchRuns += Number(row?.search_runs || 0);
            return acc;
        }, { leadsSearched: 0, leadsEnriched: 0, leadsInvestigated: 0, searchRuns: 0 });

        const { count: tasksCompleted } = await supabase
            .from('antonia_tasks')
            .select('*', { count: 'exact', head: true })
            .eq('organization_id', organizationId)
            .eq('status', 'completed')
            .gte('updated_at', rangeStartIso)
            .lt('updated_at', rangeEndIso);

        const { count: tasksFailed } = await supabase
            .from('antonia_tasks')
            .select('*', { count: 'exact', head: true })
            .eq('organization_id', organizationId)
            .eq('status', 'failed')
            .gte('updated_at', rangeStartIso)
            .lt('updated_at', rangeEndIso);

        const { data: missions } = await supabase
            .from('antonia_missions')
            .select('id, title, status')
            .eq('organization_id', organizationId);

        const { data: activeTasks } = await supabase
            .from('antonia_tasks')
            .select('mission_id, type, status, progress_label, progress_current, progress_total, created_at')
            .eq('organization_id', organizationId)
            .in('status', ['pending', 'processing'])
            .order('created_at', { ascending: false })
            .limit(100);

        const { count: leadsContactedByTable } = await supabase
            .from('contacted_leads')
            .select('*', { count: 'exact', head: true })
            .eq('organization_id', organizationId)
            .gte('created_at', rangeStartIso)
            .lt('created_at', rangeEndIso);

        let replies = 0;
        try {
            const { count } = await supabase
                .from('lead_responses')
                .select('*', { count: 'exact', head: true })
                .eq('organization_id', organizationId)
                .eq('type', 'reply')
                .gte('created_at', rangeStartIso)
                .lt('created_at', rangeEndIso);
            replies = count || 0;
        } catch {
            replies = 0;
        }

        if (replies === 0) {
            const { count: fallbackReplies } = await supabase
                .from('contacted_leads')
                .select('*', { count: 'exact', head: true })
                .eq('organization_id', organizationId)
                .not('replied_at', 'is', null)
                .gte('replied_at', rangeStartIso)
                .lt('replied_at', rangeEndIso);
            replies = fallbackReplies || 0;
        }

        const perMission: Record<string, any> = {};
        const totalsFromEvents = {
            found: 0,
            enrichEmail: 0,
            enrichNoEmail: 0,
            enrichFailed: 0,
            investigated: 0,
            investigateFailed: 0,
            contactedSent: 0,
            contactedBlocked: 0,
            contactedFailed: 0,
        };

        const { data: evs } = await supabase
            .from('antonia_lead_events')
            .select('mission_id, event_type, outcome')
            .eq('organization_id', organizationId)
            .gte('created_at', rangeStartIso)
            .lt('created_at', rangeEndIso)
            .limit(10000);

        for (const e of (evs as any[]) || []) {
            const mid = String(e.mission_id || '').trim();
            if (!mid) continue;
            if (!perMission[mid]) {
                perMission[mid] = {
                    found: 0,
                    enrichEmail: 0,
                    enrichNoEmail: 0,
                    enrichFailed: 0,
                    investigated: 0,
                    investigateFailed: 0,
                    contactedSent: 0,
                    contactedBlocked: 0,
                    contactedFailed: 0,
                };
            }

            const type = String(e.event_type || '');
            const outcome = String(e.outcome || '');

            if (type === 'lead_found') {
                perMission[mid].found++;
                totalsFromEvents.found++;
            }
            if (type === 'lead_enrich_completed') {
                if (outcome === 'email_found') {
                    perMission[mid].enrichEmail++;
                    totalsFromEvents.enrichEmail++;
                } else if (outcome === 'no_email') {
                    perMission[mid].enrichNoEmail++;
                    totalsFromEvents.enrichNoEmail++;
                }
            }
            if (type === 'lead_enrich_failed') {
                perMission[mid].enrichFailed++;
                totalsFromEvents.enrichFailed++;
            }
            if (type === 'lead_investigate_completed') {
                perMission[mid].investigated++;
                totalsFromEvents.investigated++;
            }
            if (type === 'lead_investigate_failed') {
                perMission[mid].investigateFailed++;
                totalsFromEvents.investigateFailed++;
            }
            if (type === 'lead_contact_sent') {
                perMission[mid].contactedSent++;
                totalsFromEvents.contactedSent++;
            }
            if (type === 'lead_contact_blocked') {
                perMission[mid].contactedBlocked++;
                totalsFromEvents.contactedBlocked++;
            }
            if (type === 'lead_contact_failed') {
                perMission[mid].contactedFailed++;
                totalsFromEvents.contactedFailed++;
            }
        }

        const searchRuns = usageTotals.searchRuns;
        const leadsFound = Math.max(usageTotals.leadsSearched, totalsFromEvents.found);
        const leadsEnriched = Math.max(usageTotals.leadsEnriched, totalsFromEvents.enrichEmail + totalsFromEvents.enrichNoEmail);
        const leadsInvestigated = Math.max(usageTotals.leadsInvestigated, totalsFromEvents.investigated);
        const leadsContacted = Math.max(leadsContactedByTable || 0, totalsFromEvents.contactedSent);

        const taskByMission: Record<string, any> = {};
        for (const task of (activeTasks as any[]) || []) {
            const missionId = String(task?.mission_id || '').trim();
            if (!missionId) continue;
            if (!taskByMission[missionId]) taskByMission[missionId] = task;
            else if (taskByMission[missionId].status !== 'processing' && task.status === 'processing') taskByMission[missionId] = task;
        }

        const missionMap = new Map<string, any>();
        for (const mission of (missions as any[]) || []) {
            missionMap.set(String(mission.id), mission);
        }

        const visibleMissionIds = new Set<string>();
        for (const mission of (missions as any[]) || []) {
            const missionId = String(mission.id || '').trim();
            const stats = perMission[missionId];
            const hasStats = Boolean(stats && Object.values(stats).some((value) => Number(value || 0) > 0));
            const hasTask = Boolean(taskByMission[missionId]);
            if (mission.status === 'active' || hasStats || hasTask) visibleMissionIds.add(missionId);
        }
        Object.keys(perMission).forEach((missionId) => visibleMissionIds.add(missionId));
        Object.keys(taskByMission).forEach((missionId) => visibleMissionIds.add(missionId));

        const missionRows: AntoniaDailyMissionRow[] = Array.from(visibleMissionIds)
            .map((missionId) => {
                const mission = missionMap.get(missionId) || { id: missionId, title: `Mision ${missionId.slice(0, 8)}`, status: null };
                const stats = perMission[missionId] || {};
                const task = taskByMission[missionId];
                const progressLabel = task?.progress_label || task?.type || 'Sin ejecucion activa';
                const progressSuffix = (task && typeof task.progress_current === 'number' && typeof task.progress_total === 'number')
                    ? ` (${task.progress_current}/${task.progress_total})`
                    : '';

                return {
                    title: String(mission.title || 'Mision sin titulo'),
                    status: mission.status || null,
                    agentLabel: task ? `${task.status === 'processing' ? 'Procesando' : 'En cola'} · ${progressLabel}${progressSuffix}` : 'Sin ejecucion activa',
                    found: Number(stats.found || 0),
                    enriched: Number((stats.enrichEmail || 0) + (stats.enrichNoEmail || 0)),
                    investigated: Number(stats.investigated || 0),
                    contacted: Number(stats.contactedSent || 0),
                    blocked: Number(stats.contactedBlocked || 0),
                    failed: Number((stats.contactedFailed || 0) + (stats.enrichFailed || 0) + (stats.investigateFailed || 0)),
                };
            })
            .sort((a, b) => (b.contacted * 3 + b.enriched * 2 + b.found) - (a.contacted * 3 + a.enriched * 2 + a.found));

        const html = buildAntoniaDailyDashboardHtml({
            rangeLabel,
            generatedAtLabel: new Date().toLocaleDateString('es-AR', {
                day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit'
            }),
            dashboardUrl: getDashboardUrl(),
            searchRuns,
            leadsFound,
            leadsEnriched,
            leadsInvestigated,
            leadsContacted,
            replies,
            activeMissions: ((missions as any[]) || []).filter((mission: any) => mission?.status === 'active').length,
            tasksCompleted: tasksCompleted || 0,
            tasksFailed: tasksFailed || 0,
            missions: missionRows,
        });

        const summaryData = {
            windowStart: rangeStartIso,
            windowEnd: rangeEndIso,
            searchRuns,
            leadsFound,
            leadsEnriched,
            leadsInvestigated,
            contacted: leadsContacted,
            replies,
            activeMissions: ((missions as any[]) || []).filter((mission: any) => mission?.status === 'active').length,
            tasksCompleted: tasksCompleted || 0,
            tasksFailed: tasksFailed || 0,
            perMission,
            missionRows,
        };

        const { data: reportRow } = await supabase
            .from('antonia_reports')
            .insert({
                organization_id: organizationId,
                mission_id: null,
                type: 'daily',
                content: html,
                summary_data: summaryData,
                sent_to: [],
                created_at: new Date().toISOString(),
            })
            .select('id')
            .single();

        const subject = `[ANTONIA] Reporte Diario · ${rangeStart.toLocaleDateString('es-AR')} - ${rangeEnd.toLocaleDateString('es-AR')}`;
        const sendResult = await notificationService.sendReportEmail(organizationId, subject, html);

        if (reportRow?.id && sendResult?.recipients?.length) {
            await supabase
                .from('antonia_reports')
                .update({ sent_to: sendResult.recipients })
                .eq('id', reportRow.id);
        }

        console.log(`[DailyReport] Summary - Searches: ${searchRuns}, Leads: ${leadsFound}, Enriched: ${leadsEnriched}, Investigated: ${leadsInvestigated}, Contacted: ${leadsContacted}`);
        return {
            reportId: reportRow?.id || null,
            sent: Boolean(sendResult?.sent),
            recipients: sendResult?.recipients || [],
            summary: summaryData,
        };
    }
};
