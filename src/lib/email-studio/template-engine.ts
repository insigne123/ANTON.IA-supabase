// Motor minimalista: {{path}}, {{path | default:"texto"}},
// condicionales: {{#if path}} ... {{/if}}
export function renderTemplateString(tpl: string, ctx: any): { text: string; warnings: string[] } {
  const warnings: string[] = [];

  const getPath = (path: string, obj: any): any => {
    return path.split('.').reduce((acc, k) => (acc && acc[k] !== undefined ? acc[k] : undefined), obj);
  };

  // {{#if path}} ... {{/if}}
  const ifRe = /\{\{#if\s+([a-zA-Z0-9_.\[\]]+)\}\}([\s\S]*?)\{\{\/if\}\}/g;
  tpl = tpl.replace(ifRe, (_, path: string, inner: string) => {
    const val = getPath(path, ctx);
    if (val === undefined || val === null || (Array.isArray(val) && val.length === 0) || (typeof val === 'string' && val.trim() === '')) {
      return '';
    }
    return inner;
  });

  // {{path | default:"X"}}
  const tokenRe = /\{\{\s*([a-zA-Z0-9_.\[\]]+)(?:\s*\|\s*default\s*:\s*"([^"]*)")?\s*\}\}/g;
  const text = tpl.replace(tokenRe, (_, path: string, defVal?: string) => {
    const val = getPath(path, ctx);
    if (val === undefined || val === null || val === '') {
      if (!defVal) warnings.push(`Token faltante: ${path}`);
      return defVal ?? '';
    }
    return String(val);
  });

  return { text, warnings };
}

export function buildTemplateContext(input: import('./types').RenderInput['data']) {
  // contexto plano y seguro
  return {
    lead: input.lead ?? {},
    job: input.job ?? {},
    report: input.report ?? {},
    companyProfile: input.companyProfile ?? {},
  };
}
