// Conversations: 15 people already contacted (5 replied, 4 waiting, 3 scheduled, 3 closed), with the events and inbound
// replies behind them, plus the CRM stages the pipeline and the conversation list show.
const REPLIES = [
  ['meeting_request', '¿Podemos conversar el jueves a las 10? Me interesa ver cómo funciona con nuestro ATS.'],
  ['positive', 'Gracias por escribir. Envíame una propuesta para 300 contrataciones al año.'],
  ['neutral', '¿Tienen integración con Buk? Lo consulto antes de agendar.'],
  ['negative', 'Por ahora no estamos evaluando proveedores. Escríbeme en marzo.'],
  ['auto_reply', 'Estoy fuera de la oficina hasta el lunes 6. Para urgencias escribe a personas@empresa.cl.'],
];

export default function contacted(ctx) {
  const leadIds = Array.from({ length: 15 }, (_, index) => ctx.uid(2000 + index));
  const people = [
    ['Andrea Soto', 'Retail Andino', 'retailandino.cl'], ['Matías Rojas', 'Logística Sur', 'logisticasur.cl'], ['Francisca Muñoz', 'Seguridad Austral', 'seguridadaustral.cl'],
    ['Joaquín Díaz', 'Farmacias Del Valle', 'farmaciasdelvalle.cl'], ['Isidora Contreras', 'Transportes Cordillera', 'transcordillera.cl'], ['Benjamín Silva', 'Grupo Pacífico', 'grupopacifico.cl'],
    ['Catalina Morales', 'Constructora Maule', 'constructoramaule.cl'], ['Tomás Espinoza', 'Minera Norte Grande', 'mineranorte.cl'], ['Valentina Araya', 'Retail Andino', 'retailandino.cl'],
    ['Sebastián Herrera', 'Logística Sur', 'logisticasur.cl'], ['Antonia Castillo', 'Seguridad Austral', 'seguridadaustral.cl'], ['Vicente Fuentes', 'Farmacias Del Valle', 'farmaciasdelvalle.cl'],
    ['Martina Valenzuela', 'Transportes Cordillera', 'transcordillera.cl'], ['Agustín Pizarro', 'Grupo Pacífico', 'grupopacifico.cl'], ['Josefa Tapia', 'Constructora Maule', 'constructoramaule.cl'],
  ];
  const email = (name, domain) => `${name.split(' ')[0].normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()}.${name.split(' ')[1].normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()}@${domain}`;

  const rows = people.map(([name, company, domain], index) => {
    const group = index < 5 ? 'replied' : index < 9 ? 'waiting' : index < 12 ? 'scheduled' : 'closed';
    const sentAt = group === 'scheduled' ? null : ctx.daysAgo(2 + index);
    const reply = group === 'replied' ? REPLIES[index] : null;
    return {
      id: `contacted-qa-${index + 1}`, user_id: index % 4 === 3 ? ctx.MEMBER : ctx.OWNER, organization_id: ctx.ORG, lead_id: leadIds[index],
      status: group === 'replied' ? 'replied' : group === 'scheduled' ? 'scheduled' : 'sent', sent_at: sentAt,
      scheduled_at: group === 'scheduled' ? ctx.daysAhead(index - 8) : null,
      subject: `${company}: contrataciones sin revisar antecedentes a mano`, message_id: `msg-qa-${index + 1}`, provider: index % 5 === 2 ? 'outlook' : 'gmail',
      data: { body: `Hola ${name.split(' ')[0]},\n\nVi que ${company} está creciendo. Ayudamos a revisar antecedentes en minutos.\n\n¿Te sirve conversar 15 minutos?` },
      created_at: sentAt || ctx.hoursAgo(5), name, email: email(name, domain), company, role: 'Gerente de Personas', industry: 'Retail', city: 'Santiago', country: 'Chile',
      opened_at: group !== 'scheduled' && index % 2 === 0 ? ctx.daysAgo(1 + index) : null, click_count: index === 1 ? 2 : 0,
      replied_at: reply ? ctx.hoursAgo(4 + index * 9) : null, reply_preview: reply ? reply[1].slice(0, 120) : null, last_reply_text: reply ? reply[1] : null,
      reply_intent: reply ? reply[0] : null, reply_sentiment: reply ? (reply[0] === 'negative' ? 'negative' : 'positive') : null, reply_confidence: reply ? 0.86 : null,
      reply_summary: reply ? reply[1].split('.')[0] : null, reply_subject: reply ? `RE: ${company}: contrataciones sin revisar antecedentes a mano` : null,
      delivery_status: group === 'scheduled' ? 'unknown' : 'delivered', delivered_at: sentAt, thread_key: `thread-qa-${index + 1}`, thread_id: `thread-qa-${index + 1}`,
      lifecycle_state: group === 'closed' ? 'closed' : group, last_event_type: reply ? 'reply' : sentAt ? 'sent' : null, last_event_at: reply ? ctx.hoursAgo(4 + index * 9) : sentAt,
      preflight_status: 'ok', follow_up_count: group === 'waiting' ? 1 : 0, last_step_idx: 0, campaign_followup_allowed: group === 'waiting',
      reply_sync_succeeded_at: ctx.hoursAgo(1), reply_sync_error: null,
      conversation_resolved_at: group === 'closed' ? ctx.daysAgo(index - 10) : null, conversation_outbound_at: sentAt,
    };
  });

  const events = rows.filter(row => row.sent_at).flatMap((row, index) => [
    { id: ctx.uid(4000 + index * 3), organization_id: ctx.ORG, contacted_id: row.id, lead_id: row.lead_id, provider: row.provider, event_type: 'sent', event_source: 'app', event_at: row.sent_at, thread_key: row.thread_key, message_id: row.message_id, meta: {}, created_at: row.sent_at },
    ...(row.opened_at ? [{ id: ctx.uid(4001 + index * 3), organization_id: ctx.ORG, contacted_id: row.id, lead_id: row.lead_id, provider: row.provider, event_type: 'opened', event_source: 'pixel', event_at: row.opened_at, thread_key: row.thread_key, message_id: row.message_id, meta: {}, created_at: row.opened_at }] : []),
    ...(row.replied_at ? [{ id: ctx.uid(4002 + index * 3), organization_id: ctx.ORG, contacted_id: row.id, lead_id: row.lead_id, provider: row.provider, event_type: 'reply', event_source: 'sync', event_at: row.replied_at, thread_key: row.thread_key, message_id: `reply-${row.message_id}`, meta: { intent: row.reply_intent }, created_at: row.replied_at }] : []),
  ]);

  const responses = rows.filter(row => row.replied_at).map((row, index) => ({
    id: ctx.uid(4500 + index), lead_id: row.lead_id, contacted_id: row.id, email_message_id: `reply-${row.message_id}`, type: 'reply', content: row.last_reply_text, created_at: row.replied_at, organization_id: ctx.ORG,
  }));

  const stages = ['meeting', 'engaged', 'engaged', 'closed_lost', 'contacted', 'contacted', 'contacted', 'contacted', 'contacted', 'qualified', 'qualified', 'qualified', 'closed_won', 'negotiation', 'closed_lost'];
  const crm = rows.map((row, index) => ({
    id: `lead_enriched|${row.lead_id}`, organization_id: ctx.ORG, stage: stages[index], owner: index % 4 === 3 ? 'Diego Fuentes' : 'Camila Torres',
    notes: index === 0 ? 'Quiere ver la integración con su ATS.' : null, next_action: index === 0 ? 'Preparar demo del jueves' : index === 13 ? 'Enviar propuesta corregida' : null,
    next_action_type: index === 0 ? 'meeting' : index === 13 ? 'email' : null, next_action_due_at: index === 0 ? ctx.daysAhead(1) : index === 13 ? ctx.daysAgo(1) : null,
    autopilot_status: null, last_autopilot_event: null, meeting_link: null, updated_at: ctx.hoursAgo(index + 1),
  })).concat(
    // A few saved leads already in the pipeline before any message.
    [0, 1, 2].map(index => ({ id: `lead_saved|${ctx.uid(1000 + index)}`, organization_id: ctx.ORG, stage: 'inbox', owner: 'Camila Torres', notes: null, next_action: null, next_action_type: null, next_action_due_at: null, autopilot_status: null, last_autopilot_event: null, meeting_link: null, updated_at: ctx.daysAgo(index + 2) })),
  );

  return {
    tables: {
      contacted_leads: rows,
      email_events: events,
      lead_responses: responses,
      unified_crm_data: crm,
      unsubscribed_emails: [{ id: ctx.uid(4900), email: 'no.contactar@grupopacifico.cl', user_id: ctx.OWNER, organization_id: ctx.ORG, reason: 'Pidió no recibir más correos', created_at: ctx.daysAgo(9) }],
    },
  };
}
