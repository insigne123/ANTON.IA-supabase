import { supabase } from '../supabase';
import { antoniaService } from './antonia-service';
import { sendGmail, sendOutlook } from '../server-email-sender';
import { tokenManager } from './token-manager';

/**
 * Send system email using stored OAuth tokens
 * This function is designed to be called from server-side contexts (workers, cron jobs)
 */
async function sendSystemEmail(to: string, subject: string, html: string) {
    try {
        // Get the user ID from the email address
        // Note: In a real implementation, you'd need to map email -> userId
        // For now, we'll try to find a connected integration for any user
        const { data: tokens, error } = await supabase
            .from('integration_tokens')
            .select('user_id, provider, connected')
            .eq('connected', true)
            .order('updated_at', { ascending: false })
            .limit(1)
            .single();

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
            `<p>${message}</p>`
        );
    },

    /**
     * Generate and Send Daily Report
     */
    sendDailyReport: async (organizationId: string) => {
        const config = await antoniaService.getConfig(organizationId);
        if (!config || !config.dailyReportEnabled || !config.notificationEmail) {
            return;
        }

        // Gather stats for the last 24h
        const yesterday = new Date(Date.now() - 86400000).toISOString();

        // Example: Count tasks completed
        const { count: tasksCompleted } = await supabase
            .from('antonia_tasks')
            .select('*', { count: 'exact', head: true })
            .eq('organization_id', organizationId)
            .eq('status', 'completed')
            .gte('updated_at', yesterday);

        const html = `
            <h1>Daily Briefing from ANTONIA</h1>
            <p>Here is what I accomplished in the last 24 hours:</p>
            <ul>
                <li>Tasks Completed: ${tasksCompleted || 0}</li>
            </ul>
            <p><a href="https://app.antonia.ai/antonia">Go to Mission Control</a></p>
        `;

        await sendSystemEmail(
            config.notificationEmail,
            `[ANTONIA] Daily Report`,
            html
        );
    }
};
