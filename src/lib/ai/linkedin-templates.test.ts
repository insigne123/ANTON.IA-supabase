import test from 'node:test';
import assert from 'node:assert/strict';

import { buildLinkedinDraft } from '@/lib/ai/linkedin-templates';
import type { EnrichedLead, LeadResearchReport } from '@/lib/types';

const lead = {
  id: 'lead-1',
  fullName: 'Nelida Gonzalez',
  companyName: 'GrupoExpro',
  title: 'Directora de Reclutamiento',
} as EnrichedLead;

test('uses a verified person-specific signal when available', () => {
  const report = {
    id: 'report-1',
    company: { name: 'GrupoExpro' },
    createdAt: new Date().toISOString(),
    cross: {
      company: { name: 'GrupoExpro' },
      overview: '', pains: [], opportunities: [], risks: [], useCases: [], talkTracks: [], subjectLines: [],
      valueProps: ['mejorar la experiencia de contratación'],
      emailDraft: { subject: '', body: '' },
      leadContext: { recentActivitySummary: 'su equipo está ampliando su operación regional.' },
    },
  } as LeadResearchReport;

  const draft = buildLinkedinDraft(lead, report);
  assert.equal(draft.isPersonalized, true);
  assert.match(draft.message, /ampliando su operación regional/i);
  assert.match(draft.message, /Nelida/);
});

test('labels a draft without person-specific evidence as needing review', () => {
  const draft = buildLinkedinDraft(lead, null);
  assert.equal(draft.isPersonalized, false);
  assert.match(draft.personalization, /revisa el texto/i);
  assert.doesNotMatch(draft.message, /pain|reto/i);
});
