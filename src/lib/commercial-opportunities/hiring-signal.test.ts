import test from 'node:test';
import assert from 'node:assert/strict';
import { hiringSignal, type HiringItem } from './hiring-signal';

const hiring = (company: string, score: number, extra: Partial<HiringItem> = {}): HiringItem => ({
  id: company, company, domain: null, region: null, url: null, score, reasons: [], status: 'new', mine: false, ads: 6,
  firstSeenAt: '2026-09-20T11:00:00Z', lastSeenAt: '2026-09-25T11:00:00Z',
  data: { ads: 6, adsLastWeek: 2, roles: [{ role: 'Operario', ads: 6 }], regions: [], publishers: [], sources: ['jsearch'], size: null, industry: null,
    isClient: false, isContact: false, firstPostedAt: null, lastPostedAt: null, windowDays: 30, evidence: [] },
  ...extra,
});

test('the signal of a company hiring is a fact with its source and its date', () => {
  const company = hiring('Retail Andes', 80, { ads: 14 });
  company.data = { ...company.data, ads: 14, roles: [{ role: 'operario', ads: 6 }, { role: 'reponedor', ads: 4 }, { role: 'cajero', ads: 4 }],
    publishers: ['LinkedIn', 'Laborum'], lastPostedAt: '2026-09-24T12:00:00Z' };
  assert.equal(hiringSignal(company), 'Retail Andes publicó 14 avisos de empleo en los últimos 30 días (6 de operario y 4 de reponedor), el último el 24 sept 2026, según LinkedIn y Laborum.');
  // Without portals, the source the ads came from.
  assert.equal(hiringSignal(hiring('Acme', 50)), 'Acme publicó 6 avisos de empleo en los últimos 30 días (6 de Operario), según Google for Jobs.');
  assert.equal(hiringSignal(hiring('Uno', 50, { ads: 1 })).startsWith('Uno publicó 1 aviso de empleo'), true);
});
