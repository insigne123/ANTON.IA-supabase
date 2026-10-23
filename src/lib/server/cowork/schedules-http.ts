import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { AuthError, handleAuthError } from '@/lib/server/auth-utils';
import { CoworkScheduleError } from './schedules';

export const coworkScheduleHeaders = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };

/** What each failure of a scheduled-task route says to the person: a check they can fix, a limit, a task that is not theirs or a service that is down. */
export function coworkScheduleErrorResponse(error: unknown) {
  if (error instanceof AuthError) return handleAuthError(error);
  const headers = coworkScheduleHeaders;
  if (error instanceof ZodError) return NextResponse.json({ error: error.issues[0]?.message || 'Revisa los datos de la tarea.' }, { status: 400, headers });
  if (error instanceof CoworkScheduleError) {
    const status = error.code === 'NOT_FOUND' ? 404 : error.code === 'LIMIT' ? 409 : 503;
    return NextResponse.json({ error: error.message }, { status, headers });
  }
  return NextResponse.json({ error: 'No pudimos atender las tareas programadas. Inténtalo de nuevo.' }, { status: 503, headers });
}

export const coworkSchedulesOffResponse = () =>
  NextResponse.json({ error: 'Las tareas programadas todavía no están disponibles.' }, { status: 404, headers: coworkScheduleHeaders });
