import assert from 'node:assert/strict';
import test from 'node:test';

import { NativeResearchLeadSchema, NativeResearchOptionsSchema } from '@/lib/native-research-contracts';
import { nativeResearchInternals } from './native-research';

test('native snapshot preserves imported lead context and turns Similarweb into a cited directional signal', () => {
  const lead = NativeResearchLeadSchema.parse({
    id: 'lead-ada',
    fullName: 'Ada Lovelace',
    email: 'ada@acme.example',
    title: 'Directora de Operaciones',
    headline: 'Lidera operaciones regionales',
    seniority: 'Director',
    departments: ['Operaciones'],
    companyName: 'Acme',
    companyDomain: 'acme.example',
    companyWebsite: 'https://acme.example/about',
    companyLinkedinUrl: 'https://www.linkedin.com/company/acme',
    descriptionSnippet: 'Acme coordina operaciones para equipos empresariales.',
    industry: 'Software',
    organizationIndustry: 'Software',
    organizationSize: 240,
  });
  const duplicateProfileResult = {
    title: 'Acme',
    snippet: 'Acme coordina operaciones para equipos empresariales y ofrece soporte especializado para organizaciones regionales.',
    link: 'https://acme.example/profile',
  };
  const output = nativeResearchInternals.buildSnapshot({
    jobId: 'job-1',
    reportId: 'report-1',
    requestIdempotencyKey: 'request-1',
    access: { organizationId: 'org-1', userId: 'user-1' },
    lead,
    options: NativeResearchOptionsSchema.parse({ depth: 'standard', language: 'es', refresh: false }),
    company: {
      domain: 'acme.example',
      official: {
        url: 'https://acme.example/about',
        title: 'Acme',
        description: null,
        text: 'Acme coordina operaciones para equipos empresariales y ofrece soporte especializado para organizaciones regionales.',
        pages: [{
          url: 'https://acme.example/about',
          title: 'Acme',
          description: null,
          text: 'Acme coordina operaciones para equipos empresariales y ofrece soporte especializado para organizaciones regionales.',
        }],
      },
      whois: null,
      brand: null,
      fetchedAt: '2026-08-24T18:00:00.000Z',
    },
    profile: {
      provider: 'serper',
      fetchedAt: '2026-08-24T18:00:00.000Z',
      items: [duplicateProfileResult, duplicateProfileResult],
    },
    news: {
      provider: 'serper',
      fetchedAt: '2026-08-24T18:00:00.000Z',
      items: [{
        title: 'Acme anuncia una alianza vigente',
        snippet: 'Acme confirmó una alianza para ampliar su operación regional.',
        link: 'https://news.example/acme-alliance',
        date: '2026-08-23T12:00:00.000Z',
      }, {
        title: 'Acme aparece en una nota sin fecha',
        snippet: 'Una nota antigua menciona a Acme sin indicar cuándo fue publicada.',
        link: 'https://news.example/acme-undated',
      }],
    },
    jobs: {},
    mentions: {},
    similarweb: {
      status: 'completed',
      fetchedAt: '2026-08-24T18:00:00.000Z',
      visitsMonthly: 1234,
      globalRank: 42,
      category: 'Software',
    },
    person: {
      query: null,
      provider: 'serper',
      fetchedAt: '2026-08-24T18:00:00.000Z',
      items: [],
      warnings: [],
    },
    warnings: [],
  });

  assert.equal(output.snapshot.subject.person.headline, 'Lidera operaciones regionales');
  assert.equal(output.snapshot.subject.person.seniority, 'Director');
  assert.deepEqual(output.snapshot.subject.person.departments, ['Operaciones']);
  assert.equal(output.snapshot.subject.company.industry, 'Software');
  assert.equal(output.snapshot.subject.company.size, 240);
  assert.equal(output.snapshot.subject.company.description, 'Acme coordina operaciones para equipos empresariales.');
  assert.ok(output.snapshot.sources.some((source) => source.provider === 'similarweb'));
  assert.ok(output.snapshot.claims.some((claim) => claim.kind === 'site_signal'));
  const newsClaims = output.snapshot.claims.filter((claim) => claim.kind === 'news_signal');
  assert.equal(newsClaims.length, 1);
  assert.match(newsClaims[0].statement, /alianza vigente/);
  assert.doesNotMatch(newsClaims[0].statement, /nota sin fecha/);
  assert.ok(output.snapshot.claims.some((claim) => claim.classification === 'hypothesis'));
  assert.equal(new Set(output.snapshot.evidence.map((item) => item.id)).size, output.snapshot.evidence.length);
  assert.equal(new Set(output.snapshot.claims.map((claim) => claim.id)).size, output.snapshot.claims.length);
});

test('visible company signals are balanced by kind with bounded depth caps', () => {
  const signals = [
    ...Array.from({ length: 8 }, (_, index) => ({ kind: 'news' as const, id: `news-${index}` })),
    ...Array.from({ length: 4 }, (_, index) => ({ kind: 'jobs' as const, id: `jobs-${index}` })),
    ...Array.from({ length: 4 }, (_, index) => ({ kind: 'mentions' as const, id: `mentions-${index}` })),
  ];
  const selected = nativeResearchInternals.selectBalancedSearchSignals(signals, 9);

  assert.deepEqual(selected.slice(0, 3).map((item) => item.kind), ['news', 'jobs', 'mentions']);
  assert.deepEqual(
    selected.reduce<Record<string, number>>((counts, item) => ({ ...counts, [item.kind]: (counts[item.kind] || 0) + 1 }), {}),
    { news: 3, jobs: 3, mentions: 3 },
  );
  assert.equal(nativeResearchInternals.visibleSignalLimit('basic'), 6);
  assert.equal(nativeResearchInternals.visibleSignalLimit('standard'), 9);
  assert.equal(nativeResearchInternals.visibleSignalLimit('deep'), 12);
});
