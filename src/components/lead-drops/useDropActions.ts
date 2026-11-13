'use client';

import { useState } from 'react';
import { dropName, shortDay, type DropItem } from '@/lib/lead-drops';
import { completeSavedContacts, completionSummary } from '@/lib/leads-workspace/complete-contacts';
import { enrichmentCreditReceipt } from '@/lib/leads-workspace/enrichment-provider';
import { supabaseService } from '@/lib/supabase-service';
import type { DropContactActions } from './DropContactCard';

export type DropNotice = { ok: boolean; text: string } | null;

/**
 * What a signed-in person does with the contacts of a «Contacto del día», wherever the app shows them: its own page in «Buscar
 * prospectos» (LeadDropFlow) and, for a drop of several, the section of «Hoy» (TodayContacts, 13 Nov 2026). «Enriquecer» keeps the
 * contact as a saved one, looks its email up as any saved contact's (1 credit) and ties it back to the drop; `save` keeps those whose
 * email came with the search; the card's own steps (the emails changed by hand, «Aprobar y programar», whether it is useful) each
 * answer with the drop's contacts as they are now. `single`: the drop has one contact, and what is said speaks of one.
 */
export function useDropActions({ dropId, call, setItems, single }: {
  dropId: string | null; call: (path: string, init?: RequestInit) => Promise<Response>; setItems: (items: DropItem[]) => void; single: boolean;
}) {
  const [saving, setSaving] = useState(false);
  /** The contact whose email is being looked up. */
  const [enriching, setEnriching] = useState<string | null>(null);
  const [notice, setNotice] = useState<DropNotice>(null);

  const post = async (body: Record<string, unknown>) => {
    const response = await call(`/api/lead-drops/${encodeURIComponent(dropId || '')}`, { method: 'POST', body: JSON.stringify(body) });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.error || 'No pudimos guardarlo.');
    return payload;
  };
  // «Enriquecer y guardar»: kept as a saved contact, its email looked up as any saved contact's (1 credit), then tied to this drop.
  const enrich = async (item: DropItem) => {
    if (!dropId || saving || enriching) return;
    setEnriching(item.leadId); setNotice(null);
    try {
      const kept = await post({ action: 'keep', leadId: item.leadId });
      setItems(kept.items);
      if (kept.savedLeadId) return;
      const saved = (await supabaseService.getLeads()).find(lead => lead.id === kept.keptLeadId);
      if (!saved) throw new Error('Quedó guardado, pero no pudimos buscar su correo. Búscalo desde «Por escribir».');
      const completion = await completeSavedContacts([saved], { [saved.id]: 'email' });
      const linked = await post({ action: 'link', leadId: item.leadId });
      setItems(linked.items);
      const found = completion.moved.some(lead => lead.email);
      setNotice(linked.linked && found
        ? { ok: true, text: `Listo: ya tienes su correo y quedó en «Por escribir». ${enrichmentCreditReceipt(completion.consumed)}`.trim() }
        : linked.linked ? { ok: true, text: 'Quedó en «Por escribir»: su correo sigue en búsqueda y aparecerá allí en unos minutos.' }
        : { ok: false, text: completionSummary(completion).description });
    } catch (e) { setNotice({ ok: false, text: e instanceof Error ? e.message : 'No pudimos guardarlo.' }); }
    finally { setEnriching(null); }
  };
  const save = async (leadIds?: string[]) => {
    if (!dropId) return;
    setSaving(true); setNotice(null);
    try {
      const body = await post({ action: 'save', ...(leadIds ? { leadIds } : {}) });
      setItems(body.items);
      setNotice(body.expired ? { ok: false, text: single ? 'Este contacto venció: pasaron más de 30 días desde que lo encontramos.'
        : `${body.expired === 1 ? 'Un contacto venció' : `${body.expired} contactos vencieron`}: pasaron más de 30 días. Los demás quedaron en «Por escribir».` }
        : { ok: true, text: single ? 'Quedó en «Por escribir», con su correo. Para enviarle desde ANTON.IA, lo investigamos a fondo (toma unos minutos) y luego revisas el correo.'
          : body.saved === 1 ? 'Quedó en «Por escribir», con su correo.' : `Quedaron ${body.saved} en «Por escribir», con su correo.` });
    } catch (e) { setNotice({ ok: false, text: e instanceof Error ? e.message : 'No pudimos guardarlo.' }); }
    finally { setSaving(false); }
  };
  // What a card does with its contact (DropContactCard): each answers with the drop's contacts as they are now.
  const act = async (body: Record<string, unknown>, failed: string) => {
    setNotice(null);
    try {
      const payload = await post(body);
      if (Array.isArray(payload?.items)) setItems(payload.items);
      return payload;
    } catch (e) { setNotice({ ok: false, text: e instanceof Error && e.message !== 'No pudimos guardarlo.' ? e.message : failed }); return null; }
  };
  const actions: DropContactActions = {
    enrich: item => void enrich(item),
    save: item => void save([item.leadId]),
    approve: async item => {
      const done = await act({ action: 'approve', leadId: item.leadId }, 'No pudimos programar la campaña. Inténtalo de nuevo.');
      if (!done?.campaign) return;
      const later = (done.schedule as string[]).slice(1).map(shortDay);
      setNotice({ ok: true, text: `Campaña de ${dropName(item)} programada desde ${done.provider}: el primer correo sale en unos minutos${later.length
        ? ` y ${later.length === 1 ? 'el seguimiento' : 'los seguimientos'} ${later.length === 1 ? `el ${later[0]}` : `el ${later.slice(0, -1).join(', el ')} y el ${later[later.length - 1]}`}` : ''}. Se detiene si responde.` });
    },
    edit: async (item, emails) => {
      const done = await act({ action: 'edit', leadId: item.leadId, emails }, 'No pudimos guardar los correos. Inténtalo de nuevo.');
      if (done) setNotice({ ok: true, text: `Guardamos tus cambios en los correos de ${dropName(item)}.` });
      return Boolean(done);
    },
    feedback: async (item, useful, reason) => { await act({ action: 'feedback', leadId: item.leadId, feedback: { useful, reason: reason ?? null } }, 'No pudimos guardar tu opinión. Inténtalo de nuevo.'); },
  };
  return { saving, enriching, notice, setNotice, enrich, save, actions };
}
