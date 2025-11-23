
import { supabase } from '@/lib/supabase';
import type { UnifiedRow, ColumnDef } from '@/lib/unified-sheet-types';
import { defaultColumns } from '@/lib/unified-sheet-storage'; // Reusing defaultColumns for now

// Table: unified_crm_data
// Columns: id (text, PK), stage (text), owner (text), notes (text), updated_at (timestamptz)

export type CustomData = Partial<Pick<UnifiedRow, 'stage' | 'owner' | 'notes'>>;

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
                .select('stage, owner, notes')
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
            const { error } = await supabase
                .from(TABLE_NAME)
                .upsert({
                    id: gid,
                    ...patch,
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
            const updates = rows
                .map(r => {
                    const patch: any = { id: r.gid, updated_at: new Date().toISOString() };
                    if (r.stage !== undefined) patch.stage = r.stage;
                    if (r.owner !== undefined) patch.owner = r.owner;
                    if (r.notes !== undefined) patch.notes = r.notes;
                    // Only include if there's actual data to save (besides id/updated_at)
                    if (Object.keys(patch).length > 2) return patch;
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
                .select('id, stage, owner, notes');

            if (error) {
                console.error('[unified-sheet-service] getAllCustom error:', error);
                return {};
            }

            const result: Record<string, CustomData> = {};
            data?.forEach((row: any) => {
                result[row.id] = {
                    stage: row.stage,
                    owner: row.owner,
                    notes: row.notes
                };
            });
            return result;
        } catch (err) {
            console.error('[unified-sheet-service] getAllCustom unexpected error:', err);
            return {};
        }
    }
};
