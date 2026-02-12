import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import dotenv from 'dotenv';

const ROOT = process.cwd();
dotenv.config({ path: path.join(ROOT, '.env.local') });
const API_ROOT = path.join(ROOT, 'src', 'app', 'api');
const PORT = Number(process.env.ANTONIA_TEST_PORT || 9013);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const ALLOW_HIGH_RISK = String(process.env.ALLOW_HIGH_RISK || '').toLowerCase() === 'true';
const CRON_SECRET = String(process.env.CRON_SECRET || '').trim();

const METHOD_ORDER = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];
const HIGH_RISK = new Set(['GET /api/cron/process-campaigns']);

const REQUEST_OVERRIDES = {
  'GET /api/debug/logs': {
    expected: [200],
  },
  'POST /api/debug/logs': {
    body: { name: 'smoke.log', payload: { source: 'endpoint-test' } },
    expected: [200],
  },
  'DELETE /api/debug/logs': {
    expected: [200],
  },
  'GET /api/auth/callback': {
    query: { next: '/' },
    expected: [302, 307],
  },
  'GET /api/auth/callback/google': {
    expected: [302, 307],
  },
  'GET /api/auth/callback/azure': {
    expected: [302, 307],
  },
  'GET /api/tracking/click': {
    query: { url: 'https://example.com' },
    expected: [302, 307],
  },
  'GET /api/tracking/open': {
    expected: [200],
  },
  'GET /api/cron/antonia': {
    query: { dryRun: true },
    headers: CRON_SECRET ? { 'x-cron-secret': CRON_SECRET } : {},
    expected: [200],
  },
  'GET /api/cron/process-campaigns': {
    query: { dryRun: true },
    expected: [200],
  },
  'GET /api/debug/apify-token': {
    expected: [200],
  },
  'GET /api/ai/health': {
    expected: [200],
  },
  'GET /api/leads/apify/status': {
    expected: [400],
  },
  'GET /api/opportunities/status': {
    expected: [400],
  },
  'GET /api/quota/status': {
    headers: { 'x-user-id': 'smoke-test-user' },
    expected: [200],
  },
  'POST /api/leads/search': {
    headers: { 'x-user-id': 'smoke-test-user' },
    body: {},
    expected: [400],
  },
  'POST /api/research/n8n': {
    body: {},
    expected: [400],
  },
  'POST /api/tracking/webhook': {
    body: [
      {
        event: 'open',
        email: 'smoke@example.com',
        timestamp: 1700000000,
      },
    ],
    expected: [200, 401],
  },
  'POST /api/tracking/unsubscribe': {
    body: {},
    expected: [400],
  },
  'POST /api/webhooks/apollo': {
    body: {},
    expected: [400],
  },
  'POST /api/contact/bulk-send': {
    body: {},
    expected: [503],
  },
  'POST /api/scheduler/complete': {
    body: {},
    expected: [400],
  },
  'POST /api/scheduler/reply': {
    body: {},
    expected: [200],
  },
  'POST /api/outlook/send': {
    body: {},
    expected: [400],
  },

  // Agent/AI function checks (expected success)
  'POST /api/ai/generate-campaign': {
    body: {
      goal: 'Agendar reuniones comerciales B2B',
      companyName: 'ANTON.IA',
      targetAudience: 'Directores de Operaciones',
      language: 'es',
    },
    expected: [200],
  },
  'POST /api/ai/generate-phone-script': {
    body: {
      report: {
        pains: ['Procesos manuales lentos'],
        leadContext: {
          profileSummary: 'Lidera operaciones y mejora continua',
        },
      },
      companyProfile: {
        name: 'ANTON.IA',
        services: 'Automatizacion de procesos y outreach',
      },
      lead: {
        fullName: 'Juan Perez',
        title: 'Gerente de Operaciones',
        country: 'Chile',
      },
    },
    expected: [200],
  },
  'POST /api/ai/enhance-report': {
    body: {
      rawReport: { summary: 'Reporte inicial' },
      normalizedReport: { summary: 'Reporte normalizado' },
      companyProfile: { name: 'ANTON.IA' },
      lead: { name: 'Lead Demo' },
    },
    expected: [200],
  },
  'POST /api/ai/outreach-from-report': {
    body: {
      mode: 'services',
      companyProfile: {
        name: 'ANTON.IA',
        services: 'Automatizacion de prospeccion',
      },
      lead: {
        name: 'Maria Gonzalez',
        title: 'CMO',
      },
      report: {
        pains: ['Baja tasa de respuesta por email'],
      },
    },
    expected: [200],
  },
  'POST /api/email/render': {
    body: {
      templateId: 'seed-leads-1',
      mode: 'leads',
      aiIntensity: 'none',
      tone: 'professional',
      length: 'short',
      data: {
        companyProfile: {
          name: 'ANTON.IA',
          services: 'Automatizacion',
          valueProposition: 'Mejoramos conversion',
        },
        report: {
          pains: ['Seguimiento manual'],
        },
        lead: {
          name: 'Camila Torres',
          company: 'Empresa X',
        },
      },
    },
    expected: [200],
  },
  'POST /api/email/bulk-edit': {
    body: {
      instruction: 'Haz el correo mas directo y agrega una CTA de 15 minutos.',
      drafts: [
        {
          subject: 'Colaboracion para Empresa X',
          body: 'Hola {{lead.firstName}}, me gustaria conversar contigo.',
          lead: {
            id: 'lead-1',
            fullName: 'Camila Torres',
            companyName: 'Empresa X',
            email: 'camila@empresax.com',
          },
        },
      ],
    },
    expected: [200],
  },
  'POST /api/email/style/chat': {
    body: {
      mode: 'leads',
      messages: [
        {
          role: 'user',
          content: 'Quiero un estilo mas consultivo y breve para C-level.',
        },
      ],
      sampleData: {
        companyProfile: {
          name: 'ANTON.IA',
          services: 'Automatizacion comercial',
        },
        lead: {
          name: 'Camila Torres',
          title: 'CMO',
        },
        report: {
          pains: ['Escalabilidad comercial'],
        },
      },
    },
    expected: [200],
  },
};

