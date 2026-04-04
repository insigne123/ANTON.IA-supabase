export type AntoniaPlaybook = {
  id: string;
  name: string;
  vertical: string;
  summary: string;
  whyItWorks: string;
  defaults: {
    jobTitle: string;
    location: string;
    industry: string;
    keywords: string;
    companySize: string;
    seniorities: string[];
    missionName: string;
    targetOutcome: 'meetings' | 'positive_replies' | 'pipeline';
    targetMeetings: number;
    targetPositiveReplies: number;
    targetTimelineDays: number;
    idealCustomerProfile: string;
    valueProposition: string;
    enrichmentLevel: 'basic' | 'deep';
    campaignContext: string;
    autoGenerateCampaign: boolean;
    dailySearchLimit: number;
    dailyEnrichLimit: number;
    dailyInvestigateLimit: number;
    dailyContactLimit: number;
  };
};

export const ANTONIA_OUTSOURCING_PLAYBOOKS: AntoniaPlaybook[] = [
  {
    id: 'hr-outsourcing-retail',
    name: 'HR Outsourcing Retail',
    vertical: 'Retail',
    summary: 'Target HR leaders in retail chains with hiring peaks and distributed operations.',
    whyItWorks: 'Retail teams feel pain around turnover, seasonal demand and multi-site staffing.',
    defaults: {
      jobTitle: 'Gerente de RRHH',
      location: 'Chile',
      industry: 'Retail',
      keywords: 'rotacion, dotacion, staffing estacional, multiples sucursales',
      companySize: '201-500',
      seniorities: ['director', 'manager', 'head'],
      missionName: 'Outsourcing RRHH Retail Chile',
      targetOutcome: 'meetings',
      targetMeetings: 8,
      targetPositiveReplies: 14,
      targetTimelineDays: 30,
      idealCustomerProfile: 'Retailers con multiples sucursales, alta rotacion y picos estacionales de contratacion.',
      valueProposition: 'Reducir tiempo de cobertura y rotacion operacional con outsourcing de RRHH flexible.',
      enrichmentLevel: 'deep',
      campaignContext: 'Habla de reduccion de rotacion, rapidez de cobertura y coordinacion multi-sucursal.',
      autoGenerateCampaign: true,
      dailySearchLimit: 2,
      dailyEnrichLimit: 15,
      dailyInvestigateLimit: 10,
      dailyContactLimit: 8,
    },
  },
  {
    id: 'it-staffing-midmarket',
    name: 'IT Staffing Mid Market',
    vertical: 'Technology',
    summary: 'Find technology and product leaders that need external hiring capacity fast.',
    whyItWorks: 'Fast growing software teams often need recruiting help without building bigger internal teams.',
    defaults: {
      jobTitle: 'Head of Talent',
      location: 'Chile, Peru, Colombia',
      industry: 'Technology',
      keywords: 'staff augmentation, hiring velocity, recruiting bottleneck, tech roles',
      companySize: '51-200',
      seniorities: ['director', 'head', 'manager', 'vp'],
      missionName: 'IT Staffing Mid Market Andino',
      targetOutcome: 'meetings',
      targetMeetings: 6,
      targetPositiveReplies: 10,
      targetTimelineDays: 30,
      idealCustomerProfile: 'Equipos de tecnologia mid-market con planes de crecimiento y cuellos de botella de contratacion.',
      valueProposition: 'Acelerar contratacion TI y staff augmentation sin agrandar el equipo interno de recruiting.',
      enrichmentLevel: 'deep',
      campaignContext: 'Enfatiza velocidad de contratacion, cobertura de perfiles TI y calidad de shortlist.',
      autoGenerateCampaign: true,
      dailySearchLimit: 3,
      dailyEnrichLimit: 20,
      dailyInvestigateLimit: 12,
      dailyContactLimit: 10,
    },
  },
  {
    id: 'payroll-bpo-enterprise',
    name: 'Payroll BPO Enterprise',
    vertical: 'Enterprise Services',
    summary: 'Reach finance and operations leaders in companies with complex payroll or compliance needs.',
    whyItWorks: 'Large operations suffer when payroll and labor compliance become operational bottlenecks.',
    defaults: {
      jobTitle: 'Gerente de Finanzas',
      location: 'Chile, Argentina',
      industry: 'Manufacturing',
      keywords: 'payroll, compliance laboral, procesos repetitivos, externalizacion administrativa',
      companySize: '501-1000',
      seniorities: ['director', 'manager', 'cxo', 'vp'],
      missionName: 'Payroll BPO Enterprise Sur',
      targetOutcome: 'positive_replies',
      targetMeetings: 4,
      targetPositiveReplies: 8,
      targetTimelineDays: 45,
      idealCustomerProfile: 'Operaciones complejas con payroll multi-site y alta carga administrativa/compliance.',
      valueProposition: 'Externalizar payroll y procesos administrativos para bajar riesgo operativo y carga interna.',
      enrichmentLevel: 'basic',
      campaignContext: 'Habla de exactitud operativa, compliance y ahorro de carga administrativa.',
      autoGenerateCampaign: true,
      dailySearchLimit: 2,
      dailyEnrichLimit: 12,
      dailyInvestigateLimit: 6,
      dailyContactLimit: 6,
    },
  },
  {
    id: 'seasonal-operations-staffing',
    name: 'Seasonal Operations Staffing',
    vertical: 'Operations',
    summary: 'Go after operations teams that need temporary or surge staffing support.',
    whyItWorks: 'Seasonal peaks create urgent demand and a short decision window.',
    defaults: {
      jobTitle: 'Gerente de Operaciones',
      location: 'Chile, Mexico',
      industry: 'Logistics',
      keywords: 'peak season, dotacion temporal, cobertura operativa, turnos',
      companySize: '201-500',
      seniorities: ['director', 'manager', 'head'],
      missionName: 'Staffing Operaciones Temporada Alta',
      targetOutcome: 'meetings',
      targetMeetings: 7,
      targetPositiveReplies: 12,
      targetTimelineDays: 21,
      idealCustomerProfile: 'Equipos operacionales con peaks estacionales, turnos y urgencia de cobertura.',
      valueProposition: 'Cubrir demanda operativa temporal rapido sin comprometer continuidad operacional.',
      enrichmentLevel: 'basic',
      campaignContext: 'Posiciona capacidad de respuesta rapida y cobertura operacional en temporada alta.',
      autoGenerateCampaign: true,
      dailySearchLimit: 2,
      dailyEnrichLimit: 18,
      dailyInvestigateLimit: 8,
      dailyContactLimit: 12,
    },
  },
  {
    id: 'recruitment-startups-growth',
    name: 'Recruiting For Growth Startups',
    vertical: 'Startups',
    summary: 'Focus on startup growth teams that need external recruiting without losing speed.',
    whyItWorks: 'Startups value speed, specialization and flexibility more than large process heavy vendors.',
    defaults: {
      jobTitle: 'People Manager',
      location: 'Remote, Chile, Mexico',
      industry: 'Computer Software',
      keywords: 'growth hiring, startup recruiting, talent partner, specialized roles',
      companySize: '11-50',
      seniorities: ['manager', 'head', 'director'],
      missionName: 'Recruiting Startups Growth',
      targetOutcome: 'positive_replies',
      targetMeetings: 5,
      targetPositiveReplies: 9,
      targetTimelineDays: 30,
      idealCustomerProfile: 'Startups en crecimiento con hiring urgency y roles especializados que frenan expansion.',
      valueProposition: 'Aportar recruiting flexible y especializado para crecer sin perder velocidad.',
      enrichmentLevel: 'deep',
      campaignContext: 'Enfatiza rapidez, especializacion y flexibilidad para roles clave de crecimiento.',
      autoGenerateCampaign: true,
      dailySearchLimit: 3,
      dailyEnrichLimit: 20,
      dailyInvestigateLimit: 10,
      dailyContactLimit: 10,
    },
  },
];

export function getAntoniaPlaybookById(playbookId: string) {
  return ANTONIA_OUTSOURCING_PLAYBOOKS.find((playbook) => playbook.id === playbookId) || null;
}
