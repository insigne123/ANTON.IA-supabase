import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalLinkedInPost, isOpportunityAdmin, opportunityFinancialScenario, privateOpportunitySchema, assignmentSchema, opportunityLocalClock } from './workspace';
import { opportunityReportCoverage, validOpportunityCitation, validateOpportunityFacts } from './expedient';
import { opportunityUsageCost, opportunityModel } from './model-policy';
import { opportunityAttachmentLinks } from '@/lib/server/commercial-opportunities/workspace-download';
import {opportunitySourceDate} from './source-date';

test('private invites accept missing amount/deadline; assignment requires the responsible person among participants', () => {
  const input = privateOpportunitySchema.parse({ title: 'Propuesta de servicios', company: 'Cliente' });
  assert.equal(input.amount,null);assert.equal(input.deadline,null);
  assert.equal(isOpportunityAdmin('member'),false);assert.equal(isOpportunityAdmin('admin'),true);
  assert.equal(assignmentSchema.safeParse({ expectedRevision:0, teamId:null, participantIds:[], responsibleId:'11111111-1111-4111-8111-111111111111', objective:'',dueAt:null }).success,false);
});
test('financial outputs use explicit inputs; unknown tax stays unknown and invalid margin is refused', () => {
  const value=opportunityFinancialScenario({ monthlyCost:820,months:24,overheadPercent:8,marginPercent:10,taxPercent:null,paymentDelayMonths:4,guaranteePercent:5 });
  assert.ok(Math.abs(value.monthlyNet-1000)<1e-8);assert.equal(value.totalWithTax,null);assert.equal(value.workingCapital,3280);assert.ok(Math.abs(value.guarantee-1200)<1e-8);
  assert.throws(()=>opportunityFinancialScenario({ monthlyCost:10,months:24,overheadPercent:90,marginPercent:20,taxPercent:19,paymentDelayMonths:2,guaranteePercent:5 }));
});
test('LinkedIn evidence deduplicates tracking URLs by activity, refuses other hosts and preserves unknown identity', () => {
  assert.deepEqual(canonicalLinkedInPost('https://www.linkedin.com/posts/person-activity-7330988768578920448-demo?utm_source=share'),canonicalLinkedInPost('https://www.linkedin.com/feed/update/urn:li:activity:7330988768578920448/'));
  assert.equal(canonicalLinkedInPost('https://linkedin.com.attacker.test/posts/demo'),null);
  assert.equal(canonicalLinkedInPost('https://linkedin.com/in/demo'),null);
});
test('citations must refer to this expediente and quote its text; missing support does not become documented', () => {
  const chunks=[{id:'a',document_id:'d',ordinal:0,locator:'Página 3',content:'La garantía de seriedad es de $500.000.'}];
  assert.ok(validOpportunityCitation({chunkId:'a',quote:'garantía de seriedad es de $500.000'},chunks));
  assert.equal(validOpportunityCitation({chunkId:'other',quote:'garantía de seriedad es de $500.000'},chunks),false);
  assert.equal(validOpportunityCitation({chunkId:'a',quote:'contrato máximo de 20 años'},chunks),false);
  assert.equal(validateOpportunityFacts([{text:'Dato',state:'documented',citations:[]}],chunks)[0].state,'unknown');
  assert.equal(opportunityReportCoverage([{extraction_status:'partial'}]),'partial');assert.equal(opportunityReportCoverage([]),'partial');
});
test('daily local dates follow Chile DST instead of a fixed UTC offset', () => {
  assert.deepEqual(opportunityLocalClock(new Date('2026-07-01T11:00:00Z')),{day:'2026-07-01',hour:7});
  assert.deepEqual(opportunityLocalClock(new Date('2026-10-01T11:00:00Z')),{day:'2026-10-01',hour:8});
});
test('official deadlines without a timezone keep the local Chilean time in winter and summer',()=>{
 assert.equal(opportunitySourceDate('2026-07-01T15:30:00'),'2026-07-01T19:30:00.000Z');
 assert.equal(opportunitySourceDate('2026-10-01T15:30:00'),'2026-10-01T18:30:00.000Z');
 assert.equal(opportunitySourceDate('2026-07-01T15:30:00Z'),'2026-07-01T15:30:00.000Z');
});
test('Claude usage counts cache writes, cache reads and output including reasoning; missing usage is not free', () => {
  const price={input:2,output:10,cache:.1,write:4};
  assert.equal(opportunityUsageCost({modelName:'test',durationMs:1,usage:{prompt_tokens:1000,completion_tokens:100,prompt_tokens_details:{cached_tokens:200},cache_creation_input_tokens:300}},price),3220);
  assert.equal(opportunityUsageCost({modelName:'test',durationMs:1},price),null);
  assert.throws(()=>opportunityModel('report',{OPPORTUNITIES_REPORT_MODEL:'astra'}));
  assert.equal(opportunityModel('report',{}),'claude-haiku-5-5');
  assert.throws(()=>opportunityModel('report',{OPPORTUNITIES_REPORT_MODEL:'claude-sonnet-5-5'}),/no está permitido/,'Sonnet is out of the app');
});
test('annex discovery does not follow arbitrary other domains or javascript links', () => {
  assert.deepEqual(opportunityAttachmentLinks('<a href="/bases.pdf">Bases</a><a href="https://private.test/anexo.pdf">Anexo</a><a href="javascript:alert(1)">Anexo</a>', 'https://buyer.test/tender'),['https://buyer.test/bases.pdf']);
});
