// Actual search page/client with simulated cookies/session/API. No production
// tokens, provider calls, user impersonation, paid operations or sends.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import {createRequire} from 'node:module';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const scope = { userId: 'user-a', organizationId: 'org-a' };
const mocks = {
  'next/navigation': `export const useRouter=()=>({push(){}});`,
  'next/link': `import React from 'react'; export default function Link(props){return <a {...props}/>}`,
  'next/image': `import React from 'react'; export default function Image({unoptimized,...props}){return <img {...props}/>}`,
  '@/lib/supabase': `export const supabase={auth:{
    getSession:async()=>({data:{session:{access_token:window.currentToken,user:{id:'user-a'}}}}),
    refreshSession:async()=>{window.refreshes++;if(window.refreshFailed)return {data:{session:null},error:{code:'refresh_token_not_found'}};window.currentToken='renewed';return {data:{session:{access_token:'renewed',user:{id:'user-a'}}}}},
    signOut:async options=>{window.signedOut=options;sessionStorage.setItem('test:signout',JSON.stringify(options));},
  }};`,
  '@/lib/supabase-service': `export const supabaseService={getLeads:async()=>[],addLeadsDedup:async()=>({addedCount:1,duplicateCount:0})};`,
  '@/lib/services/enriched-leads-service': `export const enrichedLeadsStorage={get:async()=>[],addDedup:async()=>({addedCount:1,duplicateCount:0})};`,
  '@/lib/services/contacted-leads-service': `export const contactedLeadsStorage={get:async()=>[]};`,
  '@/lib/services/saved-searches-service': `export class DuplicateSavedSearchNameError extends Error {} export const savedSearchesService={getSavedSearches:async()=>[]};`,
  '@/lib/services/organization-service': `export const organizationService={listOrganizations:async()=>({activeOrganizationId:'org-a',organizations:[{id:'org-a',name:'GrupoExpro'}]}),getCurrentOrganizationId:async()=> 'org-a',subscribeToCurrentOrganizationChanges:()=>()=>{}};`,
  '@/lib/services/profile-service': `export const profileService={getProfile:async()=>null};`,
  '@/hooks/use-team-locks': `export const useTeamLocks=()=>null;`,
  '@/lib/quota-client': `export const canUseClientQuota=()=>true;export const incClientQuota=()=>{};export const getClientLimit=()=>50;`,
  '@/hooks/use-toast': `export const useToast=()=>({toast:value=>window.notices.push(value)});`,
  '@/lib/auth-scope-cache': `export const readCachedAuthScope=()=>(${JSON.stringify(scope)});`,
};
const output = await build({ stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import Page from './src/app/(app)/search/page';createRoot(document.getElementById('root')).render(<Page/>);`, loader: 'tsx', resolveDir: process.cwd() },
  bundle: true, write: false, platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"test"', 'process.env': '{}' },
  plugins: [{ name: 'isolated-session', setup(builder) {
    builder.onResolve({ filter: /.*/ }, args => args.path === './supabase' && args.importer.endsWith('authenticated-api-fetch.ts')
      ? { path:'@/lib/supabase',namespace:'mock' } : args.path in mocks ? { path: args.path, namespace: 'mock' } : undefined);
    builder.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ loader: 'jsx', resolveDir: process.cwd(), contents: mocks[args.path] }));
  } }] });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const scenario of ['company-renew', 'profile-fresh', 'company-forbidden', 'profile-expired', 'reauth-criteria']) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors = []; const calls = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(({ scenario, scope }) => {
      window.currentToken = scenario === 'company-renew' ? 'stale' : 'current'; window.refreshes = 0;
      window.refreshFailed = scenario === 'profile-expired'; window.notices = [];
      if (scenario === 'reauth-criteria') sessionStorage.setItem(`antonia:search:reauth:${scope.userId}:${scope.organizationId}`, JSON.stringify({ at:Date.now(),filters:{searchMode:'company_name',companyName:'acciona',seniorities:[]} }));
    }, { scenario, scope });
    await page.route('**/*', async route => {
      const req = route.request(); const url = new URL(req.url());
      if (url.pathname === '/') return route.fulfill({ contentType:'text/html', body:'<html><body><div id="root"></div></body></html>' });
      if (url.pathname === '/login') return route.fulfill({contentType:'text/html',body:'<html><body>Login de prueba</body></html>'});
      if (url.pathname === '/api/leads/leads-finder/status') return route.fulfill({json:{available:false}});
      if (url.pathname === '/api/leads/search/checkpoint') return route.fulfill({json:{snapshot:null,revision:0,scope:'org-a:user-a'}});
      if (['/api/leads/search','/api/opportunities/enrich-apollo'].includes(url.pathname)) {
        const body=req.postDataJSON(); const token=req.headers().authorization;
        calls.push({path:url.pathname,body,token,key:req.headers()['idempotency-key']});
        if (scenario === 'company-forbidden') return route.fulfill({status:403,json:{error:'User does not belong to the requested organization',code:'ORGANIZATION_ACCESS_REQUIRED'}});
        if (scenario === 'profile-expired' || token === 'Bearer stale') return route.fulfill({status:401,json:{error:'Unauthorized',code:'AUTH_SESSION_EXPIRED'}});
        if (url.pathname === '/api/leads/search'&&body.search_mode==='companies')return route.fulfill({json:{count:1,organizations:[{id:'acciona',name:'Acciona',primary_domain:'acciona.test'}],total_pages:1,total_entries:1}});
        if (url.pathname === '/api/leads/search') return route.fulfill({json:{count:1,leads:[{id:'lead',name:'Persona de prueba',title:'Director',organization_name:'Acciona'}],search_mode:'company_people',raw_count:1,total_entries:1}});
        return route.fulfill({json:{operationStatus:'completed',queued:false,enriched:[{id:'profile',fullName:'Perfil de prueba',title:'Director',companyName:'Acciona',linkedinUrl:'https://www.linkedin.com/in/flaviobaronti',enrichmentStatus:'completed'}]}});
      }
      return route.abort();
    });
    await page.goto('http://localhost:9016/');
    await page.addScriptTag({content:output.outputFiles[0].text});
    await page.waitForFunction(()=>{const b=[...document.querySelectorAll('button')].find(b=>['Buscar empresas','Buscar'].includes(b.textContent.trim()));return b&&!b.disabled});
    if (scenario === 'reauth-criteria') {
      await page.getByLabel('Empresa *',{exact:true}).waitFor();
      assert.equal(await page.getByLabel('Empresa *',{exact:true}).inputValue(),'acciona');
      assert.equal(calls.length,0,'reauth restores criteria without charging a search');
      assert.equal(await page.evaluate(()=>sessionStorage.getItem('antonia:search:reauth:user-a:org-a')),null);
    } else {
      const profile=scenario.startsWith('profile');
      await page.getByRole('button',{name:profile?'Perfil':'Empresa',exact:true}).click();
      await page.getByLabel(profile?'URL del perfil de LinkedIn *':'Empresa *',{exact:true}).fill(profile?'https://www.linkedin.com/in/flaviobaronti/?isSelfProfile=false':'acciona');
      await page.getByRole('button',{name:profile?'Buscar':'Buscar empresas',exact:true}).click();
      if (scenario==='company-forbidden') {
        await page.getByText('No pudimos confirmar tu acceso al equipo',{exact:true}).waitFor();
        await page.getByRole('button',{name:'Volver a entrar',exact:true}).waitFor();
        assert.equal(calls.length,1);assert.equal(await page.evaluate(()=>window.refreshes),0);
        assert.equal(await page.getByText('Tu sesión expiró',{exact:true}).count(),0);
      } else if (scenario==='profile-expired') {
        await page.getByText('Tu sesión expiró',{exact:true}).waitFor();
        assert.equal(calls.length,1);assert.equal(await page.evaluate(()=>window.refreshes),1);
        await page.getByRole('button',{name:'Volver a entrar',exact:true}).click();
        await page.waitForURL('**/login?next=%2Fsearch');
        assert.deepEqual(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('test:signout'))),{scope:'local'});
        const recovered=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('antonia:search:reauth:user-a:org-a')));
        assert.equal(recovered.filters.linkedinUrl,'https://www.linkedin.com/in/flaviobaronti/?isSelfProfile=false');
        assert.doesNotMatch(JSON.stringify(recovered),/access_token|refresh_token|private@example/);
      } else {
        try { await page.getByText(profile?'Perfil de prueba':'Acciona',{exact:true}).first().waitFor(); }
        catch (error) { console.log(JSON.stringify({scenario,calls,errors,body:(await page.locator('body').textContent()).slice(-5000)}));throw error; }
        assert.equal(calls.length,scenario==='company-renew'?2:1);
        if (scenario==='company-renew') {
          assert.equal(await page.evaluate(()=>window.refreshes),1);
          assert.deepEqual(calls.map(c=>c.token),['Bearer stale','Bearer renewed']);
          assert.deepEqual(calls[0].body,calls[1].body);
        } else {
          assert.equal(calls[0].token,'Bearer current');
          assert.equal(calls[0].body.leads[0].linkedinUrl,'https://www.linkedin.com/in/flaviobaronti');
        }
      }
    }
    assert.deepEqual(errors,[]);
    console.log(`PASS search ${scenario}: real UI/client with simulated session/API, no providers.`);
    await context.close();
  }
} finally { await browser.close(); }
