import { classifyLinkedinInput, getLinkedinProfileDisplayName } from '@/lib/linkedin-url';

/**
 * What went wrong in a LinkedIn profile search, and what the person can do next. Every failure used to end in one generic
 * paragraph («Revisa los filtros…», «No se encontraron datos…»), even when the provider was down or the URL was a Sales
 * Navigator link; users reported that the profile search «falla y no dice qué hacer». Each problem now has its own title,
 * one plain sentence and the buttons that actually move the person forward.
 */
export type ProfileSearchProblem =
  | 'invalid_url'
  | 'sales_navigator_url'
  | 'company_page_url'
  | 'not_found'
  | 'no_usable_data'
  | 'identity_mismatch'
  | 'provider_unavailable'
  | 'credits_exhausted'
  | 'daily_limit'
  | 'session_expired'
  | 'organization_access'
  | 'unknown';

/** retry: same search again · professional_only: name, title and company without revealing contact data · search_company: switch
 * to «Empresa» to find the person by company and title · fix_url: focus the URL field · sign_in: renew the session. */
export type ProfileSearchAction = 'retry' | 'professional_only' | 'search_company' | 'fix_url' | 'sign_in';

export type ProfileSearchMessage = {
  problem: ProfileSearchProblem;
  title: string;
  description: string;
  actions: ProfileSearchAction[];
};

export class ProfileSearchProblemError extends Error {
  constructor(readonly problem: ProfileSearchProblem, message?: string) {
    super(message || problem);
    this.name = 'ProfileSearchProblemError';
  }
}

/** The URL kind decides the problem before any request: a company page or a Sales Navigator link never reaches the provider. */
export function profileUrlProblem(input?: string | null): ProfileSearchProblem | null {
  const kind = classifyLinkedinInput(input);
  if (kind === 'profile') return null;
  if (kind === 'sales_navigator') return 'sales_navigator_url';
  if (kind === 'company_page') return 'company_page_url';
  return 'invalid_url';
}

const PROVIDER_DOWN = /UPSTREAM|GATEWAY|TIMEOUT|RATE_LIMIT|NOT_CONFIGURED|ENRICHMENT_FAILED|PRE_PROVIDER|INVALID_RESPONSE/i;

/** A provider error code from one enriched target (`enriched[0].errorCode`). */
export function profileProblemFromProviderCode(code?: string | null): ProfileSearchProblem | null {
  const value = String(code || '').trim();
  if (!value) return null;
  if (/IDENTITY_MISMATCH/i.test(value)) return 'identity_mismatch';
  if (/CREDITS?_(EXHAUSTED|UNAVAILABLE)/i.test(value)) return 'credits_exhausted';
  if (/person_not_found|not_found/i.test(value)) return 'not_found';
  if (PROVIDER_DOWN.test(value)) return 'provider_unavailable';
  return null;
}

/** An HTTP failure of the enrichment endpoint. */
export function profileProblemFromHttp(status: number, errorCode?: string | null): ProfileSearchProblem {
  const fromCode = profileProblemFromProviderCode(errorCode);
  if (fromCode) return fromCode;
  if (status === 401) return 'session_expired';
  if (status === 403) return 'organization_access';
  if (status === 402) return 'credits_exhausted';
  if (status === 429) return 'daily_limit';
  if (status >= 500) return 'provider_unavailable';
  return 'unknown';
}

/** Older code paths still throw plain messages; read them into a problem instead of a generic sentence. */
export function profileProblemFromMessage(message?: string | null): ProfileSearchProblem {
  const raw = String(message || '');
  const lower = raw.toLowerCase();
  if (lower.includes('organization_access_required') || lower.includes('acceso a este equipo') || lower.includes('requested organization')) return 'organization_access';
  const fromCode = profileProblemFromProviderCode(raw);
  if (fromCode) return fromCode;
  if (raw.includes('APOLLO_PROFILE_NO_USABLE_DATA')) return 'no_usable_data';
  if (lower.includes('otra persona') || lower.includes('perfil distinto') || lower.includes('corresponda a la url')) return 'identity_mismatch';
  if (lower.includes('crédito') || lower.includes('credito')) return 'credits_exhausted';
  if (lower.includes('límite diario') || lower.includes('limite diario') || lower.includes('429')) return 'daily_limit';
  if (lower.includes('unauthorized') || lower.includes('401') || lower.includes('sesión') || lower.includes('sesion')) return 'session_expired';
  if (lower.includes('url de linkedin no es válida') || lower.includes('url de linkedin no es valida')) return 'invalid_url';
  if (lower.includes('no pudimos iniciar') || lower.includes('no pudimos confirmar') || lower.includes('failed to fetch')) return 'provider_unavailable';
  return 'unknown';
}

