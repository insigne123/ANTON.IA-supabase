import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Disk-backed idempotency store: a retry with the same key returns the saved
 * result instead of re-executing. Entries expire after 24 h; total size and
 * count are capped with oldest-first pruning. */

export function createResultStore({ dir, ttlMs = 24 * 60 * 60 * 1000, maxEntries = 200, maxBytes = 500 * 1024 * 1024 }) {
  const safeKey = key => {
    if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(key)) return null;
    return key;
  };
  async function prune(now) {
    let entries = [];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const metas = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const full = join(dir, entry.name);
      try {
        const content = JSON.parse(await readFile(full, 'utf8'));
        metas.push({ full, at: content.storedAt || 0, size: content.size || 0 });
      } catch {
        await rm(full, { force: true });
      }
    }
    // Expired first, then oldest-first until count and size fit.
    for (const meta of metas) {
      if (now - meta.at > ttlMs) await rm(meta.full, { force: true });
    }
    let live = [];
    for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const full = join(dir, entry.name);
      try {
        const content = JSON.parse(await readFile(full, 'utf8'));
        live.push({ full, at: content.storedAt || 0, size: content.size || 0 });
      } catch {
        await rm(full, { force: true });
      }
    }
    live.sort((a, b) => a.at - b.at);
    let total = live.reduce((sum, meta) => sum + meta.size, 0);
    while (live.length > maxEntries || total > maxBytes) {
      const oldest = live.shift();
      if (!oldest) break;
      await rm(oldest.full, { force: true });
      total -= oldest.size;
    }
  }
  return {
    async init() {
      await mkdir(dir, { recursive: true });
      await prune(Date.now());
    },
    async get(key) {
      const safe = safeKey(key);
      if (!safe) return null;
      await prune(Date.now());
      try {
        const content = JSON.parse(await readFile(join(dir, `${safe}.json`), 'utf8'));
        if (Date.now() - content.storedAt > ttlMs || content.key !== safe) return null;
        return { ...content.result, reused: true };
      } catch {
        return null;
      }
    },
    async set(key, result) {
      const safe = safeKey(key);
      if (!safe) return;
      const payload = JSON.stringify({ key: safe, storedAt: Date.now(), size: 0, result });
      const sized = JSON.stringify({ key: safe, storedAt: Date.now(), size: Buffer.byteLength(payload, 'utf8'), result });
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, `${safe}.json`), sized, { mode: 0o600 });
      await prune(Date.now());
    },
  };
}
