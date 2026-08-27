import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { assertSafeTestTarget } from './assert-test-target.mjs';
import { ensureQaIdentities, QA_IDENTITIES } from './bootstrap-test-identities.mjs';

const FIXTURE_TIME = '2026-08-26T09:00:00.000Z';

export const QA_FIXTURE_IDS = {
  primary: {
    emptyMission: '51000000-0000-4000-8000-000000000001',
    activeMission: '51000000-0000-4000-8000-000000000002',
    blockedMission: '51000000-0000-4000-8000-000000000003',
    failedMission: '51000000-0000-4000-8000-000000000004',
    normalLead: '52000000-0000-4000-8000-000000000001',
    errorLead: '52000000-0000-4000-8000-000000000002',
    campaign: '53000000-0000-4000-8000-000000000001',
    campaignStep: '53100000-0000-4000-8000-000000000001',
    researchSnapshot: '54000000-0000-4000-8000-000000000001',
    messagingDraft: '55000000-0000-4000-8000-000000000001',
    messagingDraftVersion: '55100000-0000-4000-8000-000000000001',
    researchReport: '56000000-0000-4000-8000-000000000001',
  },
  outsider: {
    mission: '61000000-0000-4000-8000-000000000001',
    lead: '62000000-0000-4000-8000-000000000001',
    campaign: '63000000-0000-4000-8000-000000000001',
    campaignStep: '63100000-0000-4000-8000-000000000001',
  },
};

