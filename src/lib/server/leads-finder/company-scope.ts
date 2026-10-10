import {createHmac,timingSafeEqual} from 'node:crypto';
import {normalizeDomainList} from '@/lib/domain';
import {z} from 'zod';
const schema=z.object({v:z.literal(1),user:z.string(),tenant:z.string(),id:z.string().min(1).max(200),domain:z.string().min(1).max(253),expires:z.number()}).strict();
function key(){const secret=process.env.INTERNAL_API_SECRET||process.env.SUPABASE_SERVICE_ROLE_KEY;if(!secret)throw Error('No se pudo fijar la empresa seleccionada.');return secret;}
export function issueCompanyScope(company:{id:string;primary_domain?:string|null;website_url?:string|null},scope:{userId:string;organizationId:string},now=Date.now()){
  const domain=normalizeDomainList([company.primary_domain||company.website_url||''])[0];if(!domain)return undefined;
  const payload=Buffer.from(JSON.stringify({v:1,user:scope.userId,tenant:scope.organizationId,id:company.id,domain,expires:now+24*3600000})).toString('base64url');
  return payload+'.'+createHmac('sha256',key()).update(payload).digest('base64url');
}
export function readCompanyScope(token:string,scope:{userId:string;organizationId:string},now=Date.now()){
  try{if(token.length>2000)throw Error();const [payload,signature,...extra]=token.split('.');if(extra.length||!signature)throw Error();
    const actual=Buffer.from(signature,'base64url'),expected=createHmac('sha256',key()).update(payload).digest();
    if(actual.length!==expected.length||!timingSafeEqual(actual,expected))throw Error();
    const decoded=schema.parse(JSON.parse(Buffer.from(payload,'base64url').toString('utf8')));
    if(decoded.user!==scope.userId||decoded.tenant!==scope.organizationId||decoded.expires<=now||normalizeDomainList([decoded.domain])[0]!==decoded.domain)throw Error();return decoded;
  }catch{throw Error('La selección de empresa venció o cambió. Busca las empresas de nuevo antes de continuar.');}
}