function toPosix(p) {
  return p.split(path.sep).join('/');
}

function summarizeBody(text) {
  const cleaned = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';
  return cleaned.slice(0, 220);
}

function statusIsExpected(status, expected) {
  if (!expected || expected.length === 0) return status < 500;
  return expected.includes(status);
}

async function walkRoutes(dir) {
  const out = [];
  const items = await fs.readdir(dir, { withFileTypes: true });
  for (const item of items) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) {
      out.push(...(await walkRoutes(full)));
      continue;
    }
    if (item.isFile() && item.name === 'route.ts') {
      out.push(full);
    }
  }
  return out;
}

async function discoverTests() {
  const files = await walkRoutes(API_ROOT);
  const tests = [];

  for (const file of files) {
    const src = await fs.readFile(file, 'utf8');
    const methods = [...src.matchAll(/export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS)\s*\(/g)]
      .map((m) => m[1]);

    if (!methods.length) continue;

    const relDir = toPosix(path.relative(API_ROOT, path.dirname(file)));
    const endpoint = relDir ? `/api/${relDir}` : '/api';

    for (const method of methods) {
      const key = `${method} ${endpoint}`;
      tests.push({ method, endpoint, key, file: toPosix(path.relative(ROOT, file)) });
    }
  }

  tests.sort((a, b) => {
    if (a.endpoint === b.endpoint) {
      return METHOD_ORDER.indexOf(a.method) - METHOD_ORDER.indexOf(b.method);
    }
    return a.endpoint.localeCompare(b.endpoint);
  });

  return tests;
}

