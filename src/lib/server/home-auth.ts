import {requireSessionRequestAuth} from './request-auth';
import {resolveActiveOrganization} from './organization-context';
import {AuthError} from './auth-utils';
/** Explicit user + selected tenant. A cookie changed in another tab cannot silently switch the request. */
export async function requireHomeAuth(request:Request){
  const session=await requireSessionRequestAuth(request);
  const requested=request.headers.get('x-organization-id')||null;
  const resolved=await resolveActiveOrganization(session.supabase,session.user.id,requested);
  if(!resolved.active||requested&&resolved.active.organizationId!==requested)throw new AuthError('Organización no disponible.',403);
  return {supabase:session.supabase,user:session.user,organizationId:resolved.active.organizationId};
}
