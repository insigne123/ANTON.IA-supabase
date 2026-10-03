// The organization, its two members and their profiles. The owner is on every allowlist (Cowork, admin, opportunities,
// privacy); the member on none, so the audit can check that gated pages stay hidden.
export const keepInEmpty = ['organizations', 'organization_members', 'profiles', 'organization_invites'];

export function personas(ctx) {
  const user = (id, email, fullName) => ({
    id, aud: 'authenticated', role: 'authenticated', email, phone: '',
    email_confirmed_at: '2025-01-01T00:00:00Z', confirmed_at: '2025-01-01T00:00:00Z', last_sign_in_at: ctx.hoursAgo(2),
    app_metadata: { provider: 'email', providers: ['email'] },
    // The tour and every screen guide count as seen, so no offer covers the screenshots.
    user_metadata: { full_name: fullName, anton_tour: { version: 99, status: 'completed', updatedAt: '2025-01-01T00:00:00Z' }, anton_guides: Object.fromEntries(ctx.pageGuideIds.map(id => [id, true])) },
    identities: [], created_at: '2025-01-01T00:00:00Z', updated_at: ctx.daysAgo(3),
  });
  return {
    [ctx.OWNER]: user(ctx.OWNER, ctx.ownerEmail, 'Camila Torres'),
    [ctx.MEMBER]: user(ctx.MEMBER, ctx.memberEmail, 'Diego Fuentes'),
  };
}

export default function people(ctx) {
  const icp = {
    role: 'Gerente comercial',
    sector: 'Software para RR. HH.',
    description: 'Automatizamos la verificación de antecedentes laborales y judiciales para empresas que contratan mucho personal.',
    services: 'Verificación de antecedentes, alertas judiciales, reportes de cumplimiento',
    valueProposition: 'Reducimos de días a minutos la revisión de cada candidato, con trazabilidad para auditorías.',
    proofPoints: ['30 % menos tiempo de contratación en clientes de retail', 'Integración con los principales ATS'],
    painPoints: ['Revisión manual lenta en contrataciones masivas', 'Riesgo legal por antecedentes no detectados'],
    differentiators: ['Datos en tiempo real del Poder Judicial', 'Soporte local en Chile'],
    referenceClients: ['Retail Andino', 'Logística Sur'],
    targetRoles: ['Gerente de Personas', 'Jefe de Reclutamiento', 'Gerente de Operaciones'],
    targetIndustries: ['Retail', 'Logística', 'Seguridad privada'],
    targetCompanySize: '201-500',
    targetLocations: ['Chile'],
  };
  return {
    tables: {
      organizations: [{ id: ctx.ORG, name: 'Yago QA', created_at: '2025-01-01T00:00:00Z', feature_campaigns_v2_enabled: true, collaboration_v1_enabled: true }],
      organization_members: [
        { organization_id: ctx.ORG, user_id: ctx.OWNER, role: 'owner', created_at: '2025-01-01T00:00:00Z' },
        { organization_id: ctx.ORG, user_id: ctx.MEMBER, role: 'member', created_at: '2025-03-01T00:00:00Z' },
      ],
      profiles: [
        { id: ctx.OWNER, email: ctx.ownerEmail, full_name: 'Camila Torres', avatar_url: null, job_title: 'Gerente comercial', company_name: 'Yago QA', company_domain: 'yago-qa.cl',
          default_mail_provider: 'google', signature: 'Camila Torres\nGerente comercial · Yago QA', signatures: { profile_extended: icp }, company_profile: {}, created_at: '2025-01-01T00:00:00Z', updated_at: ctx.daysAgo(5) },
        { id: ctx.MEMBER, email: ctx.memberEmail, full_name: 'Diego Fuentes', avatar_url: null, job_title: 'Ejecutivo de ventas', company_name: 'Yago QA', company_domain: 'yago-qa.cl',
          default_mail_provider: null, signature: null, signatures: {}, company_profile: {}, created_at: '2025-03-01T00:00:00Z', updated_at: ctx.daysAgo(20) },
      ],
      organization_invites: [
        { id: ctx.uid(21), organization_id: ctx.ORG, email: 'valentina.rios@yago-qa.cl', role: 'member', token: 'audit-invite-token', token_hash: null, invited_by: ctx.OWNER,
          created_at: ctx.daysAgo(2), expires_at: ctx.daysAhead(5), accepted_at: null, accepted_by: null, revoked_at: null, revoked_by: null },
      ],
    },
  };
}
