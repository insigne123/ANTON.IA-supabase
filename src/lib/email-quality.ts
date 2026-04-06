import { hasCta } from './tokens';
import type { StyleProfile } from './types';

export function qualityChecks(subject: string, body: string, style: StyleProfile) {
  const words = body.trim().split(/\s+/).filter(Boolean).length;
  const want =
    style.length === 'short' ? [40, 100] :
      style.length === 'medium' ? [90, 180] : [160, 300];

  const inRange = words >= want[0] && words <= want[1];
  const cta = hasCta(subject + ' ' + body);
  const personalization =
    (style.personalization?.useLeadName && /\{\{lead\./.test(subject + body)) ||
    (style.personalization?.useCompanyName && /\{\{company\./.test(subject + body));

  const warnings: string[] = [];
  if (!inRange) warnings.push(`Longitud sugerida: ${want[0]}–${want[1]} palabras (tienes ${words}).`);
  if (!cta) warnings.push('Añade un CTA claro (ej. “¿Te va una llamada de 15 min?”).');
  if (!personalization) warnings.push('Usa al menos un token de personalización (lead/empresa).');

  return { inRange, cta, personalization, warnings };
}
