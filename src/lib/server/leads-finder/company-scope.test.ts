import assert from 'node:assert/strict';import test from 'node:test';import {issueCompanyScope,readCompanyScope} from './company-scope';
import {hasLeadsFinderUserAccess} from './access';
test('company selection is bound to its user, tenant, domain and deadline; a missing domain is never a broad search',()=>{
  const prior=process.env.INTERNAL_API_SECRET;process.env.INTERNAL_API_SECRET='isolated-fixture-key';
  try{const scope={userId:'u',organizationId:'org'},company={id:'external-company',primary_domain:'example.test'};
    const token=issueCompanyScope(company,scope,0)!;assert.equal(readCompanyScope(token,scope,1).domain,'example.test');
    assert.throws(()=>readCompanyScope(token,{...scope,userId:'other'},1));assert.throws(()=>readCompanyScope(token,{...scope,organizationId:'other'},1));
    assert.throws(()=>readCompanyScope(token,scope,86400001));assert.throws(()=>readCompanyScope(token+'x',scope,1));
    assert.equal(issueCompanyScope({id:'no-domain'},scope,0),undefined);
  }finally{if(prior===undefined)delete process.env.INTERNAL_API_SECRET;else process.env.INTERNAL_API_SECRET=prior;}
});
test('only the verified app owner can access Leads Finder even if another tenant admin is allowlisted',()=>{
  const env={LEADS_FINDER_ENABLED:'true',LEADS_FINDER_ALLOWED_EMAILS:'nicolas.yarur.g@yago.cl,other@test.cl'};
  const owner={id:'de3a3194-29b1-449a-828a-53608a7ebe47',email:'nicolas.yarur.g@yago.cl',email_confirmed_at:'2026-01-01'};
  assert.equal(hasLeadsFinderUserAccess(owner,env),true);assert.equal(hasLeadsFinderUserAccess({...owner,id:'other'},env),false);
  assert.equal(hasLeadsFinderUserAccess({...owner,email_confirmed_at:null},env),false);assert.equal(hasLeadsFinderUserAccess({...owner,email:'other@test.cl'},env),false);
  assert.equal(hasLeadsFinderUserAccess(owner,{...env,LEADS_FINDER_ENABLED:'false'}),false);
});
