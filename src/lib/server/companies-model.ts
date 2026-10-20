import { AuthError } from '@/lib/server/auth-utils';

/** The model of «Empresas» (parecidas, qué hace cada una): Haiku by default; COMPANIES_MODEL can name another allowed one. */
export function companiesModel(env: Record<string, string | undefined> = process.env) {
  const wanted = env.COMPANIES_MODEL || 'claude-haiku-5-5';
  if (!['claude-haiku-5-5', 'claude-sonnet-5-5', 'gpt-6-luna'].includes(wanted)) throw new AuthError('El modelo configurado no está permitido.', 503);
  return wanted;
}
