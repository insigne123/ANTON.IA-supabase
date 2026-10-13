import { lookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { JSDOM } from 'jsdom';

/** Only cookies issued to this anonymous fetch session; never seed it from a user's browser. */
export type OpportunityPublicSession = { cookies: Map<string, Map<string, string>> };
export const createOpportunityPublicSession = (): OpportunityPublicSession => ({ cookies: new Map() });
type SourceOptions = { session?: OpportunityPublicSession; publicForm?: Record<string,string>; expectedName?: string };
const PUBLIC_READ_FORMS = new Set(['/Procurement/Modules/Attachment/VerAntecedentes.aspx','/Foros/Modules/FNormal/servicesPub.aspx']);
export function assertOpportunityPublicForm(url:URL,form:Record<string,string>) {
  if(url.protocol!=='https:'||url.hostname!=='www.mercadopublico.cl'||!PUBLIC_READ_FORMS.has(url.pathname))throw new Error('OPPORTUNITY_PUBLIC_FORM_REFUSED');
  if(url.pathname.includes('servicesPub')) {
    if(Object.keys(form).some(k=>!['opt','RFBCode'].includes(k))||form.opt!=='101'||!/^\d{1,12}$/.test(form.RFBCode||''))throw new Error('OPPORTUNITY_PUBLIC_FORM_REFUSED');
  } else {
    if(Object.keys(form).some(k=>!/^__(?:VIEWSTATE(?:\d+|GENERATOR|FIELDCOUNT)?|EVENTVALIDATION|EVENTTARGET|EVENTARGUMENT)$/.test(k)&&!/^grdAttachment\$ctl\d+\$grdIbtnView\.[xy]$/.test(k)))throw new Error('OPPORTUNITY_PUBLIC_FORM_REFUSED');
    if(!Object.keys(form).some(k=>/^grdAttachment\$ctl\d+\$grdIbtnView\.x$/.test(k)))throw new Error('OPPORTUNITY_PUBLIC_FORM_REFUSED');
  }
  if(Buffer.byteLength(new URLSearchParams(form).toString())>256000)throw new Error('OPPORTUNITY_PUBLIC_FORM_LARGE');
}

/** Bounded, DNS-pinned downloading; never forwards a user's cookie or a provider credential. */
export async function downloadOpportunitySource(value: string, options:SourceOptions={}) {
  const { nativeResearchInternals } = await import('@/lib/server/native-research');
  let url = new URL(value);
  const signal = AbortSignal.timeout(25_000);
  let form=options.publicForm;
  for (let redirects = 0; redirects < 4; redirects++) {
    if (url.protocol !== 'https:' || !nativeResearchInternals.isSafeOfficialSiteUrl(url)) throw new Error('OPPORTUNITY_UNSAFE_SOURCE');
    if(form)assertOpportunityPublicForm(url,form);
    const addresses = await lookup(url.hostname, { all: true });
    if (!addresses.length || addresses.some(a => nativeResearchInternals.isPrivateIpAddress(a.address))) throw new Error('OPPORTUNITY_PRIVATE_SOURCE');
    const result = await new Promise<{ status: number; location?: string; bytes: Buffer; mime: string; disposition: string }>((resolve, reject) => {
      const request = httpsRequest(url, { signal, lookup: nativeResearchInternals.pinnedOfficialSiteLookup(addresses[0] as { address: string; family: 4 | 6 }),
        method:form?'POST':'GET',
        headers: { Accept: 'application/pdf,text/html,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'User-Agent': 'ANTON.IA Opportunities/1.0',
          ...(form?{'Content-Type':'application/x-www-form-urlencoded'}:{}),
          ...(options.session?.cookies.get(url.hostname)?.size?{Cookie:[...options.session.cookies.get(url.hostname)!].map(([name,value])=>`${name}=${value}`).join('; ')}:{}) } }, response => {
        if(options.session)for(const raw of response.headers['set-cookie']||[]){
          const pair=raw.split(';')[0];const at=pair.indexOf('=');
          if(at>0&&at<120&&pair.length<4096){const jar=options.session.cookies.get(url.hostname)||new Map<string,string>();if(jar.size<20)jar.set(pair.slice(0,at),pair.slice(at+1));options.session.cookies.set(url.hostname,jar);}
        }
        const status = response.statusCode || 0;
        if (status >= 300 && status < 400) { response.resume(); resolve({ status, location: response.headers.location, bytes: Buffer.alloc(0), mime: '', disposition: '' }); return; }
        if (status !== 200) { response.resume(); reject(new Error('OPPORTUNITY_SOURCE_UNAVAILABLE')); return; }
        const chunks: Buffer[] = []; let size = 0;
        response.on('data', (chunk: Buffer) => { size += chunk.length; if (size > 20 * 1024 * 1024) { response.destroy(new Error('OPPORTUNITY_SOURCE_LARGE')); return; } chunks.push(chunk); });
        response.on('error', reject); response.on('aborted', () => reject(new Error('OPPORTUNITY_SOURCE_INTERRUPTED')));
        response.on('end', () => resolve({ status, bytes: Buffer.concat(chunks), mime: String(response.headers['content-type'] || '').split(';')[0], disposition: String(response.headers['content-disposition'] || '') }));
      });
      request.on('error', reject); request.end(form?new URLSearchParams(form).toString():undefined);
    });
    if (result.status >= 300 && result.status < 400) { if (!result.location) throw new Error('OPPORTUNITY_REDIRECT_MISSING'); url = new URL(result.location, url);form=undefined; continue; }
    const expected=options.expectedName?.toLowerCase().split('.').pop();
    const binaryExt=result.mime==='application/octet-stream'&&['pdf','docx','xlsx'].includes(expected||'')?expected:null;
    if(binaryExt==='pdf'&&!result.bytes.subarray(0,5).equals(Buffer.from('%PDF-')))throw new Error('OPPORTUNITY_SOURCE_FORMAT');
    if((binaryExt==='docx'||binaryExt==='xlsx')&&!(result.bytes[0]===80&&result.bytes[1]===75))throw new Error('OPPORTUNITY_SOURCE_FORMAT');
    const ext = binaryExt || (result.mime.includes('pdf') ? 'pdf' : result.mime.includes('wordprocessingml') ? 'docx' : result.mime.includes('spreadsheetml') ? 'xlsx' : result.mime.includes('html') ? 'html' : result.mime.startsWith('text/') || result.mime==='application/json'&&form ? 'txt' : null);
    if (!ext) throw new Error('OPPORTUNITY_SOURCE_FORMAT');
    const fileName = result.disposition.match(/filename="?([^";]+)/i)?.[1]?.replace(/[\\/\u0000-\u001f]/g, '_').slice(0, 250) || options.expectedName?.replace(/[\\/\u0000-\u001f]/g,'_').slice(0,250) || `Fuente.${ext}`;
    return { ...result, url: url.toString(), name: fileName.toLowerCase().endsWith('.' + ext) ? fileName : `${fileName}.${ext}` };
  }
  throw new Error('OPPORTUNITY_REDIRECT_LIMIT');
}
export function opportunityAttachmentLinks(html: string, base: string) {
  const dom = new JSDOM(html); const host = new URL(base).hostname;
  try {
    const links = [...dom.window.document.querySelectorAll('a[href]')].flatMap(a => {
      try {
        const url = new URL(a.getAttribute('href') || '', base);
        return url.protocol === 'https:' && url.hostname === host && (/\.(pdf|docx|xlsx)(?:$|\?)/i.test(url.href) || /anexo|bases|attachment|adjunto/i.test(a.textContent || '')) ? [url.href] : [];
      } catch { return []; }
    });
    return [...new Set(links)].slice(0, 12);
  } finally { dom.window.close(); }
}
