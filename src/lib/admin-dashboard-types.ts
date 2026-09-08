export type AdminReportingGroup = {
  id: string;
  name: string;
  slug: string;
  countryCode: string | null;
  color: string | null;
  memberCount: number;
  active: boolean;
};

export type AdminReportingUser = {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  role: 'owner' | 'admin' | 'member';
  memberSince: string | null;
  lastSignInAt: string | null;
  lastActivityAt: string | null;
  emailConfirmed: boolean;
  groups: Array<{
    id: string;
    name: string;
    primary: boolean;
  }>;
  metrics: {
    leads: number;
    contacted: number;
    researched: number;
    replies: number;
    responseRate: number;
    activeDays: number;
  };
};

export type AdminDimension = {
  label: string;
  value: number;
};

export type AdminDashboardOverview = {
  organization: {
    id: string;
    name: string;
  };
  filterOptions: {
    groups: Array<{ id: string; name: string }>;
    users: Array<{ id: string; name: string }>;
  };
  dateRange: {
    from: string;
    to: string;
  };
  generatedAt: string;
  coverage: {
    eventRows: number;
    sampled: boolean;
    note: string | null;
  };
  summary: {
    leadsCaptured: number;
    leadsContacted: number;
    phonesSearched: number;
    investigations: number;
    emailsSent: number;
    replies: number;
    linkedinConnections: number;
    responseRate: number;
    monthlyProjection: number;
    companiesCaptured: number;
    profilesWithSeniority: number;
  };
  trend: Array<{
    date: string;
    leads: number;
    contacted: number;
    researched: number;
    replies: number;
  }>;
  groups: Array<AdminReportingGroup & {
    metrics: {
      leads: number;
      contacted: number;
      researched: number;
      replies: number;
      responseRate: number;
    };
  }>;
  users: AdminReportingUser[];
  companies: AdminDimension[];
  seniorities: AdminDimension[];
  titles: AdminDimension[];
};

export type AdminCreditMode = 'user' | 'team' | 'hybrid';

export type AdminCreditPolicy = {
  id: string;
  mode: AdminCreditMode | null;
  userDailyLimit: number | null;
  teamDailyLimit: number | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  pending: boolean;
};

export type AdminCreditOverview = {
  organization: { id: string; name: string };
  quotaDay: string;
  nextResetAt: string;
  defaultPolicy: {
    current: AdminCreditPolicy;
    pending: AdminCreditPolicy | null;
  };
  teams: Array<{
    id: string;
    name: string;
    memberCount: number;
    currentLimit: number;
    pendingPolicy: AdminCreditPolicy | null;
    usage: number;
  }>;
  users: Array<{
    id: string;
    name: string;
    email: string;
    role: 'owner' | 'admin' | 'member';
    primaryTeam: { id: string; name: string } | null;
    pendingTeam: { id: string; name: string } | null;
    mode: AdminCreditMode;
    userLimit: number;
    teamLimit: number | null;
    userUsage: number | null;
    teamUsage: number | null;
    binding: 'user' | 'team';
    pendingPolicy: AdminCreditPolicy | null;
  }>;
};
