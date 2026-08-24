import { retiredLegacyRuntimeResponse } from '@/lib/server/legacy-runtime-retirement';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  return retiredLegacyRuntimeResponse('n8n-research');
}

export async function POST(): Promise<Response> {
  return retiredLegacyRuntimeResponse('n8n-research');
}
