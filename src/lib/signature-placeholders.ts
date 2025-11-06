// Rellena placeholders de firma y soporta variables {{sender.*}}
// Usa datos del perfil de empresa y la identidad de Outlook.

import { getCompanyProfile } from '@/lib/data';
import { microsoftAuthService } from '@/lib/microsoft-auth-service';

export type SenderInfo = {
  name?: string;
  title?: string;
  email?: string;
  phone?: string;
  company?: string;
  website?: string;
};

export function buildSenderInfo(): SenderInfo {
  const p: any = getCompanyProfile() || {};
  const id = (microsoftAuthService as any)?.getUserIdentity?.() || {};

  // intenta múltiples campos “típicos” del perfil
  const name =
    p.contactName || p.ownerName || p.fullName || p.userName || p.name || '';
  const title =
    p.contactTitle || p.role || p.position || p.title || '';
  const email =
    p.email || p.contactEmail || id.email || '';
  const phone =
    p.phone || p.contactPhone || p.mobile || '';
  const company =
    p.name || p.companyName || '';
  const website =
    p.website || (p.domain ? `https://${String(p.domain).replace(/^https?:\/\//,'')}` : '');

  return { name, title, email, phone, company, website };
}

/** Reemplaza placeholders tipo [Su Nombre] y variables {{sender.*}} */
export function applySignaturePlaceholders(text: string, sender: SenderInfo) {
  if (!text) return text;

  // 1) Variables {{sender.*}} (también aceptamos {{company.*}} si hace falta)
  const mapMustache: Record<string, string> = {
    '{{\\s*sender\\.name\\s*}}': sender.name || '',
    '{{\\s*sender\\.title\\s*}}': sender.title || '',
    '{{\\s*sender\\.phone\\s*}}': sender.phone || '',
    '{{\\s*sender\\.email\\s*}}': sender.email || '',
    '{{\\s*sender\\.company\\s*}}': sender.company || '',
    '{{\\s*sender\\.website\\s*}}': sender.website || '',
  };

  let out = text;
  for (const [pat, val] of Object.entries(mapMustache)) {
    out = out.replace(new RegExp(pat, 'gi'), val);
  }

  // 2) Placeholders “humanos” en español [Su Nombre], [Su Cargo], etc.
  const mapBrackets: Record<string, string> = {
    '\\[\\s*Su\\s+Nombre\\s*\\]': sender.name || '',
    '\\[\\s*Su\\s+Cargo\\s*\\]': sender.title || '',
    '\\[\\s*Su\\s+Tel[eé]fono\\s*\\]': sender.phone || '',
    '\\[\\s*Su\\s+Correo\\s+Electr[oó]nico\\s*\\]': sender.email || '',
    '\\[\\s*Su\\s+Sitio\\s+Web\\s*\\]': sender.website || '',
    '\\[\\s*Su\\s+Empresa\\s*\\]': sender.company || '',
  };
  for (const [pat, val] of Object.entries(mapBrackets)) {
    out = out.replace(new RegExp(pat, 'gi'), val);
  }

  // Limpia líneas en blanco duplicadas
  out = out.replace(/\n{3,}/g, '\n\n');

  return out;
}
