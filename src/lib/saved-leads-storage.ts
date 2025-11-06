import type { Lead } from './types';
import { v4 as uuidv4 } from 'uuid';

const STORAGE_KEY = 'anton_ia_saved_leads';

export function getSavedLeads(): Lead[] {
  if (typeof window === 'undefined') return [];
  
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : [];
  } catch (error) {
    console.error('Error loading saved leads:', error);
    return [];
  }
}

export function saveLeads(leads: Lead[]): void {
  if (typeof window === 'undefined') return;
  
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(leads));
  } catch (error) {
    console.error('Error saving leads:', error);
  }
}

export function addSavedLeads(newLeads: Lead[]): Lead[] {
  const existingLeads = getSavedLeads().map(l => ({ ...l, id: l.id || uuidv4() }));
  const leadMap = new Map(existingLeads.map(lead => [String(lead.id), lead]));
  
  // Agregar o actualizar leads
  newLeads.forEach(raw => {
    const lead: Lead = { ...raw, id: raw.id || uuidv4() };
    leadMap.set(String(lead.id), lead);
  });
  
  const updatedLeads = Array.from(leadMap.values());
  saveLeads(updatedLeads);
  return updatedLeads;
}

export function updateLeadStatus(leadId: string, status: 'saved' | 'investigated'): Lead[] {
  const leads = getSavedLeads();
  const updatedLeads = leads.map(lead => 
    lead.id === leadId ? { ...lead, status } : lead
  );
  saveLeads(updatedLeads);
  return updatedLeads;
}

export function updateLeadEmail(leadId: string, email: string, enrichmentData: any): Lead[] {
  const leads = getSavedLeads();
  const updatedLeads = leads.map(lead => 
    lead.id === leadId ? { 
      ...lead, 
      email,
      emailEnrichment: {
        enriched: true,
        enrichedAt: new Date().toISOString(),
        source: 'anymail_finder',
        confidence: enrichmentData.confidence,
        creditsUsed: enrichmentData.credits_used
      }
    } : lead
  );
  saveLeads(updatedLeads);
  return updatedLeads;
}

export function removeSavedLead(leadId: string): Lead[] {
  const leads = getSavedLeads();
  const updatedLeads = leads.filter(lead => lead.id !== leadId);
  saveLeads(updatedLeads);
  return updatedLeads;
}
