// src/lib/apify-client.ts
import { ApifyClient } from 'apify-client';

const token = process.env.APIFY_TOKEN || '';

/**
 * Cliente único de Apify con validación de token y logs útiles.
 * Se usa solo desde rutas / server code.
 */
export function getApifyClient(): ApifyClient {
  if (!token) {
    console.warn('[apify] APIFY_TOKEN no está definido.');
  }
  return new ApifyClient({ token });
}

export function hasApifyAuth(): boolean {
  return Boolean(token && token.trim().length > 0);
}
