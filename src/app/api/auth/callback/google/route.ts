import { NextRequest } from 'next/server';
import { finishProviderOAuth } from '@/lib/server/provider-oauth';

export async function GET(req: NextRequest) {
  return finishProviderOAuth(req, 'google');
}
