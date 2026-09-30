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
