import {
  hasUsableDraftSellerOfferV2,
  normalizeDraftSellerProfileV2,
  type DraftSellerProfileV2,
} from '@/lib/server/draft-context-v2';
import type { SellerProfileContextV2, SellerProductContextV2 } from '@/ai/flows/reason-about-report-v2-account';
import { canonicalSha256 } from '@/lib/messaging-contracts';
import { IcpRulesV2Schema, type IcpRulesV2 } from '@/qualification/icp-gate';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';

export const REPORT_V2_SELLER_CONFIGURATION_VERSION = 'report-v2/seller-configuration/1';

export type ReportV2Mode = 'off' | 'shadow' | 'visible';
export type ReportQuestionnaireMode = 'off' | 'shadow' | 'visible';

export type LoadedReportV2SellerConfiguration = {
  mode: ReportV2Mode;
  questionnaireMode: ReportQuestionnaireMode;
  sellerProfile: SellerProfileContextV2;
  icpRules: IcpRulesV2 | null;
  profileRevision: number | null;
  synthesisContextHash: string;
};

function text(value: unknown) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function object(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

function list(value: unknown) {
  const values = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[,;\n|•]+/g)
      : [];
  return [...new Set(values.map(text).filter(Boolean))].slice(0, 50);
}

function reportV2Mode(value: unknown): ReportV2Mode {
  const mode = text(value).toLowerCase();
  return mode === 'shadow' || mode === 'visible' ? mode : 'off';
}

function reportQuestionnaireMode(value: unknown): ReportQuestionnaireMode {
  const mode = text(value).toLowerCase();
  return mode === 'shadow' || mode === 'visible' ? mode : 'off';
}

function productKey(value: unknown, index: number) {
  const normalized = text(value).toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120);
  return normalized || `product-${index + 1}`;
}

function normalizeReportV2Products(value: unknown): SellerProductContextV2[] {
  return (Array.isArray(value) ? value : []).flatMap((item, index) => {
    const product = object(item);
    const name = text(product.name || product.label);
    const key = productKey(product.key || product.id || name, index);
    const assumptions = object(product.volumeAssumptions || product.volume_assumptions);
    const multipliers = (Array.isArray(assumptions.scenarioMultipliers)
      ? assumptions.scenarioMultipliers
      : Array.isArray(assumptions.scenario_multipliers)
        ? assumptions.scenario_multipliers
        : [])
      .map(Number)
      .filter((number) => Number.isFinite(number) && number > 0)
      .slice(0, 3);
    const minutesPerEvent = Number(assumptions.minutesPerEvent ?? assumptions.minutes_per_event);
    return [{
      key,
      name: name || null,
      description: text(product.description) || null,
      jurisdictions: list(product.jurisdictions || product.countries),
      regulatoryContext: text(product.regulatoryContext || product.regulatory_context) || null,
      capabilities: list(product.capabilities || product.services),
      positioning: text(product.positioning || product.valueProposition || product.value_proposition) || null,
      volumeAssumptions: multipliers.length === 3 && Number.isFinite(minutesPerEvent) && minutesPerEvent > 0
        ? { scenarioMultipliers: multipliers, minutesPerEvent }
        : null,
    }];
  }).slice(0, 50);
}

function reportV2ProfileFromPersonal(profile: DraftSellerProfileV2): SellerProfileContextV2 {
  return {
    companyName: profile.companyName,
    products: [{
      key: 'personal-offer',
      name: profile.companyName,
      description: profile.description,
      jurisdictions: null,
      regulatoryContext: null,
      capabilities: profile.services,
      positioning: profile.valueProposition,
      volumeAssumptions: null,
    }],
  };
}

export function normalizeSellerProfile(value: unknown): DraftSellerProfileV2 {
  const profile = object(value);
  const extended = object(object(profile.signatures).profile_extended);
  return normalizeDraftSellerProfileV2({
    name: profile.name || profile.full_name || null,
    jobTitle: profile.jobTitle || profile.job_title || extended.role || null,
    companyName: profile.companyName || profile.company_name || 'Mi empresa',
    companyDomain: profile.companyDomain || profile.company_domain || null,
    sector: profile.sector || extended.sector || extended.industry || null,
    description: profile.description || extended.description || null,
    services: list(profile.services ?? extended.services),
    valueProposition: profile.valueProposition
      || profile.value_proposition
      || extended.valueProposition
      || extended.value_proposition
      || null,
    proofPoints: list(profile.proofPoints ?? profile.proof_points ?? extended.proofPoints ?? extended.proof_points),
  });
}

const SELLER_PROFILE_COLUMNS = 'full_name,job_title,company_name,company_domain,signatures';

/**
 * The person's own offer, or, while they have not written one, the offer of an owner or admin of the same organization.
 * A draft without an offer is blocked (draft-context-v2.ts, `seller_profile_incomplete`): in production 25 of 28 people
 * of the main organization had none, so nobody but the admin could draft. The sender stays the person: name and role are
 * always theirs, and filling «Perfil» replaces the borrowed offer (docs/ia-medida.md).
 */
