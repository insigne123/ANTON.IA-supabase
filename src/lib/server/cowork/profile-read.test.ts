import test from 'node:test';
import assert from 'node:assert/strict';
import { readCoworkProfile } from './profile-read';
const id='00000000-0000-4000-8000-000000000001';
test('profile is own-scoped and minimizes fields without certifying mailbox', async () => {
  const calls: unknown[][]=[];
  const chain={select:(...args:unknown[])=>{calls.push(args);return chain;},eq:(...args:unknown[])=>{calls.push(args);return chain;},
    maybeSingle:async()=>({data:{id,full_name:'Ana',email:'ana@example.com',signatures:'private',token:'secret'},error:null})};
  const result=await readCoworkProfile({from:()=>chain} as never,{userId:id,organizationId:id},'');
  assert.deepEqual(calls[1],['id',id]); assert.equal(result.mailboxVerified,false);
  assert.equal(JSON.stringify(result).includes('secret'),false);assert.equal(JSON.stringify(result).includes('private'),false);
});
test('profile rejects foreign rows and database errors', async()=>{
  for(const response of [{data:{id:'other'},error:null},{data:null,error:{message:'private'}}]){
    const chain={select:()=>chain,eq:()=>chain,maybeSingle:async()=>response};
    await assert.rejects(readCoworkProfile({from:()=>chain} as never,{userId:id,organizationId:id},''));
  }
});
test('profile.get shows what «Perfil» saved, never the email signature html', async()=>{
  const signatures={gmail:{enabled:true,html:'<p>Ana · +56 9 1111 2222</p>'},profile_extended:{role:'Gerente',sector:'Software',description:'Hacemos AXIS',
    services:'AXIS, SADT',valueProposition:'Consultas PJUD por lote',proofPoints:['1.000 personas en 30 minutos']}};
  const read=async(row:unknown)=>{
    const chain={select:()=>chain,eq:()=>chain,maybeSingle:async()=>({data:row,error:null})};
    return await readCoworkProfile({from:()=>chain} as never,{userId:id,organizationId:id},'') as {commercial:Record<string,string|null>|null};
  };
  const result=await read({id,full_name:'Ana',job_title:'Gerente Comercial',signatures});
  assert.deepEqual(result.commercial,{role:'Gerente Comercial',sector:'Software',description:'Hacemos AXIS',services:'AXIS, SADT',
    valueProposition:'Consultas PJUD por lote',proofPoints:'1.000 personas en 30 minutos'});
  assert.equal(JSON.stringify(result.commercial).includes('+56'),false);
  assert.equal((await read({id,full_name:'Ana'})).commercial,null,'nothing saved, nothing shown');
});
test('with a «Ficha de la empresa», profile.get reads the company from it and says who edits it; the person keeps their role (APP-06)', async()=>{
  const tables:Record<string,unknown>={
    profiles:{id,full_name:'Ana',job_title:'Ejecutiva',signatures:{profile_extended:{services:'Lo que Ana escribió antes',companyServices:['SADT: registro de contratos']}}},
    organization_company_profile:{fields:{companyName:'Yago SpA',services:'AXIS: consultas judiciales\nSADT: registro de contratos',valueProposition:'Revisamos antecedentes en minutos.'}},
  };
  const from=(table:string)=>{const chain={select:()=>chain,eq:()=>chain,maybeSingle:async()=>({data:tables[table]??null,error:null})};return chain;};
  const result=await readCoworkProfile({from} as never,{userId:id,organizationId:id},'') as {profile:{companyName:string|null};commercial:Record<string,string|null>;companyFrom?:string};
  assert.equal(result.profile.companyName,'Yago SpA');
  assert.equal(result.commercial.services,'SADT: registro de contratos','only what Ana sells');
  assert.equal(result.commercial.valueProposition,'Revisamos antecedentes en minutos.');
  assert.equal(result.commercial.role,'Ejecutiva');
  assert.match(String(result.companyFrom),/Administración → Empresa/);
});
