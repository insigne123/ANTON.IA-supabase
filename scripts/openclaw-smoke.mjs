#!/usr/bin/env node
/* eslint-disable no-console */

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

for (const candidate of ['.env.local', '.env']) {
  const fullPath = path.resolve(process.cwd(), candidate);
  if (fs.existsSync(fullPath)) {
    dotenv.config({ path: fullPath, override: false });
  }
}

const baseUrl = (process.argv[2] || process.env.OPENCLAW_BASE_URL || 'http://localhost:9003').replace(/\/$/, '');
const apiKey = String(
  process.env.OPENCLAW_API_KEY ||
    String(process.env.OPENCLAW_API_KEYS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)[0] ||
    ''
).trim();

if (!apiKey) {
  console.error('[openclaw-smoke] Missing OPENCLAW_API_KEY in environment');
  process.exit(1);
}

async function request(path, options = {}) {
  const url = `${baseUrl}${path}`;
  const started = Date.now();
  const response = await fetch(url, options);
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  const elapsed = Date.now() - started;
  return {
    ok: response.ok,
    status: response.status,
    elapsed,
    data,
    url,
  };
}

function printResult(name, result) {
  const prefix = result.ok ? 'OK' : 'ERR';
  console.log(`[${prefix}] ${name} ${result.status} (${result.elapsed}ms) -> ${result.url}`);
  if (!result.ok) {
    console.log(JSON.stringify(result.data, null, 2));
  }
}

async function main() {
  console.log(`[openclaw-smoke] Base URL: ${baseUrl}`);

  const exchange = await request('/api/openclaw/v1/auth/exchange', {
    method: 'POST',
    headers: {
      'x-openclaw-key': apiKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify({}),
  });
  printResult('auth/exchange', exchange);

  if (!exchange.ok || !exchange.data?.data?.token) {
    console.error('[openclaw-smoke] Cannot continue without bearer token');
    process.exit(1);
  }

  const token = exchange.data.data.token;
  const authHeaders = {
    Authorization: `Bearer ${token}`,
    'content-type': 'application/json',
  };

  const checks = [
    ['whoami', '/api/openclaw/v1/whoami'],
    ['overview', '/api/openclaw/v1/overview'],
    ['missions', '/api/openclaw/v1/antonia/missions?limit=5'],
    ['tasks', '/api/openclaw/v1/antonia/tasks?limit=5'],
    ['leads', '/api/openclaw/v1/leads?limit=5'],
    ['campaigns', '/api/openclaw/v1/campaigns?limit=5'],
    ['contacted-leads', '/api/openclaw/v1/contacted-leads?limit=5'],
    ['quotas', '/api/openclaw/v1/quotas'],
    ['unsubscribes', '/api/openclaw/v1/unsubscribes?limit=5'],
    ['blocked-domains', '/api/openclaw/v1/blocked-domains?limit=5'],
  ];

  let failed = 0;
  for (const [name, path] of checks) {
    const res = await request(path, {
      method: 'GET',
      headers: authHeaders,
    });
    printResult(name, res);
    if (!res.ok) failed += 1;
  }

  if (failed > 0) {
    console.error(`[openclaw-smoke] Completed with ${failed} failed checks`);
    process.exit(1);
  }

  console.log('[openclaw-smoke] All checks passed');
}

main().catch((error) => {
  console.error('[openclaw-smoke] Fatal error:', error?.message || error);
  process.exit(1);
});
