/** One rule for the new password after a reset. */
export const PASSWORD_MIN_LENGTH = 8;

/** What is wrong with a new password, in the words the form shows, or null when it can be saved. */
export function newPasswordProblem(password: string, confirmation: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) return `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`;
  if (password !== confirmation) return 'Las contraseñas no coinciden.';
  return null;
}

/** The same answer whether or not an account exists, so the form does not reveal who has one. */
export const PASSWORD_RESET_SENT =
  'Si hay una cuenta con ese correo, te llegará un enlace para crear una contraseña nueva. Revisa también la carpeta de spam.';

const MESSAGES: Array<{ match: RegExp; message: string }> = [
  { match: /signup_disabled|signups? (?:are )?not allowed|signups? (?:are )?disabled/i, message: 'Las cuentas las crea la administración de ANTON.IA. Solicita tu acceso.' },
  { match: /invalid_credentials|invalid login credentials/i, message: 'El correo o la contraseña no coinciden.' },
  { match: /email_not_confirmed|email not confirmed/i, message: 'Confirma tu correo antes de entrar: te enviamos un enlace al crear la cuenta.' },
  { match: /user_already_exists|already registered|already been registered/i, message: 'Ya hay una cuenta con ese correo. Inicia sesión o recupera tu contraseña.' },
  { match: /same_password|should be different from the old/i, message: 'La contraseña nueva debe ser distinta de la anterior.' },
  { match: /weak_password|password should be|password is too/i, message: `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.` },
  { match: /rate_limit|rate limit|for security purposes|too many/i, message: 'Hiciste varios intentos seguidos. Espera un minuto y vuelve a intentarlo.' },
  { match: /invalid.*email|email.*invalid|unable to validate email/i, message: 'Revisa el correo: no parece una dirección válida.' },
  { match: /session.*missing|auth session missing|jwt expired|refresh token/i, message: 'Tu enlace o tu sesión vencieron. Pide un enlace nuevo.' },
  { match: /failed to fetch|network|load failed/i, message: 'No pudimos conectar. Revisa tu conexión e intenta de nuevo.' },
];

/** Supabase Auth answers in English; the login and reset forms show this instead. */
export function authErrorMessage(error: unknown, fallback = 'No pudimos completar la acción. Intenta de nuevo.'): string {
  const candidate = error as { code?: unknown; message?: unknown } | null;
  const text = [candidate?.code, candidate?.message, typeof error === 'string' ? error : '']
    .filter((part): part is string => typeof part === 'string' && part.length > 0)
    .join(' ');
  if (!text) return fallback;
  return MESSAGES.find(({ match }) => match.test(text))?.message ?? fallback;
}
