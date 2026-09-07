import { z } from 'zod';

import type { StyleProfile } from '@/lib/types';

export type OutsourcingEmailStylePreset = {
  id: 'pas' | 'qvc' | 'bab' | 'aida';
  label: string;
  description: string;
  profile: Partial<StyleProfile>;
};

const COMMON_DO = [
  'usar un solo hecho verificable del prospecto',
  'hablar en el lenguaje del comprador',
  'cerrar con una sola pregunta de baja fricción',
];

const COMMON_DONT = [
  'inventar cifras, clientes, dolores o eventos',
  'usar elogios genéricos, jerga de outsourcing o frases de marketing',
  'repetir el mismo argumento en los seguimientos',
];

export const OUTSOURCING_EMAIL_STYLE_PRESETS: OutsourcingEmailStylePreset[] = [
  {
    id: 'pas',
    label: 'Problema e impacto',
    description: 'PAS: conecta un problema operativo con su consecuencia y una solución concreta.',
    profile: {
      tone: 'professional',
      length: 'short',
      language: 'es',
      structure: ['hook', 'context', 'value', 'proof', 'cta'],
      instructions: 'Usa PAS sin nombrarlo: problema observable, consecuencia práctica y solución. No mezcles otros frameworks. Ideal para primer contacto sin un evento reciente. Mantén el correo entre 50 y 125 palabras.',
      do: COMMON_DO,
      dont: COMMON_DONT,
      personalization: { useLeadName: true, useCompanyName: true, useReportSignals: true },
      cta: { label: '¿Tiene sentido conversarlo durante 15 minutos esta semana?', duration: '15' },
      constraints: { noFabrication: true, noSensitiveClaims: true },
      subjectTemplate: 'Una idea para {{company.name}}',
      bodyTemplate: 'Hola {{lead.firstName}},\n\n¿Hay algún proceso en {{company.name}} que siga requiriendo trabajo manual?\n\n{{companyProfile.valueProposition}}\n\n¿Tiene sentido conversarlo durante {{cta.duration}} minutos esta semana?\n\nSaludos,\n{{sender.name}}',
    },
  },
  {
    id: 'qvc',
    label: 'Pregunta directa',
    description: 'QVC: una pregunta breve, valor concreto y un siguiente paso simple.',
    profile: {
      tone: 'direct',
      length: 'short',
      language: 'es',
      structure: ['hook', 'value', 'cta'],
      instructions: 'Usa QVC sin nombrarlo: abre con una pregunta que exponga el tema sin acusar, entrega valor concreto y termina con una sola acción. No mezcles otros frameworks. Mantén el correo entre 50 y 100 palabras.',
      do: COMMON_DO,
      dont: COMMON_DONT,
      personalization: { useLeadName: true, useCompanyName: true, useReportSignals: true },
      cta: { label: '¿Agendamos 15 minutos esta semana para revisarlo?', duration: '15' },
      constraints: { noFabrication: true, noSensitiveClaims: true },
      subjectTemplate: '¿Cómo simplifican {{company.name}}?',
      bodyTemplate: 'Hola {{lead.firstName}},\n\n¿Están buscando simplificar algún proceso operativo en {{company.name}}?\n\n{{companyProfile.valueProposition}}\n\n¿Agendamos {{cta.duration}} minutos esta semana para revisar si aplica?\n\nSaludos,\n{{sender.name}}',
    },
  },
  {
    id: 'bab',
    label: 'Antes y después',
    description: 'BAB: contrasta la situación actual con un resultado respaldado y explica el puente.',
    profile: {
      tone: 'consultative',
      length: 'medium',
      language: 'es',
      structure: ['context', 'proof', 'value', 'cta'],
      instructions: 'Usa BAB sin nombrarlo: situación actual, resultado deseado y el mecanismo que los conecta. No mezcles otros frameworks. Usa un caso o cifra únicamente si está respaldado en el perfil del remitente.',
      do: [...COMMON_DO, 'usar prueba social solo cuando esté verificada'],
      dont: COMMON_DONT,
      personalization: { useLeadName: true, useCompanyName: true, useReportSignals: true },
      cta: { label: '¿Te muestro cómo podría aplicarse en una llamada corta?', duration: '15' },
      constraints: { noFabrication: true, noSensitiveClaims: true },
      subjectTemplate: 'Un siguiente paso para {{company.name}}',
      bodyTemplate: 'Hola {{lead.firstName}},\n\nCuando una parte de la operación en {{company.name}} consume más tiempo del necesario, suele haber espacio para simplificarla.\n\n{{companyProfile.valueProposition}}\n\n¿Te muestro cómo podría aplicarse en una llamada de {{cta.duration}} minutos?\n\nSaludos,\n{{sender.name}}',
    },
  },
  {
    id: 'aida',
    label: 'Seguimiento con valor',
    description: 'AIDA: aporta un dato o caso nuevo y hace avanzar la conversación sin presión.',
    profile: {
      tone: 'warm',
      length: 'short',
      language: 'es',
      structure: ['hook', 'context', 'value', 'cta'],
      instructions: 'Usa AIDA sin nombrarlo y sin repetir el correo anterior: atención con un hecho o dato nuevo, relevancia para el destinatario, resultado práctico y una acción simple. Ideal para seguimientos y breakup. Mantén el mensaje entre 40 y 90 palabras.',
      do: [...COMMON_DO, 'aportar algo nuevo respecto de los mensajes anteriores'],
      dont: [...COMMON_DONT, 'preguntar si leyó el correo anterior o decir que solo haces seguimiento'],
      personalization: { useLeadName: true, useCompanyName: true, useReportSignals: true },
      cta: { label: '¿Vale la pena conversarlo durante 15 minutos?', duration: '15' },
      constraints: { noFabrication: true, noSensitiveClaims: true },
      subjectTemplate: 'Una idea para {{company.name}}',
      bodyTemplate: 'Hola {{lead.firstName}},\n\nUn proceso repetitivo puede parecer pequeño hasta que se repite cada semana en {{company.name}}.\n\n{{companyProfile.valueProposition}}\n\n¿Vale la pena conversarlo durante {{cta.duration}} minutos?\n\nSaludos,\n{{sender.name}}',
    },
  },
];

