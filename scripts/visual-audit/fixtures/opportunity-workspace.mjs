// «Gestionar oportunidades» (the workspace, OPPORTUNITIES_WORKSPACE_ENABLED): what a team has done with the opportunities of
// fixtures/opportunities.mjs. An administrator (the owner) sees the whole pipeline; a member sees only what was assigned to them
// (opportunity_participants), as opportunity_workspace_list and opportunity_can_read decide in the database; the stand-ins for
// those two functions are below and follow the SQL.
//
// Stages (work state): 2 and 7 in preparation, 3 and 6 assigned, 10 submitted, 11 won, 12 lost; 0, 1, 9 and 13 recommended and
// nobody has them yet; 4 and 15 still to review; 5, 8 and 14 left out. Diego (the member) has 2, 3, 6, 10 and 11; Camila has 7.
// The tender of 2 carries a finished report and 6 is being researched right now.
const ADMIN_ROLES = new Set(['owner', 'admin']);
const evaluationOf = row => row.data?.evaluation ?? (row.kind === 'private' ? 'review' : 'pending');
const adminOf = (store, org, userId) => ADMIN_ROLES.has((store.tables.organization_members || []).find(member => member.organization_id === org && member.user_id === userId)?.role);
const canRead = (store, org, userId, id) => adminOf(store, org, userId) || (store.tables.opportunity_participants || []).some(item => item.opportunity_id === id && item.user_id === userId);
const fmt = iso => { const d = new Date(iso); const p = n => String(n).padStart(2, '0'); return `${p(d.getUTCDate())}-${p(d.getUTCMonth() + 1)}-${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`; };

/** The page of the list as the SQL builds it: the readable rows of the view, the words and the kinds, best score first, 100 a page. */
function listRows(args, { store }) {
  const { p_org: org, p_user: userId, p_view: view = 'all', p_query: query = '', p_page: page = 0, p_kinds: kinds = [], p_terms: terms = [] } = args;
  const admin = adminOf(store, org, userId);
  const work = new Map((store.tables.opportunity_work || []).map(item => [item.opportunity_id, item]));
  const has = (value, word) => String(value ?? '').toLowerCase().includes(String(word).toLowerCase());
  const rows = (store.tables.commercial_opportunities || []).filter(row => {
    if (row.organization_id !== org || !canRead(store, org, userId, row.id)) return false;
    if (kinds?.length && !kinds.includes(row.kind)) return false;
    if (query && !(has(row.title, query) || has(row.company_name, query) || has(row.buyer_name, query))) return false;
    if (terms?.length && !terms.some(term => has(row.title, term) || has(row.data?.summary?.text, term))) return false;
    if (view === 'all') return true;
    if (admin) return view === 'assigned' ? (work.get(row.id)?.state ?? 'unassigned') !== 'unassigned' : evaluationOf(row) === view;
    return view === 'recommended' || (work.get(row.id)?.state ?? 'assigned') === view;
  });
  rows.sort((a, b) => b.score - a.score || String(b.updated_at).localeCompare(String(a.updated_at)) || String(a.id).localeCompare(String(b.id)));
  return rows.slice(Math.max(0, Math.min(page, 1000)) * 100, Math.max(0, Math.min(page, 1000)) * 100 + 100);
}

