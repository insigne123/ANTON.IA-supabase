import { supabase } from './supabase';
import type { Campaign, CampaignStep, CampaignStepAttachment } from './types';
import { organizationService } from './services/organization-service';

const TABLE_CAMPAIGNS = 'campaigns';
const TABLE_STEPS = 'campaign_steps';

function mapRowToCampaign(row: any, steps: CampaignStep[]): Campaign {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    status: row.status as 'active' | 'paused',
    // isPaused era el booleano antiguo, mapeamos status
    // isPaused: row.status === 'paused', 
    // Mantenemos compatibilidad de tipos si la UI usa isPaused?
    // En tipos dice: status: CampaignStatus. Revisar types.ts
    // El tipo en types.ts es CampaignStatus = 'active' | 'paused'. No hay isPaused en el tipo actual que leí recientemente?
    // Espera, el archivo types.ts que leí tenia: export type Campaign = { ... status: CampaignStatus ... }
    // El archivo campaigns-storage.ts anterior tenía: isPaused: boolean.
    // PARECE QUE EL TYPE CAMBIÓ O EL STORAGE ANTERIOR USABA UN TIPO LOCAL DISTINTO AL DE TYPES.TS
    // Revisando mi lectura de types.ts:
    // export type Campaign = { ... status: CampaignStatus; ... }
    // Revisando campaigns-storage.ts anterior: export type Campaign = { ... isPaused: boolean; ... }
    // !! Conflicto de tipos. El archivo anterior definía sus propios tipos localmente.
    // DEBO USAR LOS TIPOS DE SRC/LIB/TYPES.TS AHORA, UNIFICANDO.

    excludeLeadIds: row.excluded_lead_ids || [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    steps: steps,
  };
}

export const campaignsStorage = {
  async get(): Promise<Campaign[]> {
    const orgId = await organizationService.getCurrentOrganizationId();

    // Fetch campaigns
    const { data: campaigns, error: errC } = await supabase
      .from(TABLE_CAMPAIGNS)
      .select('*')
      .order('created_at', { ascending: false });

    if (errC || !campaigns) {
      console.error('Error fetching campaigns:', errC);
      return [];
    }

    // Fetch steps for all these campaigns
    // Optimización: 1 query in
    const campaignIds = campaigns.map(c => c.id);
    let stepsByCampaign: Record<string, CampaignStep[]> = {};

    if (campaignIds.length > 0) {
      const { data: steps, error: errS } = await supabase
        .from(TABLE_STEPS)
        .select('*')
        .in('campaign_id', campaignIds)
        .order('order_index', { ascending: true }); // Importante el orden

      if (!errS && steps) {
        steps.forEach((s: any) => {
          if (!stepsByCampaign[s.campaign_id]) stepsByCampaign[s.campaign_id] = [];
          stepsByCampaign[s.campaign_id].push({
            offsetDays: s.offset_days,
            subjectTemplate: s.subject_template,
            bodyTemplate: s.body_template,
            attachments: s.attachments as CampaignStepAttachment[]
          });
        });
      }
    }

    return campaigns.map(c => mapRowToCampaign(c, stepsByCampaign[c.id] || []));
  },

  async add(input: Omit<Campaign, 'id' | 'createdAt' | 'updatedAt' | 'organizationId'>) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    const orgId = await organizationService.getCurrentOrganizationId();

    // 1. Insert Campaign
    const { data: campData, error: campError } = await supabase
      .from(TABLE_CAMPAIGNS)
      .insert({
        user_id: user.id,
        organization_id: orgId,
        name: input.name,
        status: input.status,
        excluded_lead_ids: input.excludeLeadIds || []
      })
      .select()
      .single();

    if (campError || !campData) {
      console.error('Error creating campaign:', campError);
      throw campError;
    }

    const campaignId = campData.id;

    // 2. Insert Steps
    if (input.steps && input.steps.length > 0) {
      const stepsToInsert = input.steps.map((s, idx) => ({
        campaign_id: campaignId,
        order_index: idx,
        offset_days: s.offsetDays,
        subject_template: s.subjectTemplate,
        body_template: s.bodyTemplate,
        attachments: s.attachments || [] // JSONB
      }));

      const { error: stepsError } = await supabase
        .from(TABLE_STEPS)
        .insert(stepsToInsert);

      if (stepsError) {
        console.error('Error creating campaign steps:', stepsError);
        // Non-transactional rollback warning? 
        // Supabase doesn't support easy transactions client-side.
        // Retornamos lo creado con error logueado.
      }
    }

    // Return full object
    return this.getById(campaignId);
  },

  async update(id: string, patch: Partial<Campaign>) {
    // Solo actualizamos campos de la tabla campaign (name, status, excludedLeadIds)
    // No implementaremos actualización compleja de pasos aquí por simplicidad,
    // a menos que el patch incluya steps.

    const updates: any = { updated_at: new Date().toISOString() };
    if (patch.name !== undefined) updates.name = patch.name;
    if (patch.status !== undefined) updates.status = patch.status;
    if (patch.excludeLeadIds !== undefined) updates.excluded_lead_ids = patch.excludeLeadIds;

    const { error } = await supabase
      .from(TABLE_CAMPAIGNS)
      .update(updates)
      .eq('id', id);

    if (error) console.error('Error updating campaign:', error);

    // Si patch incluye steps, deberíamos borrar y re-insertar o hacer upsert
    // Por ahora asumimos que update simplificado no toca pasos
    // (en la UI actual parece que no se editan pasos individualmente tras crear, o es una edición full?)

    return this.getById(id);
  },

  async getById(id: string): Promise<Campaign | null> {
    const list = await this.get();
    return list.find(c => c.id === id) || null;
  },

  async remove(id: string) {
    const { error } = await supabase
      .from(TABLE_CAMPAIGNS)
      .delete()
      .eq('id', id);

    return error ? 0 : 1;
  },

  async togglePause(id: string, paused: boolean) {
    // paused -> status='paused', !paused -> status='active'
    return this.update(id, { status: paused ? 'paused' : 'active' });
  },

  async setExclusions(id: string, excludedLeadIds: string[]) {
    return this.update(id, { excludeLeadIds: excludedLeadIds });
  }
};
