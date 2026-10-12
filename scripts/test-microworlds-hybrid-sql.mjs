// Real isolated Postgres/WASM for the new RPCs. No env files, network or production.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
if(!process.env.PGLITE_MODULE)throw Error('Explicit PGLITE_MODULE required');
const {PGlite}=require(process.env.PGLITE_MODULE),db=new PGlite();
const org='01000000-0000-4000-8000-000000000001',user='01000000-0000-4000-8000-000000000002',other='01000000-0000-4000-8000-000000000003';
const target='01000000-0000-4000-8000-000000000004',claim='01000000-0000-4000-8000-000000000005';
const query=async(sql,args=[])=> (await db.query(sql,args)).rows;
try{
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema extensions;
    create function auth.role() returns text language sql as $$select current_setting('request.jwt.claim.role',true)$$;
    create table auth.users(id uuid primary key);create table organizations(id uuid primary key);
    create table organization_members(organization_id uuid,user_id uuid);
    create table unsubscribed_emails(email text,organization_id uuid);
    create function extensions.digest(bytea,text) returns bytea language sql immutable as $$select decode(md5($1),'hex')$$;
    create table enriched_leads(id text primary key,organization_id uuid,user_id uuid,source_provider text,source_provider_id text,
      email text,email_status text,primary_phone text,phone_numbers jsonb default '[]',enrichment_status text,full_name text,linkedin_url text,data jsonb default '{}',updated_at timestamptz);
    create table antonia_quota_operations(organization_id uuid,user_id uuid,resource text,operation_id text,claim_token uuid,status text,
      consumed_count integer,quota_count_after integer,quota_day date default current_date,quota_scope text default 'user',credit_mode text,credit_group_id uuid,updated_at timestamptz,
      primary key(organization_id,user_id,resource,operation_id));
    create table apollo_enrichment_callbacks(id uuid,organization_id uuid,user_id uuid,quota_resource text,operation_id text,target_lead_id text,
      target_table text,token_hash text,status text,provider_queued_at timestamptz,apollo_person_id text);
    create table antonia_user_daily_credits(user_id uuid primary key,usage_count integer);
    create table antonia_daily_usage(organization_id uuid,date date,leads_enriched integer,leads_investigated integer,updated_at timestamptz);
    create function release_antonia_user_daily_credits_v1(uuid,date,text,integer) returns boolean language plpgsql as $$begin update antonia_user_daily_credits set usage_count=usage_count-$4 where user_id=$1;return found;end;$$;
    create function release_antonia_organization_credits_v2(uuid,uuid,date,text,integer,text,uuid) returns boolean language sql as $$select true$$;
    create function complete_antonia_quota_operation_v1(uuid,uuid,text,text,uuid,text,integer,jsonb) returns boolean language plpgsql as $$begin
      update antonia_quota_operations set status=$6,claim_token=null where organization_id=$1 and user_id=$2 and resource=$3 and operation_id=$4 and claim_token=$5;return found;end;$$;
    create function settle_apollo_enrichment_quota_if_ready_v1(uuid) returns boolean language sql as $$select true$$;
    create function apply_apollo_enrichment_callback_v1(text,text,text,text,jsonb) returns jsonb language sql as $$select $5||jsonb_build_object('outcome','processed')$$;
    insert into organizations values('${org}');insert into auth.users values('${user}'),('${other}');insert into organization_members values('${org}','${user}');
    select set_config('request.jwt.claim.role','service_role',false);`);
  for(const file of ['20261012090000_microworlds_private_search_jobs.sql','20261012093000_hybrid_enrichment_accounting.sql'])await db.exec(readFileSync('supabase/migrations/'+file,'utf8'));
  const enqueue=async(i)=> (await query('select enqueue_microworlds_search_v1($1,$2,$3,$4,$5) value',[org,user,i.toString(16).padStart(64,'0'),'demo.test',{domain:'demo.test'}]))[0].value;
  const first=await enqueue(1);assert.ok(first.id);
  assert.equal((await enqueue(1)).id,first.id,'same criteria do not reserve a second paid run');
  await assert.rejects(db.query('select enqueue_microworlds_search_v1($1,$2,$3,$4,$5)',[org,other,'a'.repeat(64),'demo.test',{}]),/invalid search scope/);
  for(let i=2;i<=13;i++)assert.ok((await enqueue(i)).id);
  assert.equal((await enqueue(14)).status,'budget_exhausted','queued reservations count toward USD20');
  const leased=(await query('select claim_microworlds_search_v1($1) value',[first.id]))[0].value;
  assert.equal(leased.status,'submitting');assert.ok(leased.claim_token);
  assert.equal((await query('select claim_microworlds_search_v1($1) value',[first.id]))[0].value,null);
  await query("update microworlds_search_jobs set lease_until=now()-interval '10 minutes' where id=$1",[first.id]);
  assert.equal((await query('select claim_microworlds_search_v1($1) value',[first.id]))[0].value,null,'lease expiry never re-POSTs a submitting job');
  await query('select maintain_microworlds_jobs_v1()');
  assert.equal((await query('select status,reserved_micro_usd from microworlds_search_jobs where id=$1',[first.id]))[0].status,'unknown');
  assert.equal((await query('select reserved_micro_usd from microworlds_search_budgets'))[0].reserved_micro_usd,19500000);
  const second=(await enqueue(2)).id;
  const lease2=(await query('select claim_microworlds_search_v1($1) value',[second]))[0].value;
  assert.equal((await query('select record_microworlds_run_v1($1,$2,$3) value',[second,lease2.claim_token,'provider-run']))[0].value,true);
  await assert.rejects(db.query('select publish_microworlds_contacts_v1($1,$2,$3)',[second,claim,[]]),/cache lease lost/);
  await query('select publish_microworlds_contacts_v1($1,$2,$3)',[second,lease2.claim_token,[{contact_key:'a'.repeat(64),profile_hash:'b'.repeat(64),full_name_hash:'c'.repeat(64),contact_encrypted:'enc:v1.fixture'}]]);
  assert.equal((await query('select count(*)::integer n from microworlds_contact_cache'))[0].n,1);
  assert.equal((await query("select finish_microworlds_search_v1($1,$2,'completed',300000,1,null) value",[second,lease2.claim_token]))[0].value,true);
  assert.equal((await query("select finish_microworlds_search_v1($1,$2,'completed',300000,1,null) value",[second,lease2.claim_token]))[0].value,false,'receipt settles at most once');
  assert.deepEqual((await query('select reserved_micro_usd,spent_micro_usd from microworlds_search_budgets'))[0],{reserved_micro_usd:18000000,spent_micro_usd:300000});
  await db.exec(`insert into enriched_leads(id,organization_id,user_id,source_provider,source_provider_id,full_name,enrichment_status)
    values('${target}','${org}','${user}','apollo','apollo-ana','Ana Pe***z','pending');
    insert into antonia_quota_operations(organization_id,user_id,resource,operation_id,claim_token,status,consumed_count,quota_count_after)
    values('${org}','${user}','investigate','mixed','${claim}','claimed',2,2);
    insert into antonia_user_daily_credits values('${user}',2);`);
  const scope=[org,user,'investigate','mixed',claim];
  const registered=(await query('select register_hybrid_enrichment_item_v1($1,$2,$3,$4,$5,$6,$7,$8,true,true,$9) value',
    [...scope,target,'saved-ref','apollo-ana','enc:v1.fixture-plan']))[0].value;assert.equal(registered,true);
  await query("update antonia_quota_operations set status='submitted'");
  const applied=(await query('select apply_hybrid_cached_fields_v1($1,$2,$3,$4,$5,$6,$7) value',
    [...scope,target,{email:'ana@demo.test',emailStatus:'unknown',mobile:'+56912345678',fullName:'Ana Pérez'}]))[0].value;
  assert.equal(applied.cacheProcessed,true);
  assert.deepEqual((await query('select email,email_status,primary_phone from enriched_leads'))[0],{email:'ana@demo.test',email_status:'unknown',primary_phone:'+56912345678'});
  const repeat=(await query('select apply_hybrid_cached_fields_v1($1,$2,$3,$4,$5,$6,$7) value',[...scope,target,{email:'changed@demo.test'}]))[0].value;
  assert.equal(repeat.outcome,'replay');
  const callback='01000000-0000-4000-8000-000000000010';
  await query("insert into apollo_enrichment_callbacks values($1,$2,$3,'investigate','mixed',$4,'enriched_leads',$5,'terminal',now(),'apollo-ana')",[callback,org,user,target,'d'.repeat(64)]);
  assert.equal((await query('select settle_apollo_enrichment_quota_if_ready_v1($1) value',[callback]))[0].value,true);
  assert.equal((await query('select usage_count from antonia_user_daily_credits'))[0].usage_count,1,'same target cache+Apollo charged once; unprocessed reservation refunded');
  assert.equal((await query('select consumed_count,status from antonia_quota_operations'))[0].consumed_count,1);
  await query("update enriched_leads set email='edited@demo.test',primary_phone='+15550100001'");
  const filtered=(await query('select apply_apollo_enrichment_callback_v1($1,$2,$3,$4,$5) value',
    ['d'.repeat(64),'request','SUCCEEDED','e'.repeat(64),{email:'other@demo.test',email_status:'verified',primary_phone:'+56900000000',phone_numbers:[{sanitized_number:'+56900000000'}]}]))[0].value;
  assert.equal(filtered.email,undefined);assert.equal(filtered.email_status,undefined);assert.equal(filtered.primary_phone,undefined,'late callback cannot replace edits/cache');
  const grants=(await query("select has_table_privilege('authenticated','microworlds_contact_cache','select') browser,has_function_privilege('authenticated','claim_microworlds_search_v1(uuid)','execute') claim"))[0];
  assert.deepEqual(grants,{browser:false,claim:false});
  await db.exec("select set_config('request.jwt.claim.role','authenticated',false)");
  await assert.rejects(db.query('select enqueue_microworlds_search_v1($1,$2,$3,$4,$5)',[org,user,'f'.repeat(64),'demo.test',{}]),/not authorized/);
  console.log('PASS: real new SQL for budget reservation/dedup, claim fencing, receipt idempotency, private publication, gap fulfillment, union billing/refunds, late edit protection and service-only access. Existing Apollo callback body is a stub here; real baseline regression is covered by pgTAP CI.');
}catch(error){console.error(JSON.stringify({message:error.message,code:error.code,position:error.position,where:error.where}));process.exitCode=1;}finally{await db.close();}
