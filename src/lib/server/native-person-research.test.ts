import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildPublicPersonSearchQueries,
  buildPublicPersonSearchQuery,
  collectPublicPersonEvidence,
  isStrictPublicPersonIdentityMatch,
  scorePublicPersonIdentityMatch,
} from './native-person-research';

const lead = {
  fullName: 'Ana Silva',
  title: 'Directora de Operaciones',
  companyName: 'Acme Logistics',
  companyDomain: 'acme.example',
};

test('person search uses exact identity context and rejects name collisions', () => {
  assert.equal(
    buildPublicPersonSearchQuery(lead),
    '"Ana Silva" "Acme Logistics" "Directora de Operaciones"',
  );
  assert.equal(isStrictPublicPersonIdentityMatch({
    lead,
    item: {
      title: 'Ana Silva - Directora de Operaciones en Acme Logistics',
      snippet: 'Perfil profesional de Ana Silva en Acme Logistics.',
      link: 'https://www.linkedin.com/in/ana-silva',
      source: 'LinkedIn',
      date: null,
      position: 1,
    },
  }), true);
  assert.equal(isStrictPublicPersonIdentityMatch({
    lead,
    item: {
      title: 'Ana Silva - Directora de Operaciones',
      snippet: 'Perfil de otra profesional en Beta Industries.',
      link: 'https://beta.example/team/ana-silva',
      source: 'Beta',
      date: null,
      position: 1,
    },
  }), false);
  assert.equal(isStrictPublicPersonIdentityMatch({
    lead,
    item: {
      title: 'Mariana Silva - Directora de Operaciones en Acme Logistics',
      snippet: 'Perfil profesional de Mariana Silva en Acme Logistics.',
      link: 'https://www.linkedin.com/in/mariana-silva',
      source: 'LinkedIn',
      date: null,
      position: 1,
    },
  }), false);

  const rolelessMatch = {
    title: 'Ana Silva en Acme Logistics',
    snippet: 'Ana Silva forma parte del equipo ejecutivo de Acme Logistics.',
    link: 'https://www.linkedin.com/in/ana-silva',
    source: 'LinkedIn',
    date: null,
    position: 2,
  };
  assert.equal(isStrictPublicPersonIdentityMatch({ lead, item: rolelessMatch }), true);
  assert.ok(scorePublicPersonIdentityMatch({
    lead,
    item: {
      ...rolelessMatch,
      title: 'Ana Silva - Directora de Operaciones en Acme Logistics',
    },
  }) > scorePublicPersonIdentityMatch({ lead, item: rolelessMatch }));
});

test('person evidence stages fallbacks, deduplicates results, and stops when matches are sufficient', async () => {
  assert.deepEqual(buildPublicPersonSearchQueries(lead), [
    '"Ana Silva" "Acme Logistics" "Directora de Operaciones"',
    '"Ana Silva" "Acme Logistics"',
    '"Ana Silva" "acme.example"',
  ]);

  const calls: string[] = [];
  const result = await collectPublicPersonEvidence({
    organizationId: 'org-1',
    lead,
    options: { depth: 'deep', language: 'es', refresh: false },
    search: async (request: any): Promise<any> => {
      calls.push(String(request.query));
      const shared = {
        title: 'Ana Silva en Acme Logistics',
        snippet: 'Ana Silva forma parte del equipo ejecutivo de Acme Logistics.',
        link: `https://www.linkedin.com/in/ana-silva${calls.length === 1 ? '?utm_source=search' : ''}`,
        source: 'LinkedIn',
        date: null,
        position: 2,
      };
      return {
        provider: 'serper',
        kind: 'organic',
        query: request.query,
        localization: { language: 'es', countryCode: 'cl', location: null },
        limit: 8,
        items: calls.length === 1 ? [shared] : [shared, {
          title: 'Ana Silva - Directora de Operaciones',
          snippet: 'Acme Logistics presenta a Ana Silva, Directora de Operaciones.',
          link: 'https://acme.example/team/ana-silva',
          source: 'Acme Logistics',
          date: null,
          position: 1,
        }],
        answerBox: null,
        relatedQuestions: [],
        searchInformation: null,
      };
    },
  });

  assert.equal(calls.length, 2);
  assert.equal(result.items.length, 2);
  assert.match(result.items[0].title || '', /Directora de Operaciones/);
  assert.deepEqual(result.warnings, []);
});

test('person evidence does not spend a fallback query after two safe primary matches', async () => {
  let calls = 0;
  const result = await collectPublicPersonEvidence({
    organizationId: 'org-1',
    lead,
    options: { depth: 'standard', language: 'es', refresh: false },
    search: async (request: any): Promise<any> => {
      calls += 1;
      return {
        query: request.query,
        items: [
          {
            title: 'Ana Silva - Directora de Operaciones en Acme Logistics',
            snippet: 'Perfil profesional de Ana Silva en Acme Logistics.',
            link: 'https://www.linkedin.com/in/ana-silva',
            source: 'LinkedIn',
            date: null,
            position: 1,
          },
          {
            title: 'Equipo de Acme Logistics: Ana Silva',
            snippet: 'Ana Silva lidera operaciones para Acme Logistics.',
            link: 'https://acme.example/team/ana-silva',
            source: 'Acme Logistics',
            date: null,
            position: 2,
          },
        ],
      };
    },
  });

  assert.equal(calls, 1);
  assert.equal(result.items.length, 2);
});
