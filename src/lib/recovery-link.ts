// The link of «¿Olvidaste tu contraseña?» carries a one-time token. Mail security filters (Microsoft Defender Safe Links, Gmail, antivirus
// gateways) request every link of a message before the person reads it, and a request that spends the token leaves the person with «el enlace
// venció» a minute after asking for it. So the link only brings the person to /restablecer-clave, and the token is spent by the button there:
// a filter follows links, it does not press buttons.
export const RESET_PASSWORD_PATH = '/restablecer-clave';

const TOKEN_HASH = /^[A-Za-z0-9_-]{1,256}$/;

/** The token hash of a recovery link, or null when the address is not one (another type, or a token that cannot be a token). */
export function recoveryTokenHash(params: { get(name: string): string | null }): string | null {
  if (params.get('type') !== 'recovery') return null;
  const token = params.get('token_hash');
  return token && TOKEN_HASH.test(token) ? token : null;
}

/** Where a recovery link leads: the page that asks for the click, with the token still unspent. */
export const recoveryPagePath = (tokenHash: string) => `${RESET_PASSWORD_PATH}?${new URLSearchParams({ token_hash: tokenHash, type: 'recovery' })}`;
