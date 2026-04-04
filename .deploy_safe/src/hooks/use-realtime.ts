import { useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { RealtimePostgresChangesPayload } from '@supabase/supabase-js';

export function useRealtime(
    table: string,
    event: 'INSERT' | 'UPDATE' | 'DELETE' | '*',
    callback: (payload: RealtimePostgresChangesPayload<any>) => void,
    filter?: string
) {
    useEffect(() => {
        const channel = supabase
            .channel(`public:${table}:${filter || 'all'}`)
            .on(
                'postgres_changes' as any,
                { event, schema: 'public', table, filter },
                (payload: RealtimePostgresChangesPayload<any>) => {
                    console.log('Realtime event received:', payload);
                    callback(payload);
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [table, event, filter, callback]);
}
