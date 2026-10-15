import assert from 'node:assert/strict';
import test from 'node:test';
import { contactKeys, linkedinKey, newContacts } from './contact-keys';

test('a LinkedIn profile reads the same however it was copied', () => {
  assert.equal(linkedinKey('https://www.LinkedIn.com/in/luis-durand-149355110/?trk=x'), 'linkedin.com/in/luis-durand-149355110');
  assert.equal(linkedinKey('cl.linkedin.com/in/luis-durand-149355110'), 'linkedin.com/in/luis-durand-149355110');
  assert.equal(linkedinKey('https://www.linkedin.com/company/acme'), null);
  assert.equal(linkedinKey(''), null);
});

test('the same person is not saved twice: by email, by LinkedIn, or by name at the same company', () => {
  const existing = [{ email: null, linkedinUrl: 'https://www.linkedin.com/in/luis-durand-149355110', fullName: 'Luis Durand', companyName: 'Latam Trade Capital' }];
  const { fresh, repeated } = newContacts(existing, [
    { fullName: 'Luis Durand', companyName: 'Latam Trade Capital', linkedinUrl: 'linkedin.com/in/luis-durand-149355110/' },
    { fullName: 'Luis  Durand', companyName: 'latam trade capital' },
    { fullName: 'Ana Pérez', companyName: 'Metro', email: 'ana@metro.cl' },
    { fullName: 'Ana Perez', companyName: 'Metro S.A.', email: 'ANA@metro.cl' },
    { fullName: 'Luis Durand', companyName: 'Otra Empresa' },
  ]);
  assert.deepEqual(fresh.map(c => `${c.fullName}|${c.companyName}`), ['Ana Pérez|Metro', 'Luis Durand|Otra Empresa']);
  assert.equal(repeated.length, 3);
  assert.deepEqual(contactKeys({}), []);
});
