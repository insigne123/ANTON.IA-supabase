// Utilidad de Mail-Merge segura para renders por lead/usuario.
// Soporta: {{lead.firstName}}, {{lead.lastName}}, {{company.name}}, {{user.signature.name}}, etc.
// También defaults: {{lead.firstName|Hola}} -> usa "Hola" si no hay valor.
// Evita XSS básico removiendo tags peligrosos. Ajusta según tu sanitizador global si existe (TODO).

export type LeadCtx = {
  lead?: {
    id?: string;
    firstName?: string | null;
    lastName?: string | null;
    fullName?: string | null;
    title?: string | null;
    email?: string | null;
  };
  company?: {
    name?: string | null;
    domain?: string | null;
  };
  user?: {
    signature?: {
      name?: string | null;
      title?: string | null;
      phone?: string | null;
      company?: string | null;
    };
  };
  // Campo libre para variables AI u otras:
  extra?: Record<string, string | number | null | undefined>;
};

const DANGEROUS_TAGS = /<\/?(script|iframe|object|embed|link|style|meta)[^>]*>/gi;

function sanitizeBasic(htmlOrText: string) {
  return (htmlOrText || "").replace(DANGEROUS_TAGS, "");
}

// Obtiene valor por ruta, ej: path "lead.firstName"
function getByPath(obj: any, path: string): any {
  return path.split(".").reduce((acc, k) => (acc && acc[k] != null ? acc[k] : undefined), obj);
}

/**
 * renderTemplate
 * Reemplaza {{path}} y {{path|default}}. Ej: {{lead.firstName|Hola}}.
 * - subject/text: string de entrada.
 * - ctx: LeadCtx con datos del lead/empresa/usuario.
 */
export function renderTemplate(input: string, ctx: LeadCtx): string {
  if (!input) return "";
  const tpl = sanitizeBasic(input);

  // {{ path | default }} o {{ path }}
  return tpl.replace(/\{\{\s*([a-zA-Z0-9_.]+)(?:\|([^}]+))?\s*\}\}/g, (_m, rawPath, rawDefault) => {
    const path = String(rawPath).trim();
    const defVal = rawDefault != null ? String(rawDefault).trim() : "";
    const val = getByPath(ctx, path);

    const str = val == null || val === "" ? defVal : String(val);
    return sanitizeBasic(str);
  });
}

/**
 * renderEmailForLead
 * Renderiza asunto y cuerpo para un lead.
 */
export function renderEmailForLead(
  draft: { subject: string; bodyHtml?: string; bodyText?: string },
  ctx: LeadCtx
): { subject: string; bodyHtml?: string; bodyText?: string } {
  const subject = renderTemplate(draft.subject, ctx);
  const bodyHtml = draft.bodyHtml ? renderTemplate(draft.bodyHtml, ctx) : undefined;
  const bodyText = draft.bodyText ? renderTemplate(draft.bodyText, ctx) : undefined;
  return { subject, bodyHtml, bodyText };
}
