// Servicio MSAL con inicialización (v3), chequeo pasivo de sesión y consentimiento incremental
import {
  PublicClientApplication,
  InteractionRequiredAuthError,
  LogLevel,
  type AccountInfo,
  type Configuration,
} from '@azure/msal-browser';

const clientId = process.env.NEXT_PUBLIC_AZURE_AD_CLIENT_ID!;
// Para organizaciones (AAD) por defecto. Si el cliente te da su tenant, usa el GUID aquí.
const tenantId = process.env.NEXT_PUBLIC_AZURE_AD_TENANT_ID || 'organizations';

// 1) Calcula el redirect en runtime del navegador
function getRedirectUri(isSsr = false): string {
  if (isSsr || typeof window === 'undefined') return 'about:blank'; // evita SSR
  const fromEnv = process.env.NEXT_PUBLIC_AZURE_AD_REDIRECT_URI?.trim();
  return fromEnv && /^https?:\/\//i.test(fromEnv)
    ? fromEnv
    : `${window.location.origin}/outlook`;
}

// 2) Construye la config cuando realmente instanciamos MSAL
function buildMsalConfig(): Configuration {
  const redirectUri = getRedirectUri();
  console.info('[MSAL] redirectUri en uso =>', redirectUri);
  return {
    auth: {
      clientId,
      authority: `https://login.microsoftonline.com/${tenantId}`,
      redirectUri: getRedirectUri(),
      postLogoutRedirectUri: getRedirectUri(),
      navigateToLoginRequestUrl: false,
    },
    cache: {
      cacheLocation: 'sessionStorage' as const,
      storeAuthStateInCookie: false,
    },
    system: {
      loggerOptions: {
        logLevel: LogLevel.Verbose,
        piiLoggingEnabled: false,
        loggerCallback: (level, message, containsPii) => {
          if (containsPii) return;
          const TAG = '[MSAL]';
          if (level === LogLevel.Error) console.error(TAG, message);
          else if (level === LogLevel.Warning) console.warn(TAG, message);
          else if (level === LogLevel.Info) console.info(TAG, message);
          else console.debug(TAG, message);
        },
      },
    },
  };
}

export const SCOPES = {
  BASE: ['User.Read'] as const,   // login
  SEND: ['Mail.Send'] as const,   // enviar correo
  READ: ['Mail.Read'] as const,   // (opcional) tracking del propio buzón
};

class MicrosoftAuthService {
  private app: PublicClientApplication | null = null;
  private account: AccountInfo | null = null;
  private initPromise: Promise<void> | null = null;

  private getApp() {
    if (!this.app) {
      if (!clientId) throw new Error('[MSAL] Falta NEXT_PUBLIC_AZURE_AD_CLIENT_ID');
      this.app = new PublicClientApplication(buildMsalConfig());
    }
    return this.app;
  }

  /** MSAL v3: debe llamarse initialize() antes de usar */
  private async ensureInit() {
    const app = this.getApp();
    if (!this.initPromise) this.initPromise = app.initialize();
    await this.initPromise;
  }

  private hydrateAccount() {
    if (this.account) return this.account;
    const accs = this.getApp().getAllAccounts();
    if (accs.length) this.account = accs[0];
    return this.account;
  }

  /** Chequeo pasivo: NO inicia login ni abre popup */
  async isSignedIn(): Promise<boolean> {
    await this.ensureInit();
    return this.getApp().getAllAccounts().length > 0;
  }

  /** Login explícito: SOLO cuando el usuario hace clic en el botón */
  async login(): Promise<AccountInfo> {
    await this.ensureInit();
    const acc = this.hydrateAccount();
    if (acc) return acc;
    try {
      const res = await this.getApp().loginPopup({
        scopes: [...SCOPES.BASE],
        redirectUri: getRedirectUri(), // <— forzamos absoluto
      });
      this.account = res.account!;
      return this.account!;
    } catch (err) {
      console.warn('[MSAL] loginPopup falló; usando loginRedirect…', err);
      await this.getApp().loginRedirect({
        scopes: [...SCOPES.BASE],
        redirectUri: getRedirectUri(), // <— idem
      });
      throw new Error('Redirigiendo a Microsoft para completar el login…');
    }
  }

  async logout() {
    await this.ensureInit();
    const acc = this.hydrateAccount();
    if (!acc) return;
    try {
      await this.getApp().logoutPopup({ account: acc });
    } catch {
      await this.getApp().logoutRedirect();
    }
    this.account = null;
  }

  async getAccessToken(scopes: readonly string[]): Promise<string> {
    await this.ensureInit();
    const app = this.getApp();
    const account = this.hydrateAccount() ?? (await this.login());
    try {
      const silent = await app.acquireTokenSilent({ account, scopes: [...scopes] });
      return silent.accessToken;
    } catch (e) {
      if (e instanceof InteractionRequiredAuthError) {
        try {
          const interactive = await app.acquireTokenPopup({
            scopes: [...scopes],
            redirectUri: getRedirectUri(), // <— idem
          });
          return interactive.accessToken;
        } catch (err) {
          console.warn('[MSAL] acquireTokenPopup falló; usando acquireTokenRedirect…', err);
          await app.acquireTokenRedirect({ scopes: [...scopes] });
          throw new Error('Redirigiendo a Microsoft para completar el consentimiento…');
        }
      }
      console.error('[MSAL] Error adquiriendo token', e);
      throw e;
    }
  }
  
  async getSendToken() {
    return this.getAccessToken(SCOPES.SEND);
  }
  
  async getReadToken() {
    return this.getAccessToken(SCOPES.READ);
  }

  /** Identidad ligera para trazabilidad/cabeceras (evita runtime errors en UI). */
  getUserIdentity(): { id: string|null; email: string|null; name: string|null; tenantId: string|null } {
    const acc = this.hydrateAccount();
    if (!acc) return { id: null, email: null, name: null, tenantId: null };
    const claims: any = acc.idTokenClaims || {};
    const email = (claims?.preferred_username || claims?.email || acc.username || null) as string | null;
    const name = (claims?.name || (acc as any).name || null) as string | null;
    const tid = (claims?.tid || null) as string | null;
    return { id: acc.homeAccountId || null, email, name, tenantId: tid };
  }

  /** Garantiza identidad: si no hay sesión, intenta login popup y devuelve identidad. */
  async ensureUserIdentity(): Promise<{ id: string|null; email: string|null; name: string|null; tenantId: string|null }> {
    await this.ensureInit();
    // hidrata si ya hay cuenta
    const got = this.getUserIdentity();
    if (got?.email || got?.id) return got;
    // intenta login explícito (el click del usuario gatilla esta acción)
    try {
      await this.login();
    } catch (e) {
      // loginRedirect arroja un error informativo; dejamos propagar para que la UI muestre el toast
      throw e;
    }
    return this.getUserIdentity();
  }
}

export const microsoftAuthService = new MicrosoftAuthService();

// Pequeña ayuda de diagnóstico para la UI
export function getMsalPublicInfo(isSsr = false) {
  return {
    clientId,
    tenantId,
    redirectUri: getRedirectUri(isSsr),
  };
}
