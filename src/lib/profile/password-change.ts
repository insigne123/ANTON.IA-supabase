export function validatePasswordChange(password: string, confirmation: string): string | null {
  if (password.length < 8) return 'Usa al menos 8 caracteres.';
  if (password !== confirmation) return 'Las contrasenas no coinciden.';
  return null;
}

export function passwordChangeError(code?: string): string {
  if (code === 'same_password') return 'Elige una contrasena diferente de la actual.';
  if (code === 'weak_password') return 'Usa una contrasena mas segura, con mayusculas, minusculas, numeros y simbolos.';
  if (code === 'reauthentication_not_valid') return 'El codigo no es valido o vencio. Solicita otro codigo.';
  if (code === 'invalid_credentials') return 'La contrasena actual no es correcta.';
  if (code === 'session_not_found' || code === 'refresh_token_not_found') return 'Tu sesion expiro. Vuelve a iniciar sesion.';
  return 'No pudimos actualizar la contrasena. Revisa tus datos e intenta nuevamente.';
}
