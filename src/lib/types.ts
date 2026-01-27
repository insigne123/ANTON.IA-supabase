// Apify → ítem crudo que retorna el actor
export interface ApifyLead {
  id?: string;
  // Persona
  first_name?: string;
  last_name?: string;
  full_name?: string; // a veces es 'name'
  name?: string;
  title?: string;
  email?: string | null;
  email_status?: string | null;
  linkedin_url?: string | null;
  photo_url?: string | null;
  // Ubicación persona (a veces vacío)
  state?: string | null;
  city?: string | null;
  country?: string | null;
  // Organización (flat)
  organization_id?: string;
  organization_name?: string;
  organization_website_url?: string | null;
  organization_linkedin_url?: string | null;
  organization_location_city?: string | null;
  organization_location_state?: string | null;
  organization_location_country?: string | null;
  organization_industry?: string | null;
  organization_logo_url?: string | null;
  // Organización (nested)
  organization?: {
    id?: string;
    name?: string;
    website_url?: string | null;
    linkedin_url?: string | null;
    city?: string | null;
    state?: string | null;
    country?: string | null;
    industry?: string | null;
    logo_url?: string | null;
  };
}

// Lo que tu UI consume
export interface Lead {
  id: string;
  userId?: string;
  organizationId?: string;
  name: string;
  title: string;
  company: string;
  email?: string | null;
  avatar: string;
  status: 'saved' | 'investigated' | 'contacted' | string;
  emailEnrichment?: {
    enriched: boolean;
    enrichedAt?: string;
    source?: 'original' | 'anymail_finder' | 'n8n';
    confidence?: number;
    creditsUsed?: number;
  };
  industry?: string | null;
  companyWebsite?: string | null;
  companyLinkedin?: string | null;
  linkedinUrl?: string | null;
  location?: string;
  country?: string | null;
  city?: string | null;
}

export type SavedLead = Lead;

// ⬇️ incluye 'read' y metadatos de respuesta
export type ContactStatus = 'sent' | 'replied' | 'scheduled' | 'queued' | 'failed';

export interface ContactedLead {
  id: string;
  organizationId?: string;
  leadId?: string;
  name: string;
  email: string;
  company?: string;
  role?: string;
  industry?: string;
  city?: string;
  country?: string;

  subject: string;
  sentAt: string;
  status: ContactStatus;

  provider: 'gmail' | 'outlook' | 'linkedin' | 'phone';
  messageId?: string;
  conversationId?: string; // Outlook
  threadId?: string;       // Gmail
  internetMessageId?: string;

  // NUEVO: tracking robusto (no cambia 'status')
  openedAt?: string;                   // cuándo se confirmó apertura por MDN
  clickedAt?: string;                  // cuándo se hizo click en un enlace
  clickCount?: number;                 // cuántas veces se hizo click
  deliveredAt?: string;                // cuándo se confirmó entrega por DSN
  readReceiptMessageId?: string;       // id del correo de MDN
  deliveryReceiptMessageId?: string;   // id del correo de DSN

  lastUpdateAt?: string;

  // respuesta
  replyMessageId?: string;
  replySubject?: string;
  replyPreview?: string;
  repliedAt?: string;
  followUpCount?: number;
  lastFollowUpAt?: string;
  lastStepIdx?: number; // índice de paso enviado (0-based)
  replySnippet?: string;

  // Smart Planner
  scheduledAt?: string; // ISO Date

  // LinkedIn specifics
  linkedinThreadUrl?: string;
  linkedinMessageStatus?: 'sent' | 'queued' | 'failed' | 'replied';
  lastReplyText?: string;
}

export interface ContactedOpportunity extends Omit<ContactedLead, 'leadId'> {
  opportunityId?: string;
}

export interface LeadsApiResponse {
  totalRecords: number;
  results: ApifyLead[];
}

// Nuevas interfaces para enriquecimiento de emails
export interface AnyEmailFinderRequest {
  domain?: string;
  company_name?: string;
  first_name?: string;
  last_name?: string;
  full_name?: string;
}

export interface AnyEmailFinderResponse {
  success: boolean;
  email?: string;
  confidence?: number;
  status?: 'valid' | 'risky' | 'unknown';
  credits_used?: number;
  error?: string;
}

// --- OPORTUNIDADES ---
export type JobOpportunity = {
  id: string;
  title: string;
  companyName: string;
  companyLinkedinUrl?: string;
  companyDomain?: string;
  location?: string;
  publishedAt?: string;
  postedTime?: string;
  jobUrl: string;
  applyUrl?: string;
  descriptionSnippet?: string;
  workType?: 'on_site' | 'hybrid' | 'remote';
  contractType?: 'full' | 'part' | 'contract' | 'temp' | 'intern' | 'volunteer';
  experienceLevel?: '1' | '2' | '3' | '4' | '5';
  source?: 'linkedin';
};

export type CompanyTarget = {
  companyName: string;
  companyDomain?: string;
  companyLinkedinUrl?: string;
  sourceJobIds: string[];
};

