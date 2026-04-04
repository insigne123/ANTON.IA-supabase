import { generateReconnectionMessage } from '@/ai/flows/generate-reconnection-message';
import { defaultCampaignReconnectionSettings, getLeadLastContactAt, normalizeCampaignSettings } from '@/lib/campaign-settings';
import { generateCompanyOutreachV2, ensureSubjectPrefix } from '@/lib/outreach-templates';
import { applySignaturePlaceholders } from '@/lib/signature-placeholders';
import { buildPersonEmailContext, renderTemplate } from '@/lib/template';
import type { ContactedLead, LeadResearchReport } from '@/lib/types';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import {
  ensureLeadResearchReport,
  findCachedLeadResearchReport,
} from '@/lib/server/lead-research-reports';

type CampaignStepShape = {
  name?: string;
  offsetDays?: number;
  subject?: string;
  bodyHtml?: string;
};

type CampaignShape = {
  id: string;
  name: string;
  settings?: any;
};

type PersonalizationResult = {
  subject: string;
  bodyHtml: string;
  report: LeadResearchReport | null;
  reportStatus: 'cache_hit' | 'generated' | 'missing';
  researchWarning?: string | null;
  usedAi: boolean;
};

function escapeHtml(value: string) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function isLikelyHtml(value: string) {
  return /<\s*(p|div|br|table|ul|ol|li|img|a|span|strong|em)\b/i.test(value);
}

function normalizeBodyHtml(input: string) {
  const raw = String(input || '').trim();
  if (!raw) return '<div></div>';
  if (isLikelyHtml(raw)) return raw;
  return raw
    .split(/\n{2,}/)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, '<br/>')}</p>`)
    .join('');
}

function getSenderProfileShape(profile: any) {
  const domain = String(profile?.company_domain || '').trim().replace(/^https?:\/\//, '');
  return {
    name: String(profile?.full_name || '').trim(),
    title: String(profile?.job_title || '').trim(),
    company: String(profile?.company_name || '').trim(),
    domain,
    website: domain ? `https://${domain}` : '',
    signatures: profile?.signatures || null,
  };
}

function buildFallbackDraft(args: {
  lead: ContactedLead;
  step: CampaignStepShape;
  senderProfile: any;
  reconnectionBrief: typeof defaultCampaignReconnectionSettings.brief;
}) {
  const { lead, step, senderProfile, reconnectionBrief } = args;
  const sender = getSenderProfileShape(senderProfile);
  const ctx = buildPersonEmailContext({
    lead: {
      firstName: String(lead.name || '').split(' ')[0] || '',
      name: lead.name || '',
      email: lead.email || '',
      title: lead.role || '',
      company: lead.company || '',
    },
    company: {
      name: lead.company || '',
      domain: (lead as any).companyDomain || '',
      website: sender.website || '',
    },
    sender,
  });

  let subject = String(step.subject || '').trim();
  let body = String(step.bodyHtml || '').trim();

  if (!subject || !body) {
    const generated = generateCompanyOutreachV2({
      leadFirstName: ctx.lead.firstName,
      companyName: lead.company,
      myCompanyProfile: {
        name: sender.company || 'Mi Empresa',
        industry: reconnectionBrief.offerName || undefined,
      },
    });
    subject = subject || `${reconnectionBrief.offerName || generated.subjectBase}`;
    body = body || generated.body;
  }

  if (reconnectionBrief.offerSummary && !body.includes(reconnectionBrief.offerSummary)) {
    body = `${body}\n\n${reconnectionBrief.offerSummary}`.trim();
  }
  if (reconnectionBrief.cta && !body.toLowerCase().includes(reconnectionBrief.cta.toLowerCase())) {
    body = `${body}\n\n${reconnectionBrief.cta}`.trim();
  }

  const renderedSubject = ensureSubjectPrefix(renderTemplate(subject, ctx), ctx.lead.firstName);
  const renderedBody = applySignaturePlaceholders(renderTemplate(body, ctx), sender);

  return {
    subject: renderedSubject,
    bodyHtml: normalizeBodyHtml(renderedBody),
  };
}