/** The stage as opportunity_workspace_page reads it: «open» while nobody works it, otherwise its work state. */
const stageOf = (store, id) => { const state = (store.tables.opportunity_work || []).find(item => item.opportunity_id === id)?.state; return !state || state === 'unassigned' ? 'open' : state; };
/** The AI's evaluation as the new reads take it: a received one without one is to review; any other without one, none. */
const evaluationOfPage = row => row.data?.evaluation ?? (row.kind === 'private' ? 'review' : null);
/** The rows a person reads with the filters of opportunity_workspace_page and opportunity_workspace_counts (20261024150000). */
function readableRows(args, store) {
  const { p_org: org, p_user: userId, p_query: query = '', p_kinds: kinds = [], p_terms: terms = [], p_biddable: biddable = false } = args;
  if (!(store.tables.organization_members || []).some(member => member.organization_id === org && member.user_id === userId)) return [];
  const has = (value, word) => String(value ?? '').toLowerCase().includes(String(word).toLowerCase());
  const now = Date.now();
  return (store.tables.commercial_opportunities || []).filter(row => {
    if (row.organization_id !== org || !canRead(store, org, userId, row.id)) return false;
    if (kinds?.length && !kinds.includes(row.kind)) return false;
    if (query && !(has(row.title, query) || has(row.company_name, query) || has(row.buyer_name, query))) return false;
    if (terms?.length && !terms.some(term => has(row.title, term) || has(row.data?.summary?.text, term))) return false;
    if (biddable && stageOf(store, row.id) === 'open' && row.deadline_at && Date.parse(row.deadline_at) <= now) return false;
    return true;
  });
}
function pageRows(args, { store }) {
  const { p_stages: stages = [], p_evaluations: evaluations = [], p_sort: sort = 'priority', p_limit: limit = 100, p_offset: offset = 0 } = args;
  const work = new Map((store.tables.opportunity_work || []).map(item => [item.opportunity_id, item]));
  const rows = readableRows(args, store).filter(row => (!stages?.length || stages.includes(stageOf(store, row.id))) && (!evaluations?.length || evaluations.includes(evaluationOfPage(row))));
  const byDefault = (a, b) => b.score - a.score || String(b.updated_at).localeCompare(String(a.updated_at)) || String(a.id).localeCompare(String(b.id));
  const last = value => (value === null || value === undefined ? 1 : 0);
  const order = {
    deadline: (a, b) => last(a.deadline_at) - last(b.deadline_at) || String(a.deadline_at).localeCompare(String(b.deadline_at)) || byDefault(a, b),
    amount: (a, b) => last(a.amount) - last(b.amount) || Number(b.amount) - Number(a.amount) || byDefault(a, b),
    recent: (a, b) => String(work.get(b.id)?.updated_at ?? b.updated_at).localeCompare(String(work.get(a.id)?.updated_at ?? a.updated_at)) || byDefault(a, b),
  }[sort] || byDefault;
  return rows.sort(order).slice(Math.max(0, offset), Math.max(0, offset) + Math.min(600, Math.max(0, limit)));
}
function countRows(args, { store }) {
  const groups = new Map();
  for (const row of readableRows(args, store)) {
    const key = `${stageOf(store, row.id)}|${evaluationOfPage(row)}`;
    groups.set(key, (groups.get(key) || 0) + 1);
  }
  return [...groups].map(([key, total]) => { const [stage, evaluation] = key.split('|'); return { stage, evaluation: evaluation === 'null' ? null : evaluation, total }; });
}

