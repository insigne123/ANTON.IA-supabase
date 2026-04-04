
import { supabase } from '@/lib/supabase';
import type { UnifiedRow, ColumnDef } from '@/lib/unified-sheet-types';
import { defaultColumns } from '@/lib/unified-sheet-storage'; // Reusing defaultColumns for now

// Table: unified_crm_data
// Columns: id (text, PK), stage (text), owner (text), notes (text), updated_at (timestamptz)

export type CustomData = Partial<Pick<UnifiedRow, 'stage' | 'owner' | 'notes' | 'nextAction' | 'nextActionType' | 'nextActionDueAt' | 'autopilotStatus' | 'lastAutopilotEvent' | 'meetingLink'>> & { updated_at?: string };

const TABLE_NAME = 'unified_crm_data';

export const unifiedSheetService = {
    // --- Columns (UI State) ---
    // Keeping columns in localStorage for now as it is UI preference.
    // If needed, we can migrate this to a 'user_settings' table later.
    loadColumns: (): ColumnDef[] => {
        return require('@/lib/unified-sheet-storage').loadColumns();
    },

    saveColumns: (cols: ColumnDef[]) => {
        return require('@/lib/unified-sheet-storage').saveColumns(cols);
    },

    // --- Custom Data (Business Data) ---

    async getCustom(gid: string): Promise<CustomData | undefined> {
        try {
            const { data, error } = await supabase
                .from(TABLE_NAME)
                .select('stage, owner, notes, next_action, next_action_type, next_action_due_at, autopilot_status, last_autopilot_event, meeting_link')
                .eq('id', gid)
                .single();

            if (error) {
                if (error.code === 'PGRST116') return undefined; // Not found
                console.error('[unified-sheet-service] getCustom error:', error);
                return undefined;
            }
            return data as CustomData;
        } catch (err) {
            console.error('[unified-sheet-service] getCustom unexpected error:', err);
            return undefined;
        }
    },

    async setCustom(gid: string, patch: CustomData): Promise<void> {
        try {
            // Upsert
            const { data: { user } } = await supabase.auth.getUser();
            const orgId = await require('./organization-service').organizationService.getCurrentOrganizationId();

            if (!user) return;

            const { error } = await supabase
                .from(TABLE_NAME)
                .upsert({
                    id: gid,
                    ...mapCustomPatchToDb(patch),
                    organization_id: orgId, // Ensure data is owned by org
                    updated_at: new Date().toISOString(),
                });

            if (error) {
                console.error('[unified-sheet-service] setCustom error:', error);
            }
        } catch (err) {
            console.error('[unified-sheet-service] setCustom unexpected error:', err);
        }
    },

    async bulkSetCustom(rows: UnifiedRow[]): Promise<void> {
        try {
            const { data: { user } } = await supabase.auth.getUser();
            const orgId = await require('./organization-service').organizationService.getCurrentOrganizationId();
            if (!user) return;

            const updates = rows
                .map(r => {
                    const patch: any = { id: r.gid, updated_at: new Date().toISOString(), organization_id: orgId };
                    if (r.stage !== undefined) patch.stage = r.stage;
                    if (r.owner !== undefined) patch.owner = r.owner;
                    if (r.notes !== undefined) patch.notes = r.notes;
                    if (r.nextAction !== undefined) patch.next_action = r.nextAction;
                    if (r.nextActionType !== undefined) patch.next_action_type = r.nextActionType;
                    if (r.nextActionDueAt !== undefined) patch.next_action_due_at = r.nextActionDueAt;
                    if (r.autopilotStatus !== undefined) patch.autopilot_status = r.autopilotStatus;
                    if (r.lastAutopilotEvent !== undefined) patch.last_autopilot_event = r.lastAutopilotEvent;
                    if (r.meetingLink !== undefined) patch.meeting_link = r.meetingLink;
                    // Only include if there's actual data to save (besides id/updated_at)
                    if (Object.keys(patch).length > 3) return patch; // >3 because id, updated_at, orgId
                    return null;
                })
                .filter(Boolean);

            if (updates.length === 0) return;

            const { error } = await supabase
                .from(TABLE_NAME)
                .upsert(updates);

            if (error) {
                console.error('[unified-sheet-service] bulkSetCustom error:', error);
            }
        } catch (err) {
            console.error('[unified-sheet-service] bulkSetCustom unexpected error:', err);
        }
    },

    // Helper to fetch all custom data at once (e.g. for initial load of a page)
    // This is more efficient than calling getCustom for each row.
    async getAllCustom(): Promise<Record<string, CustomData>> {
        try {
            const { data, error } = await supabase
                .from(TABLE_NAME)
                .select('id, stage, owner, notes, next_action, next_action_type, next_action_due_at, autopilot_status, last_autopilot_event, meeting_link, updated_at');

            if (error) {
                console.error('[unified-sheet-service] getAllCustom error:', error);
                return {};
            }

            const result: Record<string, CustomData> = {};
            data?.forEach((row: any) => {
                result[row.id] = {
                    stage: row.stage,
                    owner: row.owner,
                    notes: row.notes,
                    nextAction: row.next_action,
                    nextActionType: row.next_action_type,
                    nextActionDueAt: row.next_action_due_at,
                    autopilotStatus: row.autopilot_status,
                    lastAutopilotEvent: row.last_autopilot_event,
                    meetingLink: row.meeting_link,
                    updated_at: row.updated_at
                };
            });
            return result;
        } catch (err) {
            console.error('[unified-sheet-service] getAllCustom unexpected error:', err);
            return {};
        }
    }
};

function mapCustomPatchToDb(patch: CustomData) {
    const out: Record<string, any> = {};
    if (patch.stage !== undefined) out.stage = patch.stage;
    if (patch.owner !== undefined) out.owner = patch.owner;
    if (patch.notes !== undefined) out.notes = patch.notes;
    if (patch.nextAction !== undefined) out.next_action = patch.nextAction;
    if (patch.nextActionType !== undefined) out.next_action_type = patch.nextActionType;
    if (patch.nextActionDueAt !== undefined) out.next_action_due_at = patch.nextActionDueAt;
    if (patch.autopilotStatus !== undefined) out.autopilot_status = patch.autopilotStatus;
    if (patch.lastAutopilotEvent !== undefined) out.last_autopilot_event = patch.lastAutopilotEvent;
    if (patch.meetingLink !== undefined) out.meeting_link = patch.meetingLink;
    if (patch.updated_at !== undefined) out.updated_at = patch.updated_at;
    return out;
}
