import { EmailTemplate } from '@/lib/types';

const KEY = 'leadflow-email-templates';

const seed: EmailTemplate[] = [
  {
    id: 'seed-leads-1',
    name: 'Leads · Servicios (breve)',
    scope: 'leads',
    authoring: 'system',
    aiIntensity: 'light',
    tone: 'professional',
    length: 'short',
    subject: '{{companyProfile.name}} × {{lead.company}}',
    body: `Hola {{lead.name | default:"equipo"}},

Noté {{#if report.pains}}{{report.pains.0}}{{/if}} en {{lead.company}}. En {{companyProfile.name}} ayudamos con {{companyProfile.services}} y {{companyProfile.valueProposition}}.

¿Te parece una llamada breve esta semana para explorar opciones?

Saludos,`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    description: 'Plantilla corta de prospección para Leads (ofrecer servicios).',
  },
  {
    id: 'seed-opps-1',
    name: 'Oportunidades · Vacante (colaboración)',
    scope: 'opportunities',
    authoring: 'system',
    aiIntensity: 'medium',
    tone: 'warm',
    length: 'medium',
    subject: 'Apoyo para {{job.title}} en {{job.companyName}}',
    body: `Hola {{lead.name | default:"equipo"}} de {{job.companyName}},

Vimos su vacante {{job.title}} ({{job.location}}). {{#if report.valueProps}}Podemos aportar con {{report.valueProps.0}}{{/if}} y acelerar el proceso de selección con {{companyProfile.services}}.

¿Coordinamos una breve llamada? Puedo compartir un plan muy concreto.

Saludos,`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    description: 'Plantilla para colaborar en vacante (Oportunidades).',
  },
];

export function getTemplates(): EmailTemplate[] {
  if (typeof window === 'undefined') return seed;
  const raw = localStorage.getItem(KEY);
  if (!raw) {
    localStorage.setItem(KEY, JSON.stringify(seed));
    return seed;
  }
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : seed;
  } catch {
    return seed;
  }
}

export function saveTemplates(list: EmailTemplate[]) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(KEY, JSON.stringify(list));
}

export function upsertTemplate(t: EmailTemplate) {
  const list = getTemplates();
  const i = list.findIndex(x => x.id === t.id);
  if (i >= 0) list[i] = { ...t, updatedAt: new Date().toISOString() };
  else list.unshift({ ...t, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  saveTemplates(list);
}

export function deleteTemplate(id: string) {
  const list = getTemplates().filter(t => t.id !== id);
  saveTemplates(list);
}

export function getTemplateById(id: string) {
  return getTemplates().find(t => t.id === id) || null;
}
