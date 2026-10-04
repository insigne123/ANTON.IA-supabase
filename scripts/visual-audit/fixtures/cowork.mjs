// Cowork: two finished threads for the owner (one with a follow-up turn, one renamed) and the access RPC, which only the owner passes.
export default function cowork(ctx) {
  const run = (n, message, { parent = null, root, status = 'completed', at }) => ({
    id: ctx.uid(9000 + n), user_id: ctx.OWNER, organization_id: ctx.ORG, request_id: ctx.uid(9100 + n), message, mode: 'approval', status,
    created_at: at, updated_at: at, lease_token: null, lease_expires_at: null, attempts: 1, parent_run_id: parent, depth: parent ? 1 : 0, root_run_id: root,
  });
  const first = ctx.uid(9001);
  const second = ctx.uid(9003);
  const runs = [
    run(1, '¿A quién le escribo esta semana?', { root: first, at: ctx.hoursAgo(26) }),
    run(2, 'Prepárame el correo para Andrea Soto', { parent: first, root: first, at: ctx.hoursAgo(25) }),
    run(3, 'Arma una campaña para jefes de reclutamiento en logística', { root: second, at: ctx.hoursAgo(3) }),
  ];
  const replies = {
    1: 'Te recomiendo empezar por **3 personas** que calzan con tu cliente ideal y aún no contactas:\n\n1. **Andrea Soto**, Gerente de Personas en Retail Andino: están abriendo tiendas.\n2. **Matías Rojas**, Jefe de Reclutamiento en Logística Sur: contrataciones masivas en temporada.\n3. **Francisca Muñoz**, Gerente de Operaciones en Seguridad Austral.\n\n¿Quieres que prepare el primer correo para Andrea?',
    2: 'Listo. Este es el borrador para **Andrea Soto**:\n\n**Asunto:** Retail Andino: contrataciones sin revisar antecedentes a mano\n\nHola Andrea, vi que Retail Andino está abriendo tiendas. Revisamos antecedentes en minutos, con trazabilidad. ¿Conversamos 15 minutos?',
    3: 'Armé la campaña **«Logística · centros de distribución»** con 6 jefes de reclutamiento. Quedó en Campañas para que la revises antes de aprobarla.',
  };
  const events = runs.flatMap((item, index) => [
    { sequence: index * 2 + 1, run_id: item.id, user_id: ctx.OWNER, organization_id: ctx.ORG, kind: 'run.started', payload: {}, created_at: item.created_at },
    { sequence: index * 2 + 2, run_id: item.id, user_id: ctx.OWNER, organization_id: ctx.ORG, kind: 'run.completed', payload: { reply: replies[index + 1], document: null }, created_at: item.updated_at },
  ]);
  return {
    tables: {
      cowork_runs: runs, cowork_run_events: events,
      // The campaign conversation was renamed (Plan 9, PR-20); the other keeps its first message as the name.
      cowork_thread_settings: [{ root_run_id: second, user_id: ctx.OWNER, organization_id: ctx.ORG, title: 'Campaña logística · reclutamiento', hidden_at: null, updated_at: ctx.hoursAgo(2) }],
    },
    rpc: { cowork_has_access: (_args, { user, service }) => service || user?.id === ctx.OWNER },
  };
}
