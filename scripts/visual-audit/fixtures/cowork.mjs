// Cowork: three finished threads for the owner (one with a follow-up turn in two versions, the latest rated 👍; one renamed; one
// with a code artifact on the canvas)
// and the access RPC, which only the owner passes. The artifact is a small static page in storage: the panel around it is what is audited.
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
  ];
  const replies = {
    1: 'Te recomiendo empezar por **3 personas** que calzan con tu cliente ideal y aún no contactas:\n\n1. **Andrea Soto**, Gerente de Personas en Retail Andino: están abriendo tiendas.\n2. **Matías Rojas**, Jefe de Reclutamiento en Logística Sur: contrataciones masivas en temporada.\n3. **Francisca Muñoz**, Gerente de Operaciones en Seguridad Austral.\n\n¿Quieres que prepare el primer correo para Andrea?',
    2: 'Listo. Este es el borrador para **Andrea Soto**:\n\n**Asunto:** Retail Andino: contrataciones sin revisar antecedentes a mano\n\nHola Andrea, vi que Retail Andino está abriendo tiendas. Revisamos antecedentes en minutos, con trazabilidad. ¿Conversamos 15 minutos?',
    3: 'Armé la campaña **«Logística · centros de distribución»** con 6 jefes de reclutamiento. Quedó en Campañas para que la revises antes de aprobarla.',
    5: 'Aquí va una versión más directa para **Andrea Soto**:\n\n**Asunto:** ¿15 minutos sobre las contrataciones de Retail Andino?\n\nHola Andrea, con las tiendas nuevas su equipo revisa muchos antecedentes. Nosotros lo hacemos en minutos y con trazabilidad. ¿Te muestro cómo el jueves?',
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
    ...(index === 3 ? [artifactEvent(item, index * 10 + 5)] : []),
    { sequence: index * 10 + 8, run_id: item.id, user_id: ctx.OWNER, organization_id: ctx.ORG, kind: 'run.completed', payload: { reply: replies[index + 1], document: null,
      ...(index === 0 ? { blocks: [stagesChart] } : {}) }, created_at: item.updated_at },
    ...(index === 4 ? [at(item, index * 10 + 9, 'answer.feedback', { rating: 'up', reason: null, comment: null })] : []),
  ]);
  return {
    tables: {
      cowork_runs: runs, cowork_run_events: events,
      // The campaign conversation was renamed (Plan 9, PR-20); the other keeps its first message as the name.
      cowork_thread_settings: [{ root_run_id: second, user_id: ctx.OWNER, organization_id: ctx.ORG, title: 'Campaña logística · reclutamiento', hidden_at: null, updated_at: ctx.hoursAgo(2) }],
      // «Lo que Cowork recuerda» (Plan 13): two of the owner's, one the team shares (saved by a member) and one a member keeps for
      // themselves, which the owner never sees.
      suplia_memories: [
        memory(9201, ctx.OWNER, 'user', 'firma solo con mi nombre, sin cargo', ctx.daysAgo(2)),
        memory(9202, ctx.OWNER, 'user', 'tutea a todos los contactos', ctx.daysAgo(5)),
        memory(9203, ctx.MEMBER, 'organization', 'no escribir a Adecco: ya es cliente', ctx.daysAgo(9)),
        memory(9204, ctx.MEMBER, 'user', 'prefiere correos de menos de 80 palabras', ctx.daysAgo(1)),
      ],
    },
    rpc: { cowork_has_access: (_args, { user, service }) => service || user?.id === ctx.OWNER },
    storage: { [`cowork-artifacts/${ctx.ORG}/${ctx.OWNER}/${runs[3].id}/${artifact.name}`]: { type: 'text/html; charset=utf-8', body: page } },
  };
}
