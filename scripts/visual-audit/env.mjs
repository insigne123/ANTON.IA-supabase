// The environment of the audited app, built from nothing: production's non-secret flags (apphosting.yaml) so pages look as
// they do for users, then local stand-ins for every URL, key and allowlist. No `.env*` file is read, and none may exist.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
export const SUPABASE_PORT = 54321;
export const APP_PORT = Number(process.env.AUDIT_APP_PORT || 9005);
export const SUPABASE_URL = `http://127.0.0.1:${SUPABASE_PORT}`;
// The browser uses «localhost» because Next builds redirect URLs with it; Chromium maps it to 127.0.0.1, where the app listens.
export const APP_URL = `http://localhost:${APP_PORT}`;
export const APP_LISTEN_URL = `http://127.0.0.1:${APP_PORT}`;
export const ANON_KEY = 'audit-anon';
export const SERVICE_KEY = 'audit-service';
export const DIST_DIR = '.next-audit';
// Every external service URL points here: a closed loopback port answers at once, and the egress guard blocks the rest.
const CLOSED = 'http://127.0.0.1:9';

const FORBIDDEN_ENV_FILES = ['.env', '.env.local', '.env.production', '.env.production.local', '.env.development', '.env.development.local'];

/** Next loads these on build and start; the audit must never run with real credentials, so it refuses to start. */
export function assertNoDotEnv() {
  const found = FORBIDDEN_ENV_FILES.filter(file => existsSync(path.join(ROOT, file)));
  if (found.length) {
    throw new Error(`La auditoría visual no corre con ${found.join(', ')} en la raíz: Next los cargaría. Muévelos fuera del repo o usa un worktree limpio.`);
  }
}

/** The fixed Cowork owner email, read from the code so it is not copied here. */
export function coworkOwnerEmail() {
  const source = readFileSync(path.join(ROOT, 'src/lib/cowork/access.ts'), 'utf8');
  const match = source.match(/COWORK_OWNER_EMAIL\s*=\s*'([^']+)'/);
  if (!match) throw new Error('No se encontró COWORK_OWNER_EMAIL en src/lib/cowork/access.ts');
  return match[1];
}

const SENSITIVE = /(KEY|SECRET|TOKEN|PASSWORD|TICKET|EMAILS|PRICING_JSON)/;
/** Production's plain values from apphosting.yaml: flags, models and limits. URLs, secrets and allowlists are left out. */
export function productionFlags() {
  const text = readFileSync(path.join(ROOT, 'apphosting.yaml'), 'utf8');
  const flags = {};
  for (const [, name, quoted] of text.matchAll(/-\s*variable:\s*(\S+)\s*\n\s*value:\s*("[^"\n]*"|'[^'\n]*'|[^\n]*)/g)) {
    const value = quoted.trim().replace(/^["']|["']$/g, '');
    if (SENSITIVE.test(name) || /https?:\/\//.test(value) || value.startsWith('{')) continue;
    flags[name] = value;
  }
  return flags;
}

export function buildEnv({ ownerId, ownerEmail }) {
  const keep = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'LANG', 'PLAYWRIGHT_BROWSERS_PATH'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
  return {
    ...keep,
    ...productionFlags(),
    NEXT_TELEMETRY_DISABLED: '1',
    NEXT_DIST_DIR: DIST_DIR,
    APP_ENV: 'test',
    NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
    SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON_KEY,
    SUPABASE_ANON_KEY: ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
    NEXT_PUBLIC_APP_URL: APP_URL,
    NEXT_PUBLIC_BASE_URL: APP_URL,
    CANONICAL_APP_URL: APP_URL,
    // The separate backend deployment: never the audited host, or the middleware would redirect every request to itself.
    BACKEND_HOSTED_APP_URL: CLOSED,
    NEXT_PUBLIC_AZURE_AD_REDIRECT_URI: `${APP_URL}/outlook`,
    NEXT_PUBLIC_GOOGLE_CLIENT_ID: 'audit-google-client',
    NEXT_PUBLIC_AZURE_AD_CLIENT_ID: '00000000-0000-4000-8000-0000000a0d17',
    ANTONIA_LEAD_SEARCH_URL: CLOSED,
    ANTONIA_LEAD_RESEARCH_URL: CLOSED,
    ENRICHMENT_SERVICE_URL: CLOSED,
    APOLLO_ORGANIZATION_ENRICHMENT_URL: CLOSED,
    APOLLO_USAGE_SERVICE_URL: CLOSED,
    COWORK_EXECUTOR_URL: CLOSED,
    COWORK_OWNER_USER_ID: ownerId,
    COWORK_INLINE_WAKE: 'false',
    ADMIN_DASHBOARD_ALLOWED_EMAILS: ownerEmail,
    OPPORTUNITIES_ALLOWED_EMAILS: ownerEmail,
    PRIVACY_ADMIN_EMAILS: ownerEmail,
    // Present so code paths that require them run, and useless anywhere else.
    OPENAI_API_KEY: 'audit-unused', COWORK_WORKER_SECRET: 'audit-unused', COWORK_EXECUTOR_SECRET: 'audit-unused',
    INTERNAL_API_SECRET: 'audit-unused', CRON_SECRET: 'audit-unused', FIREBASE_SCHEDULER_SECRET: 'audit-unused',
    TRACKING_WEBHOOK_SECRET: 'audit-unused', LEAD_RESEARCH_WORKER_SECRET: 'audit-unused', ENRICHMENT_SERVICE_SECRET: 'audit-unused',
  };
}
