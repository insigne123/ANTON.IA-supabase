import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { resolve, dirname, basename } from 'node:path';
import { validateJob, hashJobRequest } from './validate.mjs';
import { runJob } from './runner.mjs';
import { createJobManager } from './jobs.mjs';
import { execFile } from 'node:child_process';

/** Cowork executor HTTP app (importable for tests). */
const MAX_BODY_BYTES = 24 * 1024 * 1024;

const log = record => console.log(JSON.stringify({ service: 'cowork-executor', at: new Date().toISOString(), ...record }));

function authorized(header, secret) {
  if (!secret || typeof header !== 'string') return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(header.trim());
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function send(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(payload) });
  response.end(payload);
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('Body exceeds 24 MB.'), { statusCode: 413 }));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(Object.assign(new Error('Body must be JSON.'), { statusCode: 422 }));
      }
    });
    request.on('error', reject);
  });
}

export function createApp({ store, config, run = runJob, now = Date.now } = {}) {
  const readSecret = () => readFile(config.secretFile, 'utf8').then(value => value.trim()).catch(() => '');
  let busy = false;
  const stop = container => new Promise((resolve, reject) => execFile('docker', ['rm', '-f', container], { timeout: 10000 }, (error, _out, err) => {
    if (error && !/No such container/i.test(err || '')) reject(error); else resolve();
  }));
  const cleanup = async directory => {
    const target = resolve(directory);
    if (dirname(target) !== resolve(config.baseDir) || !/^job-\d+-\d+-[A-Za-z0-9]+$/.test(basename(target))) throw new Error('Invalid restart workspace');
    await rm(target, { recursive: true, force: true });
  };
  const jobs = createJobManager({ store, run, baseDir: config.baseDir, stop, cleanup, occupied: () => busy, clock: now });
  const initialized = jobs.init();
  const server = createServer(async (request, response) => {
    const started = now();
    try {
      const secret = await readSecret();
      if (!authorized(request.headers.authorization, secret)) {
        log({ event: 'denied', path: request.url });
        send(response, 401, { error: 'Unauthorized.' });
        return;
      }
      await initialized;
      if (request.method === 'GET' && request.url === '/v2/capabilities') {
        send(response, 200, { protocol: 2, provider: 'isolated-executor', languages: ['python', 'node'],
          asynchronous: true, durableJobs: true, cancellation: true, maxConcurrency: 1, maxTimeoutMs: 120000,
          network: false, outputBytes: 10485760, outputFiles: 16, toolchain: 'cowork-exec-1', privatePreviews: false }); return;
      }
      const operation = /^\/v2\/jobs\/([A-Za-z0-9_-]{8,128})(\/cancel)?$/.exec(request.url || '');
      if (operation && (request.method === 'GET' && !operation[2] || request.method === 'POST' && operation[2])) {
        const result = operation[2] ? await jobs.cancel(operation[1]) : await jobs.inspect(operation[1]);
        send(response, result ? 200 : 404, result || { error: 'Job not found.' }); return;
      }
      if (request.method === 'POST' && request.url === '/v2/jobs') {
        if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json') { send(response, 415, { error: 'Content-Type must be application/json.' }); return; }
        const result = await jobs.admit(await readBody(request));
        send(response, ['queued', 'running', 'cancel_requested'].includes(result.status) ? 202 : 200, result); return;
      }
      if (request.method === 'GET' && request.url === '/v1/health') {
        send(response, 200, { ok: true, busy: busy || jobs.busy() });
        return;
      }
      if (request.method !== 'POST' || request.url !== '/v1/jobs') {
        send(response, 404, { error: 'Not found.' });
        return;
      }
      if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json') {
        send(response, 415, { error: 'Content-Type must be application/json.' });
        return;
      }
      const job = validateJob(await readBody(request));
      const requestHash = hashJobRequest(job);
      const cached = await store.get(job.idempotencyKey);
      if (cached) {
        if (cached.requestHash !== requestHash) {
          send(response, 409, { error: 'Idempotency key reused with different content.' });
          return;
        }
        log({ event: 'replay', key: job.idempotencyKey.slice(0, 12), durationMs: now() - started });
        send(response, 200, { ...cached.result, reused: true });
        return;
      }
      if (busy || jobs.busy()) {
        send(response, 409, { error: 'Executor busy. Retry later.' });
        return;
      }
      busy = true;
      try {
        log({ event: 'start', key: job.idempotencyKey.slice(0, 12), language: job.language, inputBytes: job.inputBytes });
        const result = await run(job, { baseDir: config.baseDir });
        await store.set(job.idempotencyKey, { requestHash, result });
        log({ event: 'done', key: job.idempotencyKey.slice(0, 12), status: result.status, durationMs: result.durationMs });
        send(response, 200, { ...result, reused: false });
      } finally {
        busy = false;
      }
    } catch (error) {
      const status = error?.statusCode && Number.isInteger(error.statusCode) ? error.statusCode : 500;
      if (status === 500) log({ event: 'error', message: String(error?.message || error).slice(0, 200) });
      try {
        send(response, status, { error: status === 500 ? 'Internal error.' : String(error?.message || 'Invalid request.').slice(0, 300) });
      } catch {
        // Client already gone.
      }
    }
  });
  return server;
}
