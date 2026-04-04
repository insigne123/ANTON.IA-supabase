import type { AntoniaReplyDecisionAction } from '@/lib/antonia-reply-policy';

export type AutonomousReplyDraftValidation = {
  valid: boolean;
  issues: string[];
  severity: 'low' | 'medium' | 'high';
};

type ValidateDraftInput = {
  subject?: string;
  bodyText?: string;
  bodyHtml?: string;
  desiredAction: AntoniaReplyDecisionAction;
  intent: string;
  bookingLink?: string;
  allowedAssetNames?: string[];
  recommendedAssetNames?: string[];
};

function extractText(input: string) {
  return String(input || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function containsPlaceholder(input: string) {
  return /\{\{[^}]+\}\}|\[[^\]]+\]/.test(input);
}

export function validateAutonomousReplyDraft(input: ValidateDraftInput): AutonomousReplyDraftValidation {
  const issues: string[] = [];
  const subject = String(input.subject || '').trim();
  const bodyText = extractText(input.bodyText || input.bodyHtml || '');
  const wordCount = bodyText ? bodyText.split(/\s+/).filter(Boolean).length : 0;
  const allowedAssets = new Set((input.allowedAssetNames || []).map((value) => String(value || '').trim()).filter(Boolean));

  if (!subject) issues.push('missing_subject');
  if (!bodyText) issues.push('missing_body');
  if (containsPlaceholder(subject) || containsPlaceholder(bodyText)) issues.push('unresolved_placeholders');
  if (/\b(soy una ia|como ia|as an ai|language model)\b/i.test(bodyText)) issues.push('mentions_ai');
  if (wordCount > 190) issues.push('body_too_long');
  if (wordCount > 0 && wordCount < 12) issues.push('body_too_short');

  if (input.intent === 'meeting_request' && input.desiredAction === 'send' && input.bookingLink) {
    const bookingMentioned = bodyText.includes(input.bookingLink) || /\b(reunion|llamada|horario|agenda|agendar|calendar|calendly)\b/i.test(bodyText);
    if (!bookingMentioned) issues.push('missing_booking_cta');
  }

  for (const assetName of input.recommendedAssetNames || []) {
    if (!allowedAssets.has(assetName)) {
      issues.push(`invalid_asset:${assetName}`);
    }
  }

  const severity = issues.some((issue) => ['missing_subject', 'missing_body', 'unresolved_placeholders', 'mentions_ai', 'missing_booking_cta'].includes(issue))
    ? 'high'
    : issues.length > 0
      ? 'medium'
      : 'low';

  return {
    valid: issues.length === 0,
    issues,
    severity,
  };
}
