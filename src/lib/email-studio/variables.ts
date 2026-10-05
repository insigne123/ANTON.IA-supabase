/**
 * The variables of a style's template, as people read them (Plan 11, PR 3b). The editor shows «{Nombre}» and «{Empresa}»
 * instead of «{{lead.firstName}}»; what is saved and sent stays the canonical `{{…}}` the drafts already fill. The old
 * `[[…]]` syntax (the first default style used it in the subject) is read too and comes out as `{{…}}`.
 */
export type EmailVariable = { token: string; label: string; hint: string };

export const EMAIL_VARIABLES: EmailVariable[] = [
  { token: 'lead.firstName', label: 'Nombre', hint: 'El nombre de la persona: «María»' },
  { token: 'lead.name', label: 'Nombre completo', hint: '«María González»' },
  { token: 'lead.title', label: 'Cargo', hint: 'Su cargo: «Gerenta de Personas»' },
  { token: 'company.name', label: 'Empresa', hint: 'Su empresa' },
  { token: 'report.pains', label: 'Dolor', hint: 'Lo que la investigación encontró que le preocupa' },
  { token: 'report.valueProps', label: 'Qué le ofreces', hint: 'Lo que la investigación propone ofrecerle' },
  { token: 'companyProfile.valueProposition', label: 'Tu propuesta', hint: 'Tu propuesta de valor, desde «Perfil»' },
  { token: 'cta.duration', label: 'Minutos', hint: 'La duración de la reunión que propones' },
  { token: 'sender.name', label: 'Tu nombre', hint: 'Tu nombre, desde «Perfil»' },
  { token: 'sender.company', label: 'Tu empresa', hint: 'Tu empresa, desde «Perfil»' },
];

const byToken = new Map(EMAIL_VARIABLES.map(variable => [variable.token.toLowerCase(), variable]));
const byLabel = new Map(EMAIL_VARIABLES.map(variable => [variable.label.toLowerCase(), variable]));

/** «{Nombre}»: how a variable is written in the editor. */
export const friendlyToken = (variable: EmailVariable) => `{${variable.label}}`;

/** From what is stored (`{{lead.firstName}}` or `[[lead.firstName]]`) to what people read («{Nombre}»). Unknown ones stay as they are. */
export function toFriendlyTemplate(template: string) {
  return String(template || '').replace(/\{\{\s*([\w.]+)\s*\}\}|\[\[\s*([\w.]+)\s*\]\]/g, (match, curly: string, square: string) => {
    const variable = byToken.get(String(curly || square).toLowerCase());
    return variable ? friendlyToken(variable) : curly ? match : `{{${square}}}`;
  });
}

/** From the editor back to what drafts fill: «{Nombre}» becomes `{{lead.firstName}}`; anything else is left alone. */
export function toCanonicalTemplate(template: string) {
  return String(template || '')
    .replace(/\[\[\s*([\w.]+)\s*\]\]/g, '{{$1}}')
    .replace(/(^|[^{])\{([^{}\n]{1,40})\}(?!\})/g, (match, before: string, label: string) => {
      const variable = byLabel.get(label.trim().toLowerCase());
      return variable ? `${before}{{${variable.token}}}` : match;
    });
}

/** Labels of the variables a template uses, for «Usa: Nombre, Empresa». */
export function templateVariables(template: string) {
  const labels = new Set<string>();
  for (const match of toCanonicalTemplate(template).matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)) {
    const variable = byToken.get(match[1].toLowerCase());
    if (variable) labels.add(variable.label);
  }
  return [...labels];
}
