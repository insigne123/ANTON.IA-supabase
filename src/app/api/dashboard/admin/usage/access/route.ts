import {NextRequest,NextResponse} from 'next/server';
import {requireAdminUsageAccess} from '@/lib/server/admin-usage-auth';
import {AdminDashboardAuthError} from '@/lib/server/admin-dashboard-auth';
export const dynamic='force-dynamic';
export async function GET(req:NextRequest){
  const headers={'Cache-Control':'private, no-store'};
  try{const access=await requireAdminUsageAccess(req);return NextResponse.json({canView:true,platform:access.platform},{headers});}
  catch(error){return NextResponse.json({canView:false},{status:error instanceof AdminDashboardAuthError?error.status:503,headers});}
}
