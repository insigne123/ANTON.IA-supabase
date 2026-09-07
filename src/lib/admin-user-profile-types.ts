export type AdminUserProfileRole = 'owner' | 'admin' | 'member';

export type AdminUserProfileGroup = {
  id: string;
  name: string;
  primary: boolean;
  assignedAt: string;
};

export type AdminUserCreditBucket = {
  used: number;
  limit: number;
  remaining: number;
};

export type AdminUserCreditStatus = {
  allowed: boolean;
  mode: 'user' | 'team' | 'hybrid';
  binding: 'user' | 'team';
  dayKey: string;
  resetAt: string;
  used: number;
  limit: number;
  remaining: number;
  legacy: boolean;
  groupId: string | null;
  groupName: string | null;
  user: AdminUserCreditBucket | null;
  team: AdminUserCreditBucket | null;
};

export type AdminUserTimelineSource =
  | 'antonia_event_ledger'
  | 'activity_logs'
  | 'leads'
  | 'contacted_leads'
  | 'lead_research_jobs';

export type AdminUserTimelineItem = {
  id: string;
  source: AdminUserTimelineSource;
  category: 'lead' | 'outreach' | 'reply' | 'research' | 'account' | 'system';
  occurredAt: string;
  title: string;
  detail: string | null;
  status: string | null;
};

export type AdminUserProfile = {
  organization: {
    id: string;
    name: string;
  };
  user: {
    id: string;
    name: string;
    email: string;
    avatarUrl: string | null;
    role: AdminUserProfileRole;
    memberSince: string;
    accountCreatedAt: string | null;
    lastSignInAt: string | null;
    emailConfirmed: boolean;
  };
  groups: AdminUserProfileGroup[];
  credit: AdminUserCreditStatus;
  period: {
    from: string;
    to: string;
    days: 90;
  };
  metrics: {
    leadsCreated: number;
    contactsSent: number;
    repliesReceived: number;
    researchJobs: number;
    activeDays: number;
  };
  timeline: AdminUserTimelineItem[];
  coverage: {
    unavailableSources: AdminUserTimelineSource[];
    timelineLimited: boolean;
  };
  generatedAt: string;
};
