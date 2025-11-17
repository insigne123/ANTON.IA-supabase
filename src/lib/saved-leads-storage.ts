'use client';

import type { Lead } from './types';
import { v4 as uuidv4 } from 'uuid';
import { auth } from './firebase-client';
import { userDataService } from './user-data-service';

const STORAGE_KEY = 'anton_ia_saved_leads';

// ---------- Helpers LOCAL ----------

function getLocalLeads(): Lead[] {
  if (typeof window === 'undefined') return [];
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? (JSON.parse(saved) as Lead[]) : [];
  } catch (error) {
    console.error('Error loading saved leads from localStorage:', error);
    return [];
  }
}

function setLocalLeads(leads: Lead[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(leads));
  } catch (error) {
    console.error('Error saving leads to localStorage:', error);
  }
}

function normalizeLead(raw: Lead): Lead {
  return { ...raw, id: raw.id || uuidv4() };
}

// ---------- API PÚBLICA (async) ----------

export async function getSavedLeads(): Promise<Lead[]> {
  const user = auth.currentUser;
  if (!user) {
    // Modo invitado: solo localStorage
    return getLocalLeads();
  }
  return userDataService.getSavedLeads();
}

export async function saveLeads(leads: Lead[]): Promise<void> {
  const normalized = leads.map(normalizeLead);
  const user = auth.currentUser;

  if (!user) {
    setLocalLeads(normalized);
    return;
  }

  await userDataService.upsertSavedLeads(normalized);
}

export async function addSavedLeads(newLeads: Lead[]): Promise<Lead[]> {
  const existing = await getSavedLeads();
  const all = existing.map(normalizeLead);
  const leadMap = new Map<string, Lead>();

  all.forEach((lead) => {
    leadMap.set(String(lead.id), lead);
  });

  newLeads.forEach((raw) => {
    const lead = normalizeLead(raw);
    leadMap.set(String(lead.id), lead);
  });

  const updatedLeads = Array.from(leadMap.values());
  await saveLeads(updatedLeads);
  return updatedLeads;
}

export async function updateLeadStatus(
  leadId: string,
  status: 'saved' | 'investigated'
): Promise<Lead[]> {
  const leads = await getSavedLeads();
  const updatedLeads = leads.map((lead: any) =>
    lead.id === leadId ? { ...lead, status } : lead
  );
  await saveLeads(updatedLeads);
  return updatedLeads;
}

export async function updateLeadEmail(
  leadId: string,
  email: string,
  enrichmentData: any
): Promise<Lead[]> {
  const leads = await getSavedLeads();
  const updatedLeads = leads.map((lead: any) =>
    lead.id === leadId
      ? {
          ...lead,
          email,
          emailEnrichment: {
            enriched: true,
            enrichedAt: new Date().toISOString(),
            source: 'anymail_finder',
            confidence: enrichmentData?.confidence,
            creditsUsed: enrichmentData?.credits_used,
          },
        }
      : lead
  );
  await saveLeads(updatedLeads);
  return updatedLeads;
}

export async function removeSavedLead(leadId: string): Promise<Lead[]> {
  const user = auth.currentUser;

  if (!user) {
    const leads = getLocalLeads();
    const updated = leads.filter((lead) => lead.id !== leadId);
    setLocalLeads(updated);
    return updated;
  }

  await userDataService.deleteSavedLead(leadId);
  const updated = await userDataService.getSavedLeads();
  return updated;
}

// ---------- Objeto para compatibilidad con la UI ----------

export const savedLeadsStorage = {
  get: getSavedLeads,
  save: saveLeads,
  add: addSavedLeads,
  addSavedLeads,
  updateStatus: updateLeadStatus,
  updateEmail: updateLeadEmail,
  remove: removeSavedLead,
};