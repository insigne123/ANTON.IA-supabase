// Demo answers for «Oportunidades» (the workspace of the admin): the bench has no opportunities workspace, reports or
// ChileCompra history, so the video reads these, with the shapes of /api/commercial-opportunities/* (captured from a local
// run and rewritten). Made-up bodies, suppliers and tenders; the RUTs carry a wrong check digit on purpose.
const DAY = 86_400_000;
const at = days => new Date(Date.now() + days * DAY).toISOString();
const dateText = days => new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Santiago' }).format(new Date(Date.now() + days * DAY));
const shortDate = days => {
  const parts = new Intl.DateTimeFormat('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Santiago' }).formatToParts(new Date(Date.now() + days * DAY));
  const get = type => parts.find(part => part.type === type)?.value;
  return `${get('day')}-${get('month')}-${get('year')} 15:00:00`;
};

export function opportunityData(ctx) {
  const ORG = ctx.ORG;
  const people = [{ user_id: ctx.OWNER, role: 'owner', name: 'Camila Torres' }, { user_id: ctx.MEMBER, role: 'member', name: 'Diego Fuentes' }];
  const item = (id, kind, title, extra) => ({
    id, organization_id: ORG, profile_id: null, kind, dedupe_key: id, title, company_name: null, company_domain: null, company_linkedin_url: null, buyer_name: null,
    region: null, amount: null, currency: 'CLP', deadline_at: null, published_at: null, url: null, score: 0, reasons: [], status: 'new', claimed_by: null, signal_count: 0,
    first_seen_at: at(-3), last_seen_at: at(-1), data: { evaluation: 'recommended' }, created_at: at(-3), updated_at: at(-1), ...extra,
  });
  const items = [
    item('demo-op-1', 'tender', 'Servicio de verificación de antecedentes de postulantes', { buyer_name: 'Hospital Regional de Bahía Azul', region: 'Biobío', amount: 48_000_000,
      deadline_at: at(9), url: 'https://www.mercadopublico.cl/Procurement/Modules/RFB/DetailsAcquisition.aspx?idlicitacion=4521-61-LE26', score: 91,
      reasons: ['Piden revisar antecedentes laborales y judiciales de postulantes antes de contratar: es lo que vendes.'], data: { evaluation: 'recommended', observed: { code: '4521-61-LE26' } } }),
    item('demo-op-2', 'compra_agil', 'Evaluaciones psicolaborales para 40 cargos', { buyer_name: 'Municipalidad de Valle Verde', region: 'Maule', amount: 6_500_000, deadline_at: at(4), score: 84,
      reasons: ['Evaluaciones antes de contratar, con plazo corto: calza con tu servicio.'] }),
    item('demo-op-3', 'tender', 'Plataforma de reclutamiento y selección por 24 meses', { buyer_name: 'Universidad Regional del Sur', region: 'Los Lagos', amount: 72_000_000, deadline_at: at(21), score: 78,
      reasons: ['Reclutamiento con revisión de candidatos; pide integración con su sistema de personal.'] }),
    item('demo-op-4', 'hiring', 'Actividad de contratación: Retail Pacífico', { company_name: 'Retail Pacífico', company_domain: 'retailpacifico.cl', score: 75, signal_count: 12,
      reasons: ['Publicó 12 avisos para cajeros y reponedores este mes.'] }),
    item('demo-op-5', 'linkedin_post', 'Buscamos 30 conductores para nuestro nuevo centro de distribución', { company_name: 'Norte Sur Transportes', company_domain: 'nortesur.cl', score: 70,
      reasons: ['Contratación masiva de conductores: necesitan revisar antecedentes rápido.'] }),
    item('demo-op-6', 'tender', 'Evaluación de competencias para jefaturas', { buyer_name: 'Servicio de Salud Valle Central', region: 'Maule', amount: 19_000_000, deadline_at: at(-6), score: 72,
      reasons: ['Evaluación de candidatos a jefaturas.'] }),
    item('demo-op-7', 'tender', 'Selección de personal transitorio para temporada alta', { buyer_name: 'Corporación Municipal de Puerto Claro', region: 'Valparaíso', amount: 15_000_000, deadline_at: at(-40), score: 80,
      reasons: ['Selección de personal temporal.'] }),
  ];
  const work = (opportunity_id, state, responsible_id = ctx.OWNER) => ({ organization_id: ORG, opportunity_id, revision: 2, state, team_id: null, responsible_id, assigned_by: ctx.OWNER,
    objective: state === 'working' ? 'Presentar la oferta antes del cierre' : '', due_at: state === 'working' ? at(7) : null, updated_at: at(-1) });
  const works = [work('demo-op-1', 'working'), work('demo-op-2', 'assigned', ctx.MEMBER), work('demo-op-6', 'submitted'), work('demo-op-7', 'won')];
  const pipelineItem = row => ({ id: row.id, kind: row.kind, title: row.title, company_name: row.company_name, buyer_name: row.buyer_name, company_domain: row.company_domain,
    url: row.url, score: row.score, reasons: row.reasons, deadline_at: row.deadline_at, amount: row.amount, currency: row.currency, data: row.data, updated_at: row.updated_at });

  const overview = {
    mode: 'management', items, work: works,
    notifications: [{ id: 'demo-n-1', opportunity_id: 'demo-op-1', title: 'Informe listo: Servicio de verificación de antecedentes de postulantes', created_at: at(-0.1), read_at: null }],
    members: people, groups: [], documentAlerts: [], budget: { spent: 3.2, reserved: 0, cap: 20 },
    sourceStatus: { claude: true, linkedin: true, posts: true, jsearch: true, automation: true }, suggestion: null,
    context: {
      organization_id: ORG, offer: 'Revisión de antecedentes laborales y judiciales, y evaluaciones psicolaborales de postulantes antes de contratar.',
      services: ['Verificación de antecedentes', 'Evaluación psicolaboral', 'Reclutamiento'], territories: ['Chile'], exclusions: ['No hacemos guardias ni aseo'], priority: 'balanced',
      criteria: { roles: ['Gerente de Personas', 'Jefe de Reclutamiento'], keywords: ['verificación de antecedentes', 'evaluación psicolaboral', 'reclutamiento'], postQueries: [],
        decisionMakerTitles: ['Gerente de Personas', 'Jefe de Reclutamiento', 'Gerente de Operaciones'] },
      revision: 2, automation: true, hour: 8, approved_by: ctx.OWNER, approved_at: at(-20),
    },
  };
  const pipeline = { items: items.map(pipelineItem), work: works, totals: { found: 1, recommended: 3 } };

  const docs = [['demo-doc-1', 'Bases administrativas.pdf', 24], ['demo-doc-2', 'Bases técnicas.pdf', 11], ['demo-doc-3', 'Anexo 2 · Oferta económica.docx', 2]];
  const report = {
    kind: 'tender', title: 'Expediente comercial — Licitación 4521-61-LE26, Hospital Regional de Bahía Azul', generatedAt: at(-0.1),
    executive: `Postular. El hospital contrata la verificación de antecedentes laborales y judiciales de unas 600 personas al año, y eso es lo que vendes. La oferta se presenta en Mercado Público hasta el ${dateText(9)}; las consultas cierran el ${dateText(3)}. Lo que más pesa es la experiencia en salud (30 %) y el precio por persona revisada (40 %).`,
    recommendation: 'advance',
    reasons: ['Piden verificar antecedentes laborales y judiciales de postulantes: es tu servicio principal.', 'El presupuesto, $48 millones por 24 meses, alcanza para unas 600 revisiones al año.', 'La experiencia en servicios de salud pesa 30 % y puedes acreditarla con tres certificados.'],
    nextSteps: [`Envía tus consultas al foro antes del ${dateText(3)}`, 'Reúne tres certificados de experiencia en servicios de salud', 'Prepara la oferta económica por persona revisada'],
    warnings: [], scenarios: [], sections: [], sources: [],
    reviewers: ['Requisitos y documentos', 'Evaluación y puntaje', 'Contrato y garantías', 'Estrategia y precio'],
    questions: ['¿El precio se oferta por persona revisada o como monto mensual fijo?', '¿Aceptan certificados de experiencia de clínicas privadas?'],
    milestones: [
      { label: 'Cierre de consultas', date: shortDate(3), state: 'documented', citations: [] },
      { label: 'Cierre de recepción de ofertas', date: shortDate(9), state: 'documented', citations: [] },
      { label: 'Adjudicación estimada', date: shortDate(30), state: 'proposed', citations: [] },
    ],
    requirements: [
      { title: 'Inscripción vigente en el Registro de Proveedores', status: 'supported', evidence: [], action: 'Revisa que siga vigente al cierre.', role: 'Administración', due: dateText(8) },
      { title: 'Tres certificados de experiencia en servicios de salud', status: 'pending', evidence: [], action: 'Pide los certificados a tus clientes del sector salud.', role: 'Comercial', due: dateText(6) },
      { title: 'Entrega del resultado en 48 horas hábiles por persona', status: 'supported', evidence: [], action: 'Confirma tu capacidad para enero y febrero, cuando contratan más.', role: 'Operaciones', due: dateText(8) },
      { title: 'Garantía de fiel cumplimiento del 5 %', status: 'pending', evidence: [], action: 'Pídela al banco con una semana de anticipación si te adjudicas.', role: 'Finanzas', due: dateText(35) },
    ],
    tasks: [
      { title: 'Preparar la oferta económica por persona revisada', role: 'Comercial', due: dateText(7), dependency: 'Precio aprobado', evidence: 'Anexo 2 completo' },
      { title: 'Reunir los certificados de experiencia', role: 'Comercial', due: dateText(6), dependency: 'Respuesta de los clientes', evidence: 'Tres certificados firmados' },
    ],
    risks: [
      { title: 'Plazo de 48 horas por revisión en temporada alta', impact: 'medium', basis: 'documented', mitigation: 'Ofrece un equipo de respaldo para enero y febrero.', citations: [] },
      { title: 'Multa del 1 % por día de atraso', impact: 'low', basis: 'documented', mitigation: 'Acuerda con el hospital cómo se cuentan los días hábiles.', citations: [] },
    ],
    coverage: docs.map(([id, name, pages]) => ({ id, name, status: 'read', pagesRead: pages, pagesTotal: pages })),
    route: { steps: [
      { date: 'Hoy', kind: 'prepare', title: 'Revisa las bases y reúne la experiencia', detail: 'Tres certificados de servicios de salud suman el 30 % del puntaje.' },
      { date: shortDate(3), kind: 'ask', title: 'Envía tus consultas', detail: 'Pregunta cómo se oferta el precio y si valen clínicas privadas.' },
      { date: shortDate(9), kind: 'submit', title: 'Presenta la oferta', detail: 'En Mercado Público, con el anexo 2 y los certificados.' },
      { date: shortDate(30), kind: 'decide', title: 'Adjudicación', detail: 'El hospital estima adjudicar en un mes.' },
    ] },
    submission: null,
  };
  const detail = {
    item: items[0], work: works[0], decisionMakerTitles: ['Jefe de Personal', 'Subdirector Administrativo'],
    participants: people, members: people.map(({ user_id, name }) => ({ user_id, name })),
    activity: [{ id: 'demo-a-1', organization_id: ORG, opportunity_id: 'demo-op-1', actor_id: ctx.OWNER, kind: 'report_ready', body: 'Informe de investigación disponible', data: {}, event_key: 'demo-a-1', created_at: at(-0.1) }],
    tasks: [], contacts: [], marks: { available: true, items: {} }, offer: { available: true, latest: null }, fit: { available: true, latest: null, profileRevision: null },
    documents: docs.map(([id, name, pages]) => ({ id, organization_id: ORG, opportunity_id: 'demo-op-1', name, mime: name.endsWith('.pdf') ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      sha256: id, source_url: null, source_kind: 'upload', bytes: 240_000, pages_total: pages, pages_read: pages, extraction_status: 'read', created_at: at(-0.2) })),
    jobs: [{ id: 'demo-job-1', kind: 'research', state: 'ready', error: null, created_at: at(-0.15), updated_at: at(-0.1), requested_by: ctx.OWNER, progress: { stage: 'write', read: 3, total: 3, document: null, since: at(-0.11) } }],
    reports: [{ id: 'demo-report-1', organization_id: ORG, opportunity_id: 'demo-op-1', job_id: 'demo-job-1', content_hash: 'demo', profile_revision: 1, created_by: ctx.OWNER, created_at: at(-0.1), report }],
  };

  const supplier = (rut, name) => ({ rut, name });
  const tender = (id, code, name, agency, monthsAgo, estimated, awarded, bidders, winner, score) => ({
    id, code, name, agency, status: 'adjudicada', kind: 'LE', currency: 'CLP', estimatedAmount: estimated, awardedAmount: awarded, bidders,
    publishedOn: at(-monthsAgo * 30).slice(0, 10), awardedOn: at(-monthsAgo * 30 + 40).slice(0, 10), durationMonths: 24, category: 'SERVICIOS DE RECURSOS HUMANOS', criteria: 'Precio ; Experiencia ; Plazo de entrega',
    winners: [{ ...winner, amount: awarded }], bids: [], score,
  });
  const andes = supplier('77888999-0', 'Psicolaboral Andes Limitada');
  const pacifico = supplier('77345678-0', 'Antecedentes del Pacífico SpA');
  const market = {
    applicable: true, job: null,
    history: {
      available: true, coverage: { available: true, from: '2022-11-01', to: at(-20).slice(0, 8) + '01', loadedAt: at(-2) },
      agency: { ids: [9101], name: 'Hospital Regional de Bahía Azul', sector: 'Salud' },
      agencyStats: { tenders: 3, awarded: 3, deserted: 0, revoked: 0, medianBidders: 4, medianAwardRatio: 0.86, winners: [{ ...andes, wins: 2, amount: 79_000_000 }, { ...pacifico, wins: 1, amount: 21_000_000 }] },
      similar: [
        tender(8101, '4521-37-LE25', 'Servicio de evaluación psicolaboral para personal clínico', 'Hospital Regional de Bahía Azul', 11, 48_000_000, 42_000_000, 5, andes, 0.9),
        tender(8102, '4521-12-LE24', 'Verificación de antecedentes de postulantes a honorarios', 'Hospital Regional de Bahía Azul', 23, 25_000_000, 21_000_000, 4, pacifico, 0.85),
        tender(8103, '4521-50-LE23', 'Evaluación de idoneidad para cargos clínicos', 'Hospital Regional de Bahía Azul', 34, 40_000_000, 37_000_000, 3, andes, 0.7),
      ],
      market: {
        stats: { tenders: 6, awarded: 6, deserted: 0, revoked: 0, medianBidders: 5, medianAwardRatio: 0.84, winners: [{ ...pacifico, wins: 2, amount: 51_000_000 }, { ...andes, wins: 2, amount: 63_000_000 }] },
        similar: [
          tender(8201, '2210-88-LE25', 'Verificación de antecedentes de postulantes', 'Servicio de Salud Valle Central', 7, 30_000_000, 27_500_000, 6, pacifico, 0.88),
          tender(8202, '3301-20-LE25', 'Revisión de antecedentes de personal externo', 'Universidad Regional del Sur', 9, 26_000_000, 23_500_000, 5, pacifico, 0.8),
        ],
      },
    },
    plan: {
      jobId: 'demo-plan-1', createdAt: at(-0.05), basis: { agency: 'Hospital Regional de Bahía Azul', similar: 3, market: 2 },
      plan: {
        summary: 'El hospital licitó esto tres veces y siempre adjudicó a quien acreditó experiencia en salud con un precio cercano al 86 % del estimado. Compite por experiencia y plazo, no solo por precio',
        price: { low: 39_000_000, high: 42_500_000, basis: 'Las tres compras parecidas del hospital se adjudicaron entre el 84 % y el 92 % del estimado' },
        highlights: [
          { text: 'Tus tres clientes del sector salud', why: 'La experiencia en salud pesa 30 % y fue lo que decidió las dos últimas' },
          { text: 'Entrega en 24 horas hábiles', why: 'Las bases piden 48: el plazo es el segundo criterio' },
        ],
        risks: ['Psicolaboral Andes ganó dos de las tres y conoce al hospital', 'Un precio bajo el 80 % del estimado puede leerse como temerario'],
        competitors: [{ ...andes, why: 'Ganó dos de las tres compras parecidas del hospital', wins: 2 }, { ...pacifico, why: 'Gana seguido en otros servicios de salud con precios bajos', wins: 1 }],
        confidence: 'alta', evidence: { similar: 3, market: 2, medianAwardRatio: 0.86 },
      },
    },
  };
  return { overview, pipeline, detail, market, assistant: { available: true, threads: [], opportunities: [] } };
}
