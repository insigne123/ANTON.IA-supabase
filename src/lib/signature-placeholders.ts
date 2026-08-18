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

export type CompanyProfileInfo = {
  name?: string;
  sector?: string;
  description?: string;
  services?: string;
  valueProposition?: string;
  website?: string;
  domain?: string;
};

export type EffectiveCompanyProfile = CompanyProfileInfo & {
  industry?: string;
};

type ProfileLike = {
  full_name?: string | null;
  email?: string | null;
  company_name?: string | null;
  company_domain?: string | null;
  job_title?: string | null;
  phone?: string | null;
  signatures?: any;
};

function normalizeWebsite(value?: string | null) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

function stringifyList(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean).join(', ');
  }
  return String(value || '').trim();
}

export function buildCompanyProfileInfo(profile?: ProfileLike | null): CompanyProfileInfo {
  const fallback: any = getCompanyProfile() || {};
  const extended = profile?.signatures?.profile_extended || {};
  const domain = String(profile?.company_domain || fallback.domain || '').trim().replace(/^https?:\/\//i, '').replace(/\/$/, '');

  return {
    name: profile?.company_name || fallback.name || profile?.full_name || '',
    sector: String(extended.sector || extended.industry || extended.market || fallback.sector || '').trim(),
    description: String(extended.description || fallback.description || '').trim(),
    services: stringifyList(extended.services || fallback.services),
    valueProposition: String(extended.valueProposition || extended.value_proposition || fallback.valueProposition || '').trim(),
    website: normalizeWebsite(profile?.company_domain || fallback.website || fallback.domain || ''),
    domain,
  };
}

export function buildEffectiveCompanyProfile(profile?: ProfileLike | null): EffectiveCompanyProfile {
  const fallback: any = getCompanyProfile() || {};
  const info = buildCompanyProfileInfo(profile);

  return {
    ...fallback,
    ...info,
    name: info.name || fallback.name || '',
    sector: info.sector || fallback.sector || '',
    industry: info.sector || fallback.industry || fallback.sector || '',
    description: info.description || fallback.description || '',
    services: info.services || stringifyList(fallback.services),
    valueProposition: info.valueProposition || String(fallback.valueProposition || '').trim(),
    website: info.website || normalizeWebsite(fallback.website || fallback.domain || ''),
    domain: info.domain || String(fallback.domain || '').trim().replace(/^https?:\/\//i, '').replace(/\/$/, ''),
  };
}

export function buildSenderInfo(profile?: ProfileLike | null): SenderInfo {
  const p: any = profile || getCompanyProfile() || {};
  const id = (microsoftAuthService as any)?.getUserIdentity?.() || {};
  const companyProfile = buildEffectiveCompanyProfile(profile);

  // intenta múltiples campos “típicos” del perfil
  const name =
    p.full_name || p.contactName || p.ownerName || p.fullName || p.userName || p.name || '';
  const title =
    p.job_title || p.contactTitle || p.role || p.position || p.title || '';
  const email =
    p.email || p.contactEmail || id.email || '';
  const phone =
    p.phone || p.contactPhone || p.mobile || '';
  const company =
    p.company_name || companyProfile.name || p.name || p.companyName || '';
  const website = companyProfile.website || p.website || (p.domain ? `https://${String(p.domain).replace(/^https?:\/\//,'')}` : '');

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