export async function loadSellerProfile(
  userId: string,
  organizationId?: string | null,
  admin: any = null,
): Promise<DraftSellerProfileV2> {
  let personal: DraftSellerProfileV2;
  try {
    const client = admin || getSupabaseAdminClient();
    const { data, error } = await client
      .from('profiles')
      .select(SELLER_PROFILE_COLUMNS)
      .eq('id', userId)
      .maybeSingle();
    if (error) throw error;
    personal = normalizeSellerProfile(data || {});
  } catch (error) {
    console.warn('[seller-profile] profile unavailable; using a neutral profile:', error);
    return normalizeSellerProfile({});
  }
  if (!organizationId || hasUsableDraftSellerOfferV2(personal)) return personal;

  try {
    const organizationOffer = await loadOrganizationOffer(admin || getSupabaseAdminClient(), organizationId, userId);
    if (!organizationOffer) return personal;
    return normalizeDraftSellerProfileV2({
      ...organizationOffer,
      name: personal.name,
      jobTitle: personal.jobTitle,
      companyName: personal.companyName !== 'Mi empresa' ? personal.companyName : organizationOffer.companyName,
      companyDomain: personal.companyDomain || organizationOffer.companyDomain,
      sector: personal.sector || organizationOffer.sector,
    });
  } catch (error) {
    console.warn('[seller-profile] organization offer unavailable:', error);
    return personal;
  }
}

/** The first owner or admin of the organization (oldest first) whose profile has a usable offer. */
async function loadOrganizationOffer(admin: any, organizationId: string, userId: string): Promise<DraftSellerProfileV2 | null> {
  const { data: leaders, error: leadersError } = await admin
    .from('organization_members')
    .select('user_id, role, created_at')
    .eq('organization_id', organizationId)
    .in('role', ['owner', 'admin'])
    .order('created_at', { ascending: true })
    .limit(10);
  if (leadersError) throw leadersError;
  const ids = ((leaders || []) as Array<{ user_id: string }>).map((leader) => text(leader.user_id)).filter((id) => id && id !== userId);
  if (ids.length === 0) return null;
  const { data: profiles, error: profilesError } = await admin
    .from('profiles')
    .select(`id,${SELLER_PROFILE_COLUMNS}`)
    .in('id', ids);
  if (profilesError) throw profilesError;
  const byId = new Map(((profiles || []) as Array<Record<string, unknown>>).map((profile) => [text(profile.id), profile]));
  for (const id of ids) {
    const candidate = byId.get(id);
    if (!candidate) continue;
    const normalized = normalizeSellerProfile(candidate);
    if (hasUsableDraftSellerOfferV2(normalized)) return normalized;
  }
  return null;
}

export async function loadReportV2SellerConfiguration(input: {
  organizationId: string;
  userId: string;
}, admin: any = getSupabaseAdminClient()): Promise<LoadedReportV2SellerConfiguration> {
  const { data: settings, error: settingsError } = await admin
    .from('antonia_workflow_settings')
    .select('user_company_profile,icp,research_config,profile_revision')
    .eq('organization_id', input.organizationId)
    .maybeSingle();
  if (settingsError) throw settingsError;

  const researchConfig = object(settings?.research_config);
  const mode = reportV2Mode(researchConfig.reportV2Mode ?? researchConfig.report_v2_mode);
  const questionnaireMode = reportQuestionnaireMode(
    researchConfig.reportQuestionnaireMode ?? researchConfig.report_questionnaire_mode,
  );
  const sharedProfile = object(settings?.user_company_profile);
  const sharedProducts = normalizeReportV2Products(sharedProfile.products);
  let sellerProfile: SellerProfileContextV2;
  if (sharedProducts.length > 0) {
    sellerProfile = {
      companyName: text(sharedProfile.companyName || sharedProfile.company_name || sharedProfile.name) || null,
      products: sharedProducts,
    };
  } else {
    const { data: personal, error: personalError } = await admin
      .from('profiles')
      .select('full_name,job_title,company_name,company_domain,signatures')
      .eq('id', input.userId)
      .maybeSingle();
    if (personalError) throw personalError;
    sellerProfile = reportV2ProfileFromPersonal(normalizeSellerProfile(personal || {}));
  }

  const rawIcp = Object.keys(object(settings?.icp)).length > 0
    ? settings?.icp
    : sharedProfile.icpRules || sharedProfile.icp_rules;
  const parsedIcp = rawIcp == null || Object.keys(object(rawIcp)).length === 0
    ? null
    : IcpRulesV2Schema.safeParse(rawIcp);
  if (parsedIcp && !parsedIcp.success) throw new Error('REPORT_V2_ICP_CONFIGURATION_INVALID');
  const icpRules = parsedIcp?.data || null;
  const profileRevision = Number.isInteger(settings?.profile_revision)
    ? Number(settings.profile_revision)
    : null;
  const synthesisContextHash = canonicalSha256({
    version: REPORT_V2_SELLER_CONFIGURATION_VERSION,
    mode,
    profileRevision,
    sellerProfile,
    icpRules,
  });
  return { mode, questionnaireMode, sellerProfile, icpRules, profileRevision, synthesisContextHash };
}

export const sellerProfileInternals = {
  list,
  normalizeSellerProfile,
  normalizeReportV2Products,
  reportV2Mode,
  reportQuestionnaireMode,
  reportV2ProfileFromPersonal,
};
