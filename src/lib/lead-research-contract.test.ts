import test from 'node:test';
import assert from 'node:assert/strict';

import { adaptLeadResearchResponseToReport, getLeadResearchWarnings, unwrapLeadResearchResponse } from '@/lib/lead-research';

test('unwrapLeadResearchResponse promotes nested report fields', () => {
  const payload = {
    status: 'queued',
    report: {
      report_id: 'rep-123',
      status: 'completed',
      company: { name: 'Acme' },
      website_summary: { overview: 'Resumen', services: [], source_ids: [] },
      warnings: ['warning-1'],
    },
  };

  const unwrapped = unwrapLeadResearchResponse(payload);

  assert.equal(unwrapped.report_id, 'rep-123');
  assert.equal(unwrapped.status, 'completed');
  assert.deepEqual(unwrapped.company, { name: 'Acme' });
});

test('adaptLeadResearchResponseToReport supports nested report payloads', () => {
  const payload = {
    report: {
      report_id: 'rep-456',
      status: 'completed',
      generated_at: '2026-04-08T00:00:00.000Z',
      company: { name: 'Acme', domain: 'acme.com' },
      website_summary: { overview: 'Acme overview', services: ['Service A'], source_ids: [] },
      signals: [],
      sources: [],
      existing_compat: {
        cross: {
          company: { name: 'Acme', domain: 'acme.com' },
          overview: 'Acme overview',
          pains: [],
          opportunities: [],
          risks: [],
          valueProps: [],
          useCases: [],
          talkTracks: [],
          subjectLines: [],
          emailDraft: { subject: '', body: '' },
          sources: [],
        },
      },
    },
  };

  const report = adaptLeadResearchResponseToReport(payload, 'lead-ref-1');

  assert.equal(report.id, 'rep-456');
  assert.equal(report.company.name, 'Acme');
  assert.equal(report.company.domain, 'acme.com');
  assert.equal(report.websiteSummary?.overview, 'Acme overview');
});

test('getLeadResearchWarnings reads nested report warnings', () => {
  const warnings = getLeadResearchWarnings({
    report: {
      warnings: ['warning-a', 'warning-b'],
    },
  });

  assert.deepEqual(warnings, ['warning-a', 'warning-b']);
});

test('unwrapLeadResearchResponse parses assistant array payloads', () => {
  const payload = [
    {
      message: {
        content: JSON.stringify({
          company: { name: 'GrupoExpro', domain: 'grupoexpro.com' },
          overview: 'Resumen plano',
          pains: ['Pain 1'],
          opportunities: ['Opportunity 1'],
          risks: ['Risk 1'],
          valueProps: ['Value 1'],
          useCases: ['Use case 1'],
          talkTracks: ['Track 1'],
          subjectLines: ['Subject 1'],
          emailDraft: { subject: 'Hola', body: 'Cuerpo' },
          sources: [],
        }),
        annotations: [
          {
            type: 'url_citation',
            url_citation: {
              title: 'LinkedIn',
              url: 'https://linkedin.com/in/example',
            },
          },
        ],
      },
    },
  ];

  const unwrapped = unwrapLeadResearchResponse(payload);

  assert.equal(unwrapped.company.name, 'GrupoExpro');
  assert.equal(unwrapped.overview, 'Resumen plano');
  assert.equal(unwrapped.sources[0].url, 'https://linkedin.com/in/example');
});

test('unwrapLeadResearchResponse recovers a truncated assistant payload as partial', () => {
  const content = `{
    "company": { "name": "Entel", "domain": "entel.cl" },
    "leadContext": { "profileSummary": "Vicepresidente de Personas", "foundRecentActivity": false },
    "overview": "Resumen comercial de Entel",
    "pains": ["Optimizar procesos internos"],
    "opportunities": ["Automatizar recursos humanos"],
    "risks": ["Resistencia al cambio"],
    "valueProps": ["Automatizacion inteligente"],
    "useCases": ["Asistentes IA"],
    "talkTracks": ["Como mejorar la eficiencia?"],
    "subjectLines": ["Optimiza procesos internos con IA"],
    "emailDraft": {
      "subject": "Optimiza procesos internos con IA",
      "body": "Estimado Roberto, el mensaje quedo`;
  const payload = [{ message: { role: 'assistant', content }, finish_reason: 'stop' }];

  const unwrapped = unwrapLeadResearchResponse(payload);
  const report = adaptLeadResearchResponseToReport(payload, 'roberto-entel');

  assert.equal(unwrapped.status, 'partial');
  assert.equal(unwrapped.response_truncated, true);
  assert.equal(unwrapped.company.name, 'Entel');
  assert.equal(unwrapped.emailDraft.subject, 'Optimiza procesos internos con IA');
  assert.equal(unwrapped.emailDraft.body, '');
  assert.match(unwrapped.warnings[0], /respuesta del proveedor llego truncada/i);
  assert.equal(report.company.name, 'Entel');
  assert.equal(report.cross?.overview, 'Resumen comercial de Entel');
  assert.deepEqual(report.cross?.pains, ['Optimizar procesos internos']);
  assert.equal(report.cross?.emailDraft.body, '');
});

test('adaptLeadResearchResponseToReport supports flat cross-like payloads', () => {
  const payload = {
    company: {
      name: 'GrupoExpro',
      domain: 'grupoexpro.com',
      linkedin: 'https://linkedin.com/company/grupoexpro',
      industry: 'Servicios de Recursos Humanos',
      country: 'Chile',
      website: 'https://grupoexpro.com/chile/',
    },
    overview: 'Resumen comercial',
    pains: ['Pain 1'],
    opportunities: ['Opportunity 1'],
    risks: ['Risk 1'],
    valueProps: ['Value 1'],
    useCases: ['Use case 1'],
    talkTracks: ['Track 1'],
    subjectLines: ['Subject 1'],
    emailDraft: { subject: 'Asunto', body: 'Cuerpo' },
    leadContext: {
      profileSummary: 'Perfil',
      recentActivitySummary: 'Actividad',
      iceBreaker: 'Icebreaker',
      communicationStyle: 'Formal',
    },
    nextSteps: [{ action: 'Enviar correo', why: 'Abrir conversacion', priority: 'alta' }],
    confidence: { overview: 1, pains: 0.9 },
    contradictions: ['Validar fecha'],
    sources: [{ title: 'Site', url: 'https://grupoexpro.com/chile/' }],
  };

  const report = adaptLeadResearchResponseToReport(payload, 'lead-ref-flat');

  assert.equal(report.company.name, 'GrupoExpro');
  assert.equal(report.cross?.overview, 'Resumen comercial');
  assert.equal(report.cross?.leadContext?.communicationStyle, 'Formal');
  assert.equal(report.cross?.nextSteps?.[0]?.action, 'Enviar correo');
  assert.equal(report.cross?.sources?.[0]?.url, 'https://grupoexpro.com/chile/');
});