function buildUrl(endpoint, query) {
  const url = new URL(`${BASE_URL}${endpoint}`);
  if (query && typeof query === 'object') {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) continue;
      url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

async function runOne(test) {
  const override = REQUEST_OVERRIDES[test.key] || {};
  const url = buildUrl(test.endpoint, override.query);
  const headers = { ...(override.headers || {}) };

  const init = {
    method: test.method,
    headers,
    redirect: 'manual',
    signal: AbortSignal.timeout(45000),
  };

  const isBodyMethod = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(test.method);
  if (isBodyMethod) {
    if (!headers['Content-Type'] && !headers['content-type']) {
      headers['Content-Type'] = 'application/json';
    }
    const body = Object.prototype.hasOwnProperty.call(override, 'body') ? override.body : {};
    init.body = JSON.stringify(body);
  }

  const startedAt = Date.now();
  try {
    const res = await fetch(url, init);
    const text = await res.text().catch(() => '');
    const durationMs = Date.now() - startedAt;

    const expected = override.expected;
    const ok = statusIsExpected(res.status, expected);

    return {
      ...test,
      ok,
      skipped: false,
      status: res.status,
      expected: expected || '<500',
      durationMs,
      responsePreview: summarizeBody(text),
      location: res.headers.get('location') || '',
    };
  } catch (error) {
    return {
      ...test,
      ok: false,
      skipped: false,
      status: 0,
      expected: override.expected || '<500',
      durationMs: Date.now() - startedAt,
      responsePreview: String(error?.message || error),
      location: '',
    };
  }
}

async function waitForServer() {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE_URL}/api/ai/health`, {
        method: 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(4000),
      });
      if (res.status > 0) return true;
    } catch {
      // ignore and retry
    }
    await new Promise((r) => setTimeout(r, 1200));
  }
  return false;
}

async function main() {
  const tests = await discoverTests();
  console.log(`[antonia-endpoints] discovered: ${tests.length} method handlers`);

  const cmd = process.execPath;
  const nextBin = path.join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next');
  const args = [nextBin, 'dev', '-p', String(PORT)];

  const server = spawn(cmd, args, {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      ANTONIA_FIREBASE_TICK_URL: '',
      ANTONIA_FIREBASE_TICK_SECRET: '',
      ANTONIA_NEXT_BACKUP_PROCESSING: 'false',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const recentLogs = [];
  const capture = (chunk, side) => {
    const text = String(chunk || '');
    const lines = text.split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      recentLogs.push(`[${side}] ${line}`);
      if (recentLogs.length > 120) recentLogs.shift();
    }
  };

  server.stdout.on('data', (chunk) => capture(chunk, 'dev'));
  server.stderr.on('data', (chunk) => capture(chunk, 'err'));

  let ready = false;
  try {
    ready = await waitForServer();
    if (!ready) {
      console.log('[antonia-endpoints] server did not become ready');
      console.log(recentLogs.join('\n'));
      process.exitCode = 1;
      return;
    }

    const results = [];
    for (const test of tests) {
      const override = REQUEST_OVERRIDES[test.key] || {};
      const dryRunParam = String(override?.query?.dryRun || '').toLowerCase();
      const isSafeDryRun = dryRunParam === '1' || dryRunParam === 'true' || dryRunParam === 'yes';

      if (HIGH_RISK.has(test.key) && !ALLOW_HIGH_RISK && !isSafeDryRun) {
        results.push({
          ...test,
          ok: true,
          skipped: true,
          status: -1,
          expected: 'SKIPPED_HIGH_RISK',
          durationMs: 0,
          responsePreview: 'Skipped to avoid accidental live sends. Set ALLOW_HIGH_RISK=true to run.',
          location: '',
        });
        continue;
      }

      const result = await runOne(test);
      results.push(result);
      const marker = result.ok ? 'PASS' : 'FAIL';
      console.log(`${marker} ${result.key} -> ${result.status} (${result.durationMs}ms)`);
    }

    const failed = results.filter((r) => !r.ok && !r.skipped);
    const skipped = results.filter((r) => r.skipped);
    const passed = results.filter((r) => r.ok && !r.skipped);

    const report = {
      generatedAt: new Date().toISOString(),
      baseUrl: BASE_URL,
      discoveredHandlers: tests.length,
      passed: passed.length,
      failed: failed.length,
      skipped: skipped.length,
      allowHighRisk: ALLOW_HIGH_RISK,
      failures: failed.map((r) => ({
        key: r.key,
        status: r.status,
        expected: r.expected,
        responsePreview: r.responsePreview,
      })),
      results,
    };

    const outPath = path.join(ROOT, 'scripts', 'antonia-endpoint-test-report.json');
    await fs.writeFile(outPath, JSON.stringify(report, null, 2), 'utf8');

    console.log('\n[antonia-endpoints] summary');
    console.log(`passed=${passed.length} failed=${failed.length} skipped=${skipped.length}`);
    console.log(`[antonia-endpoints] report: ${toPosix(path.relative(ROOT, outPath))}`);

    if (failed.length > 0) {
      process.exitCode = 1;
    }
  } finally {
    if (!server.killed) {
      server.kill('SIGTERM');
    }
  }
}

main().catch((error) => {
  console.error('[antonia-endpoints] fatal:', error);
  process.exitCode = 1;
});
