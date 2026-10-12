import {NextResponse} from 'next/server';
import {hasLeadsFinderUserAccess} from '@/lib/server/leads-finder/access';
import {requireSessionOrTrustedInternalRequest} from '@/lib/server/request-auth';
import {hybridEnabled} from '@/lib/server/microworlds/contracts';
export const dynamic='force-dynamic';
export async function GET(request:Request){
  let available=false;try{const auth=await requireSessionOrTrustedInternalRequest(request);available=!hybridEnabled()&&auth.source==='session'&&Boolean(auth.organizationId)&&hasLeadsFinderUserAccess(auth.user);}catch{}
  return NextResponse.json({available},{headers:{'Cache-Control':'private, no-store, max-age=0'}});
}
