// src/lib/normalizers/n8n.ts
import { LeadsResponseSchema, N8NWebhookResponseSchema } from "@/lib/schemas/leads";

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
  const normalized = LeadsResponseSchema.parse({
    count: dataToNormalize.count ?? dataToNormalize.leads.length,
    leads: dataToNormalize.leads.map((l) => ({
      id: l.id,
      first_name: l.first_name ?? "",
      last_name: l.last_name ?? "",
      email: l.email ?? "",
      title: l.title ?? "",
      organization: l.organization
        ? {
          id: l.organization.id ?? undefined,
          name: l.organization.name ?? undefined,
          domain: l.organization.domain ?? undefined,
        }
        : undefined,
      linkedin_url: l.linkedin_url ?? "",
      photo_url: l.photo_url ?? "",
      email_status: l.email_status ?? "",
    })),
  });

  return normalized;
}
