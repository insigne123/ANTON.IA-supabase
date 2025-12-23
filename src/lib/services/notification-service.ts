import { supabase } from '../supabase';
import { antoniaService } from './antonia-service';
// In a server environment (Firebase Functions), we might use Nodemailer directly.
// In Next.js client/edge, we might use an API route that wraps Nodemailer/Resend.
// For now, let's assume we have a generic 'sendEmail' utility or usage of existing mailer.

// We'll define a simple interface for the "System Mailer" 
// (the system sending emails to the user, not the user sending emails to leads)

async function sendSystemEmail(to: string, subject: string, html: string) {
    // This implies we have a way to send transactional emails (Resend, SendGrid, etc.)
    // For now, we'll log it or use a placeholder API call.
    console.log(`[SystemMail] To: ${to} | Subject: ${subject}`);

    // Example: Call our own internal API
    // await fetch('https://api.myapp.com/system-mail', { ... })
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
