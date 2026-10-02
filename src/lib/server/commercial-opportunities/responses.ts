import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { AuthError, handleAuthError } from '@/lib/server/auth-utils';
import { HiringSyncError } from './sync';

const headers = { 'Cache-Control': 'private, no-store' };

export function opportunitiesJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers });
}

/** The routes answer in Spanish and never pass a provider's or the database's message through unchanged. */
export function opportunitiesError(error: unknown) {
  if (error instanceof AuthError) {
    const response = handleAuthError(error);
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  }
  if (error instanceof HiringSyncError) return opportunitiesJson({ error: error.message }, error.status);
  if (error instanceof ZodError) return opportunitiesJson({ error: error.issues[0]?.message || 'Revisa los datos.' }, 400);
  console.error('[commercial-opportunities] route failed:', error);
  const message = error instanceof Error && error.message.startsWith('No se pudo') ? error.message : 'No se pudo completar la acción. Intenta de nuevo.';
  return opportunitiesJson({ error: message }, 500);
}
