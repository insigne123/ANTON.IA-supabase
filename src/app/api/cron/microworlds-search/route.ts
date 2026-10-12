import { NextResponse } from 'next/server';
import { isFirebaseSchedulerRequest, firebaseSchedulerResponseHeaders } from '../_firebase-scheduler-auth';
import { runMirrorWorker } from '@/lib/server/microworlds/search';
import { recoverHybridFulfillment } from '@/lib/server/microworlds/fulfillment';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export async function POST(request:Request) {
  if(!isFirebaseSchedulerRequest(request))return NextResponse.json({error:'Unauthorized'},{status:401});
  try{return NextResponse.json({...await runMirrorWorker({limit:3}),...await recoverHybridFulfillment()},{headers:firebaseSchedulerResponseHeaders()});}
  catch{return NextResponse.json({error:'WORKER_UNAVAILABLE'},{status:503,headers:firebaseSchedulerResponseHeaders()});}
}