function requireValue(env, name) {
  const value = String(env[name] || '').trim();
  if (!value) throw new Error(`${name} is required to bootstrap QA fixtures.`);
  return value;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function expectQuery(label, query) {
  const { error } = await query;
  if (error) throw new Error(`${label}: ${error.message}`);
}

async function clearQaFixtures(admin) {
  const primary = QA_FIXTURE_IDS.primary;
  const outsider = QA_FIXTURE_IDS.outsider;
  const snapshotIds = [primary.researchSnapshot];

  await expectQuery(
    'Could not remove fixture campaigns',
    admin.from('campaigns').delete().in('id', [primary.campaign, outsider.campaign]),
  );
  await expectQuery(
    'Could not remove fixture research jobs',
    admin.from('lead_research_jobs').delete().in('research_snapshot_id', snapshotIds),
  );
  await expectQuery(
    'Could not remove fixture draft metadata',
    admin.from('messaging_draft_generation_metadata').delete().in('research_snapshot_id', snapshotIds),
  );
  await expectQuery(
    'Could not remove fixture report documents',
    admin.from('research_report_documents').delete().in('research_snapshot_id', snapshotIds),
  );
  await expectQuery(
    'Could not remove fixture draft claims',
    admin.from('native_draft_generation_claims').delete().in('research_snapshot_id', snapshotIds),
  );
  await expectQuery(
    'Could not remove fixture messaging drafts',
    admin.from('messaging_drafts').delete().eq('id', primary.messagingDraft),
  );
  await expectQuery(
    'Could not remove fixture research snapshots',
    admin.from('research_snapshots').delete().in('id', snapshotIds),
  );
  await expectQuery(
    'Could not remove fixture research reports',
    admin.from('lead_research_reports').delete().eq('id', primary.researchReport),
  );
  await expectQuery(
    'Could not remove fixture leads',
    admin.from('leads').delete().in('id', [primary.normalLead, primary.errorLead, outsider.lead]),
  );
  await expectQuery(
    'Could not remove fixture missions',
    admin.from('antonia_missions').delete().in('id', [
      primary.emptyMission,
      primary.activeMission,
      primary.blockedMission,
      primary.failedMission,
      outsider.mission,
    ]),
  );
}

function buildDraftPayload({ organizationId, userId, leadId }) {
  return {
    schemaVersion: 1,
    draftId: QA_FIXTURE_IDS.primary.messagingDraft,
    versionId: QA_FIXTURE_IDS.primary.messagingDraftVersion,
    organizationId,
    userId,
    researchSnapshotId: QA_FIXTURE_IDS.primary.researchSnapshot,
    revision: 1,
    parentVersionId: null,
    lifecycle: 'draft',
    channel: 'email',
    recipient: {
      leadRef: leadId,
      displayName: 'Lucia Vega',
      email: 'lucia.vega@example.test',
      linkedinUrl: null,
    },
    content: {
      subject: 'Una idea concreta para Acme Norte',
      text: 'Hola Lucia, prepare una idea breve basada en el crecimiento de Acme Norte.',
      html: null,
    },
    approval: {
      status: 'pending',
      decidedBy: null,
      decidedAt: null,
      reason: null,
    },
    preflight: {
      status: 'pending',
      checkedAt: null,
      errors: [],
      warnings: [],
    },
    createdAt: FIXTURE_TIME,
  };
}

export async function ensureQaFixtures(env = process.env) {
  const target = assertSafeTestTarget(env);
  if (target.kind !== 'local') {
    throw new Error('QA fixtures may only be bootstrapped in the local Supabase stack.');
  }

  const qa = await ensureQaIdentities(env);
  const admin = createClient(
    target.supabaseUrl,
    requireValue(env, 'SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const primary = QA_FIXTURE_IDS.primary;
  const outsider = QA_FIXTURE_IDS.outsider;
  const primaryOrganizationId = qa.organizations.primary.id;
  const outsiderOrganizationId = qa.organizations.outsider.id;
  const ownerId = qa.users.owner.id;
  const memberId = qa.users.member.id;
  const outsiderId = qa.users.outsider.id;

  await clearQaFixtures(admin);

  await expectQuery('Could not set fixture profiles', admin.from('profiles').upsert([
    {
      id: ownerId,
      email: QA_IDENTITIES.owner.email,
      full_name: QA_IDENTITIES.owner.fullName,
      company_name: 'ANTON.IA QA',
      company_domain: 'example.test',
      job_title: 'QA Owner',
      signature: 'QA Owner | ANTON.IA',
      company_profile: { fixture: true, segment: 'B2B SaaS' },
      updated_at: FIXTURE_TIME,
    },
    {
      id: memberId,
      email: QA_IDENTITIES.member.email,
      full_name: QA_IDENTITIES.member.fullName,
      company_name: 'ANTON.IA QA',
      company_domain: 'example.test',
      job_title: 'QA Collaborator',
      signature: 'QA Member | ANTON.IA',
      company_profile: { fixture: true, segment: 'B2B SaaS' },
      updated_at: FIXTURE_TIME,
    },
    {
      id: outsiderId,
      email: QA_IDENTITIES.outsider.email,
      full_name: QA_IDENTITIES.outsider.fullName,
      company_name: 'ANTON.IA QA Externa',
      company_domain: 'external.example.test',
      job_title: 'External QA Owner',
      signature: 'QA Outsider | External',
      company_profile: { fixture: true, segment: 'Consulting' },
      updated_at: FIXTURE_TIME,
    },
  ], { onConflict: 'id' }));

  await expectQuery('Could not create fixture missions', admin.from('antonia_missions').upsert([
    {
      id: primary.emptyMission,
      organization_id: primaryOrganizationId,
      user_id: ownerId,
      title: 'QA - Mision sin resultados',
      status: 'active',
      goal_summary: 'Estado vacio para validar el inicio de una mision.',
      params: { qaFixture: true, qaState: 'empty' },
      created_at: FIXTURE_TIME,
      updated_at: FIXTURE_TIME,
    },
    {
      id: primary.activeMission,
      organization_id: primaryOrganizationId,
      user_id: ownerId,
      title: 'QA - Expansion SaaS',
      status: 'active',
      goal_summary: 'Encontrar responsables comerciales en empresas SaaS.',
      params: {
        qaFixture: true,
        qaState: 'normal',
        jobTitle: 'VP Sales',
        location: 'Spain',
        industry: 'Software',
      },
      created_at: FIXTURE_TIME,
      updated_at: FIXTURE_TIME,
    },
    {
      id: primary.blockedMission,
      organization_id: primaryOrganizationId,
      user_id: ownerId,
      title: 'QA - Revision requerida',
      status: 'paused',
      goal_summary: 'Mision pausada por falta de criterios de contacto.',
      params: { qaFixture: true, qaState: 'blocked', blockReason: 'missing_contact_criteria' },
      created_at: FIXTURE_TIME,
      updated_at: FIXTURE_TIME,
    },
    {
      id: primary.failedMission,
      organization_id: primaryOrganizationId,
      user_id: ownerId,
      title: 'QA - Error recuperable',
      status: 'failed',
      goal_summary: 'Estado de error sintetico para validar recuperacion.',
      params: { qaFixture: true, qaState: 'error', errorCode: 'QA_SYNTHETIC_FAILURE' },
      created_at: FIXTURE_TIME,
      updated_at: FIXTURE_TIME,
    },
    {
      id: outsider.mission,
      organization_id: outsiderOrganizationId,
      user_id: outsiderId,
      title: 'QA Externa - Prospeccion',
      status: 'active',
      goal_summary: 'Fixture del segundo tenant para validar aislamiento.',
      params: { qaFixture: true, qaState: 'normal' },
      created_at: FIXTURE_TIME,
      updated_at: FIXTURE_TIME,
    },
  ], { onConflict: 'id' }));

  await expectQuery('Could not create fixture leads', admin.from('leads').upsert([
    {
      id: primary.normalLead,
      user_id: ownerId,
      organization_id: primaryOrganizationId,
      mission_id: primary.activeMission,
      name: 'Lucia Vega',
      title: 'VP Sales',
      company: 'Acme Norte',
      email: 'lucia.vega@example.test',
      status: 'investigated',
      industry: 'Software',
      company_website: 'https://acme-norte.example.test',
      location: 'Madrid, Spain',
      country: 'Spain',
      city: 'Madrid',
      score: 82,
      score_tier: 'warm',
      score_reason: 'Buen encaje de rol, industria y tamano.',
      last_investigated_at: FIXTURE_TIME,
      created_at: FIXTURE_TIME,
    },
    {
      id: primary.errorLead,
      user_id: memberId,
      organization_id: primaryOrganizationId,
      mission_id: primary.failedMission,
      name: 'Marco Error',
      title: 'Operations Director',
      company: 'Example Failure Lab',
      email: null,
      status: 'saved',
      industry: 'Logistics',
      location: 'Lisbon, Portugal',
      country: 'Portugal',
      city: 'Lisbon',
      score: 18,
      score_tier: 'cold',
      enrichment_error: 'QA synthetic enrichment failure',
      created_at: FIXTURE_TIME,
    },
    {
      id: outsider.lead,
      user_id: outsiderId,
      organization_id: outsiderOrganizationId,
      mission_id: outsider.mission,
      name: 'Olivia Tenant',
      title: 'Founder',
      company: 'External Example',
      email: 'olivia.tenant@external.example.test',
      status: 'saved',
      industry: 'Consulting',
      location: 'Dublin, Ireland',
      country: 'Ireland',
      city: 'Dublin',
      score: 65,
      score_tier: 'cool',
      score_reason: 'Fixture visible solo para el tenant externo.',
      created_at: FIXTURE_TIME,
    },
  ], { onConflict: 'id' }));

  await expectQuery('Could not create fixture campaigns', admin.from('campaigns').upsert([
    {
      id: primary.campaign,
      user_id: ownerId,
      organization_id: primaryOrganizationId,
      name: 'QA - Seguimiento de expansion',
      status: 'active',
      campaign_type: 'follow_up',
      settings: { qaFixture: true, timezone: 'Europe/Madrid' },
      sent_records: {},
      created_at: FIXTURE_TIME,
      updated_at: FIXTURE_TIME,
    },
    {
      id: outsider.campaign,
      user_id: outsiderId,
      organization_id: outsiderOrganizationId,
      name: 'QA Externa - Seguimiento',
      status: 'paused',
      campaign_type: 'follow_up',
      settings: { qaFixture: true, timezone: 'Europe/Dublin' },
      sent_records: {},
      created_at: FIXTURE_TIME,
      updated_at: FIXTURE_TIME,
    },
  ], { onConflict: 'id' }));

  await expectQuery('Could not create fixture campaign steps', admin.from('campaign_steps').upsert([
    {
      id: primary.campaignStep,
      campaign_id: primary.campaign,
      order_index: 0,
      offset_days: 2,
      name: 'Primer seguimiento',
      subject_template: 'Una idea para {{company}}',
      body_template: 'Hola {{firstName}}, queria compartirte una idea concreta.',
      attachments: [],
      created_at: FIXTURE_TIME,
    },
    {
      id: outsider.campaignStep,
      campaign_id: outsider.campaign,
      order_index: 0,
      offset_days: 3,
      name: 'External follow-up',
      subject_template: 'Follow-up for {{company}}',
      body_template: 'Hello {{firstName}}, this is a synthetic QA follow-up.',
      attachments: [],
      created_at: FIXTURE_TIME,
    },
  ], { onConflict: 'id' }));

  const snapshotPayload = {
    schemaVersion: 1,
    qaFixture: true,
    summary: 'Acme Norte esta ampliando su equipo comercial en Espana.',
    evidence: [{ source: 'synthetic', claim: 'Expansion comercial planificada.' }],
  };
  await expectQuery('Could not create fixture research snapshot', admin.from('research_snapshots').upsert({
    id: primary.researchSnapshot,
    scope_key: primaryOrganizationId,
    organization_id: primaryOrganizationId,
    user_id: ownerId,
    lead_ref: primary.normalLead,
    source: 'qa_fixture',
    schema_version: 1,
    payload: snapshotPayload,
    content_hash: sha256(JSON.stringify(snapshotPayload)),
    captured_at: FIXTURE_TIME,
    created_at: FIXTURE_TIME,
  }, { onConflict: 'id' }));

  await expectQuery('Could not create fixture research report', admin.from('lead_research_reports').upsert({
    id: primary.researchReport,
    scope_key: primaryOrganizationId,
    organization_id: primaryOrganizationId,
    user_id: ownerId,
    lead_ref: primary.normalLead,
    lead_id: primary.normalLead,
    email: 'lucia.vega@example.test',
    company_domain: 'acme-norte.example.test',
    company_name: 'Acme Norte',
    provider: 'qa_fixture',
    report: snapshotPayload,
    generated_at: FIXTURE_TIME,
    created_at: FIXTURE_TIME,
    updated_at: FIXTURE_TIME,
  }, { onConflict: 'id' }));

  const draftPayload = buildDraftPayload({
    organizationId: primaryOrganizationId,
    userId: ownerId,
    leadId: primary.normalLead,
  });
  await expectQuery('Could not create fixture messaging draft', admin.rpc('create_messaging_draft_v1', {
    p_payload: draftPayload,
    p_content_hash: sha256(JSON.stringify(draftPayload)),
  }));

  return {
    target,
    organizations: qa.organizations,
    users: qa.users,
    fixtureIds: QA_FIXTURE_IDS,
  };
}

async function main() {
  const envPath = path.join(process.cwd(), '.env.test.local');
  if (!fs.existsSync(envPath)) {
    throw new Error('Missing .env.test.local. Run npm run test:env:local first.');
  }

  Object.assign(process.env, dotenv.parse(fs.readFileSync(envPath)));
  const result = await ensureQaFixtures();
  console.log(
    `[test:fixtures] Reset deterministic QA fixtures in ${Object.keys(result.organizations).length} local organizations.`,
  );
}

const isDirectRun = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  main().catch((error) => {
    console.error(`[test:fixtures] ${error.message}`);
    process.exitCode = 1;
  });
}
