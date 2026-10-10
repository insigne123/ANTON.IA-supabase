import assert from 'node:assert/strict';
import test from 'node:test';
import {buildUsageReport,cohortConversion,commercialCounts,usageDiagnostics,usageModuleForPath,usageQuerySchema,usageReportCsv,type UsageFact,type UsagePerson,type AdminUsageReport} from './usage';
const org='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002',uid='00000000-0000-4000-8000-000000000003';
const q={from:'2026-09-01',to:'2026-09-30',horizon:14},now=new Date('2026-10-10T12:00:00Z');
const fact=(extra:Partial<UsageFact>={}):UsageFact=>({organizationId:org,userId:uid,day:'2026-09-01',module:'email',kind:'module_opened',status:'observed',actor:'user',count:1,firstAt:'2026-09-01T12:00:00Z',lastAt:'2026-09-01T12:00:00Z',...extra});
test('scope dates are real calendar dates and the report range is bounded',()=>{
  assert.equal(usageQuerySchema.safeParse({...q,from:'2026-02-30'}).success,false);
  assert.equal(usageQuerySchema.safeParse({...q,from:'2024-02-29',to:'2024-03-01'}).success,true);
  assert.equal(usageQuerySchema.safeParse({...q,from:'2024-01-01',to:'2026-09-30'}).success,false);
  assert.equal(usageQuerySchema.safeParse({...q,horizon:'14'}).success,true);
  assert.equal(usageQuerySchema.safeParse({...q,organizationId:'foreign'}).success,false);
});
test('navigation captures module names, never path queries or a public password flow',()=>{
  assert.equal(usageModuleForPath('/dashboard/admin/usage'),'admin');assert.equal(usageModuleForPath('/dashboard'),'home');
  assert.equal(usageModuleForPath('/contact/compose'),'email');assert.equal(usageModuleForPath('/sheet'),'contacts');
  assert.equal(usageModuleForPath('/restablecer-clave'),null);assert.equal(usageModuleForPath('/api/auth/callback'),null);
});
test('conversion uses unique scoped contacts, mature windows and classified replies from the same cohort',()=>{
  const contact={organizationId:org,userId:uid,recipientKey:'recipient',sentAt:'2026-09-01T12:00:00Z',replyAt:'2026-09-03T12:00:00Z',intent:'positive',reliable:true};
  const result=cohortConversion([contact,{...contact,sentAt:'2026-09-02T12:00:00Z'},
    {...contact,recipientKey:'automatic',intent:'auto_reply'}, {...contact,recipientKey:'outside',replyAt:'2026-09-25T12:00:00Z'},
    {...contact,organizationId:other}],q,now);
  assert.equal(result.contacted,4);assert.equal(result.mature,4);assert.equal(result.replies,2);assert.equal(result.interested,2);assert.equal(result.replyRate,50);
  const recent=cohortConversion([{...contact,sentAt:'2026-09-29T12:00:00Z'}],q,new Date('2026-10-01T00:00:00Z'));
  assert.equal(recent.observing,1);assert.equal(recent.replyRate,null);
});
test('unknown classification, missing linkage and an empty denominator do not become zero success/failure',()=>{
  const contact={organizationId:org,userId:uid,recipientKey:'recipient',sentAt:'2026-09-01T12:00:00Z',replyAt:'2026-09-03T12:00:00Z',intent:null,reliable:true};
  assert.equal(cohortConversion([contact],q,now).replyRate,null);
  assert.equal(cohortConversion([{...contact,intent:'positive',reliable:false}],q,now).unknown,1);
  assert.equal(cohortConversion([],q,now).replyRate,null);
});
test('a later positive response is retained and a neutral response does not prove complete interest observation',()=>{
  const contact={organizationId:org,userId:uid,recipientKey:'one',sentAt:'2026-09-01T12:00:00Z',replyAt:'2026-09-02T12:00:00Z',intent:'neutral',reliable:true,interestedAt:'2026-09-08T12:00:00Z',interestReliable:true};
  const yes=cohortConversion([contact],q,now);assert.equal(yes.replyRate,100);assert.equal(yes.interestRate,100);
  const partial=cohortConversion([{...contact,interestedAt:null,interestReliable:false}],q,now);assert.equal(partial.replyRate,100);assert.equal(partial.interestRate,null);
  assert.equal(usageDiagnostics([],[],partial).some(d=>d.category==='strategy'),false);
});
test('commercial entities are deduplicated across days and aliases while different meetings remain different',()=>{
  const counts=commercialCounts([fact({kind:'contact_sent',entityKeys:['same']}),fact({kind:'contact_sent',day:'2026-09-02',entityKeys:['same']}),
    fact({kind:'meeting_registered',entityKeys:['meeting-1','meeting-2']}),fact({kind:'call_completed',entityKeys:['call']})]);
  assert.equal(counts.contacted,1);assert.equal(counts.meetingRegistered,2);assert.equal(counts.meetingCompleted,0);
});
test('human adoption, machine work, app credits and former members retain separate meanings',()=>{
  const person:UsagePerson={id:uid,organizationId:org,name:'Ana',email:'ana@example.test',member:true,groupIds:[]};
  const data=buildUsageReport({facts:[fact(),fact({organizationId:other}),fact({day:'2026-09-02',kind:'research_completed',actor:'system'}),fact({day:'2026-09-03',actor:'unknown'})],
    credits:[{organizationId:org,userId:uid,groupId:null,day:'2026-09-01',resource:'enrich',net:5,debits:8,refunds:3,source:'journal'}],
    cohort:[],pending:[],people:[person,{...person,organizationId:other}],organizations:[{id:org,name:'Demo'},{id:other,name:'Other'}],groups:[],
    coverage:{captureFrom:null,journalFrom:null,unavailable:[],legacyReplies:0,unassignedCredits:0,source:'sql'}},q,now);
  assert.equal(data.summary.active,1,'one person in two companies is not two platform users');
  assert.equal(data.summary.activeDays,1);assert.equal(data.summary.credits,5);assert.equal(data.summary.commercial.researchCompleted,1);
  assert.equal(data.people[0].activeDays,1);assert.equal(data.people[1].credits,null);
});
test('diagnostics prioritize verified technical/pending work, keep safety holds expected and never blame a recent contact',()=>{
  const conversion=cohortConversion([],q,now);
  const diagnostics=usageDiagnostics([],[{organizationId:org,userId:uid,kind:'positive_pending',count:2},{organizationId:org,userId:uid,kind:'unknown_send',count:1},{organizationId:org,userId:uid,kind:'safety_hold',count:4}],conversion);
  assert.equal(diagnostics[0].category,'technical');assert.equal(diagnostics[1].category,'pending');assert.equal(diagnostics[2].category,'protection');
  assert.equal(diagnostics.some(d=>d.category==='strategy'),false);assert.match(diagnostics[0].detail,/antes de volver a enviar/);
});
test('CSV export uses the selected report and neutralizes spreadsheet formula cells',()=>{
  const person:UsagePerson={id:uid,organizationId:org,name:'  =HYPERLINK("bad")',email:'a@example.test',member:true,groupIds:[]};
  const base=buildUsageReport({facts:[],credits:[],cohort:[],people:[person],pending:[],organizations:[{id:org,name:'Demo'}],groups:[],coverage:{captureFrom:null,journalFrom:null,unavailable:[],legacyReplies:0,unassignedCredits:0,source:'sql'}},q,now);
  const csv=usageReportCsv({...base,platform:false,viewerUserId:uid,selectedOrganizationId:org,activeOrganizationId:org,ready:true,limits:[]} as AdminUsageReport);
  assert.ok(csv.startsWith('\uFEFF'));assert.ok(csv.includes("'  =HYPERLINK"));assert.ok(csv.includes('Demo'));
});
