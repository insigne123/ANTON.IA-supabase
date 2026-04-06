import type { StyleProfile } from './types';

const KEY = 'email-style-profiles';

export const defaultStyle: StyleProfile = {
  scope: 'leads',
  name: 'Estilo conversacional',
  tone: 'professional',
  length: 'medium',
  structure: ['hook','context','value','cta'],
  do: ['mantener claridad', 'evitar jerga'],
  dont: ['promesas absolutas', 'emoji'],
  personalization: { useLeadName: true, useCompanyName: true, useReportSignals: true },
  cta: { label: '¿Agendamos 15 min?', duration: '15' },
  language: 'es',
  constraints: { noFabrication: true, noSensitiveClaims: true },
  tokens: ['{{lead.firstName}}','{{lead.title}}','{{company.name}}','{{company.domain}}'],

  // 🔥 NUEVO: plantillas
  subjectTemplate: '[[lead.firstName]], idea rápida para [[company.name]]',
  bodyTemplate:
`Hola {{lead.firstName}},

Soy {{sender.name}} de {{sender.company}}. Estuve revisando {{company.name}} y noté: {{report.pains}}.

Ayudamos a equipos como el tuyo con {{report.valueProps}}. ¿Te sirve una llamada corta de {{cta.duration || "15"}} min para explorar si aplica?

Saludos,
{{sender.name}}
{{sender.company}}`,

  updatedAt: new Date().toISOString(),
};


function getAll(): StyleProfile[] {
  if (typeof window === 'undefined') return [defaultStyle];
  try { return JSON.parse(localStorage.getItem(KEY) || '[]') || []; } catch { return []; }
}
function setAll(items: StyleProfile[]) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(KEY, JSON.stringify(items));
}

export const styleProfilesStorage = {
  list(): StyleProfile[] {
    const all = getAll();
    return all.length ? all : [defaultStyle];
  },
  getByName(name: string) {
    return this.list().find(s => s.name === name) || null;
  },
  upsert(p: StyleProfile) {
    const all = this.list();
    const i = all.findIndex(x => x.name === p.name && x.scope === p.scope);
    p.updatedAt = new Date().toISOString();
    if (i >= 0) all[i] = p; else all.unshift(p);
    setAll(all);
    return p;
  },
  remove(name: string) {
    const out = this.list().filter(s => s.name !== name);
    setAll(out);
  },
  duplicate(name: string, newName: string) {
    const s = this.getByName(name);
    if (!s) return null;
    const copy = { ...s, name: newName, updatedAt: new Date().toISOString() };
    return this.upsert(copy);
  },
  rename(oldName: string, newName: string) {
    const s = this.getByName(oldName);
    if (!s) return null;
    s.name = newName;
    return this.upsert(s);
  },
};
