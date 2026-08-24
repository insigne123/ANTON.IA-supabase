import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json(
    { error: 'Este endpoint fue reemplazado por /api/providers/send para garantizar idempotencia.' },
    { status: 410 },
  );
}
