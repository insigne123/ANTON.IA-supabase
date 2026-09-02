import { z } from 'zod';

import type { ResearchDraftEligibility, ResearchQualityAssessment } from '@/lib/native-research-quality';
import type { ResearchSnapshotV1 } from '@/lib/research-contracts';

const optionalText = z.string().trim().max(2_000).nullable().optional();

function hasResearchSubject(lead: Record<string, unknown>) {
  return [
    lead.id,
    lead.email,
    lead.fullName,
    lead.linkedinUrl,
    lead.companyName,
    lead.companyDomain,
    lead.companyWebsite,
  ].some((value) => typeof value === 'string' && value.trim().length > 0);
}

export const NativeResearchLeadSchema = z.object({
  id: z.string().trim().max(500).nullable().optional(),
  fullName: z.string().trim().max(300).nullable().optional(),
  email: z.string().trim().email().max(320).nullable().optional(),
  title: optionalText,
  headline: optionalText,
  seniority: optionalText,
  departments: z.array(z.string().trim().min(1).max(160)).max(12).nullable().optional(),
  linkedinUrl: z.string().trim().url().max(2_048).nullable().optional(),
  companyName: z.string().trim().max(300).nullable().optional(),
  companyDomain: z.string().trim().max(300).nullable().optional(),
  companyWebsite: z.string().trim().url().max(2_048).nullable().optional(),
  companyLinkedinUrl: z.string().trim().url().max(2_048).nullable().optional(),
  descriptionSnippet: optionalText,
  industry: optionalText,
  organizationIndustry: optionalText,
  organizationSize: z.number().int().positive().max(10_000_000).nullable().optional(),
  city: optionalText,
  country: optionalText,
}).strict().superRefine((lead, ctx) => {
  if (!hasResearchSubject(lead)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'A native research lead needs a person or company identity.',
    });
  }
});

export const NativeResearchOptionsSchema = z.object({
  depth: z.enum(['basic', 'standard', 'deep']).default('standard'),
  language: z.string().trim().min(2).max(12).default('es'),
  refresh: z.boolean().default(false),
}).strict();

export const NativeResearchRequestSchema = z.object({
  lead: NativeResearchLeadSchema,
  options: NativeResearchOptionsSchema.default({}),
}).strict();

export const NativeResearchBatchRequestSchema = z.object({
  leads: z.array(NativeResearchLeadSchema).min(1).max(50),
  options: NativeResearchOptionsSchema.default({}),
}).strict();

export const NativeResearchLeadStatusesRequestSchema = z.object({
  leadIds: z.array(z.string().trim().min(1).max(500)).min(1).max(200),
}).strict();

export const NativeResearchReprocessRequestSchema = z.object({
  confirm: z.literal(true),
  limit: z.number().int().min(1).max(50).default(50),
}).strict();

export const NativeResearchStatusSchema = z.enum([
  'queued',
  'running',
  'completed',
  'partial',
  'insufficient_data',
  'failed',
  'cancelled',
]);

export type NativeResearchLead = z.infer<typeof NativeResearchLeadSchema>;
export type NativeResearchOptions = z.infer<typeof NativeResearchOptionsSchema>;
export type NativeResearchRequest = z.infer<typeof NativeResearchRequestSchema>;
export type NativeResearchBatchRequest = z.infer<typeof NativeResearchBatchRequestSchema>;
export type NativeResearchStatus = z.infer<typeof NativeResearchStatusSchema>;
export type NativeResearchReprocessRequest = z.infer<typeof NativeResearchReprocessRequestSchema>;

export type NativeResearchResult = {
  status: NativeResearchStatus;
  reportId: string;
  researchSnapshotId: string | null;
  lead: NativeResearchLead;
  score: number;
  priority: 'high' | 'medium' | 'low';
  evidence: Array<{
    id: string;
    statement: string;
    sourceId: string;
    sourceUrl: string;
    kind: 'fact' | 'signal' | 'hypothesis';
  }>;
  sources: Array<{
    id: string;
    title: string;
    url: string;
    type: string;
    provider: string;
  }>;
  angle: string;
  ordenEnvio: number;
  esperaSugeridaDias: number;
  promptPack: {
    context: string;
    claims: string[];
    doNotClaim: string[];
  };
  companyResearchCache: {
    hit: boolean;
    domain: string | null;
    expiresAt: string | null;
    artifactId: string | null;
    cacheIdentity: string | null;
  };
  quality: ResearchQualityAssessment;
  draftEligibility: ResearchDraftEligibility;
  warnings: string[];
  reportSynthesis?: {
    status: 'completed' | 'partial';
    generationMethod: 'model' | 'fallback';
    retryable: boolean;
    errorCode: string | null;
  };
  snapshot?: ResearchSnapshotV1;
};

export type NativeResearchLeadStatus = {
  leadId: string;
  status: NativeResearchStatus;
  reportId: string;
  researchSnapshotId: string | null;
  result: NativeResearchResult | null;
  errorCode: string | null;
  updatedAt: string | null;
};
