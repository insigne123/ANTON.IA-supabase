import test from 'node:test';
import assert from 'node:assert/strict';

const autopilot = await import('../src/lib/antonia-autopilot.ts');
const playbooks = await import('../src/lib/antonia-playbooks.ts');

test('scoreLeadForMission prioritizes strong outsourcing matches', () => {
  const result = autopilot.scoreLeadForMission(
    {
      title: 'Gerente de RRHH',
      company: 'Retail Sur',
      email: 'rrhh@retailsur.cl',
      linkedin_url: 'https://linkedin.com/in/demo',
      industry: 'Retail',
      location: 'Chile',
    },
    {
      jobTitle: 'Gerente de RRHH',
      industry: 'Retail',
      location: 'Chile',
      keywords: 'rotacion, staffing estacional',
    }
  );

  assert.ok(result.score >= 80);
  assert.equal(result.tier, 'hot');
  assert.match(result.reason, /cargo|industria|ubicacion|email/i);
});

test('decideAutopilotContactAction respects manual assist mode', () => {
  const decision = autopilot.decideAutopilotContactAction({
    config: {
      autopilotEnabled: true,
      autopilotMode: 'manual_assist',
      approvalMode: 'disabled',
      minAutoSendScore: 70,
      minReviewScore: 45,
    },
    lead: {
      email: 'lead@example.com',
      score: 92,
      company: 'Demo Co',
      title: 'Head of People',
      linkedin_url: 'https://linkedin.com/in/lead',
    },
  });

  assert.equal(decision.action, 'review');
  assert.match(decision.reason, /manual assist/i);
});

test('decideAutopilotContactAction sends high-score leads in full auto', () => {
  const decision = autopilot.decideAutopilotContactAction({
    config: {
      autopilotEnabled: true,
      autopilotMode: 'full_auto',
      approvalMode: 'disabled',
      minAutoSendScore: 70,
      minReviewScore: 45,
    },
    lead: {
      email: 'lead@example.com',
      score: 88,
      company: 'Demo Co',
      title: 'Director de Operaciones',
      linkedin_url: 'https://linkedin.com/in/lead',
    },
  });

  assert.equal(decision.action, 'send');
});

test('decideAutopilotContactAction skips leads without email', () => {
  const decision = autopilot.decideAutopilotContactAction({
    config: {
      autopilotEnabled: true,
      autopilotMode: 'full_auto',
      approvalMode: 'disabled',
    },
    lead: {
      score: 99,
      company: 'Demo Co',
      title: 'CEO',
    },
  });

  assert.equal(decision.action, 'skip');
  assert.match(decision.reason, /sin email/i);
});

test('assessLeadMissionFit blocks leads outside the requested industry', () => {
  const fit = autopilot.assessLeadMissionFit(
    {
      company: 'LATAM Airlines',
      title: 'Head of Recruiting',
      industry: 'Logistics',
      organization_industry: 'Airlines/Aviation',
      researchReport: {
        company: { industry: 'Airlines/Aviation', size: 12000 },
        cross: { company: { industry: 'Airlines/Aviation' }, overview: 'Aerolinea lider en Sudamerica.' },
      },
    },
    {
      industry: 'Logistics',
      companySize: '5001+',
      seniorities: ['head'],
    }
  );

  assert.equal(fit.action, 'block');
  assert.match(fit.reason, /industria/i);
});

test('assessLeadMissionFit allows strong ICP matches', () => {
  const fit = autopilot.assessLeadMissionFit(
    {
      company: 'Chilexpress',
      title: 'Head of Operations',
      organization_industry: 'Logistics and Supply Chain',
      location: 'Santiago, Chile',
      organization_size: 6500,
    },
    {
      jobTitle: 'Operations',
      industry: 'Logistics',
      location: 'Chile',
      companySize: '5001+',
      seniorities: ['head'],
    }
  );

  assert.equal(fit.action, 'allow');
  assert.ok(fit.matchedSignals.length >= 3);
});

test('buildSuggestedMeetingReply includes booking link when available', () => {
  const reply = autopilot.buildSuggestedMeetingReply({
    leadName: 'Camila Torres',
    companyName: 'Empresa X',
    bookingLink: 'https://calendly.com/antonia/demo',
    meetingInstructions: 'La llamada dura 20 minutos y revisamos staffing y payroll.',
  });

  assert.match(reply, /Camila/i);
  assert.match(reply, /https:\/\/calendly\.com\/antonia\/demo/i);
  assert.match(reply, /20 minutos/i);
});

test('outsourcing playbooks expose valid defaults', () => {
  assert.ok(playbooks.ANTONIA_OUTSOURCING_PLAYBOOKS.length >= 5);

  const ids = new Set(playbooks.ANTONIA_OUTSOURCING_PLAYBOOKS.map((item) => item.id));
  assert.equal(ids.size, playbooks.ANTONIA_OUTSOURCING_PLAYBOOKS.length);

  for (const playbook of playbooks.ANTONIA_OUTSOURCING_PLAYBOOKS) {
    assert.ok(playbook.defaults.jobTitle);
    assert.ok(playbook.defaults.location);
    assert.ok(playbook.defaults.industry);
    assert.ok(playbook.defaults.missionName);
    assert.ok(playbook.defaults.dailyContactLimit > 0);
  }
});
