import type { ContactBounceCategory, ContactDeliveryStatus, ContactedLead } from '@/lib/types';

export type DeliveryFailureClassification = {
  matched: true;
  deliveryStatus: Extract<ContactDeliveryStatus, 'bounced' | 'soft_bounced'>;
  bounceCategory: ContactBounceCategory;
  bounceReason: string;
  replyIntent: 'delivery_failure';
  evaluationStatus: 'do_not_contact' | 'action_required';
  campaignFollowupAllowed: false;
  campaignFollowupReason: string;
};

type DetectInput = {
  subject?: string | null;
  from?: string | null;
  text?: string | null;
  html?: string | null;
};

type Rule = {
  category: ContactBounceCategory;
  deliveryStatus: Extract<ContactDeliveryStatus, 'bounced' | 'soft_bounced'>;
  evaluationStatus: 'do_not_contact' | 'action_required';
  campaignFollowupReason: string;
  patterns: RegExp[];
  reason: string;
};

const MAILER_PATTERN = /mailer-daemon|mail delivery subsystem|postmaster|delivery status notification|undeliverable/i;

const RULES: Rule[] = [
  {
    category: 'left_company',
    deliveryStatus: 'bounced',
    evaluationStatus: 'do_not_contact',
    campaignFollowupReason: 'left_company',
    reason: 'El contacto ya no trabaja en esa empresa.',
    patterns: [
      /ya\s+no\s+trabaj[ao]\s+en/i,
      /ya\s+no\s+est[aá]\s+en\s+la\s+empresa/i,
      /no\s+trabaj[ao]\s+en/i,
      /no\s+pertenec[ea]\s+a\s+la\s+empresa/i,
      /left\s+the\s+company/i,
      /no\s+longer\s+(works?|with|at)/i,
      /is\s+no\s+longer\s+(employed|with)/i,
    ],
  },
  {
    category: 'mailbox_not_found',
    deliveryStatus: 'bounced',
    evaluationStatus: 'do_not_contact',
    campaignFollowupReason: 'mailbox_not_found',
    reason: 'La casilla del destinatario no existe o no recibe correo.',
    patterns: [
      /recipient\s+address\s+rejected/i,
      /user\s+unknown/i,
      /unknown\s+user/i,
      /mailbox\s+unavailable/i,
      /mailbox\s+not\s+found/i,
      /address\s+couldn'?t\s+be\s+found/i,
      /does\s+not\s+exist/i,
      /no\s+such\s+(user|recipient)/i,
      /invalid\s+recipient/i,
      /550\s+5\.1\.1/i,
      /550\s+5\.4\.1/i,
    ],
  },
  {
    category: 'domain_error',
    deliveryStatus: 'bounced',
    evaluationStatus: 'do_not_contact',
    campaignFollowupReason: 'domain_error',
    reason: 'El dominio del destinatario no resolvio o no existe.',
    patterns: [
      /host\s+or\s+domain\s+name\s+not\s+found/i,
      /domain\s+not\s+found/i,
      /name\s+or\s+service\s+not\s+known/i,
      /dns\s+error/i,
      /nxdomain/i,
    ],
  },
  {
    category: 'mailbox_full',
    deliveryStatus: 'soft_bounced',
    evaluationStatus: 'action_required',
    campaignFollowupReason: 'mailbox_full',
    reason: 'La casilla del destinatario esta llena.',
    patterns: [
      /mailbox\s+full/i,
      /quota\s+exceeded/i,
      /over\s+quota/i,
      /insufficient\s+system\s+storage/i,
    ],
  },
  {
    category: 'policy_block',
    deliveryStatus: 'soft_bounced',
    evaluationStatus: 'action_required',
    campaignFollowupReason: 'policy_block',
    reason: 'El mensaje fue bloqueado por politica, reputacion o autenticacion.',
    patterns: [
      /blocked\s+using/i,
      /message\s+rejected/i,
      /rejected\s+for\s+policy\s+reasons/i,
      /spf/i,
      /dmarc/i,
      /dkim/i,
      /unauthenticated/i,
      /spam/i,
    ],
  },
  {
    category: 'temporary_failure',
    deliveryStatus: 'soft_bounced',
    evaluationStatus: 'action_required',
    campaignFollowupReason: 'temporary_failure',
    reason: 'La entrega fallo temporalmente y requiere revision.',
    patterns: [
      /temporar(?:y|ily)\s+(failed|unavailable)/i,
      /try\s+again\s+later/i,
      /server\s+busy/i,
      /deferred/i,
      /greylist/i,
      /timed\s+out/i,
      /resources\s+temporarily\s+unavailable/i,
    ],
  },
];

function stripHtml(input: string) {
  return input
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalize(input?: string | null) {
  return String(input || '').trim();
}

function buildSearchText(input: DetectInput) {
  const subject = normalize(input.subject);
  const from = normalize(input.from);
  const text = normalize(input.text);
  const html = stripHtml(normalize(input.html));
  return [subject, from, text, html].filter(Boolean).join('\n').slice(0, 12000);
}

function matchGenericBounce(subject: string, from: string, text: string) {
  const joined = [subject, from, text].filter(Boolean).join('\n');
  const bounceSubject = /undeliverable|delivery status notification|mail delivery failed|returned mail|failure notice|couldn'?t be delivered|no se pudo entregar/i.test(subject);
  const mailerFrom = MAILER_PATTERN.test(from);
  const genericBounce = /delivery\s+failed|delivery\s+has\s+failed|returned\s+to\s+sender|couldn'?t\s+be\s+delivered|no\s+se\s+pudo\s+entregar/i.test(joined);
  return (bounceSubject && mailerFrom) || (mailerFrom && genericBounce);
}

export function detectDeliveryFailure(input: DetectInput): DeliveryFailureClassification | null {
  const subject = normalize(input.subject);
  const from = normalize(input.from);
  const text = buildSearchText(input);
  if (!text) return null;

  for (const rule of RULES) {
    if (rule.patterns.some((pattern) => pattern.test(text))) {
      return {
        matched: true,
        deliveryStatus: rule.deliveryStatus,
        bounceCategory: rule.category,
        bounceReason: rule.reason,
        replyIntent: 'delivery_failure',
        evaluationStatus: rule.evaluationStatus,
        campaignFollowupAllowed: false,
        campaignFollowupReason: rule.campaignFollowupReason,
      };
    }
  }

  if (matchGenericBounce(subject, from, text)) {
    return {
      matched: true,
      deliveryStatus: 'soft_bounced',
      bounceCategory: 'generic',
      bounceReason: 'Se detecto un rebote o aviso de entrega fallida.',
      replyIntent: 'delivery_failure',
      evaluationStatus: 'action_required',
      campaignFollowupAllowed: false,
      campaignFollowupReason: 'generic_delivery_failure',
    };
  }

  return null;
}

export function isFailedDeliverability(lead: Partial<ContactedLead>) {
  return lead.deliveryStatus === 'bounced' || lead.deliveryStatus === 'soft_bounced' || lead.status === 'failed';
}

export function getBestDeliveryStatus(lead: Partial<ContactedLead>): ContactDeliveryStatus {
  if (lead.deliveryStatus) return lead.deliveryStatus;
  if (lead.repliedAt || lead.status === 'replied') return 'replied';
  if (lead.clickedAt || Number(lead.clickCount || 0) > 0) return 'clicked';
  if (lead.openedAt || lead.status === 'opened') return 'opened';
  if (lead.deliveredAt || lead.deliveryReceiptMessageId) return 'delivered';
  if (lead.status === 'failed') return 'soft_bounced';
  return 'unknown';
}
