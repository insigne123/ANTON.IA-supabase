// src/lib/delete-contacted-cascade.ts
// Borrado en cascada de todo rastro de un lead contactado (localStorage only).

import { contactedLeadsStorage } from './contacted-leads-storage';
import { localStorageService } from './local-storage-service';
import { getEnrichedLeads, setEnrichedLeads } from './saved-enriched-leads-storage';
import { getEnrichedOppLeads, setEnrichedOppLeads } from './saved-enriched-opps-storage';
import { leadResearchStorage } from './lead-research-storage';

export type DeleteCascadeParams = {
  leadId?: string | null;
  email?: string | null;
  messageId?: string | null;
  conversationId?: string | null;
};

const eq = (a?: string | null, b?: string | null) =>
  (a || '').trim().toLowerCase() === (b || '').trim().toLowerCase();

export function deleteContactedCascade(params: DeleteCascadeParams) {
  if (typeof window === 'undefined') return { contacted: 0, saved: 0, enriched: 0, oppEnriched: 0, research: 0 };

  const { leadId, email, messageId, conversationId } = params || {};

  // 1) Contacted
  const contacted = contactedLeadsStorage.removeWhere(
    x =>
      (messageId && eq(x.messageId, messageId)) ||
      (conversationId && eq(x.conversationId, conversationId)) ||
      (leadId && eq(x.leadId, leadId)) ||
      (email && eq(x.email, email))
  );

  // 2) Guardados (sin email) – vía localStorageService
  const saved = localStorageService.removeWhere((l: any) =>
    (leadId && eq(l.id, leadId)) || (email && l.email && eq(l.email, email))
  );

  // 3) Enriquecidos (leads)
  const beforeEnriched = getEnrichedLeads();
  const afterEnriched = beforeEnriched.filter(
    (e) => !(
      (leadId && eq(e.id, leadId)) ||
      (email && e.email && eq(e.email, email))
    )
  );
  setEnrichedLeads(afterEnriched);
  const enriched = beforeEnriched.length - afterEnriched.length;

  // 4) Enriquecidos (opps → leads)
  const beforeOpp = getEnrichedOppLeads();
  const afterOpp = beforeOpp.filter(
    (e) => !(
      (leadId && eq(e.id, leadId)) ||
      (email && e.email && eq(e.email, email))
    )
  );
  setEnrichedOppLeads(afterOpp);
  const oppEnriched = beforeOpp.length - afterOpp.length;

  // 5) Research / Reportes (por leadId/email)
  const research = leadResearchStorage.removeWhere((r: any) =>
    (leadId && (eq(r.leadId, leadId) || eq(r.id, leadId))) ||
    (email && (eq(r.email, email) || eq(r.leadEmail, email)))
  );

  return { contacted, saved, enriched, oppEnriched, research };
}
