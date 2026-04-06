import { legalConfig } from '@/lib/legal-config';

const DEFAULT_PRIVACY_ADMIN = legalConfig.privacyContactEmail;

export function getPrivacyAdminEmails() {
  const configured = String(process.env.PRIVACY_ADMIN_EMAILS || DEFAULT_PRIVACY_ADMIN)
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);

  return Array.from(new Set(configured));
}

export function isPrivacyAdminEmail(email: string | null | undefined) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return false;
  return getPrivacyAdminEmails().includes(normalized);
}
