import { addDays, isWeekend, startOfTomorrow, setHours, setMinutes } from 'date-fns';
import { ContactedLead } from '../types';
import { contactedLeadsStorage } from './contacted-leads-service';

export interface ScheduleConfig {
    startDate: Date;
    msgsPerDay: number;
    skipWeekends: boolean;
    channel: 'linkedin' | 'email';
}

export type LeadToSchedule = {
    id: string; // lead id (enriched lead id)
    name: string;
    email?: string;
    linkedinUrl?: string; // required if channel is linkedin
    company?: string;
    role?: string;
    industry?: string;
};

export const plannerService = {
    /**
     * Distributes leads across valid weekdays starting from startDate.
     * Returns a list of ContactedLead objects prepared for insertion (with status='scheduled').
     */
    calculateSchedule: (leads: LeadToSchedule[], config: ScheduleConfig) => {
        const { startDate, msgsPerDay, skipWeekends, channel } = config;

        const scheduledItems: Partial<ContactedLead>[] = [];
        let currentDate = startDate;
        let dailyCount = 0;

        // Normalize start time to 10:00 AM for consistency
        currentDate = setHours(setMinutes(currentDate, 0), 10);

        for (const lead of leads) {
            if (skipWeekends) {
                while (isWeekend(currentDate)) {
                    currentDate = addDays(currentDate, 1);
                }
            }

            // Prepare item
            scheduledItems.push({
                leadId: lead.id,
                name: lead.name,
                email: lead.email || '',
                company: lead.company,
                role: lead.role,
                industry: lead.industry,
                status: 'scheduled',
                provider: channel === 'linkedin' ? 'linkedin' : 'gmail', // default provider
                scheduledAt: currentDate.toISOString(),
                subject: channel === 'linkedin' ? 'LinkedIn DM' : 'Campaign Email',
                linkedinThreadUrl: lead.linkedinUrl, // store url here for reference
                linkedinMessageStatus: 'queued'
            });

            dailyCount++;

            // Move to next day if limit reached
            if (dailyCount >= msgsPerDay) {
                currentDate = addDays(currentDate, 1);
                dailyCount = 0;
            }
        }

        return scheduledItems;
    },

    /**
     * Persists the schedule to DB
     */
    saveSchedule: async (items: Partial<ContactedLead>[]) => {
        let savedCount = 0;
        for (const item of items) {
            // We use 'add' from storage which expects a full ContactedLead but handles partials if we are careful or cast.
            // Better to ensure it has mandatory fields.
            // In real app, we might want a bulk insert for performance.
            await contactedLeadsStorage.add(item as ContactedLead);
            savedCount++;
        }
        return savedCount;
    }
};
