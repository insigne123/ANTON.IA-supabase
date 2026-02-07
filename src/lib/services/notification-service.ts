import { createClient } from '@supabase/supabase-js';
import { sendGmail, sendOutlook } from '../server-email-sender';
import { refreshGoogleToken, refreshMicrosoftToken } from '../server-auth-helpers';

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
     * Generate and Send Daily Report
     */
    sendDailyReport: async (organizationId: string) => {
        console.log(`[DailyReport] Starting report generation for org ${organizationId}`);

        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!supabaseUrl || !serviceKey) return;

        const supabase = createClient(supabaseUrl, serviceKey, {
            auth: { persistSession: false, autoRefreshToken: false }
        });

        const { data: config } = await supabase
            .from('antonia_config')
            .select('*')
            .eq('organization_id', organizationId)
            .maybeSingle();

        if (!config || !config.daily_report_enabled || !config.notification_email) {
            console.log(`[DailyReport] Skipping report - dailyReportEnabled: ${config?.daily_report_enabled}, notificationEmail: ${config?.notification_email}`);
            return;
        }

        // Gather stats for the last 24h
        const yesterday = new Date(Date.now() - 86400000).toISOString();
        const yesterdayDate = yesterday.split('T')[0];

        // 1. Get daily usage metrics
        const { data: usage } = await supabase
            .from('antonia_daily_usage')
            .select('*')
            .eq('organization_id', organizationId)
            .eq('date', yesterdayDate)
            .single();

        const leadsSearched = usage?.leads_searched || 0;
        const leadsEnriched = usage?.leads_enriched || 0;
        const leadsInvestigated = usage?.leads_investigated || 0;
        const searchRuns = usage?.search_runs || 0;

        console.log(`[DailyReport] Daily usage metrics for ${yesterdayDate}:`, {
            leadsSearched,
            leadsEnriched,
            leadsInvestigated,
            searchRuns
        });

        // 2. Count tasks completed
        const { count: tasksCompleted } = await supabase
            .from('antonia_tasks')
            .select('*', { count: 'exact', head: true })
            .eq('organization_id', organizationId)
            .eq('status', 'completed')
            .gte('updated_at', yesterday);

        // 3. Count failed tasks
        const { count: tasksFailed } = await supabase
            .from('antonia_tasks')
            .select('*', { count: 'exact', head: true })
            .eq('organization_id', organizationId)
            .eq('status', 'failed')
            .gte('updated_at', yesterday);

        // 4. Count active missions
        const { count: activeMissions } = await supabase
            .from('antonia_missions')
            .select('*', { count: 'exact', head: true })
            .eq('organization_id', organizationId)
            .eq('status', 'active');

        // 5. Count contacted leads (emails queued/sent)
        const { count: leadsContacted } = await supabase
            .from('contacted_leads')
            .select('*', { count: 'exact', head: true })
            .eq('organization_id', organizationId)
            .gte('created_at', yesterday);

        console.log(`[DailyReport] Contacted leads count: ${leadsContacted || 0}`);
        console.log(`[DailyReport] Tasks - Completed: ${tasksCompleted || 0}, Failed: ${tasksFailed || 0}`);
        console.log(`[DailyReport] Active missions: ${activeMissions || 0}`);

        // 6. Get daily limits from config
        const searchLimit = config.daily_search_limit || 3;
        const enrichLimit = config.daily_enrich_limit || 50;
        const investigateLimit = config.daily_investigate_limit || 20;

        // Calculate remaining capacity
        const searchRemaining = Math.max(0, searchLimit - searchRuns);
        const enrichRemaining = Math.max(0, enrichLimit - leadsEnriched);
        const investigateRemaining = Math.max(0, investigateLimit - leadsInvestigated);

        const html = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h1 style="color: #2563eb;">📊 Reporte Diario de ANTONIA</h1>
                <p style="color: #64748b;">Aquí está el resumen de actividad de las últimas 24 horas:</p>
                
                <h2 style="color: #334155; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px;">Actividad de Leads</h2>
                <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
                    <tr style="background-color: #f8fafc;">
                        <td style="padding: 12px; border: 1px solid #e2e8f0;"><strong>Búsquedas Ejecutadas</strong></td>
                        <td style="padding: 12px; border: 1px solid #e2e8f0; text-align: right;">${searchRuns}</td>
                    </tr>
                    <tr>
                        <td style="padding: 12px; border: 1px solid #e2e8f0;"><strong>Leads Encontrados</strong></td>
                        <td style="padding: 12px; border: 1px solid #e2e8f0; text-align: right;">${leadsSearched}</td>
                    </tr>
                    <tr style="background-color: #f8fafc;">
                        <td style="padding: 12px; border: 1px solid #e2e8f0;"><strong>Leads Enriquecidos</strong></td>
                        <td style="padding: 12px; border: 1px solid #e2e8f0; text-align: right;">${leadsEnriched}</td>
                    </tr>
                    <tr>
                        <td style="padding: 12px; border: 1px solid #e2e8f0;"><strong>Investigaciones Profundas</strong></td>
                        <td style="padding: 12px; border: 1px solid #e2e8f0; text-align: right;">${leadsInvestigated}</td>
                    </tr>
                    <tr style="background-color: #f8fafc;">
                        <td style="padding: 12px; border: 1px solid #e2e8f0;"><strong>Leads Contactados</strong></td>
                        <td style="padding: 12px; border: 1px solid #e2e8f0; text-align: right;">${leadsContacted || 0}</td>
                    </tr>
                </table>

                <h2 style="color: #334155; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px;">Estado del Sistema</h2>
                <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
                    <tr style="background-color: #f8fafc;">
                        <td style="padding: 12px; border: 1px solid #e2e8f0;"><strong>Misiones Activas</strong></td>
                        <td style="padding: 12px; border: 1px solid #e2e8f0; text-align: right;">${activeMissions || 0}</td>
                    </tr>
                    <tr>
                        <td style="padding: 12px; border: 1px solid #e2e8f0;"><strong>Tareas Completadas</strong></td>
                        <td style="padding: 12px; border: 1px solid #e2e8f0; text-align: right;">${tasksCompleted || 0}</td>
                    </tr>
                    ${tasksFailed && tasksFailed > 0 ? `
                    <tr style="background-color: #fef2f2;">
                        <td style="padding: 12px; border: 1px solid #e2e8f0;"><strong>⚠️ Tareas Fallidas</strong></td>
                        <td style="padding: 12px; border: 1px solid #e2e8f0; text-align: right; color: #dc2626;">${tasksFailed}</td>
                    </tr>
                    ` : ''}
                </table>

                <h2 style="color: #334155; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px;">Capacidad Restante Hoy</h2>
                <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
                    <tr style="background-color: #f8fafc;">
                        <td style="padding: 12px; border: 1px solid #e2e8f0;"><strong>Búsquedas</strong></td>
                        <td style="padding: 12px; border: 1px solid #e2e8f0; text-align: right;">${searchRemaining} de ${searchLimit}</td>
                    </tr>
                    <tr>
                        <td style="padding: 12px; border: 1px solid #e2e8f0;"><strong>Enriquecimientos</strong></td>
                        <td style="padding: 12px; border: 1px solid #e2e8f0; text-align: right;">${enrichRemaining} de ${enrichLimit}</td>
                    </tr>
                    <tr style="background-color: #f8fafc;">
                        <td style="padding: 12px; border: 1px solid #e2e8f0;"><strong>Investigaciones</strong></td>
                        <td style="padding: 12px; border: 1px solid #e2e8f0; text-align: right;">${investigateRemaining} de ${investigateLimit}</td>
                    </tr>
                </table>

                <div style="margin-top: 30px; padding: 20px; background-color: #f0f9ff; border-left: 4px solid #2563eb; border-radius: 4px;">
                    <p style="margin: 0; color: #1e40af;">
                        <strong>💡 Consejo:</strong> ${tasksFailed && tasksFailed > 0
                ? 'Revisa las tareas fallidas en el panel de control para resolver cualquier problema.'
                : 'Todo funcionando correctamente. ¡Sigue así!'}
                    </p>
                </div>

                <p style="text-align: center; margin-top: 30px;">
                    <a href="https://app.antonia.ai/antonia" style="display: inline-block; padding: 12px 24px; background-color: #2563eb; color: white; text-decoration: none; border-radius: 6px; font-weight: bold;">
                        Ir a Mission Control
                    </a>
                </p>

                <p style="text-align: center; color: #94a3b8; font-size: 12px; margin-top: 20px;">
                    Este es un reporte automático de ANTONIA. Para desactivarlo, ve a Configuración.
                </p>
            </div>
        `;

        await sendSystemEmail(
            config.notification_email,
            `[ANTONIA] Reporte Diario - ${new Date().toLocaleDateString('es-ES')}`,
            html,
            organizationId // Pass org ID
        );

        console.log(`[DailyReport] Report sent successfully to ${config.notification_email}`);
        console.log(`[DailyReport] Summary - Searches: ${searchRuns}, Leads: ${leadsSearched}, Enriched: ${leadsEnriched}, Investigated: ${leadsInvestigated}, Contacted: ${leadsContacted || 0}`);
    }
};
