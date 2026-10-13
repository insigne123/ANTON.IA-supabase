import { lookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { JSDOM } from 'jsdom';

/** Bounded, DNS-pinned downloading; never forwards a user's cookie or a provider credential. */
export async function downloadOpportunitySource(value: string) {
  const { nativeResearchInternals } = await import('@/lib/server/native-research');
  let url = new URL(value);
  const signal = AbortSignal.timeout(25_000);
  for (let redirects = 0; redirects < 4; redirects++) {
    if (url.protocol !== 'https:' || !nativeResearchInternals.isSafeOfficialSiteUrl(url)) throw new Error('OPPORTUNITY_UNSAFE_SOURCE');
    const addresses = await lookup(url.hostname, { all: true });
    if (!addresses.length || addresses.some(a => nativeResearchInternals.isPrivateIpAddress(a.address))) throw new Error('OPPORTUNITY_PRIVATE_SOURCE');
    const result = await new Promise<{ status: number; location?: string; bytes: Buffer; mime: string; disposition: string }>((resolve, reject) => {
      const request = httpsRequest(url, { signal, lookup: nativeResearchInternals.pinnedOfficialSiteLookup(addresses[0] as { address: string; family: 4 | 6 }),
        headers: { Accept: 'application/pdf,text/html,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'User-Agent': 'ANTON.IA Opportunities/1.0' } }, response => {
        const status = response.statusCode || 0;
        if (status >= 300 && status < 400) { response.resume(); resolve({ status, location: response.headers.location, bytes: Buffer.alloc(0), mime: '', disposition: '' }); return; }
        if (status !== 200) { response.resume(); reject(new Error('OPPORTUNITY_SOURCE_UNAVAILABLE')); return; }
        const chunks: Buffer[] = []; let size = 0;
        response.on('data', (chunk: Buffer) => { size += chunk.length; if (size > 20 * 1024 * 1024) { response.destroy(new Error('OPPORTUNITY_SOURCE_LARGE')); return; } chunks.push(chunk); });
        response.on('error', reject); response.on('aborted', () => reject(new Error('OPPORTUNITY_SOURCE_INTERRUPTED')));
        response.on('end', () => resolve({ status, bytes: Buffer.concat(chunks), mime: String(response.headers['content-type'] || '').split(';')[0], disposition: String(response.headers['content-disposition'] || '') }));
      });
      request.on('error', reject); request.end();
    });
    if (result.status >= 300 && result.status < 400) { if (!result.location) throw new Error('OPPORTUNITY_REDIRECT_MISSING'); url = new URL(result.location, url); continue; }
    const ext = result.mime.includes('pdf') ? 'pdf' : result.mime.includes('wordprocessingml') ? 'docx' : result.mime.includes('spreadsheetml') ? 'xlsx' : result.mime.includes('html') ? 'html' : result.mime.startsWith('text/') ? 'txt' : null;
    if (!ext) throw new Error('OPPORTUNITY_SOURCE_FORMAT');
    const fileName = result.disposition.match(/filename="?([^";]+)/i)?.[1]?.replace(/[\\/\u0000-\u001f]/g, '_').slice(0, 250) || `Fuente.${ext}`;
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
