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
  role: 'owner' | 'admin' | 'member';
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
