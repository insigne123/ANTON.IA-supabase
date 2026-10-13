import { NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { firebaseSchedulerResponseHeaders, isFirebaseSchedulerRequest } from '../_firebase-scheduler-auth';
import { enqueueDailyOpportunityWork, opportunityWorkerTick } from '@/lib/server/commercial-opportunities/workspace-jobs';
import { opportunityWorkspaceEnabled } from '@/lib/commercial-opportunities/workspace';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;
export async function POST(request: Request) {
  const headers = firebaseSchedulerResponseHeaders();
  if (!isFirebaseSchedulerRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers });
  if (!opportunityWorkspaceEnabled()) return NextResponse.json({ disabled: true, processed: 0 }, { headers });
  try {
    const client = getSupabaseAdminClient();
    await enqueueDailyOpportunityWork(client);
    const started=Date.now();const results=[];
    for(let i=0;i<6 && Date.now()-started<40_000;i++){
      const result=await opportunityWorkerTick(client);results.push(result);if(!result.processed)break;
    }
    return NextResponse.json({processed:results.reduce((n,r)=>n+r.processed,0),results}, { headers });
  } catch { return NextResponse.json({ error: 'No se pudo continuar el trabajo de Oportunidades.' }, { status: 503, headers }); }
}
