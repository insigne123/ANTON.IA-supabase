import {NextResponse} from 'next/server';
import {requireHomeAuth} from '@/lib/server/home-auth';
import {getSupabaseAdminClient} from '@/lib/server/supabase-admin';
import {handleAuthError} from '@/lib/server/auth-utils';
import {requestAuthErrorResponse} from '@/lib/server/request-auth';
import {homeScope} from '@/lib/home/scope';
export async function GET(request:Request){
  const headers={'Cache-Control':'private, no-store'};
  try{const {user,organizationId}=await requireHomeAuth(request);const day=new Date().toISOString().slice(0,10);
    const result=await getSupabaseAdminClient().rpc('get_antonia_credit_status_v2',{p_user_id:user.id,p_organization_id:organizationId,p_day:day});
    if(result.error)throw Error('No pudimos comprobar tu cupo.');
    const c=result.data;
    const personal=c.mode==='team'?null:{count:c.user_count??c.count,limit:c.user_limit??c.limit};
    const available=personal?Math.max(0,Math.min(personal.limit-personal.count,c.limit-c.count)):null;
    return NextResponse.json({scope:homeScope(user.id,organizationId),personal,available,
      resetAtISO:new Date(Date.parse(day+'T00:00:00Z')+86400000).toISOString(),legacy:c.legacy===true,mode:c.mode},{headers});
  }catch(error){return requestAuthErrorResponse(error)||handleAuthError(error);}
}
