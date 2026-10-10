import {NextRequest,NextResponse} from 'next/server';
import {z} from 'zod';
import {USAGE_MODULES} from '@/lib/admin/usage';
import {requireSessionRequestAuth,requestAuthErrorResponse} from '@/lib/server/request-auth';
import {resolveActiveOrganization} from '@/lib/server/organization-context';
import {getSupabaseAdminClient} from '@/lib/server/supabase-admin';
const schema=z.object({eventId:z.string().uuid(),sessionId:z.string().uuid(),organizationId:z.string().uuid(),
  module:z.enum(Object.keys(USAGE_MODULES) as [keyof typeof USAGE_MODULES,...Array<keyof typeof USAGE_MODULES>])}).strict();
export async function POST(req:NextRequest){
  const headers={'Cache-Control':'private, no-store'};
  try{
    if(Number(req.headers.get('content-length')||0)>2048)return NextResponse.json({error:'Solicitud demasiado grande.'},{status:413,headers});
    const text=await req.text();if(text.length>2048)return NextResponse.json({error:'Solicitud demasiado grande.'},{status:413,headers});
    let input;try{input=JSON.parse(text);}catch{return NextResponse.json({error:'Actividad inválida.'},{status:400,headers});}
    const body=schema.safeParse(input);if(!body.success)return NextResponse.json({error:'Actividad inválida.'},{status:400,headers});
    const auth=await requireSessionRequestAuth(req);
    const resolved=await resolveActiveOrganization(auth.supabase,auth.user.id,body.data.organizationId);
    if(!resolved.active||resolved.active.organizationId!==body.data.organizationId)return NextResponse.json({error:'Organización no disponible.'},{status:403,headers});
    const saved=await getSupabaseAdminClient().rpc('admin_record_usage_view_v1',{p_event:body.data.eventId,p_session:body.data.sessionId,p_org:resolved.active.organizationId,p_user:auth.user.id,p_module:body.data.module});
    if(saved.error)return NextResponse.json({recorded:false},{status:503,headers});
    return NextResponse.json({recorded:saved.data===true},{headers});
  }catch(error){return requestAuthErrorResponse(error)||NextResponse.json({recorded:false},{status:503,headers});}
}
