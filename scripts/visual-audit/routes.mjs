// Every page of the app, with who may see it. `gate` names the allowlist a page sits behind: the owner is on every list and
// the member on none, so for the member a gated page must end in a 404, a redirect or an access notice. Public pages also
// run without a session; two private pages check that an anonymous visit goes to /login.
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
    app('/contacted/analytics', 'Analítica de contactados', { legacy: true }),
    app('/contacted/replied', 'Respondidos', { legacy: true }),
    app('/crm', 'Pipeline'),
    app('/sheet', 'Tabla de datos'),
    app('/campaigns', 'Campañas'),
    app('/campaigns/history', 'Historial de campañas'),
    app('/contact/compose', 'Redactar'),
    app('/contact/sequence', 'Secuencia'),
    app('/opportunities', 'Oportunidades', { gate: 'opportunities' }),
    app('/saved/opportunities', 'Oportunidades antiguas', { gate: 'opportunities', legacy: true }),
    app('/saved/opportunities/enriched', 'Oportunidades antiguas enriquecidas', { gate: 'opportunities', legacy: true }),
    app('/cowork', 'Cowork', { gate: 'cowork' }),
    app('/profile', 'Perfil'),
    app('/connections', 'Conexiones'),
    app('/settings/email-studio', 'Firmas y estilo'),
    app('/settings/email-studio/test', 'Probar envíos', { legacy: true }),
    app('/settings/organization', 'Organización'),
    app('/settings/privacy', 'Privacidad', { gate: 'privacy' }),
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
    app('/antonia', 'ANTON.IA (archivado)', { legacy: true }),
    app('/planner', 'Planificador', { legacy: true }),
    app('/suplia', 'Suplia', { legacy: true }),
    app('/suplia/review', 'Suplia: revisión', { legacy: true }),
    app('/debug', 'Debug', { legacy: true, gate: 'debug' }),
    app('/extension/connect', 'Conectar extensión'),
    app('/gmail', 'Retorno de Gmail', { oauth: true }),
    app('/outlook', 'Retorno de Outlook', { oauth: true }),
    app('/esta-pagina-no-existe', 'Página inexistente', { notFound: true }),
    { path: '/login', name: 'Ingresar', area: 'public' },
    { path: '/invite/audit-invite-token', name: 'Invitación', area: 'public' },
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
        if (persona !== 'anon' && route.area === 'public' && route.path === '/login') continue;
        if (dataset === 'empty' && (route.notFound || route.legacy || route.area === 'public')) continue;
        visits.push({ persona, dataset, route });
      }
    }
  }
  return visits;
}
