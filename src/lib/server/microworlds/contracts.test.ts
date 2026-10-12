import assert from 'node:assert/strict';
import test from 'node:test';
import { mirrorCriteria,mirrorFingerprint,microworldsInput,contactFromMicroworlds,chooseCachedContact,residualFields,hybridEnabled } from './contracts';
const contact=contactFromMicroworlds({first_name:'Ana',last_name:'Pérez',organization_primary_domain:'demo.test',title:'Gerenta de Personas',
  linkedin_url:'https://linkedin.com/in/ana-demo',email:'ana@demo.test',mobile_number:'+56 9 1234 5678'},'demo.test')!;
test('mirror inputs fix the company, bound100, request mobiles and do not add hidden eligibility or reinterpret company location',()=>{
  const a=mirrorCriteria({domain:'https://www.demo.test/',titles:['CEO','Gerente','CEO'],personLocations:['Chile'],seniorities:['director']});
  const b=mirrorCriteria({domain:'demo.test',titles:['Gerente','CEO'],personLocations:['Chile'],seniorities:['director']});
  assert.equal(mirrorFingerprint(a),mirrorFingerprint(b));assert.equal(microworldsInput(a).include_mobile,true);
  assert.deepEqual(microworldsInput(a).company_domains,['demo.test']);assert.deepEqual(microworldsInput(a).email_status,[]);
  assert.equal(microworldsInput(a).max_result,100);assert.equal('company_locations' in microworldsInput(a),false);
  assert.equal('seniority' in microworldsInput(a),false);assert.throws(()=>mirrorCriteria({domain:'localhost'}));
  assert.equal(hybridEnabled({}),false);
});
test('only personal mobile and explicit email status are accepted; foreign-company and obscured contacts are discarded',()=>{
  assert.equal(contact.mobile,'+56912345678');assert.equal(contact.emailStatus,'unknown','a returned email is not automatically verified');
  assert.equal(contactFromMicroworlds(null as any,'demo.test'),null);
  assert.equal(contactFromMicroworlds({first_name:'Ana',last_name:'Pé***z',organization_primary_domain:'demo.test'},'demo.test'),null);
  assert.equal(contactFromMicroworlds({first_name:'Ana',last_name:'Pérez',organization_primary_domain:'other.test'},'demo.test'),null);
  const office=contactFromMicroworlds({first_name:'Ana',last_name:'Pérez',organization_primary_domain:'demo.test',organization_phone:'+56912345678'},'demo.test');
  assert.equal(office?.mobile,null);
});
test('identity matching rejects masked names, homonyms, conflicting profiles and wrong domains',()=>{
  const identity={id:'apollo-ana',domain:'demo.test',fullName:'Ana Pe***z',title:contact.title};
  assert.equal(chooseCachedContact(identity,[contact]),null);
  assert.equal(chooseCachedContact({...identity,fullName:'Ana Pérez'},[contact]),contact);
  assert.equal(chooseCachedContact({...identity,fullName:'Ana Pérez'},[contact,{...contact,linkedinUrl:'https://linkedin.com/in/homonym'}]),null);
  assert.equal(chooseCachedContact({...identity,linkedinUrl:'https://linkedin.com/in/another'},[contact]),null);
  assert.equal(chooseCachedContact({...identity,linkedinUrl:'https://cl.linkedin.com/in/ana-demo/?trk=x'},[contact]),contact);
  assert.equal(chooseCachedContact({...identity,domain:'other.test',linkedinUrl:contact.linkedinUrl},[contact]),null);
});
test('fallback is per requested gap; cached email is contrasted only when phone fallback is requested',()=>{
  const requested={email:true,phone:true};
  assert.deepEqual(residualFields(requested,{},contact),{apolloEmail:false,apolloPhone:false,verifyEmail:false,cacheEmail:contact.email,cachePhone:contact.mobile});
  assert.deepEqual(residualFields(requested,{}, {...contact,mobile:null}),{apolloEmail:false,apolloPhone:true,verifyEmail:true,cacheEmail:contact.email,cachePhone:null});
  assert.equal(residualFields({email:true,phone:false},{}, {...contact,mobile:null}).apolloPhone,false);
  assert.equal(residualFields(requested,{email:'edited@demo.test',phone:'+15550100001'},contact).cacheEmail,null);
  assert.equal(residualFields(requested,{},null).apolloEmail,true);
});
