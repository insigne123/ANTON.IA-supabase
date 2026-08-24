import { EnrichedLead, LeadResearchReport } from '@/lib/types';
import { getFirstNameSafe } from '@/lib/template';

export type LinkedInDraft = {
  message: string;
  personalization: string;
  isPersonalized: boolean;
};

function toShortSentence(value?: string | null, limit = 180) {
  const cleaned = String(value || '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  const firstSentence = cleaned.match(new RegExp(`^(.{1,${limit}}?[.!?])(?:\\s|$)`))?.[1] || cleaned;
  return firstSentence.length > limit ? `${firstSentence.slice(0, limit - 1).trim()}...` : firstSentence;
}

function lowerCaseFirst(value: string) {
  return value ? `${value.charAt(0).toLowerCase()}${value.slice(1)}` : value;
}

function limitMessage(value: string, limit = 500) {
  return value.length > limit ? `${value.slice(0, limit - 1).trim()}...` : value;
}

export function buildLinkedinDraft(lead: EnrichedLead, report?: LeadResearchReport | null): LinkedInDraft {
  const firstName = getFirstNameSafe(lead.fullName) || 'hola';
  const company = lead.companyName || 'tu equipo';
  const role = lead.title ? ` como ${lead.title}` : '';
  const leadContext = report?.cross?.leadContext;
  const socialSignal = toShortSentence(leadContext?.iceBreaker || leadContext?.recentActivitySummary);
  const value = toShortSentence(report?.cross?.valueProps?.[0], 140);

  if (socialSignal) {
    const message = [
      `Hola ${firstName}, me llamó la atención ${lowerCaseFirst(socialSignal)}.`,
      value
        ? `Creo que puede ser relevante conversar sobre ${lowerCaseFirst(value)}.`
        : `Vi tu trabajo${role} en ${company} y quería compartirte una idea breve.`,
      '¿Te parece si conectamos?',
    ].join(' ');

    return {
      message: limitMessage(message),
      personalization: leadContext?.iceBreaker ? 'Se basa en un hallazgo específico del perfil.' : 'Se basa en actividad reciente del perfil.',
      isPersonalized: true,
    };
  }

  const message = `Hola ${firstName}, vi tu trabajo${role} en ${company}. Me gustaría compartirte una idea breve que podría ser útil para tu equipo. ¿Te parece si conectamos?`;
  return {
    message: limitMessage(message),
    personalization: 'No encontramos una señal personal verificable; revisa el texto antes de enviarlo.',
    isPersonalized: false,
  };
}

export function generateLinkedinDraft(lead: EnrichedLead, report?: LeadResearchReport | null): string {
  return buildLinkedinDraft(lead, report).message;
}
