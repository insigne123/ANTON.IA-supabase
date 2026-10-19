import {NextRequest,NextResponse} from 'next/server';
import {requireAdminUsageAccess} from '@/lib/server/admin-usage-auth';
import {AdminDashboardAuthError} from '@/lib/server/admin-dashboard-auth';
export const dynamic='force-dynamic';
export async function GET(req:NextRequest){
  const headers={'Cache-Control':'private, no-store'};
  try{const access=await requireAdminUsageAccess(req);return NextResponse.json({canView:true,platform:access.platform},{headers});}
  catch(error){
    // A member who does not administer is an answer, not a failure: the menu hides «Administración» (as /api/privacy/access).
    if(error instanceof AdminDashboardAuthError&&error.status===403)return NextResponse.json({canView:false},{headers});
    return NextResponse.json({canView:false},{status:error instanceof AdminDashboardAuthError?error.status:503,headers});
  }
}
