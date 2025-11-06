// src/lib/template.ts
// Motor de plantillas tolerante a distintos formatos de tokens.
// Soporta: {{path}}, {path}, [Alias], [[Alias]], y alias comunes en ES.
// Ej: [Nombre lead] -> lead.firstName, [Cargo] -> lead.title, [Empresa] -> company.name

type AnyRec = Record<string, any>;

function flatten(obj: AnyRec, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (o: AnyRec, p: string[]) => {
    Object.keys(o || {}).forEach((k) => {
      const v = o[k];
      const path = [...p, k];
      if (v !== null && typeof v === 'object') walk(v, path);
      else out[path.join('.')] = v == null ? '' : String(v);
    });
  };
  walk(obj || {}, prefix ? [prefix] : []);
  return out;
}

function norm(s: string) {
  return String(s || '')
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/gi, '')
    .toLowerCase();
}

const aliasMap: Record<string, string> = {
  // Persona
  nombre: 'lead.firstName',
  nombrelead: 'lead.firstName',
  leadnombre: 'lead.firstName',
  firstname: 'lead.firstName',
  nombrecompleto: 'lead.name',
  cargolead: 'lead.title',
  cargo: 'lead.title',
  email: 'lead.email',
  // Empresa
  empresa: 'company.name',
  nombreempresa: 'company.name',
  dominio: 'company.domain',
  website: 'company.website',
  // Remitente
  remitente: 'sender.name',
  miempresa: 'sender.company',
  senderempresa: 'sender.company',
};

function lookup(key: string, flat: Record<string, string>) {
  if (!key) return '';
  // 1) path directo
  if (key in flat) return flat[key];
  // 2) alias normalizado
  const nk = norm(key);
  const alias = aliasMap[nk];
  if (alias && alias in flat) return flat[alias];
  // 3) variantes comunes (leadfirstname -> lead.firstName, companyname -> company.name)
  const m = nk.match(/^(lead|company|sender)(first|last)?name$/);
  if (m) {
    const scope = m[1];
    if (scope === 'lead' && flat['lead.firstName']) return flat['lead.firstName'];
    if (scope === 'company' && flat['company.name']) return flat['company.name'];
    if (scope === 'sender' && flat['sender.name']) return flat['sender.name'];
  }
  return '';
}

/** Reemplaza tokens sobre múltiples sintaxis. Si no existe, reemplaza por '' (nunca deja el token crudo). */
export function renderTemplate(tpl: string, data: AnyRec): string {
  if (!tpl) return '';
  const flat = flatten(data);

  let out = String(tpl);

  // Sintaxis {{path}} y {path}
  out = out.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_m, k) => lookup(String(k).trim(), flat));
  out = out.replace(/\{\s*([^}]+?)\s*\}/g, (_m, k) => lookup(String(k).trim(), flat));

  // Sintaxis [Alias] o [[Alias]]
  out = out.replace(/\[\[\s*([^\]]+?)\s*\]\]/g, (_m, k) => lookup(String(k).trim(), flat));
  out = out.replace(/\[\s*([^\]]+?)\s*\]/g, (_m, k) => lookup(String(k).trim(), flat));

  // Limpieza: colapsar espacios múltiples creados por reemplazos vacíos
  out = out.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

  return out;
}

/** Construye el contexto estándar esperado por los templates. */
export function buildPersonEmailContext(args: {
  lead?: { firstName?: string; name?: string; email?: string; title?: string; company?: string };
  company?: { name?: string; domain?: string; website?: string };
  sender?: { name?: string; email?: string; company?: string; title?: string };
}) {
  const { lead = {}, company = {}, sender = {} } = args || {};
  const firstName = (lead.name || '').split(' ')[0] || lead.firstName || '';
  return {
    lead: {
      firstName,
      name: lead.name || '',
      email: lead.email || '',
      title: lead.title || '',
      company: lead.company || '',
    },
    company: {
      name: company.name || lead.company || '',
      domain: company.domain || '',
      website: company.website || '',
    },
    sender: {
      name: sender.name || '',
      email: sender.email || '',
      company: sender.company || '',
      title: sender.title || '',
    },
  };
}

/** Utilidad básica para obtener firstName desde "Nombre Apellido" */
export function splitName(fullName?: string) {
  const n = (fullName || '').trim();
  const [firstName, ...rest] = n.split(/\s+/);
  return { firstName, lastName: rest.join(' ') };
}
/** Obtiene firstName seguro, con fallback vacío */
export function getFirstNameSafe(fullName?: string) {
  return splitName(fullName).firstName || '';
}
