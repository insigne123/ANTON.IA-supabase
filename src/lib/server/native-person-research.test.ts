import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildPublicPersonSearchQuery,
  isStrictPublicPersonIdentityMatch,
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
});
