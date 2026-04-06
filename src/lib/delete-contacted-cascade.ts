// src/lib/delete-contacted-cascade.ts
// Borrado en cascada de todo rastro de un lead contactado (localStorage only).

import { contactedLeadsStorage } from '@/lib/services/contacted-leads-service';
import { supabaseService } from './supabase-service';
import { enrichedLeadsStorage } from '@/lib/services/enriched-leads-service';
import { leadResearchStorage } from './lead-research-storage';

export type DeleteCascadeParams = {
  leadId?: string | null;
  email?: string | null;
  messageId?: string | null;
  conversationId?: string | null;
};

const eq = (a?: string | null, b?: string | null) =>
  (a || '').trim().toLowerCase() === (b || '').trim().toLowerCase();

export async function deleteContactedCascade(params: DeleteCascadeParams) {
  // if (typeof window === 'undefined') return { contacted: 0, saved: 0, enriched: 0, oppEnriched: 0, research: 0 };
  // Now we can run on server or client, but keep check if needed? No, services handle it.

  const { leadId, email, messageId, conversationId } = params || {};

  // 1) Contacted
  const contacted = await contactedLeadsStorage.removeWhere(
    x =>
      !!((messageId && eq(x.messageId, messageId)) ||
        (conversationId && eq(x.conversationId, conversationId)) ||
        (leadId && eq(x.leadId, leadId)) ||
        (email && eq(x.email, email)))
  );

  // 2) Guardados (sin email) – vía supabaseService
  const saved = await supabaseService.removeWhere((l: any) =>
    !!((leadId && eq(l.id, leadId)) || (email && l.email && eq(l.email, email)))
  );

  // 3) Enriquecidos (leads + opp leads merged)
  const enriched = await enrichedLeadsStorage.removeWhere((e) =>
    !!((leadId && eq(e.id, leadId)) || (email && e.email && eq(e.email, email)))
  );

  // 4) Research (Local Storage for now, or migrate if needed)
  // leadResearchStorage seems to be local only still.
  const research = leadResearchStorage.removeWhere((r: any) =>
    !!((leadId && eq(r.leadId, leadId)) || (email && eq(r.email, email)))
  );

  return { contacted, saved, enriched, oppEnriched: 0, research };
}
