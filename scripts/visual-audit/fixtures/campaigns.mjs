// Campaigns: three bulk campaigns (a draft, one approved and half sent, one paused) with their deliveries, a saved audience,
// and two older sequence campaigns that the history page lists.
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
  const recipients = (campaignIndex, count) => audience.slice(0, count).map(([name, company, email], index) => ({
    email, name, company, title: 'Gerente de Personas', industry: index % 2 ? 'Logística' : 'Retail', country: 'Chile', size: '201-500', seniority: 'manager',
    leadRef: `lead_enriched|${ctx.uid(2014 + index)}`, lastSentAt: null, contacted: false, replied: false, blockedReason: null,
    reasons: ['Sin envíos registrados', 'Cargo: Gerente de Personas'], enriched: true,
    messages: MESSAGES.map(message => {
      draftSeq += 1;
      return { ...message, subject: message.subject.replace('{{empresa}}', company), body: message.body.replace('{{nombre}}', name.split(' ')[0]).replace(/\{\{empresa\}\}/g, company), draftId: ctx.uid(6000 + campaignIndex * 100 + draftSeq), versionId: ctx.uid(6500 + campaignIndex * 100 + draftSeq) };
    }),
  }));
  const definition = (name, objective, people, provider = 'google') => ({ name, description: '', objective, criteria, emails: people.map(person => person.email), messages: MESSAGES, provider, overrides: [] });

  const approvedRecipients = recipients(1, 6);
  const bulk = [
    { id: ctx.uid(5001), organization_id: ctx.ORG, user_id: ctx.OWNER, revision: 2, status: 'draft', definition: definition('Reclutamiento masivo · retail', 'Agendar 5 demos con gerentes de personas de retail.', recipients(0, 4)), recipients: recipients(0, 4), review_hash: 'audit-hash-1', approved_at: null, created_at: ctx.daysAgo(1), updated_at: ctx.hoursAgo(3) },
    { id: ctx.uid(5002), organization_id: ctx.ORG, user_id: ctx.OWNER, revision: 3, status: 'approved', definition: definition('Logística · centros de distribución', 'Conseguir 3 reuniones con jefes de reclutamiento.', approvedRecipients), recipients: approvedRecipients, review_hash: 'audit-hash-2', approved_at: ctx.daysAgo(2), created_at: ctx.daysAgo(4), updated_at: ctx.daysAgo(2) },
    { id: ctx.uid(5003), organization_id: ctx.ORG, user_id: ctx.MEMBER, revision: 1, status: 'paused', definition: definition('Seguridad privada · piloto', 'Probar el mensaje con 3 empresas de seguridad.', recipients(2, 3), 'outlook'), recipients: recipients(2, 3), review_hash: 'audit-hash-3', approved_at: ctx.daysAgo(10), created_at: ctx.daysAgo(12), updated_at: ctx.daysAgo(6) },
  ];

  // The approved campaign: first message sent to 3 people, one failed, the rest waiting.
  const firstMessages = approvedRecipients.map(person => person.messages[0]);
  const dispatches = firstMessages.slice(0, 4).map((message, index) => ({
    id: ctx.uid(7000 + index), organization_id: ctx.ORG, user_id: ctx.OWNER, draft_id: message.draftId, version_id: message.versionId,
    idempotency_key: `bulk:${message.draftId}`, content_hash: `hash-${index}`, channel: 'email', provider: 'gmail',
    status: index === 3 ? 'failed' : 'sent', metadata: { bulkCampaignId: ctx.uid(5002) }, provider_message_id: index === 3 ? null : `gmail-${index}`,
    error_code: index === 3 ? 'mailbox_full' : null, error_message: index === 3 ? 'El buzón del destinatario está lleno.' : null, attempt_count: 1,
    requested_at: ctx.daysAgo(2), started_at: ctx.daysAgo(2), completed_at: ctx.daysAgo(2), created_at: ctx.daysAgo(2), updated_at: ctx.daysAgo(2),
  }));
  const attempts = firstMessages.slice(4).map((message, index) => ({
    draft_id: message.draftId, campaign_id: ctx.uid(5002), organization_id: ctx.ORG, user_id: ctx.OWNER, state: 'deferred', code: 'daily_limit',
    message: 'Se alcanzó el límite diario de envíos. Sigue mañana.', retry_at: ctx.daysAhead(1), attempt_count: 1, updated_at: ctx.hoursAgo(5),
  }));

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