export async function buildCampaignPersonalization(args: {
  campaign: CampaignShape;
  step: CampaignStepShape;
  stepIndex: number;
  totalSteps: number;
  contactedLead: ContactedLead;
  userId: string;
  organizationId?: string | null;
  matchReason?: string | null;
  daysSinceLastContact?: number;
}): Promise<PersonalizationResult> {
  const settings = normalizeCampaignSettings(args.campaign.settings);
  const reconnection = settings.reconnection || defaultCampaignReconnectionSettings;
  const supabase = getSupabaseAdminClient();
  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, company_name, company_domain, job_title, signatures')
    .eq('id', args.userId)
    .maybeSingle();

  let report: LeadResearchReport | null = null;
  let reportStatus: PersonalizationResult['reportStatus'] = 'missing';
  let researchWarning: string | null = null;

  if (reconnection.enabled && reconnection.autoResearchOnSend) {
    const ensured = await ensureLeadResearchReport({
      userId: args.userId,
      organizationId: args.organizationId,
      lead: args.contactedLead,
      sellerProfile: profile,
    });
    report = ensured.report;
    reportStatus = ensured.report ? (ensured.cacheHit ? 'cache_hit' : 'generated') : 'missing';
    researchWarning = ensured.warning;
  } else if (reconnection.enabled) {
    report = await findCachedLeadResearchReport({
      userId: args.userId,
      organizationId: args.organizationId,
      lead: args.contactedLead,
    });
    reportStatus = report ? 'cache_hit' : 'missing';
  }

  const fallback = buildFallbackDraft({
    lead: args.contactedLead,
    step: args.step,
    senderProfile: profile,
    reconnectionBrief: reconnection.brief,
  });

  const canUseAi = Boolean(
    reconnection.enabled &&
    reconnection.personalizeWithAi &&
    (reconnection.brief.offerName.trim() || reconnection.brief.offerSummary.trim())
  );

  if (!canUseAi) {
    return { ...fallback, report, reportStatus, researchWarning, usedAi: false };
  }

  try {
    const personalized = await generateReconnectionMessage({
      brief: reconnection.brief,
      lead: {
        id: args.contactedLead.leadId || args.contactedLead.id,
        fullName: args.contactedLead.name,
        firstName: String(args.contactedLead.name || '').split(' ')[0] || '',
        email: args.contactedLead.email,
        title: args.contactedLead.role,
        companyName: args.contactedLead.company,
        industry: args.contactedLead.industry,
        city: args.contactedLead.city,
        country: args.contactedLead.country,
      },
      report: report?.cross || report || null,
      senderProfile: getSenderProfileShape(profile),
      step: {
        name: String(args.step.name || `Paso ${args.stepIndex + 1}`),
        offsetDays: Number(args.step.offsetDays || 0),
        stepIndex: args.stepIndex,
        totalSteps: args.totalSteps,
        subjectGuide: String(args.step.subject || ''),
        bodyGuide: String(args.step.bodyHtml || ''),
      },
      interaction: {
        lastContactAt: getLeadLastContactAt(args.contactedLead),
        daysSinceLastContact: args.daysSinceLastContact,
        matchReason: args.matchReason || undefined,
        openedAt: args.contactedLead.openedAt || null,
        clickedAt: args.contactedLead.clickedAt || null,
        repliedAt: args.contactedLead.repliedAt || null,
      },
    });

    const subject = ensureSubjectPrefix(String(personalized.subject || fallback.subject).trim(), String(args.contactedLead.name || '').split(' ')[0] || '');
    const bodyHtml = normalizeBodyHtml(applySignaturePlaceholders(String(personalized.bodyHtml || fallback.bodyHtml), getSenderProfileShape(profile)));

    if (!subject || !bodyHtml.replace(/<[^>]+>/g, '').trim()) {
      return { ...fallback, report, reportStatus, researchWarning, usedAi: false };
    }

    return { subject, bodyHtml, report, reportStatus, researchWarning, usedAi: true };
  } catch (error) {
    console.warn('[campaign-reconnection] personalization fallback:', error);
    return { ...fallback, report, reportStatus, researchWarning, usedAi: false };
  }
}
