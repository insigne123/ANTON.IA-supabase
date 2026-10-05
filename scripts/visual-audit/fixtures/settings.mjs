// Account settings: the connected mailbox, the writing style library and the organization's messaging rules. Token values
// are placeholders; the app only reads whether a row exists.
export default function settings(ctx) {
  return {
    tables: {
      provider_tokens: [{ user_id: ctx.OWNER, provider: 'google', refresh_token: 'audit-placeholder', expires_at: ctx.daysAhead(30), updated_at: ctx.daysAgo(5) }],
      email_style_profiles: [
        { id: ctx.uid(9701), organization_id: ctx.ORG, user_id: ctx.OWNER, name: 'Cercano y breve', profile: { tone: 'warm', length: 'short', cta: { label: '¿Conversamos 15 minutos?', duration: '15' } }, content_hash: 'style-1', revision: 2, is_default: true, created_at: ctx.daysAgo(30), updated_at: ctx.daysAgo(4), library_scope: 'personal', archived_at: null },
        { id: ctx.uid(9702), organization_id: ctx.ORG, user_id: ctx.OWNER, name: 'Formal para gerencias', profile: { tone: 'executive', length: 'medium' }, content_hash: 'style-2', revision: 1, is_default: false, created_at: ctx.daysAgo(60), updated_at: ctx.daysAgo(60), library_scope: 'team', archived_at: null, published_by: ctx.OWNER, published_at: ctx.daysAgo(59) },
      ],
      organization_messaging_context: [{ organization_id: ctx.ORG, voice_examples: [], prohibited_terms: ['gratis'], required_terms: [], approved_claims: [], trial_offer: 'Piloto de 30 días', default_style_profile_id: ctx.uid(9701), role_cta: {}, vertical_notes: {}, updated_at: ctx.daysAgo(10) }],
      activity_logs: [
        { id: ctx.uid(9801), organization_id: ctx.ORG, user_id: ctx.OWNER, action: 'campaign.approved', entity_type: 'bulk_campaign', entity_id: ctx.uid(5002), metadata: { name: 'Logística · centros de distribución' }, details: {}, created_at: ctx.daysAgo(2) },
        { id: ctx.uid(9802), organization_id: ctx.ORG, user_id: ctx.MEMBER, action: 'lead.saved', entity_type: 'lead', entity_id: ctx.uid(1003), metadata: { name: 'Joaquín Díaz' }, details: {}, created_at: ctx.daysAgo(3) },
      ],
    },
  };
}
