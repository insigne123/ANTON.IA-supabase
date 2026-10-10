import assert from 'node:assert/strict';import test from 'node:test';import {build} from 'esbuild';import {createRequire} from 'node:module';
const state:any={};(globalThis as any).__homeScopeAuth=state;
const dependencies:Record<string,string>={
  './request-auth':`export async function requireSessionRequestAuth(){if(!globalThis.__homeScopeAuth.user)throw Object.assign(Error('Unauthorized'),{status:401});return {user:globalThis.__homeScopeAuth.user,supabase:{}}}`,
  './organization-context':`export async function resolveActiveOrganization(db,id,requested){globalThis.__homeScopeAuth.requested=requested;return {active:{organizationId:requested==='org-a'||requested==='org-b'?requested:'org-a'}}}`,
  './auth-utils':`export class AuthError extends Error{constructor(message,status){super(message);this.status=status}}`,
};
const bundle=await build({entryPoints:['src/lib/server/home-auth.ts'],bundle:true,write:false,platform:'node',format:'cjs',packages:'external',plugins:[{name:'auth-fixture',setup(b){b.onResolve({filter:/.*/},args=>dependencies[args.path]?{path:args.path,namespace:'fixture'}:undefined);b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:dependencies[args.path]}));}}]});
const compiled={exports:{} as any};new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(import.meta.url),compiled,compiled.exports);
test('Home pins only the selected authorized tenant and derives the actor from Auth, never request ids or admin role',async()=>{
  for(const role of ['owner','admin','member']){state.user={id:'me',role};
    const result=await compiled.exports.requireHomeAuth(new Request('https://app.test/api/home/summary?userId=other',{headers:{'x-organization-id':'org-b'}}));
    assert.equal(result.organizationId,'org-b');assert.equal(result.user.id,'me');assert.equal(state.requested,'org-b');
    await assert.rejects(compiled.exports.requireHomeAuth(new Request('https://app.test/api/home/summary',{headers:{'x-organization-id':'unauthorized'}})),(e:any)=>e.status===403);
  }
  state.user=null;await assert.rejects(compiled.exports.requireHomeAuth(new Request('https://app.test/api/home/summary')),(e:any)=>e.status===401);
});
