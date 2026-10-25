// Cowork: three finished threads for the owner (one with a follow-up turn in two versions, the latest rated 👍; one renamed; one
// with a code artifact on the canvas)
// and the access RPC: Cowork is open to every member of the organization (COWORK_OPEN_TO_ALL, 19 Oct 2026). The artifact is a small static page in storage: the panel around it is what is audited.
export default function cowork(ctx) {
  const run = (n, message, { parent = null, root, status = 'completed', at }) => ({
    id: ctx.uid(9000 + n), user_id: ctx.OWNER, organization_id: ctx.ORG, request_id: ctx.uid(9100 + n), message, mode: 'approval', status,
    created_at: at, updated_at: at, lease_token: null, lease_expires_at: null, attempts: 1, parent_run_id: parent, depth: parent ? 1 : 0, root_run_id: root,
  });
  const memory = (n, userId, scope, text, at) => ({ id: ctx.uid(n), organization_id: ctx.ORG, user_id: userId, scope, memory_type: 'cowork_preference',
    key: text, value: { text }, confidence: 1, status: 'approved', created_at: at, updated_at: at, expires_at: null });
  const first = ctx.uid(9001);
  const second = ctx.uid(9003);
  const runs = [
    run(1, '¿A quién le escribo esta semana?', { root: first, at: ctx.hoursAgo(26) }),
    run(2, 'Prepárame el correo para Andrea Soto', { parent: first, root: first, at: ctx.hoursAgo(25) }),
    run(3, 'Arma una campaña para jefes de reclutamiento en logística', { root: second, at: ctx.hoursAgo(3) }),
    run(4, 'Muéstrame mi pipeline en un gráfico por etapa', { root: ctx.uid(9004), at: ctx.hoursAgo(1) }),
    // «Otra versión» of the second turn (Plan 13): same parent, asked again later.
    run(5, 'Prepárame el correo para Andrea Soto', { parent: first, root: first, at: ctx.hoursAgo(24) }),
    // A long task waiting for its plan to be approved (Plan 13, 4c).
    run(6, 'Busca 25 gerentes de RR. HH. de retail en Santiago, guarda los 10 mejores, búscales el correo y escríbeles una secuencia', { root: ctx.uid(9006), status: 'waiting_approval', at: ctx.hoursAgo(0.2) }),
    // Research with the web (COWORK_WEB_ENABLED): what it searched and read is listed with the rest of what it consulted, and the answer cites it.
    run(7, 'Investiga qué hace Sodexo Chile y si está contratando', { root: ctx.uid(9007), at: ctx.hoursAgo(0.5) }),
    // A search of new contacts waiting for approval, with criteria to edit in the card (COW-29).
    run(8, 'Busca 25 gerentes de personas de retail en Santiago', { root: ctx.uid(9008), status: 'waiting_approval', at: ctx.hoursAgo(0.1) }),
  ];
  const replies = {
    1: 'Te recomiendo empezar por **3 personas** que calzan con tu cliente ideal y aún no contactas:\n\n1. **Andrea Soto**, Gerente de Personas en Retail Andino: están abriendo tiendas.\n2. **Matías Rojas**, Jefe de Reclutamiento en Logística Sur: contrataciones masivas en temporada.\n3. **Francisca Muñoz**, Gerente de Operaciones en Seguridad Austral.\n\n¿Quieres que prepare el primer correo para Andrea?',
    2: 'Listo. Este es el borrador para **Andrea Soto**:\n\n**Asunto:** Retail Andino: contrataciones sin revisar antecedentes a mano\n\nHola Andrea, vi que Retail Andino está abriendo tiendas. Revisamos antecedentes en minutos, con trazabilidad. ¿Conversamos 15 minutos?',
    3: 'Armé la campaña **«Logística · centros de distribución»** con 6 jefes de reclutamiento. Quedó en Campañas para que la revises antes de aprobarla.',
    5: 'Aquí va una versión más directa para **Andrea Soto**:\n\n**Asunto:** ¿15 minutos sobre las contrataciones de Retail Andino?\n\nHola Andrea, con las tiendas nuevas su equipo revisa muchos antecedentes. Nosotros lo hacemos en minutos y con trazabilidad. ¿Te muestro cómo el jueves?',
    7: 'Sodexo Chile presta **alimentación y gestión de instalaciones** a empresas e instituciones, y **sí está reclutando en volumen**, sobre todo en minería y regiones.\n\n- **Qué hace:** [Somos Sodexo](https://cl.sodexo.com/acerca-de-nosotros/quienes-somos) la describe como líder en servicios de alimentación y facility management.\n- **Contratación:** [Reclutamiento masivo en Coquimbo, Arica y Hualpén](https://trabajosenminera.com/reclutamiento-masivo-sodexo-chile) (sept. 2026) y [vacantes en Antofagasta](https://www.redimin.cl/sodexo-busca-trabajadores-en-antofagasta).\n\nLas cifras vienen de medios de empleo, que son fuentes secundarias: «masivo» es su titular, no un dato de la empresa.',
    4: 'De tus 20 contactos, 8 siguen en Nuevos y 3 ya tienen reunión. El tablero muestra el pipeline por etapa con la tabla de detalle; puedes ordenarla y usar «Ver datos» en el gráfico.',
  };
  // The first answer carries a chart: in the chat a compact card, drawn on the canvas when opened (Plan 12, 2).
  const stagesChart = { type: 'chart', title: 'Contactos por etapa', kind: 'bar', period: 'Hoy', unit: null,
    labels: ['Nuevos', 'Contactado', 'Interesado', 'Reunión'], series: [{ name: 'Contactos', values: [8, 6, 3, 3] }] };
  const artifact = { name: 'artifact-pipeline-por-etapa-v1.html', title: 'Pipeline por etapa' };
  const page = '<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Pipeline por etapa</title><style>'
    + 'body{margin:0;font:14px system-ui,sans-serif;background:#fff;color:#0f172a}html.dark body{background:#020817;color:#e2e8f0}'
    + 'main{padding:24px;max-width:960px}h1{font-size:22px;margin:0 0 4px}p{color:#64748b;margin:0 0 16px}'
    + 'table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:8px;border-bottom:1px solid #e2e8f0}</style></head>'
    + '<body><main><h1>Pipeline por etapa</h1><p>Tus contactos guardados, en el orden del proceso.</p>'
    + '<table><caption>Contactos por etapa</caption><thead><tr><th scope="col">Etapa</th><th scope="col">Contactos</th></tr></thead>'
    + '<tbody><tr><td>Nuevos</td><td>8</td></tr><tr><td>Contactado</td><td>6</td></tr><tr><td>Interesado</td><td>3</td></tr><tr><td>Reunión</td><td>3</td></tr></tbody></table></main>'
    + '<script>if(/theme=dark/.test(location.hash))document.documentElement.className="dark";parent.postMessage({source:"antonia-artifact",type:"ready",detail:{errors:0}},"*");</script></body></html>';
  const artifactEvent = (item, sequence) => ({ sequence, run_id: item.id, user_id: ctx.OWNER, organization_id: ctx.ORG, kind: 'artifact.created', created_at: item.updated_at,
    payload: { name: artifact.name, path: `${ctx.ORG}/${ctx.OWNER}/${item.id}/${artifact.name}`, size: page.length, kind: 'code', title: artifact.title,
      key: 'pipeline-por-etapa', version: 1, tables: [{ name: 'pipeline', label: 'Pipeline', rows: 20, truncated: false }] } });
  // The campaign turn worked with a plan (Plan 13): the side panel shows it as a to-do list, each step with what it found.
  const at = (item, sequence, kind, payload) => ({ sequence, run_id: item.id, user_id: ctx.OWNER, organization_id: ctx.ORG, kind, payload, created_at: item.updated_at });
  const plan = (item, base) => [
    at(item, base + 2, 'tool.completed', { action: 'assistant.plan', input: '', result: { steps: [
      { label: 'Reviso tus campañas', read: 'campaigns.list' },
      { label: 'Veo si hay incidencias abiertas', read: 'exceptions.list' },
      { label: 'Armo la campaña con los jefes de reclutamiento', read: null },
    ] } }),
    at(item, base + 3, 'tool.completed', { action: 'campaigns.list', input: '', result: { scope: 'own', campaigns: [{ name: 'Logística' }, { name: 'Retail' }] } }),
    at(item, base + 4, 'tool.completed', { action: 'exceptions.list', input: '', result: { scope: 'team', items: [] } }),
  ];
  const events = runs.flatMap((item, index) => [
    { sequence: index * 10 + 1, run_id: item.id, user_id: ctx.OWNER, organization_id: ctx.ORG, kind: 'run.started', payload: {}, created_at: item.created_at },
    ...(index === 2 ? plan(item, index * 10) : []),
    // The first turn read your contacts and the read came back cut (Plan 13): the table offers «Ver todos».
    ...(index === 0 ? [at(item, 3, 'tool.completed', { action: 'leads.search', input: 'personas', result: { scope: 'own_saved_contacts', truncated: true, limit: 3, returned: 3,
      items: [['Andrea Soto', 'Gerente de Personas', 'Retail Andino'], ['Catalina Morales', 'Subgerente de Personas', 'Grupo Pacífico'], ['Martina Valenzuela', 'Jefa de Personas', 'Logística Sur']]
        .map(([name, title, company], n) => ({ id: ctx.uid(9301 + n), name, title, company, email: null, status: 'saved' })) } })] : []),
    ...(index === 3 ? [artifactEvent(item, index * 10 + 5)] : []),
    ...(index === 6 ? [
      at(item, index * 10 + 2, 'tool.completed', { action: 'web.search', input: 'Sodexo Chile a qué se dedica servicios', result: { ok: true, sources: [
        { title: 'Somos Sodexo', url: 'https://cl.sodexo.com/acerca-de-nosotros/quienes-somos' }, { title: 'Servicios de Alimentación, Sodexo Chile', url: 'https://cl.sodexo.com/servicios-y-marcas/servicios-de-alimentacion' },
        { title: 'Portal de empleos Sodexo', url: 'https://sodexo.trabajando.cl/' }] } }),
      at(item, index * 10 + 3, 'tool.completed', { action: 'web.search', input: 'Sodexo Chile contratación masiva 2026', result: { ok: true, sources: [
        { title: 'Reclutamiento Masivo Sodexo Chile', url: 'https://trabajosenminera.com/reclutamiento-masivo-sodexo-chile' }, { title: 'Vacantes en Antofagasta', url: 'https://www.redimin.cl/sodexo-busca-trabajadores-en-antofagasta' }] } }),
      at(item, index * 10 + 4, 'tool.completed', { action: 'web.fetch', input: 'https://cl.sodexo.com/acerca-de-nosotros/quienes-somos', result: { ok: true, sources: [{ title: 'Somos Sodexo', url: 'https://cl.sodexo.com/acerca-de-nosotros/quienes-somos' }] } }),
      at(item, index * 10 + 5, 'tool.completed', { action: 'web.fetch', input: 'https://sodexo.cl/carreras', result: { ok: false, sources: [], error: 'url_not_allowed' } }),
    ] : []),
    { sequence: index * 10 + 8, run_id: item.id, user_id: ctx.OWNER, organization_id: ctx.ORG, kind: 'run.completed', payload: { reply: replies[index + 1], document: null,
      ...(index === 0 ? { blocks: [stagesChart] } : {}),
      ...(index === 6 ? { question: '¿Busco contactos de selección y RR. HH. en Sodexo Chile?', suggestions: [{ label: 'Buscar contactos', message: 'Busca contactos de selección y RR. HH. en Sodexo Chile' }] } : {}) }, created_at: item.updated_at },
    ...(index === 4 ? [at(item, index * 10 + 9, 'answer.feedback', { rating: 'up', reason: null, comment: null })] : []),
  ]).filter(event => !((event.run_id === ctx.uid(9006) || event.run_id === ctx.uid(9008)) && event.kind === 'run.completed'));
  // The plan the task proposed, staged as an event of its run, and the card that asks to approve it.
  const taskRun = runs[5];
  const taskHash = '0123456789abcdef0123456789abcdef';
  const taskPlan = { goal: 'Dejar una secuencia de 3 correos lista para los 10 gerentes de RR. HH. de retail que mejor calcen', limits: { searches: 1, credits: 10 }, steps: [
    { label: 'Buscar 25 gerentes de RR. HH. de retail en Santiago', kind: 'search' },
    { label: 'Guardar a los 10 mejores y buscar su correo', kind: 'prepare' },
    { label: 'Escribir una secuencia de 3 correos', kind: 'write' },
    { label: 'Dejar la campaña pausada con ellos', kind: 'campaign' }] };
  events.push(
    at(taskRun, 53, 'tool.completed', { action: 'assistant.note', input: '', result: { reply: 'Propongo hacerlo como una tarea: busco, preparo a los 10 mejores, escribo la secuencia y dejo la campaña pausada. Nunca envío ni activo nada sin preguntarte.' } }),
    at(taskRun, 54, 'task.plan', { hash: taskHash, plan: taskPlan }),
    at(taskRun, 55, 'approval.requested', { action: 'cowork.effect', kind: 'task_plan', targetId: `task:${taskHash}`, label: 'Tarea de 4 pasos · hasta 1 búsqueda y 10 créditos' }),
  );
  const searchRun = runs[7];
  const searchCriteria = { target: 'people', titles: ['Gerente de Personas'], industries: ['Retail'], locations: ['Santiago, Chile'], limit: 25 };
  events.push(at(searchRun, 75, 'approval.requested', { action: 'prospecting.search', criteria: searchCriteria }));
  return {
    tables: {
      cowork_runs: runs, cowork_run_events: events,
      cowork_search_proposals: [{ run_id: searchRun.id, user_id: ctx.OWNER, organization_id: ctx.ORG, criteria: searchCriteria, status: 'pending', created_at: searchRun.created_at }],
      // The grants a first visit leaves (ensureCoworkGrant): the worker's own check reads them before changing a proposal.
      cowork_access_grants: [{ user_id: ctx.OWNER, enabled: true, created_at: ctx.daysAgo(30) }, { user_id: ctx.MEMBER, enabled: true, created_at: ctx.daysAgo(30) }],
      // The model calls of those turns with their cost (Administración → «Oportunidades y Cowork»), one of them today.
      cowork_model_calls: [...runs.slice(0, 4).map((item, index) => ({ id: ctx.uid(9450 + index), run_id: item.id, user_id: ctx.OWNER, organization_id: ctx.ORG, role: 'coordinator',
        output_reserved: 4000, usage: { costUsd: 0.012 + index * 0.004 }, usage_recorded_at: item.created_at, created_at: item.created_at })),
        { id: ctx.uid(9459), run_id: runs[0].id, user_id: ctx.OWNER, organization_id: ctx.ORG, role: 'coordinator', output_reserved: 4000, usage: null, usage_recorded_at: null, created_at: ctx.minutesAgo(20) }],
      // Scheduled tasks (COWORK_SCHEDULES_ENABLED): one that fires on Mondays and ran last week, one on weekdays that was paused after failing, one monthly.
      cowork_scheduled_tasks: [
        { id: ctx.uid(9401), user_id: ctx.OWNER, organization_id: ctx.ORG, title: 'Resumen del lunes', prompt: 'Dime quién respondió esta semana y a quién escribir hoy, con el motivo de cada uno.',
          frequency: 'weekly', time_of_day: '09:00', weekday: 1, month_day: null, time_zone: 'America/Santiago', status: 'active', next_run_at: ctx.daysAhead(3),
          last_run_at: ctx.daysAgo(4), last_run_id: ctx.uid(9001), last_status: 'admitted', consecutive_failures: 0, run_count: 6, created_from_run_id: null, created_at: ctx.daysAgo(45), updated_at: ctx.daysAgo(4) },
        { id: ctx.uid(9402), user_id: ctx.OWNER, organization_id: ctx.ORG, title: 'Respuestas nuevas de la mañana', prompt: 'Revisa si hay respuestas nuevas de contactos y dime cuáles piden reunión.',
          frequency: 'weekdays', time_of_day: '08:30', weekday: null, month_day: null, time_zone: 'America/Santiago', status: 'paused', next_run_at: null,
          last_run_at: ctx.daysAgo(2), last_run_id: null, last_status: 'failed', consecutive_failures: 3, run_count: 14, created_from_run_id: null, created_at: ctx.daysAgo(30), updated_at: ctx.daysAgo(2) },
        { id: ctx.uid(9403), user_id: ctx.OWNER, organization_id: ctx.ORG, title: 'Cierre de mes', prompt: 'Calcula mis resultados del mes: envíos, respuestas y reuniones, y compáralos con el mes anterior.',
          frequency: 'monthly', time_of_day: '18:00', weekday: null, month_day: 1, time_zone: 'America/Santiago', status: 'active', next_run_at: ctx.daysAhead(9),
          last_run_at: null, last_run_id: null, last_status: null, consecutive_failures: 0, run_count: 0, created_from_run_id: null, created_at: ctx.daysAgo(10), updated_at: ctx.daysAgo(10) },
      ],
      // The campaign conversation was renamed (Plan 9, PR-20).
      // The renamed one, and «Prioridades de esta semana» pinned on top (COW-12).
      cowork_thread_settings: [{ root_run_id: second, user_id: ctx.OWNER, organization_id: ctx.ORG, title: 'Campaña logística · reclutamiento', hidden_at: null, pinned_at: null, updated_at: ctx.hoursAgo(2) },
        { root_run_id: first, user_id: ctx.OWNER, organization_id: ctx.ORG, title: null, hidden_at: null, pinned_at: ctx.hoursAgo(5), updated_at: ctx.hoursAgo(5) }],
      // The names Cowork gave its conversations (Plan 13): the first one shows it; the renamed one keeps the person's name.
      cowork_thread_memory: [
        { root_run_id: first, user_id: ctx.OWNER, organization_id: ctx.ORG, source_run_id: ctx.uid(9005), source_created_at: ctx.hoursAgo(24), updated_at: ctx.hoursAgo(24),
          memory: { title: 'Prioridades de esta semana', offer: null, audience: null, people: [], decisions: [], pending: [] } },
        { root_run_id: second, user_id: ctx.OWNER, organization_id: ctx.ORG, source_run_id: second, source_created_at: ctx.hoursAgo(3), updated_at: ctx.hoursAgo(3),
          memory: { title: 'Campaña de logística', offer: null, audience: null, people: [], decisions: [], pending: [] } },
      ],
      // «Lo que Cowork recuerda» (Plan 13): two of the owner's, one the team shares (saved by a member) and one a member keeps for
      // themselves, which the owner never sees.
      suplia_memories: [
        memory(9201, ctx.OWNER, 'user', 'firma solo con mi nombre, sin cargo', ctx.daysAgo(2)),
        memory(9202, ctx.OWNER, 'user', 'tutea a todos los contactos', ctx.daysAgo(5)),
        memory(9203, ctx.MEMBER, 'organization', 'no escribir a Adecco: ya es cliente', ctx.daysAgo(9)),
        memory(9204, ctx.MEMBER, 'user', 'prefiere correos de menos de 80 palabras', ctx.daysAgo(1)),
      ],
      // «Pedidos guardados» (COW-06): one of the owner's, one a member shared with the team and one a member keeps for themselves.
      cowork_prompts: [
        { id: ctx.uid(9301), organization_id: ctx.ORG, user_id: ctx.OWNER, title: 'Seguimiento sin respuesta', shared: false, created_at: ctx.daysAgo(3), updated_at: ctx.daysAgo(3),
          prompt: 'Revisa a quién le escribí hace más de una semana y no respondió, y prepárame un seguimiento corto para cada uno.' },
        { id: ctx.uid(9302), organization_id: ctx.ORG, user_id: ctx.MEMBER, title: 'Informe del lunes', shared: true, created_at: ctx.daysAgo(6), updated_at: ctx.daysAgo(6),
          prompt: 'Dime quién respondió la semana pasada, qué reuniones salieron y a quién conviene escribir hoy.' },
        { id: ctx.uid(9303), organization_id: ctx.ORG, user_id: ctx.MEMBER, title: 'Mi lista de retail', shared: false, created_at: ctx.daysAgo(1), updated_at: ctx.daysAgo(1),
          prompt: 'Busca jefes de selección en cadenas de retail de regiones.' },
      ],
    },
    rpc: { cowork_has_access: (_args, { user, service }) => service || user?.id === ctx.OWNER || user?.id === ctx.MEMBER },
    storage: { [`cowork-artifacts/${ctx.ORG}/${ctx.OWNER}/${runs[3].id}/${artifact.name}`]: { type: 'text/html; charset=utf-8', body: page } },
  };
}
