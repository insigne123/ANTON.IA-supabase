import { createClient } from '@supabase/supabase-js';
import { sendGmail, sendOutlook } from '../server-email-sender';
import { refreshGoogleToken, refreshMicrosoftToken } from '../server-auth-helpers';

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

        if (provider === 'google') {
            await sendGmail(accessToken, to, subject, html);
            console.log(`[SystemMail] ✅ Sent via Gmail to: ${to} | Subject: ${subject}`);
        } else {
            await sendOutlook(accessToken, to, subject, html);
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
            .select('id, title')
            .eq('organization_id', organizationId)
            .eq('status', 'active');

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

        const missionRows = (missions || []).map((m: any) => {
            const s = perMission[String(m.id)] || {};
            return `<tr>
                <td style="padding:10px;border-bottom:1px solid #e2e8f0;font-weight:600;">${m.title}</td>
                <td style="padding:10px;border-bottom:1px solid #e2e8f0;text-align:right;">${s.found || 0}</td>
                <td style="padding:10px;border-bottom:1px solid #e2e8f0;text-align:right;">${(s.enrichEmail || 0) + (s.enrichNoEmail || 0)}</td>
                <td style="padding:10px;border-bottom:1px solid #e2e8f0;text-align:right;">${s.investigated || 0}</td>
                <td style="padding:10px;border-bottom:1px solid #e2e8f0;text-align:right;">${s.contactedSent || 0}</td>
            </tr>`;
        }).join('');

        const html = `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; max-width: 760px; margin: 0 auto; background: #ffffff; border: 1px solid #dbe3ef; border-radius: 14px; overflow: hidden;">
                <div style="padding: 28px; background: linear-gradient(135deg, #0f4c81 0%, #0a7fa4 100%); color: #fff;">
                    <h1 style="margin:0;font-size:28px;">ANTONIA · Reporte Diario</h1>
                    <p style="margin:8px 0 0 0;font-size:13px;opacity:0.92;"><strong>Ventana:</strong> ${rangeLabel}</p>
                </div>

                <div style="padding:18px;background:#f8fafc;border-bottom:1px solid #e2e8f0;display:grid;grid-template-columns:repeat(3,1fr);gap:12px;">
                    ${[
                ['Búsquedas', searchRuns],
                ['Leads Encontrados', leadsFound],
                ['Leads Enriquecidos', leadsEnriched],
                ['Leads Investigados', leadsInvestigated],
                ['Leads Contactados', leadsContacted],
                ['Respuestas', replies],
            ].map(([label, value]) => `<div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:14px;text-align:center;"><div style="font-size:30px;font-weight:800;color:#0f4c81;line-height:1;">${value}</div><div style="margin-top:8px;font-size:11px;color:#475569;text-transform:uppercase;letter-spacing:.7px;font-weight:700;">${label}</div></div>`).join('')}
                </div>

                <div style="padding:22px;">
                    <h2 style="margin:0 0 14px 0;font-size:17px;color:#0f172a;border-bottom:2px solid #e2e8f0;padding-bottom:8px;">Misiones activas (${missions?.length || 0})</h2>
                    <table style="width:100%;border-collapse:collapse;font-size:13px;">
                        <thead>
                            <tr style="background:#f8fafc;color:#334155;text-transform:uppercase;font-size:11px;letter-spacing:.4px;">
                                <th style="padding:10px;text-align:left;border-bottom:1px solid #e2e8f0;">Misión</th>
                                <th style="padding:10px;text-align:right;border-bottom:1px solid #e2e8f0;">Found</th>
                                <th style="padding:10px;text-align:right;border-bottom:1px solid #e2e8f0;">Enriq.</th>
                                <th style="padding:10px;text-align:right;border-bottom:1px solid #e2e8f0;">Invest.</th>
                                <th style="padding:10px;text-align:right;border-bottom:1px solid #e2e8f0;">Contact.</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${missionRows || '<tr><td colspan="5" style="padding:12px;color:#64748b;text-align:center;">Sin actividad por misión en esta ventana.</td></tr>'}
                        </tbody>
                    </table>
                </div>

                <div style="padding:0 22px 22px 22px;">
                    <h2 style="margin:0 0 14px 0;font-size:17px;color:#0f172a;border-bottom:2px solid #e2e8f0;padding-bottom:8px;">Salud del sistema</h2>
                    <p style="margin:0;color:#334155;font-size:14px;">Tareas completadas: <strong>${tasksCompleted || 0}</strong> · Tareas fallidas: <strong style="color:${(tasksFailed || 0) > 0 ? '#b91c1c' : '#166534'}">${tasksFailed || 0}</strong></p>
                </div>

                <div style="background:#0f172a;color:#cbd5e1;text-align:center;font-size:12px;padding:18px;">Reporte automático de ANTONIA · <a href="https://app.antonia.ai/antonia" style="color:#fff;">Ir a Mission Control</a></div>
            </div>
        `;

        const summaryData = {
            windowStart: rangeStartIso,
            windowEnd: rangeEndIso,
            searchRuns,
            leadsFound,
            leadsEnriched,
            leadsInvestigated,
            contacted: leadsContacted,
            replies,
            activeMissions: missions?.length || 0,
            tasksCompleted: tasksCompleted || 0,
            tasksFailed: tasksFailed || 0,
            perMission,
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