export default function workspace(ctx) {
  const opp = ctx.opp;
  const org = ctx.ORG;
  const group = ctx.uid(9600);
  const doc = n => ctx.uid(9610 + n);
  const job = n => ctx.uid(9620 + n);
  const report = n => ctx.uid(9630 + n);

  const work = (n, state, extra = {}) => ({ organization_id: org, opportunity_id: opp(n), revision: 2, state, team_id: group, responsible_id: ctx.MEMBER, assigned_by: ctx.OWNER, objective: '', due_at: null, updated_at: ctx.daysAgo(1), ...extra });
  const opportunityWork = [
    work(2, 'working', { objective: 'Presentar la oferta con las dos referencias de retail y el certificado de antecedentes de la empresa.', due_at: ctx.daysAhead(6), updated_at: ctx.hoursAgo(5) }),
    work(3, 'assigned', { objective: 'Revisar si conviene postular: es una compra chica, sirve para crear historial.', due_at: ctx.daysAhead(7) }),
    work(6, 'assigned', { objective: 'Cierra en dos días: confirmar si podemos cubrir las 12 sucursales y preparar la oferta.', due_at: ctx.daysAhead(1), updated_at: ctx.hoursAgo(20) }),
    work(7, 'working', { responsible_id: ctx.OWNER, objective: 'Coordinar la visita obligatoria a planta y cotizar con el equipo de operaciones.', due_at: ctx.daysAhead(10), updated_at: ctx.hoursAgo(30) }),
    work(10, 'submitted', { objective: 'Seguir la adjudicación; responder consultas si el comprador pregunta.', updated_at: ctx.daysAgo(3) }),
    work(11, 'won', { objective: 'Preparar el contrato y la garantía de fiel cumplimiento.', updated_at: ctx.daysAgo(7) }),
    work(12, 'lost', { objective: '', updated_at: ctx.daysAgo(15) }),
  ];
  const participant = (n, userId) => ({ organization_id: org, opportunity_id: opp(n), user_id: userId, assigned_at: ctx.daysAgo(4) });
  const participants = [participant(2, ctx.MEMBER), participant(2, ctx.OWNER), participant(3, ctx.MEMBER), participant(6, ctx.MEMBER), participant(7, ctx.OWNER), participant(10, ctx.MEMBER), participant(11, ctx.MEMBER)];

  const note = (n, index, kind, body, actor, ago, data = {}) => ({ id: ctx.uid(9640 + n * 10 + index), organization_id: org, opportunity_id: opp(n), actor_id: actor, kind, body, data, event_key: `fx:${n}:${index}`, created_at: ago });
  const activity = [
    note(2, 0, 'created', 'Oportunidad encontrada por la búsqueda diaria', null, ctx.daysAgo(6)),
    note(2, 1, 'assigned', 'Camila Torres asignó la oportunidad a Diego Fuentes', ctx.OWNER, ctx.daysAgo(5)),
    note(2, 2, 'progress', 'Leí las bases: piden dos referencias y certificado de antecedentes de la empresa. Ya pedí el certificado.', ctx.MEMBER, ctx.daysAgo(3)),
    note(2, 3, 'decision', 'Pide una decisión: ¿Ofertamos el módulo de alertas judiciales como opcional? Sube el precio 12 %.', ctx.MEMBER, ctx.hoursAgo(6), { type: 'ask', dueAt: ctx.daysAhead(2) }),
    // A note that names Diego (OPP-28): he heard about it in «Novedades».
    note(2, 4, 'note', '@Diego Fuentes, ¿confirmas con Retail Andino que firman el certificado esta semana?', ctx.OWNER, ctx.hoursAgo(3), { mentions: [ctx.MEMBER] }),
    note(6, 0, 'assigned', 'Camila Torres asignó la oportunidad a Diego Fuentes', ctx.OWNER, ctx.hoursAgo(20)),
    note(7, 0, 'created', 'Oportunidad recibida incorporada al workspace', ctx.OWNER, ctx.daysAgo(2)),
    note(10, 0, 'submitted', 'Oferta presentada en Mercado Público', ctx.MEMBER, ctx.daysAgo(3)),
    // Closed with their reasons (OPP-30): what «Lo que aprendimos» counts in Administración.
    note(11, 0, 'state', 'Estado: Ganada · Experiencia, Precio.', ctx.OWNER, ctx.daysAgo(7), { to: 'won', motives: ['price', 'experience'] }),
    note(12, 0, 'state', 'Estado: Perdida · Precio. Ganó Selección Austral SpA.', ctx.OWNER, ctx.daysAgo(9), { to: 'lost', motives: ['price'], winner: 'Selección Austral SpA' }),
  ];

  const task = (n, index, title, status, owner, due) => ({ id: ctx.uid(9700 + n * 10 + index), organization_id: org, opportunity_id: opp(n), title, owner_id: owner, due_at: due, status, evidence: '', created_by: ctx.OWNER, updated_at: ctx.daysAgo(1) });
  const tasks = [
    task(2, 0, 'Pedir el certificado de antecedentes de la empresa', 'done', ctx.MEMBER, ctx.daysAgo(1)),
    task(2, 1, 'Reunir las dos referencias de clientes de retail', 'working', ctx.MEMBER, ctx.daysAhead(2)),
    task(2, 2, 'Completar el anexo 3 con el precio por persona', 'pending', ctx.OWNER, ctx.daysAhead(4)),
    task(2, 3, 'Firmar la declaración jurada del representante legal', 'pending', ctx.OWNER, ctx.daysAhead(5)),
    // «Mis tareas» of Diego across his opportunities (OPP-27): one already late, one this week.
    task(6, 0, 'Pedir la visita a terreno de las sucursales', 'pending', ctx.MEMBER, ctx.daysAgo(2)),
    task(3, 0, 'Preparar el anexo técnico', 'pending', ctx.MEMBER, ctx.daysAhead(3)),
  ];

  const document = (n, index, name, status = 'read') => ({ id: doc(n * 3 + index), organization_id: org, opportunity_id: opp(n), name, mime: 'application/pdf', sha256: `${String(n * 3 + index).padStart(2, '0')}`.repeat(32).slice(0, 64),
    storage_path: null, source_url: 'https://example.org/bases.pdf', source_kind: 'official', bytes: 480_000, pages_total: 24, pages_read: status === 'read' ? 24 : 12, extraction_status: status, uploaded_by: ctx.OWNER, created_at: ctx.daysAgo(5) });
  const documents = [document(2, 0, 'Bases administrativas.pdf'), document(2, 1, 'Anexos y formularios.pdf'), document(2, 2, 'Aclaraciones del foro.pdf', 'partial')];

  // The report of tender 2, as the research job leaves it (REPORT_OUTLINE in expedient.ts): enough to see every part of the page.
  const cite = (chunk, quote) => ({ chunkId: `fx-chunk-${chunk}`, quote });
  const fact = (text, state, ...citations) => ({ text, state, citations });
  const section = (id, title, paragraphs, facts = []) => ({ id, title, paragraphs, facts });
  const closing = ctx.daysAhead(8);
  const tenderReport = {
    title: 'Servicio de verificación de antecedentes para personal externo · Municipalidad de Providencia',
    executive: 'La municipalidad pide verificar antecedentes laborales y judiciales de unas 180 personas externas al año, con informe en 48 horas. Calza con lo que ofreces, el monto referencial es de $18.000.000 y el plazo para ofertar cierra en 8 días. Conviene postular: lo que falta es reunir dos referencias y fijar el precio por persona.',
    recommendation: 'advance',
    reasons: [
      'Piden exactamente lo que ofreces: antecedentes laborales y judiciales con informe en 48 horas.',
      'El monto referencial calza con tu escala y las bases son simples (un anexo económico y uno técnico).',
      'El puntaje premia el plazo de entrega y la experiencia en retail, que ya tienes.',
    ],
    sections: [
      section('decision', 'Decisión y próximos pasos', ['Postula. El cierre es en 8 días y quedan tres tareas con dueño: referencias, anexo económico y declaración jurada.'],
        [fact('Cierre de ofertas el ' + fmt(closing), 'documented', cite(1, 'La recepción de ofertas vence el'))]),
      section('calza', 'Qué piden y cómo calza con tu oferta', ['Verificación de antecedentes laborales y judiciales de personal externo, con informe por persona en un máximo de 48 horas hábiles.',
        'Tu plataforma entrega el informe en minutos; el riesgo no está en el plazo sino en acreditar experiencia con organismos públicos.'],
        [fact('Piden informe por persona en un máximo de 48 horas hábiles', 'documented', cite(2, 'informe individual dentro de 48 horas hábiles')),
          fact('Estiman unas 180 personas al año', 'proposed')]),
      section('requisitos', 'Requisitos para postular y qué falta', ['Se piden siete documentos; cuatro ya están en tu carpeta y tres faltan.'],
        [fact('La oferta se descarta sin la declaración jurada firmada', 'documented', cite(3, 'serán declaradas inadmisibles las ofertas que no incluyan'))]),
      section('evaluacion', 'Cómo se evalúa y cómo ganar puntaje', ['Precio 40 %, plazo de entrega del informe 25 %, experiencia 25 % y cumplimiento formal 10 %.',
        'El plazo es la palanca más barata: ofrecer 24 horas en lugar de 48 suma el puntaje completo de ese criterio.'],
        [fact('Ponderación: precio 40 %, plazo 25 %, experiencia 25 %, formal 10 %', 'documented', cite(4, 'Precio 40%'))]),
      section('contrato', 'Condiciones del contrato: garantías, pagos y multas', ['Garantía de fiel cumplimiento del 5 % del contrato, pago a 30 días y multa de 1 UF por día de atraso en un informe.'],
        [fact('Pago a 30 días desde la factura', 'documented', cite(5, 'se pagará dentro de 30 días corridos'))]),
      section('propuesta', 'Propuesta sugerida y plan de trabajo', ['Ofrece informe en 24 horas, tablero de seguimiento para el municipio y un contacto único. Implementación en cinco días.']),
      section('precio', 'Precio y números', ['Con 180 personas al año y un costo de $4.200 por verificación, el escenario base queda en $17,3 millones antes de impuestos.']),
      section('riesgos', 'Riesgos y cómo cubrirlos', ['Dos riesgos: no acreditar experiencia pública y que el volumen real supere lo estimado.']),
      section('preguntas', 'Preguntas para el comprador y documentos por preparar', ['Hay tres preguntas que conviene hacer en el foro antes del cierre.']),
    ],
    requirements: [
      { title: 'Declaración jurada de requisitos para ofertar firmada', status: 'pending', evidence: [cite(3, 'declaración jurada')], action: 'Firmarla en línea en el portal antes de ofertar.', role: 'Representante legal', due: fmt(ctx.daysAhead(5)) },
      { title: 'Certificado de antecedentes de la empresa', status: 'supported', evidence: [], action: 'Ya está en la carpeta de la empresa; vence en 60 días.', role: 'Administración', due: '' },
      { title: 'Dos referencias de clientes con monto y plazo', status: 'pending', evidence: [cite(6, 'dos certificados de clientes')], action: 'Pedir los certificados a Retail Andino y Logística Sur.', role: 'Comercial', due: fmt(ctx.daysAhead(3)) },
      { title: 'Inscripción hábil en el Registro de Proveedores', status: 'supported', evidence: [], action: 'Revisar que siga vigente.', role: 'Administración', due: '' },
      { title: 'Anexo económico con el precio por persona', status: 'pending', evidence: [cite(7, 'anexo económico')], action: 'Definir el precio con la calculadora y completarlo.', role: 'Gerencia', due: fmt(ctx.daysAhead(4)) },
      { title: 'Programa de integridad declarado', status: 'unknown', evidence: [], action: 'Confirmar si la empresa tiene código de ética y canal de denuncias.', role: 'Gerencia', due: '' },
      { title: 'Garantía de seriedad de la oferta', status: 'supported', evidence: [], action: 'No se exige en esta licitación.', role: '', due: '' },
    ],
    tasks: [
      { title: 'Pedir las dos referencias de clientes', role: 'Comercial', due: fmt(ctx.daysAhead(3)), dependency: '', evidence: '' },
      { title: 'Calcular el precio por persona y completar el anexo económico', role: 'Gerencia', due: fmt(ctx.daysAhead(4)), dependency: 'Referencias', evidence: '' },
      { title: 'Firmar la declaración jurada en el portal', role: 'Representante legal', due: fmt(ctx.daysAhead(5)), dependency: '', evidence: '' },
      { title: 'Subir la oferta al portal y verificar el comprobante', role: 'Comercial', due: fmt(ctx.daysAhead(7)), dependency: 'Todo lo anterior', evidence: '' },
    ],
    milestones: [
      { label: 'Cierre del foro de consultas', date: fmt(ctx.daysAhead(4)), state: 'documented', citations: [cite(8, 'consultas hasta')] },
      { label: 'Cierre de recepción de ofertas', date: fmt(closing), state: 'documented', citations: [cite(1, 'La recepción de ofertas vence el')] },
      { label: 'Adjudicación estimada', date: fmt(ctx.daysAhead(23)), state: 'proposed', citations: [] },
    ],
    risks: [
      { title: 'No acreditar experiencia con organismos públicos', impact: 'medium', basis: 'documented', mitigation: 'Ofrecer certificados de clientes privados con monto y plazo, y proponer una prueba piloto sin costo.', citations: [cite(6, 'dos certificados de clientes')] },
      { title: 'El volumen real supera las 180 personas estimadas', impact: 'low', basis: 'proposed', mitigation: 'Fijar un tramo de precio por volumen en el anexo económico.', citations: [] },
    ],
    scenarios: [{ name: 'Escenario base', monthlyCost: 63000, months: 12, overheadPercent: 12, marginPercent: 18, taxPercent: 19, paymentDelayMonths: 1, guaranteePercent: 5, assumptions: ['180 verificaciones al año', 'Costo de $4.200 por verificación'] }],
    questions: [
      '¿El volumen de 180 personas al año es un mínimo o una estimación?',
      '¿Se acepta firma electrónica simple en la declaración jurada?',
      '¿La garantía de fiel cumplimiento puede ser una póliza electrónica?',
    ],
    warnings: ['El anexo económico exige el valor neto: el portal suma el IVA al total.'],
    nextSteps: ['Pedir las dos referencias de clientes esta semana', 'Calcular el precio por persona con la calculadora', 'Firmar la declaración jurada antes del cierre'],
    kind: 'tender', generatedAt: ctx.daysAgo(2),
    coverage: [{ id: doc(6), name: 'Bases administrativas.pdf', status: 'read', pagesRead: 24, pagesTotal: 24 }, { id: doc(7), name: 'Anexos y formularios.pdf', status: 'read', pagesRead: 24, pagesTotal: 24 }, { id: doc(8), name: 'Aclaraciones del foro.pdf', status: 'partial', pagesRead: 12, pagesTotal: 24 }],
    sources: [{ id: 'S1', documentId: doc(6), locator: 'p. 4', name: 'Bases administrativas.pdf' }, { id: 'S2', documentId: doc(7), locator: 'p. 2', name: 'Anexos y formularios.pdf' }],
    route: { steps: [
      { title: 'Reunir las dos referencias de clientes', detail: 'Pide el certificado a dos clientes con monto, plazo y alcance.', date: fmt(ctx.daysAhead(3)), kind: 'prepare' },
      { title: 'Hacer las preguntas del foro', detail: 'Volumen mínimo, firma electrónica y tipo de garantía.', date: fmt(ctx.daysAhead(4)), kind: 'ask' },
      { title: 'Completar el anexo económico', detail: 'Con el precio por persona de la calculadora.', date: fmt(ctx.daysAhead(5)), kind: 'prepare' },
      { title: 'Presentar la oferta en el portal', detail: 'Verifica el comprobante antes del cierre.', date: fmt(closing), kind: 'submit' },
    ] },
    reviewers: ['Abogada', 'Analista financiero'],
    submission: {
      channel: 'portal', channelDetail: 'La oferta se sube al portal de Mercado Público; no se aceptan ofertas por correo.',
      folders: [{ name: 'Oferta administrativa', documents: [
        { title: 'Declaración jurada de requisitos para ofertar', source: 'annex', signed: true, validity: '', excludesIfMissing: true, howTo: 'Se completa y firma en línea en el portal.', evidence: [cite(3, 'declaración jurada')] },
        { title: 'Certificado de antecedentes de la empresa', source: 'company', signed: false, validity: 'Emitido en los últimos 60 días', excludesIfMissing: false, howTo: 'Ya está en la carpeta de la empresa.', evidence: [] },
      ] }, { name: 'Oferta económica', documents: [
        { title: 'Anexo económico', source: 'annex', signed: true, validity: '', excludesIfMissing: true, howTo: 'El precio va neto; el portal suma el IVA.', evidence: [cite(7, 'anexo económico')] },
      ] }],
      rules: [{ text: 'El precio por persona no puede superar el monto referencial dividido por 180.', kind: 'budget', evidence: [] }],
      numbers: { budget: 18000000, budgetLabel: 'Monto referencial anual', currency: 'CLP', budgetIncludesTax: true, portalValue: 'net', notes: ['Digita el valor neto en el portal.'] },
      guarantees: [{ kind: 'Fiel cumplimiento', amount: '5 % del contrato', validity: 'Contrato más 60 días', when: 'Al firmar el contrato', payableTo: 'Municipalidad de Providencia' }],
      afterSubmit: ['Revisa el comprobante del portal.', 'Atiende consultas de la comisión evaluadora.'],
      inconsistencies: [],
    },
  };
  const reports = [
    { id: report(2), organization_id: org, opportunity_id: opp(2), job_id: job(2), content_hash: 'fx-hash-2', profile_revision: 3, report: tenderReport, created_by: ctx.OWNER, created_at: ctx.daysAgo(2) },
    { id: report(10), organization_id: org, opportunity_id: opp(10), job_id: job(10), content_hash: 'fx-hash-10', profile_revision: 3, report: { ...tenderReport, title: 'Servicios de contact center para atención ciudadana · Servicio de Registro Civil' }, created_by: ctx.OWNER, created_at: ctx.daysAgo(6) },
  ];
  const jobs = [
    { id: job(2), organization_id: org, opportunity_id: opp(2), requested_by: ctx.OWNER, kind: 'research', dedupe_key: 'fx:research:2', state: 'ready', payload: {}, result: null, lease_token: null, lease_until: null, attempts: 1, error: null, created_at: ctx.daysAgo(2), updated_at: ctx.daysAgo(2) },
    // A report reading its documents: 4 of 10 parts in two minutes, as the job notes it (report-progress.ts), with the estimate of its size.
    { id: job(6), organization_id: org, opportunity_id: opp(6), requested_by: ctx.OWNER, kind: 'research', dedupe_key: 'fx:research:6', state: 'running',
      payload: { estimate: { parts: 10, minutes: 5 }, progress: { stage: 'read', read: 4, total: 10, document: 'Bases técnicas.pdf', readSince: ctx.minutesAgo(2) } },
      result: null, lease_token: null, lease_until: null, attempts: 1, error: null, created_at: ctx.minutesAgo(3), updated_at: ctx.minutesAgo(1) },
    { id: job(10), organization_id: org, opportunity_id: opp(10), requested_by: ctx.OWNER, kind: 'research', dedupe_key: 'fx:research:10', state: 'ready', payload: {}, result: null, lease_token: null, lease_until: null, attempts: 1, error: null, created_at: ctx.daysAgo(6), updated_at: ctx.daysAgo(6) },
    // This morning's search (OPP-15): the listing and LinkedIn answered; one of the two Compra Ágil searches got Mercado Público's 504.
    ...[['tenders', {}, 'ready', null], ['tenders', { keyword: 'antecedentes' }, 'ready', null], ['tenders', { keyword: 'verificación' }, 'failed', 'Compra Ágil respondió 504 (falla de Mercado Público).'], ['posts', {}, 'ready', null]]
      .map(([kind, payload, state, error], index) => ({ id: ctx.uid(9590 + index), organization_id: org, opportunity_id: null, requested_by: ctx.OWNER, kind, dedupe_key: `fx:discovery:${index}`, state, payload, result: null,
        lease_token: null, lease_until: null, attempts: 1, error, created_at: ctx.hoursAgo(5), updated_at: ctx.hoursAgo(5 - index * 0.05) })),
  ];

  // The titles of production: opportunity_assign («Oportunidad asignada: …»), workspace-jobs.ts («Informe listo: …») and notifyManagers.
  const notification = (index, userId, n, title, kind, read) => ({ id: ctx.uid(9800 + index), organization_id: org, opportunity_id: opp(n), user_id: userId, title, assignment_revision: 1, kind, event_key: `fx-n:${index}`, created_at: ctx.hoursAgo(2 + index * 3), read_at: read ? ctx.hoursAgo(1) : null });
  const notifications = [
    notification(0, ctx.MEMBER, 6, 'Oportunidad asignada: Servicio de guardias de seguridad para 12 sucursales', 'assignment', false),
    notification(1, ctx.MEMBER, 2, 'Informe listo: Servicio de verificación de antecedentes para personal externo', 'report', false),
    notification(2, ctx.MEMBER, 3, 'Oportunidad asignada: Compra Ágil: revisión de antecedentes de postulantes', 'assignment', true),
    notification(3, ctx.OWNER, 2, 'Decisión pedida: Servicio de verificación de antecedentes para personal externo', 'task', false),
    // workspace-notes.ts: a note that names Diego.
    { ...notification(4, ctx.MEMBER, 2, 'Camila Torres te mencionó: Servicio de verificación de antecedentes para personal externo', 'task', false), event_key: 'mention:fx:2:4', created_at: ctx.hoursAgo(3) },
  ];

  const context = { organization_id: org, offer: 'Verificación de antecedentes laborales y judiciales para empresas que contratan mucho personal, con informes en minutos y trazabilidad para auditorías.',
    services: ['Verificación de antecedentes laborales', 'Verificación de antecedentes judiciales', 'Alertas judiciales'], territories: ['Región Metropolitana', 'Valparaíso', 'Biobío'], exclusions: ['Servicios de salud', 'Construcción'],
    priority: 'balanced', criteria: { decisionMakerTitles: ['Gerente de Personas', 'Jefe de Reclutamiento'], keywords: ['antecedentes', 'verificación', 'personal externo'], postQueries: ['"verificación de antecedentes" contratación masiva'], unspsc: ['80111600'] },
    search: { sources: { hiring: false }, tenders: { minAmount: 2_000_000, avoidBuyers: [], buyers: ['Servicio de Salud Metropolitano Norte'], regions: [], unspsc: ['8011'] } },
    revision: 3, automation: true, hour: 8, approved_by: ctx.OWNER, approved_at: ctx.daysAgo(9) };
  const companyDocument = (n, label, expiresIn) => ({ id: ctx.uid(9900 + n), organization_id: org, label, kind: 'certificate', expires_at: expiresIn === null ? null : ctx.daysAhead(expiresIn), storage_path: null, uploaded_by: ctx.OWNER, created_at: ctx.daysAgo(30) });

  return {
    tables: {
      opportunity_work: opportunityWork,
      opportunity_participants: participants,
      opportunity_activity: activity,
      opportunity_tasks: tasks,
      opportunity_documents: documents,
      opportunity_reports: reports,
      opportunity_jobs: jobs,
      opportunity_notifications: notifications,
      opportunity_company_context: [context],
      opportunity_budget_months: [{ organization_id: org, period: `${ctx.today.slice(0, 7)}-01`, spent_micro_usd: 3_400_000, reserved_micro_usd: 600_000 }],
      opportunity_company_documents: [companyDocument(0, 'Certificado F30', 5), companyDocument(1, 'Certificado de antecedentes de la empresa', 60), companyDocument(2, 'Inscripción en el Registro de Proveedores', null)],
      organization_reporting_groups: [{ id: group, organization_id: org, name: 'Licitaciones', slug: 'licitaciones', country_code: 'CL', color: '#2563eb', is_active: true, created_at: ctx.daysAgo(40), updated_at: ctx.daysAgo(40) }],
    },
    rpc: {
      opportunity_workspace_list: listRows,
      opportunity_workspace_list_kinds: listRows,
      opportunity_workspace_list_terms: listRows,
      opportunity_workspace_page: pageRows,
      opportunity_workspace_counts: countRows,
      opportunity_can_read: (args, { store }) => canRead(store, args.p_org, args.p_user, args.p_opportunity),
      // opportunity_assign: the team of an opportunity is replaced, the stage becomes «assigned» when it had none, and the people are told.
      opportunity_assign: (args, { store }) => {
        const { p_org: orgId, p_actor: actor, p_id: id, p_revision: revision, p_team: team, p_users: users = [], p_responsible: responsible, p_objective: objective, p_due: due } = args;
        if (!adminOf(store, orgId, actor)) throw new Error('OPPORTUNITY_ADMIN_REQUIRED');
        const item = (store.tables.commercial_opportunities || []).find(row => row.organization_id === orgId && row.id === id);
        if (!item) throw new Error('OPPORTUNITY_NOT_FOUND');
        const table = name => (store.tables[name] ||= []);
        let record = table('opportunity_work').find(row => row.opportunity_id === id);
        if (!record) { record = { organization_id: orgId, opportunity_id: id, revision: 0, state: 'unassigned', team_id: null, responsible_id: null, assigned_by: null, objective: '', due_at: null, updated_at: new Date().toISOString() }; table('opportunity_work').push(record); }
        if (record.revision !== Number(revision)) throw new Error('OPPORTUNITY_REVISION_CONFLICT');
        store.tables.opportunity_participants = table('opportunity_participants').filter(row => row.opportunity_id !== id);
        for (const user of new Set(users)) store.tables.opportunity_participants.push({ organization_id: orgId, opportunity_id: id, user_id: user, assigned_at: new Date().toISOString() });
        Object.assign(record, { revision: record.revision + 1, team_id: team ?? null, responsible_id: responsible ?? null, assigned_by: actor, objective: objective || '', due_at: due ?? null, updated_at: new Date().toISOString(),
          state: users.length === 0 ? 'unassigned' : record.state === 'unassigned' ? 'assigned' : record.state });
        for (const user of new Set(users)) table('opportunity_notifications').push({ id: `fx-assign-${id}-${user}`, organization_id: orgId, opportunity_id: id, user_id: user, title: `Oportunidad asignada: ${String(item.title).slice(0, 470)}`, assignment_revision: record.revision, kind: 'assignment', event_key: null, created_at: new Date().toISOString(), read_at: null });
        table('opportunity_activity').push({ id: `fx-act-${id}-${record.revision}`, organization_id: orgId, opportunity_id: id, actor_id: actor, kind: 'assignment', body: 'Equipo de trabajo actualizado', data: { revision: record.revision, users, team, responsible }, event_key: null, created_at: new Date().toISOString() });
        return record.revision;
      },
    },
  };
}
