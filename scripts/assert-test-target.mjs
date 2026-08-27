import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const KNOWN_PRODUCTION_PROJECT_REFS = new Set([
  'yfdelflsheurzaicwayi',
]);

const LOCAL_HOSTS = new Set([
  '127.0.0.1',
  'localhost',
  '::1',
]);

function readValue(value) {
  return String(value || '').trim();
}

function readProjectRefFromUrl(value) {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    const match = hostname.match(/^([a-z0-9-]+)\.supabase\.co$/i);
    return match?.[1] || '';
  } catch {
    return '';
  }
}

function getProductionRefs(env) {
  const configured = readValue(env.SUPABASE_PRODUCTION_PROJECT_REFS);
  const refs = configured ? configured.split(',') : [];
  return new Set([...KNOWN_PRODUCTION_PROJECT_REFS, ...refs.map(readValue)].filter(Boolean));
}

export function assertSafeTestTarget(env = process.env) {
  const appEnv = readValue(env.APP_ENV).toLowerCase();
  const supabaseUrl = readValue(env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL);
  const testEnabled = readValue(env.TEST_DATABASE_ENABLED).toLowerCase() === 'true';

  if (!supabaseUrl) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL for the test target.');
  }

  let hostname = '';
  try {
    hostname = new URL(supabaseUrl).hostname.toLowerCase();
  } catch {
    throw new Error('Supabase test target URL is invalid.');
  }

  const projectRef = readProjectRefFromUrl(supabaseUrl);
  if (getProductionRefs(env).has(projectRef)) {
    throw new Error(`Refusing to run tests against the production Supabase project (${projectRef}).`);
  }

  if (!testEnabled) {
    throw new Error('TEST_DATABASE_ENABLED=true is required before database tests can run.');
  }

  if (LOCAL_HOSTS.has(hostname)) {
    if (!['local', 'test'].includes(appEnv)) {
      throw new Error('Local Supabase tests require APP_ENV=local or APP_ENV=test.');
    }
    return { kind: 'local', hostname, projectRef: null, supabaseUrl };
  }

  const expectedNonprodRef = readValue(env.SUPABASE_TEST_PROJECT_REF);
  if (appEnv !== 'staging') {
    throw new Error('Remote database tests require APP_ENV=staging.');
  }
  if (!expectedNonprodRef || projectRef !== expectedNonprodRef) {
    throw new Error('Remote database tests require the configured nonproduction project ref.');
  }

  return { kind: 'nonprod', hostname, projectRef, supabaseUrl };
}

const isDirectRun = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  try {
    const target = assertSafeTestTarget();
    console.log(`[test-target] Safe ${target.kind} Supabase target: ${target.hostname}`);
  } catch (error) {
    console.error(`[test-target] ${error.message}`);
    process.exitCode = 1;
  }
}
