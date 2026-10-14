import { NextResponse } from 'next/server';
import { isFirebaseSchedulerRequest, firebaseSchedulerResponseHeaders } from '../_firebase-scheduler-auth';
import { isTrustedInternalRequest } from '@/lib/server/internal-api-auth';
import { runMirrorWorker } from '@/lib/server/microworlds/search';
import { recoverHybridFulfillment } from '@/lib/server/microworlds/fulfillment';
import { mirrorUsage } from '@/lib/server/microworlds/usage';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export async function POST(request:Request) {
  if(!isFirebaseSchedulerRequest(request))return NextResponse.json({error:'Unauthorized'},{status:401});
  try{return NextResponse.json({...await runMirrorWorker({limit:3}),...await recoverHybridFulfillment()},{headers:firebaseSchedulerResponseHeaders()});}
  catch{return NextResponse.json({error:'WORKER_UNAVAILABLE'},{status:503,headers:firebaseSchedulerResponseHeaders()});}
}
/** This month's and last month's mirror spend against contacts served from the cache. Internal secret only. */
export async function GET(request:Request) {
  if(!isTrustedInternalRequest(request))return NextResponse.json({error:'Unauthorized'},{status:401});
  const now=new Date(),last=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-1,1));
  try{return NextResponse.json({months:await Promise.all([now,last].map(date=>mirrorUsage(date.toISOString().slice(0,7))))});}
  catch{return NextResponse.json({error:'USAGE_UNAVAILABLE'},{status:503});}
}
