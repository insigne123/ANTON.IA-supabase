
// src/lib/schemas/leads.ts
import { z } from "zod";
import { normalizeDomainList } from "@/lib/domain";
import { normalizeLinkedinProfileUrl } from "@/lib/linkedin-url";

const ZStrNullish = z.string().nullish(); // acepta string | null | undefined

/** === Tipado de respuesta estándar de la app === */
export const LeadOrganizationSchema = z.object({
  id: z.string().optional(),
  name: z.string().nullable().optional(),
  domain: z.string().nullable().optional(),
  industry: z.string().nullable().optional(),
  website_url: z.string().nullable().optional(),
  linkedin_url: z.string().nullable().optional(),
});

export const LeadPhoneNumberSchema = z.object({
  raw_number: z.string().optional().nullable(),
  sanitized_number: z.string().optional().nullable(),
  type: z.string().optional().nullable(),
  position: z.string().optional().nullable(),
  status: z.string().optional().nullable(),
});

export const LeadSchema = z.object({
  id: z.string(),
  first_name: z.string().nullable().optional(),
  last_name: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  organization: LeadOrganizationSchema.optional(),
  linkedin_url: z.string().nullable().optional(),
  photo_url: z.string().nullable().optional(),
  email_status: z.string().nullable().optional(),
  apollo_id: z.string().nullable().optional(),
  primary_phone: z.string().nullable().optional(),
  phone_numbers: z.array(LeadPhoneNumberSchema).nullable().optional(),
  enrichment_status: z.string().nullable().optional(),
});

export const LeadsResponseSchema = z.object({
  count: z.number().nonnegative(),
  leads: z.array(LeadSchema),
});

export const RevealFlagsSchema = z.object({
  email: z.boolean(),
  phone: z.boolean(),
});

export const LeadPhoneEnrichmentSchema = z.object({
  requested: z.boolean(),
  queued: z.boolean(),
  status: z.enum(["not_requested", "queued", "skipped", "failed"]),
  message: z.string().nullable(),
  webhook_url: z.string().nullable(),
  provider_status: z.number().nullable(),
  provider_details: z.string().nullable(),
});

export const CompanySearchOrganizationSchema = z.object({
  id: z.string(),
  name: z.string(),
  primary_domain: z.string().nullable().optional(),
  website_url: z.string().nullable().optional(),
  linkedin_url: z.string().nullable().optional(),
  industry: z.string().nullable().optional(),
  estimated_num_employees: z.number().nullable().optional(),
  city: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  match_score: z.number().nullable().optional(),
});

export const LeadSearchResponseSchema = LeadsResponseSchema.extend({
  batch_run_id: z.string().optional(),
  search_mode: z.string().optional(),
  company_name: z.string().optional(),
  leads_count: z.number().nonnegative().optional(),
  requested_reveal: RevealFlagsSchema.optional(),
  applied_reveal: RevealFlagsSchema.optional(),
  effective_reveal: RevealFlagsSchema.optional(),
  phone_enrichment: LeadPhoneEnrichmentSchema.optional(),
  provider_warnings: z.array(z.string()).optional(),
  warning: z.string().optional(),
  requires_organization_selection: z.boolean().optional(),
  organization_candidates: z.array(CompanySearchOrganizationSchema).optional(),
  selected_organization: CompanySearchOrganizationSchema.optional(),
  includes_similar_titles: z.boolean().optional(),
}).passthrough();

/** === Payload que espera n8n (array con 1 item) ===
 * Cambios:
 * - industry_keywords: requerido con al menos 1 string no vacío (texto libre → lo pondremos en un array).
 * - company_location: requerido con al menos 1 string no vacío.
 * - employee_ranges: requerido con al menos 1 string no vacío.
 */
const nonEmptyString = z.string().trim().min(1, "requerido");

export const N8NRequestItemSchema = z.object({
  industry_keywords: z.array(nonEmptyString).min(1, "industry_keywords requiere al menos 1 valor"),
  company_location: z.array(nonEmptyString).min(1, "company_location requiere al menos 1 valor"),
  employee_ranges: z.array(nonEmptyString).min(1, "employee_ranges requiere al menos 1 valor"),

  titles: z.string().optional().default(""),
  seniorities: z.array(z.string()).optional().default([]),

  per_page_orgs: z.number().int().positive().max(200).optional().default(100),
  per_page_people: z.number().int().positive().max(200).optional().default(100),
  max_org_pages: z.number().int().positive().max(50).optional().default(3),
  max_people_pages_per_chunk: z.number().int().positive().max(50).optional().default(2),
  enrich: z.boolean().optional().default(true),

  max_results: z.number().int().positive().max(5000).optional(),
});

export const N8NRequestBodySchema = z.array(N8NRequestItemSchema).min(1);

