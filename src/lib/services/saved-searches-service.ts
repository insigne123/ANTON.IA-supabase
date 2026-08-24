import { supabase } from '@/lib/supabase';
import { SavedSearch } from '@/lib/types';
import { organizationService } from './organization-service';
import {
    normalizeSavedSearchCriteria,
    normalizeSavedSearchName,
    savedSearchNamesMatch,
    serializeSavedSearchCriteria,
} from '@/lib/search/saved-search-criteria';

export class DuplicateSavedSearchNameError extends Error {
    constructor(name: string) {
        super(`Ya existe una búsqueda guardada llamada "${name}".`);
        this.name = 'DuplicateSavedSearchNameError';
    }
}

function mapSavedSearch(row: any): SavedSearch {
    const relatedUser = Array.isArray(row?.user) ? row.user[0] : row?.user;
    return {
        id: row.id,
        organizationId: row.organization_id,
        userId: row.user_id,
        name: normalizeSavedSearchName(row.name),
        criteria: normalizeSavedSearchCriteria(row.criteria),
        isShared: Boolean(row.is_shared),
        createdAt: row.created_at,
        user: {
            fullName: relatedUser?.full_name || 'Usuario',
            avatarUrl: relatedUser?.avatar_url,
        },
    };
}

export const savedSearchesService = {
    async getSavedSearches(): Promise<SavedSearch[]> {
        const { data, error } = await supabase
            .from('saved_searches')
            .select(`
        *,
        user:profiles!saved_searches_user_id_fkey (
          full_name,
          avatar_url
        )
      `)
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Error fetching saved searches:', error);
            throw new Error('No se pudieron cargar las búsquedas guardadas.');
        }

        return (data || []).map(mapSavedSearch);
    },

    async saveSearch(name: string, criteria: unknown, isShared: boolean): Promise<SavedSearch> {
        const normalizedName = normalizeSavedSearchName(name);
        if (!normalizedName) throw new Error('Escribe un nombre para la búsqueda.');

        const orgId = await organizationService.getCurrentOrganizationId();
        if (!orgId) throw new Error('No organization found');

        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('No user found');

        const { data: existing, error: duplicateCheckError } = await supabase
            .from('saved_searches')
            .select('id, name')
            .eq('organization_id', orgId)
            .eq('user_id', user.id);

        if (duplicateCheckError) {
            console.error('Error checking saved search name:', duplicateCheckError);
            throw new Error('No se pudo validar el nombre de la búsqueda.');
        }
        if ((existing || []).some((row: any) => savedSearchNamesMatch(row.name, normalizedName))) {
            throw new DuplicateSavedSearchNameError(normalizedName);
        }

        const { data, error } = await supabase
            .from('saved_searches')
            .insert({
                organization_id: orgId,
                user_id: user.id,
                name: normalizedName,
                criteria: serializeSavedSearchCriteria(criteria),
                is_shared: isShared,
            })
            .select(`
        *,
        user:profiles!saved_searches_user_id_fkey (
          full_name,
          avatar_url
        )
      `)
            .single();

        if (error) {
            console.error('Error saving search:', error);
            if (error.code === '23505') throw new DuplicateSavedSearchNameError(normalizedName);
            throw new Error('No se pudo guardar la búsqueda.');
        }

        if (!data) throw new Error('La búsqueda no devolvió una confirmación válida.');
        return mapSavedSearch(data);
    },

    async deleteSearch(id: string): Promise<boolean> {
        const { data, error } = await supabase
            .from('saved_searches')
            .delete()
            .eq('id', id)
            .select('id');

        if (error) {
            console.error('Error deleting saved search:', error);
            throw new Error('No se pudo eliminar la búsqueda guardada.');
        }
        if (!data || data.length === 0) throw new Error('La búsqueda guardada no se eliminó.');
        return true;
    }
};
