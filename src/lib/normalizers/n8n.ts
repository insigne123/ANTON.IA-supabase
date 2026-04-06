// src/lib/normalizers/n8n.ts
import { LeadsResponseSchema, N8NWebhookResponseSchema } from "@/lib/schemas/leads";

function firstNonEmpty(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) return trimmed;
    }
  }
  return undefined;
}

function normalizeOrganization(lead: any) {
  const organization = {
    id: firstNonEmpty(lead?.organization?.id, lead?.organization_id),
    name: firstNonEmpty(
      lead?.organization?.name,
      lead?.organization_name,
      lead?.job_company_name,
      lead?.company_name,
      lead?.company,
    ),
    domain: firstNonEmpty(
      lead?.organization?.domain,
      lead?.organization_domain,
    ),
    industry: firstNonEmpty(
      lead?.organization?.industry,
      lead?.organization_industry,
      lead?.job_company_industry,
    ),
    website_url: firstNonEmpty(
      lead?.organization?.website_url,
      lead?.organization_website_url,
      lead?.job_company_website,
    ),
    linkedin_url: firstNonEmpty(
      lead?.organization?.linkedin_url,
      lead?.organization_linkedin_url,
    ),
  };

  return Object.values(organization).some(Boolean) ? organization : undefined;
}

/**
 * Normaliza la respuesta del webhook n8n al shape interno de la app.
 * Soporta tanto {count, leads} como [ {count, leads} ].
 */
export function normalizeFromN8N(json: unknown) {
  // ⬇️ Desenrollar si n8n envía [ { count, leads } ]
  const payload = Array.isArray(json) ? (json[0] ?? {}) : json;

  // Validar con el schema flexible que acepta nulls
  const parsed = N8NWebhookResponseSchema.parse(payload);

  // Si el schema union validó un array, tomamos el primer elemento.
  const dataToNormalize = Array.isArray(parsed) ? parsed[0] : parsed;

  // Asegura shape interno estricto (string | undefined, no null)
  // Mapeamos count preferentemente de leads_count, luego de count (legacy), y fallback a length
  const finalCount = (dataToNormalize as any).leads_count ?? dataToNormalize.count ?? dataToNormalize.leads.length;

  const normalized = LeadsResponseSchema.parse({
    count: finalCount,
    leads: dataToNormalize.leads.map((l) => ({
      id: l.id,
      first_name: l.first_name ?? "",
      last_name: l.last_name ?? "",
      email: l.email ?? "",
      title: l.title ?? "",
      organization: normalizeOrganization(l),
      linkedin_url: l.linkedin_url ?? "",
      photo_url: l.photo_url ?? "",
      email_status: l.email_status ?? "",
      apollo_id: (l as any).apollo_id ?? (l as any).apolloId ?? undefined,
      primary_phone: (l as any).primary_phone ?? (l as any).primaryPhone ?? undefined,
      phone_numbers: (l as any).phone_numbers ?? (l as any).phoneNumbers ?? undefined,
      enrichment_status: (l as any).enrichment_status ?? (l as any).enrichmentStatus ?? undefined,
    })),
  });

  return normalized;
}
