import { AUDIT_INVITE_TOKEN } from './fixtures/people.mjs';

// Every page of the app, with who may see it. `gate` names the allowlist a page sits behind: the owner is on every list and
// the member on none, so for the member a gated page must end in a 404, a redirect or an access notice. Public pages also
// run without a session; two private pages check that an anonymous visit goes to /login. `redirectsTo` is a retired
// address that must land on what replaced it (checked once, as the owner); `notFound` must answer 404.
export function routeList(ctx) {
  const app = (path, name, extra = {}) => ({ path, name, area: 'app', ...extra });
  return [
    app('/', 'Inicio'),
    app('/search', 'Búsqueda'),
    app('/saved/leads', 'Por completar'),
    app('/saved/leads/enriched', 'Por escribir'),
    app('/leads/import', 'Importar contactos'),
    app('/saved', 'Empresas guardadas'),
    app('/research', 'Investigaciones'),
    app('/contacted', 'Conversaciones'),
    app('/crm', 'Pipeline'),
    app('/sheet', 'Tabla de datos'),
    app('/campaigns', 'Campañas'),
    app('/campaigns/history', 'Historial de campañas'),
    app('/contact/compose', 'Redactar'),
    app('/contact/sequence', 'Secuencia'),
    app('/opportunities', 'Oportunidades', { gate: 'opportunities' }),
    app('/cowork', 'Cowork', { gate: 'cowork' }),
    app('/profile', 'Perfil'),
    app('/connections', 'Conexiones'),
    app('/settings/email-studio', 'Firmas y estilo'),
    app('/settings/organization', 'Organización'),
    // Everyone manages their opt-outs here; only its requests and incidents entries are for PRIVACY_ADMIN_EMAILS.
    app('/settings/privacy', 'Privacidad'),
    app('/settings/privacy-requests', 'Solicitudes de privacidad', { gate: 'privacy' }),
    app('/settings/privacy-incidents', 'Incidentes de privacidad', { gate: 'privacy' }),
    app('/settings/unsubscribes', 'Bajas'),
    app('/dashboard', 'Créditos y uso'),
    app('/dashboard/admin', 'Administración', { gate: 'admin' }),
    app('/dashboard/admin/users', 'Usuarios', { gate: 'admin' }),
    app(`/dashboard/admin/users/${ctx.MEMBER}`, 'Detalle de usuario', { gate: 'admin' }),
    app('/dashboard/admin/teams', 'Equipos', { gate: 'admin' }),
    app('/dashboard/admin/credits', 'Créditos del equipo', { gate: 'admin' }),
    app('/ayuda', 'Centro de ayuda'),
    app('/ayuda/primeros-pasos', 'Ayuda: primeros pasos'),
    app('/extension/connect', 'Conectar extensión'),
    app('/gmail', 'Retorno de Gmail', { oauth: true }),
    app('/outlook', 'Retorno de Outlook', { oauth: true }),
    app('/esta-pagina-no-existe', 'Página inexistente', { notFound: true }),
    app('/suplia', 'SUPL.IA (retirado)', { notFound: true }),
    app('/debug', 'Debug (retirado)', { notFound: true }),
    // Retired addresses (Plan 9, PR-2 and PR-3) and where they lead now.
    app('/contacted/replied', 'Respondidos (retirado)', { redirectsTo: '/contacted?view=reply' }),
    app('/contacted/analytics', 'Analítica (retirada)', { redirectsTo: '/contacted' }),
    app('/planner', 'Planificador (retirado)', { redirectsTo: '/contacted?view=scheduled' }),
    app('/settings/email-studio/test', 'Probar envíos (retirado)', { redirectsTo: '/settings/email-studio' }),
    app('/saved/opportunities', 'Empresas guardadas (retirada)', { redirectsTo: '/opportunities' }),
    app('/saved/opportunities/enriched', 'Oportunidades enriquecidas (retirada)', { redirectsTo: '/opportunities' }),
    // The retired mission agent sends whoever has Cowork there (the owner here), and everyone else to /dashboard.
    app('/antonia', 'ANTON.IA (retirado)', { redirectsTo: '/cowork' }),
    app('/antonia/misiones', 'ANTON.IA: subpágina (retirada)', { redirectsTo: '/cowork' }),
    app('/admin/suggestions', 'Sugerencias (retirada)', { redirectsTo: '/dashboard' }),
    { path: '/login', name: 'Ingresar', area: 'public' },
    { path: `/invite/${AUDIT_INVITE_TOKEN}`, name: 'Invitación', area: 'public' },
    { path: '/privacy', name: 'Política de privacidad', area: 'public' },
    { path: '/privacy/extension', name: 'Privacidad de la extensión', area: 'public' },
    { path: '/privacy/request', name: 'Solicitud de privacidad', area: 'public' },
    { path: '/unsubscribe', name: 'Darse de baja', area: 'public' },
  ];
}

/** The visits one run makes: persona × dataset × route, before the color schemes and widths each visit covers. */
export function planVisits(routes, { personas, datasets }) {
  const visits = [];
  for (const dataset of datasets) {
    for (const persona of personas) {
      if (persona === 'member' && dataset !== 'full') continue; // The member only checks access, on the full dataset.
      if (persona === 'anon' && dataset !== 'full') continue;
      for (const route of routes) {
        if (persona === 'anon' && route.area === 'app' && !['/', '/cowork'].includes(route.path)) continue;
        if (route.redirectsTo && (persona !== 'owner' || dataset !== 'full')) continue; // One check is enough.
        if (persona !== 'anon' && route.area === 'public' && route.path === '/login') continue;
        if (dataset === 'empty' && (route.notFound || route.legacy || route.area === 'public')) continue;
        if (persona === 'member' && route.notFound) continue;
        visits.push({ persona, dataset, route });
      }
    }
  }
  return visits;
}
