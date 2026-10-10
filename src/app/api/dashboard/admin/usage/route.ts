import {NextRequest,NextResponse} from 'next/server';
import {usageQuerySchema} from '@/lib/admin/usage';
import {lastDaysInZone} from '@/lib/admin/chile-time';
import {requireAdminUsageAccess} from '@/lib/server/admin-usage-auth';
import {loadAdminUsage} from '@/lib/server/admin-usage-data';
import {AdminDashboardAuthError} from '@/lib/server/admin-dashboard-auth';
export const dynamic='force-dynamic';
export async function GET(req:NextRequest){
  const headers={'Cache-Control':'private, no-store'};
  try{
    const access=await requireAdminUsageAccess(req),defaults=lastDaysInZone(30);
    const values=Object.fromEntries(req.nextUrl.searchParams);
    const query=usageQuerySchema.safeParse({...defaults,...values});
    if(!query.success)return NextResponse.json({error:'Revisa las fechas y el alcance seleccionado.'},{status:400,headers});
    return NextResponse.json(await loadAdminUsage(access,query.data),{headers});
  }catch(error){if(error instanceof AdminDashboardAuthError)return NextResponse.json({error:error.message},{status:error.status,headers});
    console.warn('[admin-usage] report unavailable');return NextResponse.json({error:'No pudimos abrir el informe. Intenta nuevamente.'},{status:503,headers});}
}