/** The person's name as the slug spells it («María José Pérez»), to say who to look for next; empty for custom slugs. */
export function profileSearchPersonHint(url?: string | null): string {
  const name = getLinkedinProfileDisplayName(url);
  return /\d/.test(name) ? '' : name;
}

export function profileSearchMessage(problem: ProfileSearchProblem, context: { url?: string | null } = {}): ProfileSearchMessage {
  const person = profileSearchPersonHint(context.url);
  const lookFor = person ? `Busca a ${person} por su empresa y cargo en «Empresa».` : 'Busca a la persona por su empresa y cargo en «Empresa».';
  switch (problem) {
    case 'invalid_url':
      return { problem, title: 'Esa dirección no es un perfil de LinkedIn',
        description: 'Copia la dirección del perfil de la persona, la que empieza con linkedin.com/in/.', actions: ['fix_url'] };
    case 'sales_navigator_url':
      return { problem, title: 'Es una dirección de Sales Navigator',
        description: 'Abre el perfil público de la persona (botón «Ver perfil de LinkedIn») y copia esa dirección: linkedin.com/in/…', actions: ['fix_url'] };
    case 'company_page_url':
      return { problem, title: 'Es la página de una empresa',
        description: 'Para encontrar personas de una empresa, búscala en «Empresa» y elige los cargos que te interesan.', actions: ['search_company', 'fix_url'] };
    case 'not_found':
      return { problem, title: 'Nuestro proveedor no tiene este perfil',
        description: `Pasa con perfiles nuevos o con poca información pública. ${lookFor}`, actions: ['search_company', 'fix_url'] };
    case 'no_usable_data':
      return { problem, title: 'El perfil existe, pero sin datos útiles',
        description: `No hay nombre, cargo ni empresa para esta dirección. Prueba solo con datos profesionales o ${lookFor.charAt(0).toLowerCase()}${lookFor.slice(1)}`,
        actions: ['professional_only', 'search_company'] };
    case 'identity_mismatch':
      return { problem, title: 'El proveedor devolvió a otra persona',
        description: `No lo mostramos para no mezclar datos de alguien más. Suele pasar cuando la persona cambió su dirección de LinkedIn. ${lookFor}`,
        actions: ['search_company', 'fix_url'] };
    case 'provider_unavailable':
      return { problem, title: 'El proveedor de datos no respondió',
        description: 'Es un problema temporal del servicio, no de la dirección que pegaste. Prueba de nuevo en unos minutos.', actions: ['retry'] };
    case 'credits_exhausted':
      return { problem, title: 'No quedan créditos para revelar contactos',
        description: 'Avisa a quien administra tu cuenta. Mientras tanto puedes traer el nombre, el cargo y la empresa sin revelar el contacto.',
        actions: ['professional_only'] };
    case 'daily_limit':
      return { problem, title: 'Llegaste al límite diario de enriquecimientos',
        description: 'Se renueva mañana. Si lo necesitas antes, pide a quien administra tu cuenta que lo amplíe.', actions: [] };
    case 'session_expired':
      return { problem, title: 'Tu sesión expiró', description: 'Vuelve a entrar y repite la búsqueda.', actions: ['sign_in'] };
    case 'organization_access':
      return { problem, title: 'No pudimos confirmar tu acceso al equipo',
        description: 'Vuelve a entrar para comprobar tu cuenta. Si se repite, consulta a quien administra tu acceso al equipo.', actions: ['sign_in'] };
    default:
      return { problem: 'unknown', title: 'No pudimos completar la búsqueda del perfil',
        description: `Prueba de nuevo. Si se repite, ${lookFor.charAt(0).toLowerCase()}${lookFor.slice(1)}`, actions: ['retry', 'search_company'] };
  }
}

export const PROFILE_SEARCH_ACTION_LABELS: Record<ProfileSearchAction, string> = {
  retry: 'Reintentar',
  professional_only: 'Traer solo datos profesionales',
  search_company: 'Buscar en «Empresa»',
  fix_url: 'Corregir la dirección',
  sign_in: 'Volver a entrar',
};