export type LeadFromApollo = {
  id?: string;
  fullName: string;
  title: string;
  email?: string;
  lockedEmail?: boolean;
  guessedEmail?: boolean;
  linkedinUrl?: string;
  location?: string;
  companyName?: string;
  companyDomain?: string;
};

export type EnrichedLead = {
  id: string;
  apolloId?: string; // New field for integration
  organizationId?: string;
  sourceOpportunityId?: string;
  fullName: string;
  title?: string;
  email?: string;
  emailStatus?: 'verified' | 'guessed' | 'locked' | 'unknown' | 'not_found';
  linkedinUrl?: string;
  companyName?: string;
  companyDomain?: string;
  descriptionSnippet?: string;
  createdAt: string;

  // Location fields
  country?: string;
  state?: string;
  city?: string;

  // Professional details
  headline?: string;
  photoUrl?: string;
  seniority?: string;
  departments?: string[];

  // Organization details
  organizationDomain?: string;
  organizationIndustry?: string;
  organizationSize?: number;

  // Legacy location field (for backwards compatibility)
  industry?: string;

  // Phone Enrichment
  phoneNumbers?: Array<{
    raw_number: string;
    sanitized_number: string;
    type: string;
    position: string;
    status: string;
  }> | null;
  primaryPhone?: string | null;
  enrichmentStatus?: 'completed' | 'pending_phone' | 'failed' | string;

  // Metadata
  updatedAt?: string;

  report?: CrossReport; // Persistent Report
};

export type EnrichedOppLead = {
  id: string;
  sourceOpportunityId?: string;
  fullName: string;
  title?: string;
  email?: string;
  emailStatus?: 'verified' | 'guessed' | 'locked' | 'unknown' | 'not_found';
  linkedinUrl?: string;
  companyName?: string;
  companyDomain?: string;
  descriptionSnippet?: string;
  createdAt: string;

  // Location fields
  country?: string;
  state?: string;
  city?: string;

  // Professional details
  headline?: string;
  photoUrl?: string;
  seniority?: string;
  departments?: string[];

  // Organization details
  organizationDomain?: string;
  organizationIndustry?: string;
  organizationSize?: number;

  // Legacy field
  industry?: string;

  phoneNumbers?: Array<{
    raw_number: string;
    sanitized_number: string;
    type: string;
    position: string;
    status: string;
  }> | null;
  primaryPhone?: string | null;
  enrichmentStatus?: 'completed' | 'pending_phone' | 'failed' | string;
  updatedAt?: string;
  report?: CrossReport; // Persistent Report
};

export type N8nCompanyResearchInput = {
  companyName: string;
  industry?: string;
  country?: string;
  location?: string;
  domain?: string;
};

export type CrossReport = {
  company: {
    name: string;
    domain?: string;
    linkedin?: string;
    industry?: string;
    country?: string;
    website?: string;
  };
  overview: string;
  pains: string[];
  opportunities: string[];
  risks: string[];
  valueProps: string[];
  useCases: string[];
  talkTracks: string[];
  subjectLines: string[];
  emailDraft: { subject: string; body: string };
  sources?: Array<{ title?: string; url: string }>;
  leadContext?: {
    iceBreaker?: string | null;
    recentActivitySummary?: string | null;
    foundRecentActivity?: boolean;
    profileSummary?: string;
  };
};

export type LeadResearchReport = {
  id: string;
  company: {
    name: string;
    domain?: string;
    linkedin?: string;
    industry?: string;
    country?: string;
    website?: string;
    size?: string | number;
  };
  websiteSummary?: { overview?: string; services?: string[]; sources: Array<{ url: string; title?: string }> };
  signals?: Array<{ type: 'news' | 'hiring' | 'tech' | 'site'; title: string; url?: string; when?: string }>;
  createdAt: string;
  cross?: CrossReport;
  raw?: any;
  enhanced?: EnhancedReport;
  meta?: { leadRef?: string | null };
};

export type EnhancedReport = {
  overview: string;
  pains: string[];
  opportunities: string[];
  risks: string[];
  valueProps: string[];
  useCases: string[];
  suggestedContacts?: string[];
  talkTracks: string[];
  subjectLines: string[];
  emailDraft: { subject: string; body: string };
};

export type EmailScope = 'leads' | 'opportunities';
export type AiIntensity = 'none' | 'light' | 'medium' | 'rewrite';
export type EmailTone = 'professional' | 'warm' | 'direct' | 'challenger' | 'brief';
export type EmailLength = 'short' | 'medium' | 'long';

export type EmailTemplate = {
  id: string;
  name: string;
  scope: EmailScope;
  authoring: 'user' | 'system';
  aiIntensity: AiIntensity;
  tone: EmailTone;
  length: EmailLength;
  subject: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  description?: string;
};

export type RenderInput = {
  template: EmailTemplate;
  mode: EmailScope;
  data: {
    companyProfile: any;
    report?: any;
    lead?: any;
    job?: any;
  };
};

export type RenderResult = { subject: string; body: string; warnings?: string[] };
export type RenderRequest = {
  templateId: string;
  aiIntensity?: AiIntensity;
  tone?: EmailTone;
  length?: EmailLength;
  mode: EmailScope;
  data: RenderInput['data'];
};

