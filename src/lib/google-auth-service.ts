// Servicio de autenticación Google (GIS - OAuth 2.0 Token Client)
// - Scopes: gmail.send (básico). Incremental: gmail.readonly.
// - Guarda access token y perfil mínimo en sessionStorage (no se persiste en BD).
// - Similar a microsoft-auth-service para mantener DX.

type GoogleSession = {
  accessToken: string;
  expiresAt: number; // epoch ms
  scope: string;
  idToken?: string | null; // OIDC ID Token
  email?: string | null;
};

const STORAGE_KEY = 'gmail.oauth.session.v1';
const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '';
// Valida formato básico de un OAuth Web Client ID
const CLIENT_ID_REGEX = /^[0-9\-]+-[a-z0-9]+\.apps\.googleusercontent\.com$/i;
if (typeof window !== 'undefined') {
  if (!CLIENT_ID) {
    console.error('[google-auth-service] Falta NEXT_PUBLIC_GOOGLE_CLIENT_ID (env pública).');
  } else if (!CLIENT_ID_REGEX.test(CLIENT_ID)) {
    console.error('[google-auth-service] NEXT_PUBLIC_GOOGLE_CLIENT_ID parece inválido:', CLIENT_ID);
  }
}

// Carga dinámica del script de GIS
function ensureGis(): Promise<void> {
  return new Promise((resolve, reject) => {
    if ((window as any).google?.accounts?.oauth2) return resolve();
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('No se pudo cargar Google Identity Services'));
    document.head.appendChild(s);
  });
}

// Obtener email del perfil con token (userinfo)
async function fetchUserInfoEmail(accessToken: string): Promise<string | null> {
  try {
    const r = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    });
    if (!r.ok) return null;
    const j = await r.json();
    return j?.email ?? null;
  } catch {
    return null;
  }
}

function parseEmailFromIdToken(idt: string | null): string | null {
  try {
    if (!idt) return null;
    const [, payloadB64] = idt.split('.');
    const payload = JSON.parse(atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/')));
    return payload?.email ?? null;
  } catch {
    return null;
  }
}


function saveSession(s: GoogleSession) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

function loadSession(): GoogleSession | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as GoogleSession;
    if (!s.accessToken || Date.now() >= s.expiresAt) {
      sessionStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return s;
  } catch {
    return null;
  }
}

function clearSession() {
  sessionStorage.removeItem(STORAGE_KEY);
}

const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';
const GMAIL_READ_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const OIDC_SCOPES = ['openid', 'email', 'profile'] as const;
const BASE_SCOPES = [GMAIL_SEND_SCOPE, ...OIDC_SCOPES] as const;

function validateScopes(scopes: string[]) {
  if (!scopes.length) throw new Error('Scopes vacíos');
  if (scopes.some(s => s.includes(',') )) {
    throw new Error('Scopes mal formateados (usa espacios, no comas)');
  }
}

async function getAccessToken(
  scopes: string[],
  opts?: { forceConsent?: boolean }
): Promise<GoogleSession> {
  await ensureGis();
  validateScopes(scopes);
  if (!CLIENT_ID || !CLIENT_ID_REGEX.test(CLIENT_ID)) {
    throw new Error('Config inválida: NEXT_PUBLIC_GOOGLE_CLIENT_ID ausente o mal formateado');
  }
  return new Promise((resolve, reject) => {
    const tokenClient = (window as any).google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: scopes.join(' '),
      prompt: opts?.forceConsent ? 'consent' : '',
      callback: async (resp: any) => {
        if (resp.error || !resp.access_token) {
          const msg = [
            'No se obtuvo access token de Google.',
            resp?.error && `error=${resp.error}`,
            resp?.error_subtype && `subtype=${resp.error_subtype}`,
            resp?.error_description && `desc=${resp.error_description}`,
          ]
            .filter(Boolean)
            .join(' ');
          console.error('[google-auth] callback error', resp);
          return reject(new Error(msg));
        }
        const expiresIn = Number(resp.expires_in ?? 3600) * 1000;
        const idToken = resp.id_token || null;

        // Intentar obtener email desde id_token
        let email = parseEmailFromIdToken(idToken);
        // Si no vino, usar userinfo endpoint
        if (!email) {
          email = await fetchUserInfoEmail(resp.access_token);
        }

        const session: GoogleSession = {
          accessToken: resp.access_token,
          idToken,
          expiresAt: Date.now() + expiresIn - 10_000,
          scope: scopes.join(' '),
          email,
        };
        saveSession(session);
        resolve(session);
      },
    });
    tokenClient.requestAccessToken();
  });
}

export const googleAuthService = {
  getSession(): GoogleSession | null {
    if (typeof window === 'undefined') return null;
    return loadSession();
  },

  async login(opts?: { withReadScope?: boolean }): Promise<{ email: string | null }> {
    // Siempre incluir OIDC scopes
    const scopes = opts?.withReadScope
      ? [...BASE_SCOPES, GMAIL_READ_SCOPE]
      : [...BASE_SCOPES];
    const s = await getAccessToken(scopes, { forceConsent: true });
    return { email: s.email ?? null };
  },

  async upgradeToReadScope(): Promise<void> {
    const s = loadSession();
    const current = s?.scope?.split(' ') ?? [];
    if (current.includes(GMAIL_READ_SCOPE)) return;
    await getAccessToken([...BASE_SCOPES, GMAIL_READ_SCOPE], { forceConsent: true });
  },

  async getSendToken(): Promise<string> {
    const s = loadSession();
    if (s?.accessToken && s.scope.includes(GMAIL_SEND_SCOPE)) return s.accessToken;
    const n = await getAccessToken([...BASE_SCOPES]);
    return n.accessToken;
  },

  async getReadToken(): Promise<string> {
    const s = loadSession();
    const scopes = s?.scope?.split(' ') ?? [];
    if (s?.accessToken && scopes.includes(GMAIL_READ_SCOPE)) return s.accessToken;
    const n = await getAccessToken([...BASE_SCOPES, GMAIL_READ_SCOPE]);
    return n.accessToken;
  },

  async getUserEmail(): Promise<string | null> {
    const session = loadSession();
    if (session?.email) return session.email;

    const fromId = parseEmailFromIdToken(session?.idToken ?? null);
    if (fromId) {
      // guardar para futuras sesiones
      saveSession({ ...session!, email: fromId });
      return fromId;
    }

    if (session?.accessToken) {
      const fromUserInfo = await fetchUserInfoEmail(session.accessToken);
      if (fromUserInfo) {
        saveSession({ ...session, email: fromUserInfo });
        return fromUserInfo;
      }
    }

    return null;
  },

  logout() {
    clearSession();
  },

  debugAuthConfig() {
    return {
      clientIdPresent: !!CLIENT_ID,
      clientId: CLIENT_ID || '(vacío)',
      origin: typeof window !== 'undefined' ? window.location.origin : '(ssr)',
    };
  },
};
