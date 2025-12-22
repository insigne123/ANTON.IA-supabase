import { contactedLeadsStorage } from './contacted-leads-service';
import { unifiedSheetService } from './unified-sheet-service';
import type { Activity, ActivityType } from '../crm-types';
import { v4 as uuidv4 } from 'uuid';

export const activityService = {
    async getLeadActivities(leadId: string, unifiedGid?: string): Promise<Activity[]> {
        const activities: Activity[] = [];

        // 1. Fetch Emails (Contacted History)
        // We try to fetch by leadId first
        const emails = await contactedLeadsStorage.findAllByLeadId(leadId);

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

        // 2. Fetch Notes from Unified Data (if unifiedGid provided)
        if (unifiedGid) {
            const custom = await unifiedSheetService.getCustom(unifiedGid);
            if (custom?.notes) {
                // We don't have a timestamp for the note specifically, using current time or updated_at if available in your future schema
                // For now, we just present it. To be consistent with timeline, we might want a "pinned" approach or just put it at 
                // a default recent date? Or maybe we shouldn't mix static notes with timeline.
                // Let's treat it as a "Note activity" for now, maybe with a specialized ID.
                activities.push({
                    id: `note_${unifiedGid}`,
                    leadId,
                    unifiedGid,
                    type: 'note',
                    title: 'Nota guardada',
                    description: custom.notes,
                    createdAt: new Date().toISOString(), // Rough approximation or we need 'updated_at' from custom data
                });
            }
        }

        // Sort by date desc
        return activities.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }
};
