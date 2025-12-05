
// src/lib/schemas/leads.ts
import { z } from "zod";

const ZStrNullish = z.string().nullish(); // acepta string | null | undefined

/** === Tipado de respuesta estándar de la app === */
export const LeadOrganizationSchema = z.object({
  id: z.string().optional(),
  name: z.string().nullable().optional(),
  domain: z.string().nullable().optional(),
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
});

export const LeadsResponseSchema = z.object({
  count: z.number().nonnegative(),
  leads: z.array(LeadSchema),
});

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
export type LeadsSearchParams = z.infer<typeof N8NRequestBodySchema>;
