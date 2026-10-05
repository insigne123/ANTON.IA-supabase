
import { supabase } from '@/lib/supabase';
import type { UnifiedRow, ColumnDef } from '@/lib/unified-sheet-types';
import { loadColumns, saveColumns } from '@/lib/unified-sheet-storage';

// Table: unified_crm_data
// Columns: id (text, PK), stage (text), owner (text), notes (text), updated_at (timestamptz)

export type CustomData = Partial<Pick<UnifiedRow, 'stage' | 'owner' | 'notes' | 'nextAction' | 'nextActionType' | 'nextActionDueAt' | 'autopilotStatus' | 'lastAutopilotEvent' | 'meetingLink'
    | 'dealValue' | 'dealCurrency' | 'stageChangedAt' | 'wonAt' | 'lostAt'>> & { updated_at?: string };

const TABLE_NAME = 'unified_crm_data';

export const unifiedSheetService = {
    // --- Columns (UI State) ---
    // Keeping columns in localStorage for now as it is UI preference.
    // If needed, we can migrate this to a 'user_settings' table later.
    loadColumns: (): ColumnDef[] => {
        return loadColumns();
    },

    saveColumns: (cols: ColumnDef[]) => {
        return saveColumns(cols);
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
            return {
                stage: data.stage,
                owner: data.owner,
                notes: data.notes,
                nextAction: data.next_action,
                nextActionType: data.next_action_type,
                nextActionDueAt: data.next_action_due_at,
                autopilotStatus: data.autopilot_status,
                lastAutopilotEvent: data.last_autopilot_event,
                meetingLink: data.meeting_link,
            };
        } catch (err) {
            console.error('[unified-sheet-service] getCustom unexpected error:', err);
            return undefined;
        }
    },

    async setCustom(gid: string, patch: CustomData): Promise<void> {
        try {
            const { data: { user }, error: authError } = await supabase.auth.getUser();
            if (authError) throw authError;
            if (!user) throw new Error('Debes iniciar sesión para guardar cambios.');

            const orgId = await require('./organization-service').organizationService.getCurrentOrganizationId();
            if (!orgId) throw new Error('No se encontró una organización activa.');

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
                throw error;
            }
        } catch (err) {
            console.error('[unified-sheet-service] setCustom unexpected error:', err);
            throw err;
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
    // `strict` throws when the read fails, for screens that must tell an error from an empty list.
    async getAllCustom(options: { strict?: boolean; dealValues?: boolean } = {}): Promise<Record<string, CustomData>> {
        try {
            const columns = 'id, stage, owner, notes, next_action, next_action_type, next_action_due_at, autopilot_status, last_autopilot_event, meeting_link, updated_at';
            // The value of each deal (Plan 11, PR 4c) only when CRM_DEAL_VALUES_ENABLED asks for it.
            const read = (deal: boolean) => supabase
                .from(TABLE_NAME)
                .select(deal ? `${columns}, deal_value, deal_currency, stage_changed_at, won_at, lost_at` : columns);
            let { data, error } = await read(Boolean(options.dealValues));
            // The switch went on before the migration that adds those columns (42703: no such column): read without them.
            if (error && options.dealValues && error.code === '42703') {
                console.warn('[unified-sheet-service] getAllCustom: the deal value columns are missing, reading without them');
                ({ data, error } = await read(false));
            }

            if (error) {
                console.error('[unified-sheet-service] getAllCustom error:', error);
                if (options.strict) throw error;
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
                    ...(options.dealValues && 'deal_value' in row ? {
                        dealValue: row.deal_value === null ? null : Number(row.deal_value),
                        dealCurrency: row.deal_currency ?? null,
                        stageChangedAt: row.stage_changed_at ?? null,
                        wonAt: row.won_at ?? null,
                        lostAt: row.lost_at ?? null,
                    } : {}),
                    updated_at: row.updated_at
                };
            });
            return result;
        } catch (err) {
            console.error('[unified-sheet-service] getAllCustom unexpected error:', err);
            if (options.strict) throw err;
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
    // The value of the deal (Plan 11, PR 4c). When it changed stage, was won or lost is written by the database itself.
    if (patch.dealValue !== undefined) out.deal_value = patch.dealValue;
    if (patch.dealCurrency !== undefined) out.deal_currency = patch.dealCurrency;
    if (patch.updated_at !== undefined) out.updated_at = patch.updated_at;
    return out;
}
