
// src/lib/campaign-eligibility.ts
// Ajusta nombres/types si difieren en tu repo (TODO tipar con tus tipos reales).
import { contactedLeadsStorage } from '@/lib/services/contacted-leads-service';
import type { Campaign, CampaignStep } from '@/lib/services/campaigns-service';
import type { ContactedLead } from '@/lib/types';

export type EligiblePreviewRow = {
  leadId: string;
  leadEmail: string | null;
  leadName: string | null;
  nextStepIdx: number;
  nextStep: CampaignStep;
  daysSinceLastContact: number;
};

type Options = {
  now?: Date;
  // IMPORTANTE: por defecto NO consultar proveedores de correo.
  verifyReplies?: boolean; // si en el futuro quieres activar la verificación externa, habilítalo explícitamente.
};

// Utilidad mínima para días entre fechas (redondeo hacia abajo).
function diffDays(a: Date, b: Date) {
  const MS = 24 * 60 * 60 * 1000;
  return Math.floor((a.getTime() - b.getTime()) / MS);
}

// Determina el siguiente índice de paso a enviar para un lead dado.
function getNextStepIdx(campaign: Campaign, leadId: string): number | null {
  const record = campaign.sentRecords?.[leadId];
  if (!campaign.steps || campaign.steps.length === 0) return null;
  if (!record) return 0; // nada enviado → primer paso
  const next = (record.lastStepIdx ?? -1) + 1;
  if (next >= campaign.steps.length) return null; // campaña terminada para este lead
  return next;
}

export async function computeEligibilityForCampaign(
  campaign: Campaign,
  opts: Options = {}
): Promise<EligiblePreviewRow[]> {
  const now = opts.now ?? new Date();
  const verifyReplies = opts.verifyReplies ?? false;

  // SOLO usamos fuente local. No hacemos side effects ni llamadas externas.
  const contacted = await contactedLeadsStorage.get() ?? [];
  const excluded = new Set(campaign.excludedLeadIds ?? []);

  const rows: EligiblePreviewRow[] = [];

  for (const lead of contacted) {
    // Prefer the source lead ID so exclusions (excludedLeadIds) work as expected.
    // Fallback to contacted row id if leadId is missing.
    const leadId: string = lead.leadId ?? (lead as any).id ?? '';
    if (!leadId) continue;

    // 1) Filtrado básico local
    if (excluded.has(leadId)) continue;

    // If replies exist but the classifier says to stop, skip
    if (lead.campaignFollowupAllowed === false) continue;

    // If replied and no explicit allow, skip by default
    if (lead.status === 'replied' && lead.campaignFollowupAllowed !== true) continue;
    if (lead.status === 'replied' && !lead.replyIntent) continue;

    // Si algún día quieres chequear externamente, debe ser una acción manual en UI,
    // no en este compute (para no disparar MSAL). Lo dejamos explícito:
    if (verifyReplies) {
      // NO IMPLEMENTAR aquí a propósito (evitar llamadas OAuth).
      // Podrías exponer otra función separada que haga “refresh replies”
      // y muta contactedLeadsStorage, pero invocada solo por el usuario.
      console.warn(
        '[campaign-eligibility] verifyReplies solicitado, pero deshabilitado en preview para evitar OAuth.'
      );
    }

    // 2) Calcular el siguiente paso
    const nextStepIdx = getNextStepIdx(campaign, leadId);
    if (nextStepIdx == null) continue;
    const nextStep = campaign.steps[nextStepIdx];
    if (!nextStep) continue;

    // 3) Respetar offsetDays desde el último contacto/followup
    // Fuente local: lead.lastContactAt o lead.lastFollowupAt (usa lo que tengas).
    const lastAtStr: string | undefined =
      (lead as any).lastFollowupAt ?? (lead as any).lastContactAt ?? (lead as any).firstContactAt ?? lead.sentAt;
    if (!lastAtStr) continue;

    const lastAt = new Date(lastAtStr);
    const days = diffDays(now, lastAt);

    const offset = Number(nextStep.offsetDays ?? 0);
    if (Number.isNaN(offset)) continue;

    if (days < offset) continue; // aún no cumple el offset

    rows.push({
      leadId,
      leadEmail: lead.email ?? null,
      leadName: lead.name ?? null,
      nextStepIdx,
      nextStep,
      daysSinceLastContact: days,
    });
  }

  return rows;
}
