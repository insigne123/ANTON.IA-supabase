/** Input validation: every field is untrusted agent/user data. */
import { createHash } from 'node:crypto';

const MAX_CODE_BYTES = 64 * 1024;
const MAX_FILES = 8;
const MAX_INPUT_BYTES = 20 * 1024 * 1024;
const MAX_TIMEOUT_MS = 120_000;
const MIN_TIMEOUT_MS = 5_000;
const MAX_NAME_LENGTH = 120;
const MAX_KEY_LENGTH = 128;
const INPUT_EXTENSIONS = new Set(['csv', 'json', 'md', 'txt', 'xlsx']);
const LANGUAGE_PATTERN = /^(python|node)$/;
const KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

function fail(message) {
  const error = new Error(message);
  error.statusCode = 422;
  throw error;
}

export function sanitizeFileName(raw) {
  if (typeof raw !== 'string') fail('File name must be a string.');
  const name = raw.trim();
  if (!name || name.length > MAX_NAME_LENGTH) fail('File name has an invalid length.');
  if (name !== raw.trim() || name.includes('/') || name.includes('\\') || name.includes('\0')) {
    fail(`Invalid file name: ${name.slice(0, 40)}`);
  }
  if (name.startsWith('.')) fail('Hidden files are not allowed.');
  const dot = name.lastIndexOf('.');
  if (dot < 1) fail(`File needs an allowed extension: ${name.slice(0, 40)}`);
  const ext = name.slice(dot + 1).toLowerCase();
  if (!INPUT_EXTENSIONS.has(ext)) fail(`Extension not allowed: .${ext}`);
  return { name, ext };
}

function decodeFile(file) {
  const { name } = sanitizeFileName(file?.name);
  if (typeof file?.contentBase64 !== 'string') fail(`File ${name} needs base64 content.`);
  // Pre-check encoded length before allocating the buffer.
  if (file.contentBase64.length > MAX_INPUT_BYTES * 2) fail(`File ${name} exceeds the input budget.`);
  let bytes;
  try {
    bytes = Buffer.from(file.contentBase64, 'base64');
  } catch {
    fail(`File ${name} is not valid base64.`);
  }
  if (bytes.length === 0) fail(`File ${name} is empty.`);
  return { name, bytes };
}

export function validateJob(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('Body must be a JSON object.');
  const { idempotencyKey, language, code, files, timeoutMs } = body;
  if (typeof idempotencyKey !== 'string' || !KEY_PATTERN.test(idempotencyKey)) {
    fail('idempotencyKey must be 8-128 chars of [A-Za-z0-9_-].');
  }
  if (typeof language !== 'string' || !LANGUAGE_PATTERN.test(language)) fail('language must be python or node.');
  if (typeof code !== 'string' || code.length === 0) fail('code must be a non-empty string.');
  if (Buffer.byteLength(code, 'utf8') > MAX_CODE_BYTES) fail('code exceeds 64 KB.');
  if (/\0/.test(code)) fail('code contains null bytes.');
  const list = files === undefined ? [] : files;
  if (!Array.isArray(list)) fail('files must be an array.');
  if (list.length > MAX_FILES) fail(`At most ${MAX_FILES} files per job.`);
  const decoded = list.map(decodeFile);
  const total = decoded.reduce((sum, file) => sum + file.bytes.length, 0);
  if (total > MAX_INPUT_BYTES) fail('Input files exceed 20 MB in total.');
  const names = new Set(decoded.map(file => file.name));
  if (names.size !== decoded.length) fail('Duplicate file names.');
  let timeout = MAX_TIMEOUT_MS;
  if (timeoutMs !== undefined) {
    if (!Number.isInteger(timeoutMs) || timeoutMs < MIN_TIMEOUT_MS || timeoutMs > MAX_TIMEOUT_MS) {
      fail(`timeoutMs must be an integer between ${MIN_TIMEOUT_MS} and ${MAX_TIMEOUT_MS}.`);
    }
    timeout = timeoutMs;
  }
  return { idempotencyKey, language, code, files: decoded, inputBytes: total, timeoutMs: timeout };
}

export const LIMITS = { MAX_CODE_BYTES, MAX_FILES, MAX_INPUT_BYTES, MAX_TIMEOUT_MS };

/** Stable fingerprint of the request: reusing a key with different content
 * is a conflict, never a silent replay. */
export function hashJobRequest(job) {
  const hash = createHash('sha256');
  hash.update(job.language);
  hash.update('\0');
  hash.update(job.code);
  hash.update('\0');
  hash.update(String(job.timeoutMs));
  for (const file of job.files) {
    hash.update('\0');
    hash.update(file.name);
    hash.update('\0');
    hash.update(file.bytes);
  }
  return hash.digest('hex');
}
