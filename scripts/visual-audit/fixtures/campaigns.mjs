// Campaigns: four bulk campaigns (a draft, one approved and half sent, one paused of the owner and one paused of a member)
// with their deliveries, a saved audience, and two older sequence campaigns that the history page lists. The approved one
// carries what production shows (9 Nov 2026): a person who answered (Matías Rojas, a reply in contacted.mjs), an Outlook send
// confirmed after its attempt, a send that did not go out, and two held by the daily limit.
const MESSAGES = [
  { subject: '{{empresa}}: contrataciones sin revisar antecedentes a mano', body: 'Hola {{nombre}},\n\nVi que {{empresa}} está contratando. Revisamos antecedentes laborales y judiciales en minutos, con trazabilidad para auditorías.\n\n¿Te sirve conversar 15 minutos esta semana?', delayDays: 0 },
  { subject: 'RE: {{empresa}}: contrataciones sin revisar antecedentes a mano', body: 'Hola {{nombre}}, retomo el correo anterior. En Retail Andino bajamos 30 % el tiempo de contratación. ¿Lo vemos?', delayDays: 3 },
];
const criteria = { relationship: 'never_contacted', titles: ['Gerente de Personas', 'Jefe de Reclutamiento'], industries: ['Retail', 'Logística'], countries: ['Chile'], sizes: [], seniorities: [], minimumDaysSinceSent: 0, excludeReplied: true, enrichedOnly: true };

