import type { Lead, ContactedLead } from './types';

export const companyProfile = {
  name: 'Innovatech Solutions',
  sector: 'Technology',
  description: 'Leading provider of innovative cloud-based solutions for enterprise customers. Our mission is to empower businesses with cutting-edge technology, driving growth and efficiency.',
  website: 'https://innovatech.com',
  contactInfo: 'contact@innovatech.com',
  logo: '/logo-placeholder.svg',
  services: 'Cloud hosting, AI-driven analytics, enterprise software',
  valueProposition: 'We help businesses scale faster and more securely than any other provider.',
  customMessage: 'Hi [Lead Name],\n\nI came across your profile on LinkedIn and was really impressed with your experience at [Company Name]. At Innovatech Solutions, we\'re helping companies in your industry to streamline their operations and boost productivity with our latest AI-driven platform.\n\nI\'d love to briefly connect and see if we could be a good fit for your current challenges.\n\nBest,',
  emailSignature: '--\nJohn Doe\nGrowth Manager\nInnovatech Solutions\n(555) 123-4567 | innovatech.com',
};

export const leads: Lead[] = [
  { id: '1', name: 'Alice Johnson', company: 'QuantumCorp', title: 'Marketing Director', email: 'alice.j@quantum.co', avatar: 'https://placehold.co/40x40.png?a=1', status: 'saved' },
  { id: '2', name: 'Bob Williams', company: 'Nexus Inc.', title: 'Product Manager', email: 'bob.w@nexus.io', avatar: 'https://placehold.co/40x40.png?a=2', status: 'investigated' },
  { id: '3', name: 'Charlie Brown', company: 'Stellar LLC', title: 'CTO', email: 'charlie@stellar.dev', avatar: 'https://placehold.co/40x40.png?a=3', status: 'saved' },
  { id: '4', name: 'Diana Miller', company: 'Apex Solutions', title: 'Sales Executive', email: 'diana.m@apex.com', avatar: 'https://placehold.co/40x40.png?a=4', status: 'investigated' },
  { id: '5', name: 'Ethan Davis', company: 'Momentum Co.', title: 'CEO', email: 'ethan.d@momentum.co', avatar: 'https://placehold.co/40x40.png?a=5', status: 'saved' },
  { id: '6', name: 'Fiona Garcia', company: 'Synergy Ltd.', title: 'Head of Operations', email: 'f.garcia@synergy.org', avatar: 'https://placehold.co/40x40.png?a=6', status: 'investigated' },
  { id: '7', name: 'George Clark', company: 'Pioneer Group', title: 'VP of Engineering', email: 'g.clark@pioneer.net', avatar: 'https://placehold.co/40x40.png?a=7', status: 'saved' },
  { id: '8', name: 'Hannah Rodriguez', company: 'Zenith Systems', title: 'HR Manager', email: 'h.rodriguez@zenith.sys', avatar: 'https://placehold.co/40x40.png?a=8', status: 'investigated' },
];

export const contactedLeads: ContactedLead[] = [
  { id: '1', name: 'Isabella Martinez', email: 'isabella@catalyst.co', company: 'Catalyst Co.', sentAt: '2023-10-26T10:00:00Z', status: 'sent', subject: 'Collaboration Opportunity', provider: 'gmail' },
  { id: '2', name: 'Jack Lewis', email: 'jack@fusion.dyn', company: 'Fusion Dynamics', sentAt: '2023-10-25T14:30:00Z', status: 'sent', subject: 'Quick Question', provider: 'outlook' },
  { id: '3', name: 'Karen Hall', email: 'karen@vortex.inc', company: 'Vortex Inc.', sentAt: '2023-10-24T09:15:00Z', status: 'replied', subject: 'Following up', provider: 'gmail', repliedAt: '2023-10-25T09:00:00Z' },
  { id: '4', name: 'Leo Young', email: 'leo@evolve.sys', company: 'Evolve Systems', sentAt: '2023-10-23T16:45:00Z', status: 'sent', subject: 'Intro to Innovatech', provider: 'outlook' },
  { id: '5', name: 'Mia Scott', email: 'mia@horizon.tech', company: 'Horizon Tech', sentAt: '2023-10-22T11:20:00Z', status: 'sent', subject: 'Your tech stack', provider: 'gmail' },
];

export const industries = ["Human Resources", "Technology", "Healthcare", "Finance", "Manufacturing", "Retail", "Education", "Accounting", "Architecture & Planning", "Apparel & Fashion", "Automotive", "Building Materials", "Biotechnology", "Environment Services", "Electrical/Electronic Manufacturing", "Computer Software", "Entertainment", "Education Management", "Construction", "Financial Services", "Government Administration", "Hospitality", "Health, Wellness & Fitness", "Higher Education", "Information Services"];
export const companySizes = ["1-10", "11-50", "51-200", "201-500", "501-1000", "1001-5000", "5001+"];

export const industryMapping: { [key: string]: string } = {
  "Human Resources": "5567e0e37369640e5ac10c00",
  "Technology": "5494458a746564006c840200",
  "Healthcare": "5494458a746564006c840100",
  "Finance": "5494458a746564006c840000",
  "Manufacturing": "5494458a746564006c840300",
  "Retail": "5567ced173696450cb580000",
  "Education": "5494458a746564006c840500",
  "Accounting": "5567ce1f7369643b78570000",
  "Architecture & Planning": "5567cdb77369645401080000",
  "Apparel & Fashion": "5567cd82736964540d0b0000",
  "Automotive": "5567cdf27369644cfd800000",
  "Building Materials": "5567e1a17369641ea9d30100",
  "Biotechnology": "5567d08e7369645dbc4b0000",
  "Environment Services": "5567ce5b736964540d280000",
  "Electrical/Electronic Manufacturing": "5567cd4c73696439c9030000",
  "Computer Software": "5567cd4e7369643b70010000",
  "Entertainment": "5567cdd37369643b80510000",
  "Education Management": "5567ce9e736964540d540000",
  "Construction": "5567cd4773696439dd350000",
  "Financial Services": "5567cdd67369643e64020000",
  "Government Administration": "5567cd527369643981050000",
  "Hospitality": "5567ce9d7369643bc19c0000",
  "Health, Wellness & Fitness": "5567cddb7369644d250c0000",
  "Higher Education": "5567cd4c73696453e1300000",
  "Information Services": "5567e0c97369640d2b3b1600",
};

export function getCompanyProfile() {
  if (typeof window !== 'undefined') {
    const savedProfile = localStorage.getItem('leadflow-company-profile');
    if (savedProfile) {
      return JSON.parse(savedProfile);
    }
  }
  return companyProfile;
}


// Normaliza clave y busca ID. Insensible a mayúsculas/espacios/acentos simples.
export function getIndustryIdByName(name?: string | null): string | null {
  if (!name) return null;
  const key = String(name)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // quita diacríticos
    .trim();

  // Búsqueda directa
  if (industryMapping[key]) return industryMapping[key];

  // Búsqueda flexible (lowercase)
  const lower = key.toLowerCase();
  for (const k of Object.keys(industryMapping)) {
    if (k.toLowerCase() === lower) return industryMapping[k];
  }
  return null;
}