export const OUTSOURCING_EMAIL_STYLE_PRESET_PREFIX = 'preset:';
export type OutsourcingEmailStylePresetId = (typeof OUTSOURCING_EMAIL_STYLE_PRESETS)[number]['id'];

export function outsourcingEmailStylePresetSelection(id: OutsourcingEmailStylePresetId) {
  return `${OUTSOURCING_EMAIL_STYLE_PRESET_PREFIX}${id}`;
}

export function getOutsourcingEmailStylePresetById(value: unknown) {
  const id = String(value || '').trim().toLowerCase();
  return OUTSOURCING_EMAIL_STYLE_PRESETS.find((preset) => preset.id === id) || null;
}

export function getOutsourcingEmailStylePresetFromSelection(value: unknown) {
  const selection = String(value || '').trim().toLowerCase();
  if (!selection.startsWith(OUTSOURCING_EMAIL_STYLE_PRESET_PREFIX)) return null;
  return getOutsourcingEmailStylePresetById(selection.slice(OUTSOURCING_EMAIL_STYLE_PRESET_PREFIX.length));
}

export function isOutsourcingEmailStylePresetSelection(value: unknown): value is string {
  return Boolean(getOutsourcingEmailStylePresetFromSelection(value));
}

export const EmailStyleSelectionSchema = z.union([
  z.string().uuid(),
  z.string().refine(isOutsourcingEmailStylePresetSelection, 'Invalid email style selection'),
]);

export function normalizeEmailStyleSelection(value: unknown) {
  if (typeof value !== 'string') return null;
  const selection = value.trim();
  if (!EmailStyleSelectionSchema.safeParse(selection).success) return null;
  return isOutsourcingEmailStylePresetSelection(selection) ? selection.toLowerCase() : selection;
}

export function styleProfileFromOutsourcingEmailStylePreset(
  preset: OutsourcingEmailStylePreset,
  scope: StyleProfile['scope'] = 'leads',
): StyleProfile {
  return {
    ...preset.profile,
    scope,
    name: preset.label,
    presetId: preset.id,
  };
}
