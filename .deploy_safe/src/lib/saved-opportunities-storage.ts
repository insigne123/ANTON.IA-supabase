import { supabase } from './supabase';
import type { JobOpportunity } from './types';
import { organizationService } from './services/organization-service';

const TABLE = 'saved_opportunities';

// Helper to map DB row to JobOpportunity
function mapRowToOpp(row: any): JobOpportunity {
  return {
    id: row.id,
    title: row.title,
    companyName: row.company_name,
    companyLinkedinUrl: row.company_linkedin_url,
    companyDomain: row.company_domain,
    location: row.location,
    publishedAt: row.published_at,
    postedTime: row.posted_time,
    jobUrl: row.job_url,
    applyUrl: row.apply_url,
    descriptionSnippet: row.description_snippet,
    workType: row.work_type,
    contractType: row.contract_type,
    experienceLevel: row.experience_level,
    source: row.source,
  };
}

// Helper to map JobOpportunity to DB row
function mapOppToRow(opp: JobOpportunity, userId: string, organizationId: string | null) {
  const isValidUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(opp.id || '');

  const row: any = {
    user_id: userId,
    organization_id: organizationId,
    title: opp.title,
    company_name: opp.companyName,
    company_linkedin_url: opp.companyLinkedinUrl,
    company_domain: opp.companyDomain,
    location: opp.location,
    published_at: opp.publishedAt,
    posted_time: opp.postedTime,
    job_url: opp.jobUrl,
    apply_url: opp.applyUrl,
    description_snippet: opp.descriptionSnippet,
    work_type: opp.workType,
    contract_type: opp.contractType,
    experience_level: opp.experienceLevel,
    source: opp.source || 'linkedin',
  };

  // Solo usamos el ID si es un UUID válido, de lo contrario dejamos que la DB genere uno nuevo
  if (isValidUUID) {
    row.id = opp.id;
  }

  return row;
}

export const savedOpportunitiesStorage = {
  async get(): Promise<JobOpportunity[]> {
    const orgId = await organizationService.getCurrentOrganizationId();

    let query = supabase
      .from(TABLE)
      .select('*')
      .order('created_at', { ascending: false });

    // RLS ya maneja auth.uid, pero si queremos lógica de org específica:
    // (Asumiendo que RLS permite ver lo de la org o lo propio)
    // El filtro RLS "Users can view their own or org opportunities" se encarga.
    // Simplemente ejecutamos el select.

    const { data, error } = await query;
    if (error) {
      console.error('Error fetching saved opportunities:', error);
      return [];
    }
    return (data || []).map(mapRowToOpp);
  },

  // No se usa set directo en el nuevo modelo, solo add/remove
  // Mantendremos una firma compatible si fuera necesario, pero la UI usa addDedup
  async set(opps: JobOpportunity[]) {
    console.warn('savedOpportunitiesStorage.set() is deprecated with Supabase integration. Use add/remove methods.');
  },

  async addDedup(oppsToAdd: JobOpportunity[]) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { addedCount: 0, duplicateCount: 0, added: [], duplicates: [] };

    const orgId = await organizationService.getCurrentOrganizationId();

    // 1. Obtener existentes para de-duplicar
    // (Optimización: Podríamos traer solo job_url o id)
    const existing = await this.get();

    // Lógica de clave única (mismo que antes)
    const oppKey = (o: JobOpportunity | any) => {
      // Preferimos jobUrl para unicidad real de vacante
      if (o.jobUrl) return o.jobUrl.trim().toLowerCase();
      // Fallback
      return `${o.companyName || ''}|${o.title || ''}`.toLowerCase();
    };

    const existingKeys = new Set(existing.map(oppKey));

    const added: JobOpportunity[] = [];
    const duplicates: JobOpportunity[] = [];
    const toInsert: any[] = [];

    for (const o of oppsToAdd) {
      const k = oppKey(o);
      if (existingKeys.has(k)) {
        duplicates.push(o);
      } else {
        added.push(o);
        existingKeys.add(k); // Evitar duplicados dentro del mismo batch
        toInsert.push(mapOppToRow(o, user.id, orgId));
      }
    }

    if (toInsert.length > 0) {
      const { error } = await supabase.from(TABLE).insert(toInsert);
      if (error) {
        console.error('Error inserting opportunities:', error);
        // Si falla, asumimos que no se agregó nada
        return { addedCount: 0, duplicateCount: oppsToAdd.length, added: [], duplicates: oppsToAdd };
      }
    }

    // Re-mapear lo insertado para devolver objetos completos si fuera necesario,
    // pero por ahora devolvemos lo que se intentó agregar.

    return {
      addedCount: added.length,
      duplicateCount: duplicates.length,
      added,
      duplicates,
    };
  },

  async isSaved(o: JobOpportunity): Promise<boolean> {
    // Verificación rápida contra caché o query simple
    // Para simplificar, traemos todo (como antes) o hacemos query count
    // Dada la API actual, get() trae todo. 
    // Optimización futura: .select('id').eq(...).maybeSingle()
    const all = await this.get();
    const oppKey = (item: JobOpportunity) => (item.jobUrl || '').toLowerCase();
    const target = oppKey(o);
    if (!target) return false;
    return all.some(x => oppKey(x) === target);
  }
};
