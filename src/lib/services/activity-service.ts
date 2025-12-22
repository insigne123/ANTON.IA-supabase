import { contactedLeadsStorage } from './contacted-leads-service';
import { unifiedSheetService } from './unified-sheet-service';
import type { Activity, ActivityType } from '../crm-types';
import { v4 as uuidv4 } from 'uuid';

export const activityService = {
    async getLeadActivities(leadId: string, unifiedGid?: string, email?: string): Promise<Activity[]> {
        const activities: Activity[] = [];

        try {
            // 1. Fetch Emails (Contacted History)
            // Try by leadId first, then by email if no results
            let emails = await contactedLeadsStorage.findAllByLeadId(leadId);

            if (emails.length === 0 && email) {
                emails = await contactedLeadsStorage.findAllByEmail(email);
            }

            for (const email of emails) {
                if (email.sentAt) {
                    activities.push({
                        id: `email_sent_${email.id}`,
                        leadId,
                        type: 'email',
                        title: `Email enviado: ${email.subject}`,
                        description: `Provider: ${email.provider}`,
                        createdAt: email.sentAt,
                        metadata: { messageId: email.messageId, status: email.status }
                    });
                }

                if (email.repliedAt) {
                    activities.push({
                        id: `email_replied_${email.id}`,
                        leadId,
                        type: 'email',
                        title: 'Respuesta recibida',
                        description: email.replyPreview || 'El lead respondió al correo.',
                        createdAt: email.repliedAt,
                        metadata: { status: 'replied' }
                    });
                }

                // Opened events (optional, maybe noisy for main timeline)
                if (email.openedAt && !email.repliedAt) {
                    activities.push({
                        id: `email_opened_${email.id}`,
                        leadId,
                        type: 'enrichment', // Using enrichment/info type for passive actions
                        title: 'Correo abierto',
                        description: `El lead abrió el correo "${email.subject}"`,
                        createdAt: email.openedAt,
                        metadata: { clickCount: email.clickCount }
                    });
                }
            }
        } catch (error) {
            console.error('[activityService] Error fetching emails:', error);
        }

        // 2. Fetch Notes from Unified Data (if unifiedGid provided)
        if (unifiedGid) {
            try {
                const custom = await unifiedSheetService.getCustom(unifiedGid);
                if (custom?.notes) {
                    activities.push({
                        id: `note_${unifiedGid}`,
                        leadId,
                        unifiedGid,
                        type: 'note',
                        title: 'Nota guardada',
                        description: custom.notes,
                        createdAt: new Date().toISOString(),
                    });
                }
            } catch (error) {
                console.error('[activityService] Error fetching notes:', error);
            }
        }

        // Sort by date desc
        return activities.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }
};