// === Conversational Email Designer ===
export type ChatRole = 'user' | 'assistant' | 'system';
export type ChatMessage = { id?: string; role: ChatRole; content: string; createdAt?: string };

export type StyleProfile = {
  scope: 'leads' | 'opportunities';
  name: string;
  tone?: 'professional' | 'warm' | 'direct' | 'challenger' | 'brief';
  length?: 'short' | 'medium' | 'long';
  structure?: Array<'hook' | 'context' | 'value' | 'proof' | 'cta'>;
  do?: string[];
  dont?: string[];
  personalization?: { useLeadName?: boolean; useCompanyName?: boolean; useReportSignals?: boolean; };
  cta?: { label?: string; duration?: string };
  language?: 'es' | 'en';
  constraints?: { noFabrication?: boolean; noSensitiveClaims?: boolean };
  tokens?: string[];
  updatedAt?: string;

  /** NUEVO: plantillas que definen el formato real del correo */
  subjectTemplate?: string;
  bodyTemplate?: string;
};


// --- CAMPAIGNS ---
export type CampaignStatus = 'active' | 'paused';

export type CampaignStepAttachment = {
  name: string;
  contentBytes: string;
  contentType?: string;
};

export type CampaignStep = {
  offsetDays: number;
  subjectTemplate: string;
  bodyTemplate: string;
  attachments?: CampaignStepAttachment[];
};

export type Campaign = {
  id: string;
  organizationId?: string;
  name: string;
  status: CampaignStatus;
  steps: CampaignStep[];
  excludeLeadIds?: string[];
  createdAt: string;
  updatedAt: string;
  // Progreso por lead (independiente por campaña)
  sentRecords?: Record<string, { lastStepIdx: number; lastSentAt: string }>;
};

// --- ORGANIZATIONS ---
export type OrganizationRole = 'owner' | 'admin' | 'member';

export interface Organization {
  id: string;
  name: string;
  createdAt: string;
  social_search_credits?: number;
  feature_social_search_enabled?: boolean;
}

export interface OrganizationMember {
  organizationId: string;
  userId: string;
  role: OrganizationRole;
  createdAt: string;
}

// --- COMMENTS ---
export interface Comment {
  id: string;
  organizationId: string;
  userId: string;
  entityType: string;
  entityId: string;
  content: string;
  createdAt: string;
  user?: {
    fullName: string;
    avatarUrl?: string;
    email?: string;
  };
}

// --- SAVED SEARCHES ---
export interface SavedSearch {
  id: string;
  organizationId: string;
  userId: string;
  name: string;
  criteria: any; // JSONB
  isShared: boolean;
  createdAt: string;
  user?: {
    fullName: string;
    avatarUrl?: string;
  };
}

// --- ANTONIA AUTOMATION ---
export interface AntoniaConfig {
  organizationId: string;
  notificationEmail?: string;
  dailyReportEnabled: boolean;
  instantAlertsEnabled: boolean;
  dailySearchLimit?: number;
  dailyEnrichLimit?: number;
  dailyInvestigateLimit?: number;
  trackingEnabled?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface IntegrationToken {
  userId: string;
  provider: 'google' | 'outlook';
  refreshToken: string; // Stored encrypted? In client, we might just see a flag/placeholder
  updatedAt: string;
}

export type AntoniaMissionStatus = 'active' | 'paused' | 'completed' | 'failed';

export interface AntoniaMission {
  id: string;
  organizationId: string;
  userId: string;
  title: string;
  status: AntoniaMissionStatus;
  goalSummary?: string;
  params: any; // JSONB
  createdAt: string;
  updatedAt: string;
}

export type AntoniaTaskType = 'SEARCH' | 'ENRICH' | 'CONTACT' | 'REPORT' | 'ALERT' | 'GENERATE_REPORT' | 'CONTACT_CAMPAIGN' | 'CONTACT_INITIAL' | 'EVALUATE' | 'INVESTIGATE' | 'GENERATE_CAMPAIGN';
export type AntoniaTaskStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface AntoniaTask {
  id: string;
  missionId?: string;
  organizationId: string;
  type: AntoniaTaskType;
  status: AntoniaTaskStatus;
  payload: any;
  result?: any;
  errorMessage?: string;
  processingStartedAt?: string;
  idempotencyKey?: string;
  createdAt: string;
  updatedAt: string;
}

export type AntoniaLogLevel = 'info' | 'success' | 'warning' | 'error';

export interface AntoniaLog {
  id: string;
  missionId?: string;
  organizationId?: string;
  level: AntoniaLogLevel;
  message: string;
  details?: any;
  createdAt: string;
}

export interface AntoniaMetric {
  id: string;
  missionId?: string;
  metricType: string;
  value: number;
  context?: any;
  recordedAt: string;
}

export type AntoniaSuggestionType = 'feature' | 'optimization' | 'bug';

export interface AntoniaAppSuggestion {
  id: string;
  suggestionType: AntoniaSuggestionType;
  description: string;
  context?: string;
  suggestedByMissionId?: string;
  isRead: boolean;
  createdAt: string;
}
