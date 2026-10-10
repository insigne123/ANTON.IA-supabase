import { requireSessionRequestAuth, RequestAuthError } from './request-auth';
import { resolveActiveOrganization } from './organization-context';
import { getSupabaseAdminClient } from './supabase-admin';
import { AdminDashboardAuthError } from './admin-dashboard-auth';

export function isPlatformUsageAdmin(user: {id:string;email_confirmed_at?:string|null}, environment:Record<string,string|undefined>=process.env) {
  // Separate capability: the existing credit-operator email list does not grant cross-company analytics.
  return Boolean(user.email_confirmed_at && (environment.ADMIN_USAGE_PLATFORM_USER_IDS||'').split(',').map(id=>id.trim()).filter(Boolean).includes(user.id));
}
export type UsageAccess = { userId:string; platform:boolean; activeOrganizationId:string|null; organizationIds:string[];
  organizationAdmin:boolean; supabase:ReturnType<typeof getSupabaseAdminClient> };
export async function requireAdminUsageAccess(request?:Request):Promise<UsageAccess> {
  let session;
  try { session=await requireSessionRequestAuth(request); }
  catch(error) { if(error instanceof RequestAuthError)throw new AdminDashboardAuthError('Inicia sesión para abrir Administración.',error.status);throw error; }
  if(!session.user.email_confirmed_at)throw new AdminDashboardAuthError('Confirma tu correo para abrir Administración.',403);
  const platform=isPlatformUsageAdmin(session.user),admin=getSupabaseAdminClient();
  const resolved=await resolveActiveOrganization(session.supabase,session.user.id);
  const activeOrganizationId=resolved.active?.organizationId||null;
  let organizationAdmin=false;
  if(activeOrganizationId){
    const checked=await admin.from('organization_members').select('role').eq('user_id',session.user.id).eq('organization_id',activeOrganizationId).maybeSingle();
    if(checked.error)throw new AdminDashboardAuthError('No pudimos comprobar el acceso administrativo.',503);
    organizationAdmin=['owner','admin'].includes(checked.data?.role||'');
  }
  if(!platform && !organizationAdmin)throw new AdminDashboardAuthError('Necesitas administrar esta organización para ver sus resultados.',403);
  return {userId:session.user.id,platform,activeOrganizationId,organizationIds:activeOrganizationId?[activeOrganizationId]:[],organizationAdmin,supabase:admin};
}
export function authorizedUsageScope(access:UsageAccess,requested?:string) {
  const selected=requested||(access.platform?'all':access.activeOrganizationId||'');
  if(selected==='all'&&!access.platform || selected!=='all'&&!access.platform&&selected!==access.activeOrganizationId)
    throw new AdminDashboardAuthError('No puedes consultar otra empresa.',403);
  return selected;
}
