// src/lib/user-data-service.ts
'use client';

import { auth, db } from './firebase-client';
import {
  collection,
  doc,
  getDocs,
  setDoc,
  deleteDoc,
} from 'firebase/firestore';
import type { Lead, ContactedLead } from './types';
import type { JobOpportunity } from './opportunities';
import type { Campaign } from './campaigns-storage';

class UserDataService {
  private getUserId(): string | null {
    return auth.currentUser?.uid ?? null;
  }

  private ensureUserId(): string {
    const uid = this.getUserId();
    if (!uid) {
      throw new Error(
        'UserDataService: no hay usuario autenticado. Asegúrate de hacer login antes de usar este servicio.'
      );
    }
    return uid;
  }

  private col(subpath: string) {
    const uid = this.ensureUserId();
    return collection(db, 'users', uid, subpath);
  }

  // ---------- LEADS GUARDADOS ----------

  async getSavedLeads(): Promise<Lead[]> {
    const snap = await getDocs(this.col('savedLeads'));
    return snap.docs.map((d) => {
      const data = d.data() as Lead;
      return { ...data, id: data.id ?? d.id };
    });
  }

  async upsertSavedLeads(leads: Lead[]): Promise<void> {
    const colRef = this.col('savedLeads');
    const ops = leads.map((lead) => {
      const id = lead.id || crypto.randomUUID();
      return setDoc(doc(colRef, id), { ...lead, id });
    });
    await Promise.all(ops);
  }

  async deleteSavedLead(id: string): Promise<void> {
    await deleteDoc(doc(this.col('savedLeads'), id));
  }

  // ---------- OPORTUNIDADES GUARDADAS ----------

  async getSavedOpportunities(): Promise<JobOpportunity[]> {
    const snap = await getDocs(this.col('savedOpportunities'));
    return snap.docs.map((d) => {
      const data = d.data() as JobOpportunity;
      return { ...data, id: data.id ?? d.id };
    });
  }

  async upsertSavedOpportunities(opps: JobOpportunity[]): Promise<void> {
    const colRef = this.col('savedOpportunities');
    const ops = opps.map((opp) => {
      const id = String(opp.id || crypto.randomUUID());
      return setDoc(doc(colRef, id), { ...opp, id });
    });
    await Promise.all(ops);
  }

  async deleteSavedOpportunity(id: string): Promise<void> {
    await deleteDoc(doc(this.col('savedOpportunities'), id));
  }

  // ---------- CAMPAÑAS ----------

  async getCampaigns(): Promise<Campaign[]> {
    const snap = await getDocs(this.col('campaigns'));
    return snap.docs.map((d) => {
      const data = d.data() as Campaign;
      return { ...data, id: data.id ?? d.id };
    });
  }

  async upsertCampaigns(campaigns: Campaign[]): Promise<void> {
    const colRef = this.col('campaigns');
    const ops = campaigns.map((c) => {
      const id = String(c.id || crypto.randomUUID());
      return setDoc(doc(colRef, id), { ...c, id });
    });
    await Promise.all(ops);
  }

  async deleteCampaign(id: string): Promise<void> {
    await deleteDoc(doc(this.col('campaigns'), id));
  }

  // ---------- CONTACTED LEADS (para futuro) ----------

  async getContactedLeads(): Promise<ContactedLead[]> {
    const snap = await getDocs(this.col('contactedLeads'));
    return snap.docs.map((d) => {
      const data = d.data() as ContactedLead;
      return { ...data, id: data.id ?? d.id };
    });
  }

  async upsertContactedLeads(items: ContactedLead[]): Promise<void> {
    const colRef = this.col('contactedLeads');
    const ops = items.map((c) => {
      const id = String(c.id || crypto.randomUUID());
      return setDoc(doc(colRef, id), { ...c, id });
    });
    await Promise.all(ops);
  }
}

export const userDataService = new UserDataService();