const linkedinUrlField = z.string().trim()
  .transform((value) => normalizeLinkedinProfileUrl(value))
  .refine((value) => !!value, "linkedin_url invalida")
  .optional();

export const LinkedInProfileSearchRequestSchema = z.object({
  user_id: z.string().trim().optional(),
  search_mode: z.enum(["linkedin_profile", "linkedin", "profile"]).optional().default("linkedin_profile"),
  linkedin_url: linkedinUrlField,
  linkedin_profile_url: linkedinUrlField,
  linkedinUrl: linkedinUrlField,
  reveal_email: z.boolean().optional(),
  revealEmail: z.boolean().optional(),
  reveal_phone: z.boolean().optional(),
  revealPhone: z.boolean().optional(),
}).superRefine((value, ctx) => {
  if (!value.linkedin_url && !value.linkedin_profile_url && !value.linkedinUrl) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "linkedin_url es obligatoria",
      path: ["linkedin_url"],
    });
  }
});

const titleArrayField = z.union([
  z.array(nonEmptyString),
  z.string().trim().min(1).transform((value) => value.split(',').map((item) => item.trim()).filter(Boolean)),
]).optional();

const domainArrayField = z.union([
  z.array(nonEmptyString),
  z.string().trim().min(1).transform((value) => value.split(',').map((item) => item.trim()).filter(Boolean)),
]).optional();

const singleDomainField = z.string().trim().min(1).optional();

export const CompanyNameSearchRequestSchema = z.object({
  user_id: z.string().trim().optional(),
  search_mode: z.literal('company_name').optional().default('company_name'),
  company_name: z.string().trim().optional(),
  seniorities: z.array(z.string().trim().min(1)).optional().default([]),
  titles: titleArrayField,
  max_results: z.number().int().positive().max(500).optional(),
  organization_domains: domainArrayField,
  organizationDomains: domainArrayField,
  organization_domain_list: domainArrayField,
  organizationDomainList: domainArrayField,
  organization_domain: singleDomainField,
  organizationDomain: singleDomainField,
  company_domain: singleDomainField,
  companyDomain: singleDomainField,
  selected_organization_id: z.string().trim().optional(),
  selected_organization_name: z.string().trim().optional(),
  selected_organization_domain: z.string().trim().optional(),
}).superRefine((value, ctx) => {
  if (!value.company_name && !value.selected_organization_id) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'company_name o selected_organization_id es obligatorio',
      path: ['company_name'],
    });
  }
  const domains = normalizeDomainList([
    ...(value.organization_domains || []),
    ...(value.organizationDomains || []),
    ...(value.organization_domain_list || []),
    ...(value.organizationDomainList || []),
    value.organization_domain,
    value.organizationDomain,
    value.company_domain,
    value.companyDomain,
  ]);
  if ([
    ...(value.organization_domains || []),
    ...(value.organizationDomains || []),
    ...(value.organization_domain_list || []),
    ...(value.organizationDomainList || []),
    value.organization_domain,
    value.organizationDomain,
    value.company_domain,
    value.companyDomain,
  ].some(Boolean) && domains.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'organization_domains invalido',
      path: ['organization_domains'],
    });
  }
});

// --- N8N ---
const N8NWebhookLeadSchema = z.object({
  id: z.string(),
  first_name: z.string().optional().nullable(),
  last_name: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  title: z.string().optional().nullable(),
  organization: z
    .object({
      id: z.string().optional().nullable(),
      name: z.string().optional().nullable(),
      domain: z.string().optional().nullable(),
    })
    .optional()
    .nullable(),
  linkedin_url: z.string().optional().nullable(),
  photo_url: z.string().optional().nullable(),
  email_status: z.string().optional().nullable(),
});

const N8NWebhookObjectSchema = z.object({
  count: z.number().nonnegative().optional(), // Legacy support
  leads_count: z.number().nonnegative().optional(), // New API field
  leads: z.array(N8NWebhookLeadSchema),
});

export const N8NWebhookResponseSchema = z.union([
  N8NWebhookObjectSchema,
  z.array(N8NWebhookObjectSchema).min(1),
]);


export type Lead = z.infer<typeof LeadSchema>;
export type LeadsResponse = z.infer<typeof LeadsResponseSchema>;
export type LeadSearchResponse = z.infer<typeof LeadSearchResponseSchema>;
export type LeadsSearchParams = z.infer<typeof N8NRequestBodySchema>;
export type LinkedInProfileSearchRequest = z.infer<typeof LinkedInProfileSearchRequestSchema>;
export type CompanyNameSearchRequest = z.infer<typeof CompanyNameSearchRequestSchema>;
export type CompanySearchOrganization = z.infer<typeof CompanySearchOrganizationSchema>;