export default function campaigns(ctx) {
  const audience = [
    ['Florencia Sepúlveda', 'Retail Andino', 'florencia.sepulveda@retailandino.cl'], ['Cristóbal Núñez', 'Logística Sur', 'cristobal.nunez@logisticasur.cl'],
    ['Amanda Vargas', 'Seguridad Austral', 'amanda.vargas@seguridadaustral.cl'], ['Felipe Cortés', 'Farmacias Del Valle', 'felipe.cortes@farmaciasdelvalle.cl'],
    ['Javiera Lagos', 'Transportes Cordillera', 'javiera.lagos@transcordillera.cl'], ['Diego Bravo', 'Grupo Pacífico', 'diego.bravo@grupopacifico.cl'],
  ];
  let draftSeq = 0;
  const recipients = (campaignIndex, count, people = audience) => people.slice(0, count).map(([name, company, email], index) => ({
    email, name, company, title: 'Gerente de Personas', industry: index % 2 ? 'Logística' : 'Retail', country: 'Chile', size: '201-500', seniority: 'manager',
    leadRef: `lead_enriched|${ctx.uid(2014 + index)}`, lastSentAt: null, contacted: false, replied: false, blockedReason: null,
    reasons: ['Sin envíos registrados', 'Cargo: Gerente de Personas'], enriched: true,
    messages: MESSAGES.map(message => {
      draftSeq += 1;
      return { ...message, subject: message.subject.replace('{{empresa}}', company), body: message.body.replace('{{nombre}}', name.split(' ')[0]).replace(/\{\{empresa\}\}/g, company), draftId: ctx.uid(6000 + campaignIndex * 100 + draftSeq), versionId: ctx.uid(6500 + campaignIndex * 100 + draftSeq) };
    }),
  }));
  const definition = (name, objective, people, provider = 'google') => ({ name, description: '', objective, criteria, emails: people.map(person => person.email), messages: MESSAGES, provider, overrides: [] });

  // Matías Rojas answered after the launch (contacted.mjs: contacted-qa-2, replied hours ago).
  const approvedPeople = [audience[0], ['Matías Rojas', 'Logística Sur', 'matias.rojas@logisticasur.cl'], ...audience.slice(2)];
  const approvedRecipients = recipients(1, 6, approvedPeople);
  const pausedRecipients = recipients(3, 3, [['Rocío Paredes', 'Minera Norte Grande', 'rocio.paredes@mineranorte.cl'], ['Ignacio Vera', 'Constructora Maule', 'ignacio.vera@constructoramaule.cl'], ['Paula Soto', 'Grupo Pacífico', 'paula.soto@grupopacifico.cl']]);
  const bulk = [
    { id: ctx.uid(5001), organization_id: ctx.ORG, user_id: ctx.OWNER, revision: 2, status: 'draft', definition: definition('Reclutamiento masivo · retail', 'Agendar 5 demos con gerentes de personas de retail.', recipients(0, 4)), recipients: recipients(0, 4), review_hash: 'audit-hash-1', approved_at: null, created_at: ctx.daysAgo(1), updated_at: ctx.hoursAgo(3) },
    { id: ctx.uid(5002), organization_id: ctx.ORG, user_id: ctx.OWNER, revision: 3, status: 'approved', definition: definition('Logística · centros de distribución', 'Conseguir 3 reuniones con jefes de reclutamiento.', approvedRecipients), recipients: approvedRecipients, review_hash: 'audit-hash-2', approved_at: ctx.daysAgo(2), created_at: ctx.daysAgo(4), updated_at: ctx.daysAgo(2) },
    { id: ctx.uid(5003), organization_id: ctx.ORG, user_id: ctx.MEMBER, revision: 1, status: 'paused', definition: definition('Seguridad privada · piloto', 'Probar el mensaje con 3 empresas de seguridad.', recipients(2, 3), 'outlook'), recipients: recipients(2, 3), review_hash: 'audit-hash-3', approved_at: ctx.daysAgo(10), created_at: ctx.daysAgo(12), updated_at: ctx.daysAgo(6) },
    { id: ctx.uid(5004), organization_id: ctx.ORG, user_id: ctx.OWNER, revision: 2, status: 'paused', definition: definition('Minería · contratistas', 'Conversar con jefes de reclutamiento de contratistas mineros.', pausedRecipients, 'outlook'), recipients: pausedRecipients, review_hash: 'audit-hash-4', approved_at: ctx.daysAgo(9), created_at: ctx.daysAgo(11), updated_at: ctx.daysAgo(5) },
  ];

  // The approved campaign: first message sent to 3 people (Amanda's by Outlook, confirmed after its attempt), one failed, two
  // held by the daily limit. The owner's paused campaign: every first message sent.
  const firstMessages = approvedRecipients.map(person => person.messages[0]);
  const dispatch = (campaignId, message, index, extra = {}) => ({
    id: ctx.uid(7000 + index), organization_id: ctx.ORG, user_id: ctx.OWNER, draft_id: message.draftId, version_id: message.versionId,
    idempotency_key: `bulk:${campaignId}:${message.draftId}`, content_hash: `hash-${index}`, channel: 'email', provider: 'gmail',
    status: 'sent', metadata: { bulkCampaignId: campaignId }, provider_message_id: `gmail-${index}`, error_code: null, error_message: null, attempt_count: 1,
    requested_at: ctx.daysAgo(2), started_at: ctx.daysAgo(2), completed_at: ctx.daysAgo(2), created_at: ctx.daysAgo(2), updated_at: ctx.daysAgo(2), ...extra,
  });
  const dispatches = [
    ...firstMessages.slice(0, 4).map((message, index) => dispatch(ctx.uid(5002), message, index, index === 2
      ? { provider: 'outlook', provider_message_id: null, reconciled_at: ctx.daysAgo(2) }
      : index === 3 ? { status: 'failed', provider_message_id: null, error_code: 'mailbox_full', error_message: 'Mailbox full (552 5.2.2)' } : {})),
    ...pausedRecipients.map((person, index) => dispatch(ctx.uid(5004), person.messages[0], 20 + index, { provider: 'outlook', completed_at: ctx.daysAgo(8) })),
  ];
  const attempt = (message, state, code, text, retryAt = null) => ({
    draft_id: message.draftId, campaign_id: ctx.uid(5002), organization_id: ctx.ORG, user_id: ctx.OWNER, state, code, message: text, retry_at: retryAt, attempt_count: 1, updated_at: ctx.hoursAgo(5),
  });
  const attempts = [
    attempt(firstMessages[2], 'attention', 'invalid_provider_response', 'El envío está pendiente de confirmación. No se repetirá automáticamente.'),
    attempt(firstMessages[3], 'attention', 'mailbox_full', 'No se pudo enviar el correo. Revisa el contacto y la cuenta de envío.'),
    ...firstMessages.slice(4).map(message => attempt(message, 'retry_wait', 'daily_quota_exceeded', 'Se alcanzó el límite diario. Se volverá a comprobar la cuota.', ctx.daysAhead(1))),
  ];

  const sequence = [
    { id: 'campaign-qa-1', user_id: ctx.OWNER, organization_id: ctx.ORG, name: 'Bienvenida 2025 · RR. HH.', status: 'completed', steps: [], created_at: ctx.daysAgo(140), updated_at: ctx.daysAgo(100),
      excluded_lead_ids: [], settings: {}, sent_records: { 'contacted-qa-13': { sentAt: ctx.daysAgo(120), step: 0 } }, campaign_type: 'reconnection', outreach_version: 1, last_run_at: ctx.daysAgo(100), last_run_status: 'success', last_run_summary: { sent: 24 } },
    { id: 'campaign-qa-2', user_id: ctx.MEMBER, organization_id: ctx.ORG, name: 'Ferias laborales · seguimiento', status: 'paused', steps: [], created_at: ctx.daysAgo(80), updated_at: ctx.daysAgo(60),
      excluded_lead_ids: [], settings: {}, sent_records: {}, campaign_type: 'follow_up', outreach_version: 1, last_run_at: ctx.daysAgo(60), last_run_status: 'idle', last_run_summary: { sent: 9 } },
  ];
  const steps = sequence.flatMap((campaign, campaignIndex) => MESSAGES.map((message, index) => ({
    id: ctx.uid(8000 + campaignIndex * 10 + index), campaign_id: campaign.id, order_index: index, offset_days: message.delayDays, name: index ? 'Seguimiento' : 'Primer correo',
    subject_template: message.subject, body_template: message.body, attachments: [], created_at: campaign.created_at,
  })));

  return {
    tables: {
      bulk_campaigns: bulk,
      outbound_dispatches: dispatches,
      bulk_campaign_attempts: attempts,
      bulk_audience_profiles: [{ id: ctx.uid(5101), organization_id: ctx.ORG, user_id: ctx.OWNER, name: 'Personas · retail y logística', criteria, created_at: ctx.daysAgo(15) }],
      campaigns: sequence,
      campaign_steps: steps,
    },
  };
}
