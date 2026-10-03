import assert from 'node:assert/strict';
import test from 'node:test';

import { PASSWORD_MIN_LENGTH, PASSWORD_RESET_SENT, authErrorMessage, newPasswordProblem } from './auth-messages';

test('Supabase Auth errors reach the person in Spanish, by code or by message', () => {
  const cases: Array<[unknown, string]> = [
    [{ code: 'invalid_credentials', message: 'Invalid login credentials' }, 'El correo o la contraseña no coinciden.'],
    [{ message: 'Invalid login credentials' }, 'El correo o la contraseña no coinciden.'],
    [{ code: 'email_not_confirmed' }, 'Confirma tu correo antes de entrar: te enviamos un enlace al crear la cuenta.'],
    [{ message: 'User already registered' }, 'Ya hay una cuenta con ese correo. Inicia sesión o recupera tu contraseña.'],
    [{ code: 'same_password', message: 'New password should be different from the old password.' }, 'La contraseña nueva debe ser distinta de la anterior.'],
    [{ code: 'weak_password', message: 'Password should be at least 6 characters.' }, `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`],
    [{ code: 'over_email_send_rate_limit', message: 'For security purposes, you can only request this after 52 seconds.' }, 'Hiciste varios intentos seguidos. Espera un minuto y vuelve a intentarlo.'],
    [{ message: 'Unable to validate email address: invalid format' }, 'Revisa el correo: no parece una dirección válida.'],
    [{ message: 'Auth session missing!' }, 'Tu enlace o tu sesión vencieron. Pide un enlace nuevo.'],
    [new TypeError('Failed to fetch'), 'No pudimos conectar. Revisa tu conexión e intenta de nuevo.'],
  ];
  for (const [error, expected] of cases) assert.equal(authErrorMessage(error), expected, JSON.stringify(error));
});

test('an unknown or empty error falls back to a plain sentence, never to English or an object dump', () => {
  assert.equal(authErrorMessage({ message: 'Database error saving new user' }), 'No pudimos completar la acción. Intenta de nuevo.');
  assert.equal(authErrorMessage(null), 'No pudimos completar la acción. Intenta de nuevo.');
  assert.equal(authErrorMessage(undefined, 'Otro texto.'), 'Otro texto.');
  assert.equal(authErrorMessage({ code: 42 }), 'No pudimos completar la acción. Intenta de nuevo.');
});

test('one password rule for sign-up and reset: 8 characters, and the confirmation must match', () => {
  assert.equal(PASSWORD_MIN_LENGTH, 8);
  assert.equal(newPasswordProblem('1234567', '1234567'), 'La contraseña debe tener al menos 8 caracteres.');
  assert.equal(newPasswordProblem('12345678', '12345679'), 'Las contraseñas no coinciden.');
  assert.equal(newPasswordProblem('12345678', '12345678'), null);
});

test('the reset answer never says whether the account exists', () => {
  assert.match(PASSWORD_RESET_SENT, /^Si hay una cuenta con ese correo/);
  assert.doesNotMatch(PASSWORD_RESET_SENT, /no existe|no encontramos/i);
});
