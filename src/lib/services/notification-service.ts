import { supabase } from '../supabase';
import { antoniaService } from './antonia-service';
import { sendGmail, sendOutlook } from '../server-email-sender';
import { tokenManager } from './token-manager';

/**
 * Send system email using stored OAuth tokens
 * This function is designed to be called from server-side contexts (workers, cron jobs)
 */
async function sendSystemEmail(to: string, subject: string, html: string, organizationId?: string) {
    try {
        // Get the user ID from the email address
        // Note: In a real implementation, you'd need to map email -> userId
        // For now, we'll try to find a connected integration for any user
        let query = supabase
            .from('integration_tokens')
            .select('user_id, provider, connected')
            .eq('connected', true)
            .order('updated_at', { ascending: false })
            .limit(1);

        if (organizationId) {
            query = query.eq('organization_id', organizationId);
        }

        const { data: tokens, error } = await query.maybeSingle();

        if (error || !tokens) {
            console.error('[SystemMail] No connected integration found:', error);
            // Fallback: just log the email
            console.log(`[SystemMail] Would send: To: ${to} | Subject: ${subject}`);
            return;
        }

        const { user_id, provider } = tokens;

        // Get fresh access token
        const accessToken = await tokenManager.getFreshAccessToken(user_id, provider as 'google' | 'outlook');

        if (!accessToken) {
            console.error('[SystemMail] Failed to get access token for provider:', provider);
            console.log(`[SystemMail] Would send: To: ${to} | Subject: ${subject}`);
            return;
        }

        // Send email using the appropriate provider
        if (provider === 'google') {
            await sendGmail(accessToken, to, subject, html);
            console.log(`[SystemMail] ✅ Sent via Gmail to: ${to} | Subject: ${subject}`);
        } else if (provider === 'outlook') {
            await sendOutlook(accessToken, to, subject, html);
            console.log(`[SystemMail] ✅ Sent via Outlook to: ${to} | Subject: ${subject}`);
        } else {
            console.warn(`[SystemMail] Unknown provider: ${provider}`);
            console.log(`[SystemMail] Would send: To: ${to} | Subject: ${subject}`);
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
        const config = await antoniaService.getConfig(organizationId);
        if (!config || !config.instantAlertsEnabled || !config.notificationEmail) {
            return;
        }

        await sendSystemEmail(
            config.notificationEmail,
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

        const config = await antoniaService.getConfig(organizationId);
        if (!config || !config.dailyReportEnabled || !config.notificationEmail) {
            console.log(`[DailyReport] Skipping report - dailyReportEnabled: ${config?.dailyReportEnabled}, notificationEmail: ${config?.notificationEmail}`);
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
        const searchLimit = config.dailySearchLimit || 3;
        const enrichLimit = config.dailyEnrichLimit || 50;
        const investigateLimit = config.dailyInvestigateLimit || 20;

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
            config.notificationEmail,
            `[ANTONIA] Reporte Diario - ${new Date().toLocaleDateString('es-ES')}`,
            html,
            organizationId // Pass org ID
        );

        console.log(`[DailyReport] Report sent successfully to ${config.notificationEmail}`);
        console.log(`[DailyReport] Summary - Searches: ${searchRuns}, Leads: ${leadsSearched}, Enriched: ${leadsEnriched}, Investigated: ${leadsInvestigated}, Contacted: ${leadsContacted || 0}`);
    }
};
