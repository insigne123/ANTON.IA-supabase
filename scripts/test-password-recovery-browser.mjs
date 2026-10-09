// Actual AuthProvider, callback, reset form and Supabase cookie/PKCE clients.
// Auth HTTP is a local fixture: no env files, emails or production account writes.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { parseCookies, serializeCookie } = require('@supabase/auth-helpers-shared');
const authOrigin = 'https://recovery-fixture.supabase.test';
const user = { id: '00000000-0000-4000-8000-000000000001', email: 'persona@example.test', aud: 'authenticated', role: 'authenticated',
  app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' };
const exp = Math.floor(Date.now() / 1000) + 3600;
const token = [{alg:'HS256',typ:'JWT'},{sub:user.id,aud:'authenticated',role:'authenticated',email:user.email,exp}]
  .map(part=>Buffer.from(JSON.stringify(part)).toString('base64url')).join('.')+'.'+Buffer.alloc(32,1).toString('base64url');
const session = {access_token:token,refresh_token:'fixture-refresh',expires_in:3600,expires_at:exp,token_type:'bearer',user};
const calls=[];
const authResponse = (url, method, body) => {
  calls.push({path:url.pathname,grant:url.searchParams.get('grant_type'),method,body});
  if(url.pathname==='/auth/v1/recover')return {status:200,body:{}};
  if(url.pathname==='/auth/v1/token'&&url.searchParams.get('grant_type')==='pkce') {
    assert.ok(body.code_verifier,'PKCE verifier must come from the requesting browser cookie');
    return body.auth_code==='expired' ? {status:400,body:{code:'otp_expired',msg:'Expired code'}} : {status:200,body:session};
  }
  if(url.pathname==='/auth/v1/verify')return body.token_hash==='expired' ? {status:400,body:{code:'otp_expired',msg:'Expired token'}} : {status:200,body:session};
  if(url.pathname==='/auth/v1/user') {
    if(method==='PUT'&&body.password==='weak-password-fixture')return {status:400,body:{code:'weak_password',msg:'Password is too weak'}};
    return {status:200,body:user};
  }
  throw Error('Unexpected fixture Auth request: '+url.pathname);
};
const plugin = mocks=>({name:'fixture-next',setup(builder){
  builder.onResolve({filter:/.*/},args=>args.path in mocks?{path:args.path,namespace:'fixture'}:undefined);
  builder.onLoad({filter:/.*/,namespace:'fixture'},args=>({loader:'jsx',resolveDir:process.cwd(),contents:mocks[args.path]}));
}});
const client = await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';
  import {AuthProvider} from './src/context/AuthContext';import Login from './src/app/login/page';import Reset from './src/app/restablecer-clave/page';
  createRoot(document.getElementById('root')).render(<React.StrictMode><AuthProvider>{location.pathname==='/restablecer-clave'?<Reset/>:<Login/>}</AuthProvider></React.StrictMode>);`,
  loader:'tsx',resolveDir:process.cwd()},bundle:true,write:false,platform:'browser',jsx:'automatic',
  define:{'process.env.NODE_ENV':'"test"','process.env.NEXT_PUBLIC_SUPABASE_URL':JSON.stringify(authOrigin),'process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY':'"fixture-key"','process.env':'{}'},
  plugins:[plugin({'next/navigation':`export const useSearchParams=()=>new URLSearchParams(location.search);export const useRouter=()=>({push:path=>location.assign(path)});`,
    'next/link':`import React from 'react';export default function Link(props){return <a {...props}/>}`,
    'next/image':`import React from 'react';export default function Image({fill,priority,unoptimized,...props}){return <img {...props}/>}`})]});
const serverCode=await build({stdin:{contents:`export {GET} from './src/app/api/auth/callback/route';export {middleware} from './src/middleware';`,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,platform:'node',format:'cjs',packages:'external',
  plugins:[plugin({'next/headers':`export const cookies=async()=>globalThis.recoveryFixtureCookies;`,
    'next/server':`export const NextResponse={next:()=>new Response(),redirect:url=>new Response(null,{status:307,headers:{location:String(url)}}),json:(body,init)=>Response.json(body,init)};`})]});
const loaded={exports:{}};new Function('require','module','exports',serverCode.outputFiles[0].text)(require,loaded,loaded.exports);
const realFetch=globalThis.fetch;
globalThis.fetch=async(input,init)=>{
  const url=new URL(typeof input==='string'?input:input.url||String(input));
  if(url.origin!==authOrigin)return realFetch(input,init);
  const result=authResponse(url,init?.method||'GET',JSON.parse(init?.body||'{}'));
  return Response.json(result.body,{status:result.status});
};
const server=createServer(async(request,response)=>{
  try{
    const url=new URL(request.url,origin);
    if(url.pathname==='/api/auth/callback'){
      const cookies=parseCookies(request.headers.cookie||''),written=[];
      globalThis.recoveryFixtureCookies={get:name=>cookies[name]?{value:cookies[name]}:undefined,
        set:(name,value,options)=>{cookies[name]=value;written.push(serializeCookie(name,value,options));}};
      const result=await loaded.exports.GET(new Request(url));
      response.statusCode=result.status;for(const [name,value] of result.headers)response.setHeader(name,value);
      if(written.length)response.setHeader('set-cookie',written);response.end(await result.text());return;
    }
    if(url.pathname==='/bundle.js'){response.setHeader('content-type','text/javascript');response.end(client.outputFiles[0].text);return;}
    if(url.pathname==='/api/organizations'){response.setHeader('content-type','application/json');response.end(JSON.stringify({activeOrganizationId:'fixture-org',organizations:[{id:'fixture-org',role:'member',name:'Demo',memberCount:1}]}));return;}
    const guard=await loaded.exports.middleware(Object.assign(new Request(url,{headers:request.headers}),{nextUrl:url}));
    if(guard.status===307){response.statusCode=307;response.setHeader('location',guard.headers.get('location'));response.end();return;}
    response.setHeader('content-type','text/html');
    response.end(url.pathname==='/dashboard'?'<html><body><h1>Hoy</h1></body></html>':
      '<!doctype html><html lang="es"><body><div id="root"></div><script src="/bundle.js"></script></body></html>');
  }catch(error){response.statusCode=500;response.end('Fixture failed');console.error(error.message);}
}).listen(0,'127.0.0.1');
await new Promise(resolve=>server.once('listening',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
process.env.NEXT_PUBLIC_SUPABASE_URL=authOrigin;process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY='fixture-key';process.env.CANONICAL_APP_URL=origin;
let browser;
try{
  browser=await chromium.launch({headless:true});
  for(const flow of ['pkce','legacy-fragment','token-hash']){
    calls.length=0;const context=await browser.newContext({viewport:{width:flow==='pkce'?390:1440,height:900}});
    try{
      await context.route(authOrigin+'/**',route=>{
        const request=route.request(),result=authResponse(new URL(request.url()),request.method(),request.postData()?request.postDataJSON():{});
        return route.fulfill({status:result.status,json:result.body});
      });
      const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
      if(flow==='pkce'){
        await page.goto(origin+'/login?recuperar=1');await page.getByLabel('Correo',{exact:true}).fill(user.email);
        await page.getByRole('button',{name:'Enviarme el enlace'}).click();await page.getByRole('status').getByText(/Si hay una cuenta/).waitFor();
        const recover=calls.find(call=>call.path==='/auth/v1/recover');assert.equal(recover.body.email,user.email);assert.ok(recover.body.code_challenge);
        await page.goto(origin+'/api/auth/callback?code=fixture-code&next=%2Frestablecer-clave');
      }else if(flow==='legacy-fragment'){
        await page.goto(origin+'/login#'+new URLSearchParams({access_token:token,refresh_token:session.refresh_token,type:'recovery',expires_in:'3600'}));
      }else{
        await page.goto(origin+'/api/auth/callback?token_hash=fixture-hash&type=recovery&next=%2Fdashboard');
        assert.equal(calls.find(call=>call.path==='/auth/v1/verify').body.type,'recovery');
      }
      await page.waitForURL(origin+'/restablecer-clave');await page.getByLabel('Contraseña nueva',{exact:true}).waitFor();
      assert.ok((await context.cookies()).some(cookie=>cookie.name.startsWith('sb-recovery-fixture-auth-token')));
      assert.equal(new URL(page.url()).hash,'');
      await page.getByLabel('Contraseña nueva',{exact:true}).fill('short');await page.getByLabel('Repite la contraseña').fill('short');
      await page.getByRole('button',{name:'Guardar contraseña'}).click();await page.getByRole('alert').getByText(/al menos 8/).waitFor();
      assert.equal(calls.filter(call=>call.method==='PUT').length,0);
      await page.getByLabel('Contraseña nueva',{exact:true}).fill('new-fixture-password');await page.getByLabel('Repite la contraseña').fill('different-fixture');
      await page.getByRole('button',{name:'Guardar contraseña'}).click();await page.getByRole('alert').getByText('Las contraseñas no coinciden.').waitFor();
      assert.equal(calls.filter(call=>call.method==='PUT').length,0);
      for(const value of ['weak-password-fixture','new-fixture-password']){
        await page.getByLabel('Contraseña nueva',{exact:true}).fill(value);await page.getByLabel('Repite la contraseña').fill(value);
        await page.getByRole('button',{name:'Guardar contraseña'}).click();
        await page.getByText(value==='weak-password-fixture'?'La contraseña debe tener al menos 8 caracteres.':
          'Listo: tu contraseña nueva quedó guardada. Úsala la próxima vez que entres.',{exact:true}).waitFor();
      }
      assert.equal(calls.filter(call=>call.method==='PUT').length,2);assert.deepEqual(errors,[]);
      await page.getByRole('button',{name:'Ir a Hoy'}).click();await page.getByRole('heading',{name:'Hoy'}).waitFor();
      await page.goto(origin+'/login?recuperar=1&enlace=vencido');await page.getByRole('heading',{name:'Recupera tu contraseña'}).waitFor();
      assert.equal(new URL(page.url()).pathname,'/login','a previous session must not hide recovery or expired-link feedback');
      console.log('PASS '+flow+': session cookies, new password form, local validation, provider error, successful save and continuation.');
    }finally{await context.close();}
  }
  for(const query of ['token_hash=expired&type=recovery','token_hash=fixture-hash&type=signup','error=access_denied']){
    const response=await realFetch(origin+'/api/auth/callback?'+query,{redirect:'manual'});
    assert.equal(response.status,307);assert.equal(response.headers.get('location'),origin+'/login?enlace=vencido');
    assert.ok(response.headers.get('cache-control').includes('no-store'));assert.equal(response.headers.get('referrer-policy'),'no-referrer');
  }
  const context=await browser.newContext();const page=await context.newPage();
  await page.goto(origin+'/restablecer-clave');await page.getByRole('link',{name:'Pedir un enlace nuevo'}).waitFor();
  assert.equal(await page.getByLabel('Contraseña nueva',{exact:true}).count(),0);await context.close();
  console.log('PASS expired/invalid links and no session: recover again, never report saved. No real email/account changes.');
}finally{
  globalThis.fetch=realFetch;delete globalThis.recoveryFixtureCookies;
  if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));
}
