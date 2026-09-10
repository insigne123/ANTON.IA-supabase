import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import path from 'node:path';
import { generateStructuredWithTelemetry, generateStructured, type StructuredTelemetry } from '@/ai/openai-json';
import { synthesizeReportV2 } from '@/ai/flows/synthesize-report-v2';
import { reasonAboutReportV2Account } from '@/ai/flows/reason-about-report-v2-account';
import { briefReportV2Specialists } from '@/ai/flows/report-v2-specialists';
import { selectReportV2EditorClaims, writeReportV2 } from '@/ai/flows/write-report-v2';
import { auditReportV2 } from '@/ai/flows/audit-report-v2';
import { ResearchSnapshotV1Schema } from '@/lib/research-contracts';
import { projectResearchSnapshotV1ToReportV2 } from '@/lib/report-v2-snapshot-adapter';
import { serializeReportV2Context, stripInternalIdsForReportPrompt } from '@/ai/flows/write-report-v2-section';
import { getReportModels } from '@/ai/report-models';
import { reportV2Markdown } from '@/lib/report-v2-markdown';
import { validateReportV2CoverageGapConsistency } from '@/lib/report-v2-coverage';

const { values: args } = parseArgs({ options: {
  output: { type: 'string' }, 'production-read-only': { type: 'boolean' }, replay: { type: 'string' },
  organization: { type: 'string' }, user: { type: 'string' }, lead: { type: 'string' }, role: { type: 'string' },
  'profile-only': { type: 'boolean' },
  'inspect-context': { type: 'boolean' }, 'allow-paid-calls': { type: 'boolean' },
} });
if (!args.output && !args['inspect-context']) throw new Error('--output required');
const output = args.output || '';
if (Boolean(args['production-read-only']) === Boolean(args.replay)) throw new Error('Choose --production-read-only or --replay');
if (args.role && !args.replay) throw new Error('--role only applies to replay simulations');
if (args['profile-only'] && !args.replay) throw new Error('--profile-only requires --replay');
if (args['inspect-context'] && !args.replay) throw new Error('--inspect-context requires --replay; no production access');
if (!args['inspect-context'] && !args['allow-paid-calls']) throw new Error('Paid model/search calls require --allow-paid-calls; use --inspect-context for offline inspection');
if (args.replay && output && path.resolve(args.replay).toLowerCase() === path.resolve(output).toLowerCase()) throw new Error('Output must differ from replay input');
const startedAt = Date.now();
const calls: StructuredTelemetry[] = [];
const save = (name: string, data: unknown) => writeFile(path.join(output, name), JSON.stringify(data, null, 2));
const generate: typeof generateStructuredWithTelemetry = async (options) => {
  if (options.allowDefaultModelFallback !== false || options.openAiModels?.length !== 1 || options.openAiModels[0] !== 'gpt-5.6-luna') throw new Error('REPORT_MODEL_POLICY_VIOLATION');
  const result = await generateStructuredWithTelemetry(options);
  calls.push(result.telemetry);
  return result;
};
const generateData: typeof generateStructured = async (options) => (await generate(options)).data;

async function main() {
  let configuration;
  let projection;
  let snapshot;
  if (args.replay) {
    const replay = args.replay;
    configuration = JSON.parse(await readFile(path.join(replay, 'configuration.json'), 'utf8'));
    projection = JSON.parse(await readFile(path.join(replay, 'research.json'), 'utf8'));
    snapshot = ResearchSnapshotV1Schema.parse(JSON.parse(await readFile(path.join(replay, 'snapshot.json'), 'utf8')));
    if (args.role) {
      projection.entity.contact = { ...projection.entity.contact, fullName: 'Contacto simulado para evaluar el rol', title: args.role, seniority: 'director', department: args.role, linkedinUrl: null };
      projection.committee = [];
    }
    if (args['profile-only']) {
      projection = { ...projection, sources: [], facts: [], claims: [], shortIdMap: {}, committee: [], initialGaps: [], researchMetrics: { queries: 0, pages: 0, elapsedMs: 0 }, researchWarnings: ['web_context_unavailable'] };
    }
  } else {
    const { gatherReportV2Research } = await import('@/lib/server/research-report-v2-research');
    const { getSupabaseAdminClient } = await import('@/lib/server/supabase-admin');
    const { loadReportV2SellerConfiguration } = await import('@/lib/server/seller-profile');
    if (process.env.NEXT_PUBLIC_SUPABASE_URL !== 'https://yfdelflsheurzaicwayi.supabase.co') throw new Error('PRODUCTION_PROJECT_MISMATCH');
    const organizationId = args.organization!;
    const userId = args.user!;
    const leadId = args.lead!;
    if (![organizationId, userId, leadId].every((id) => /^[0-9a-f-]{36}$/i.test(id))) throw new Error('EXACT_SCOPE_REQUIRED');
    const admin = getSupabaseAdminClient();
    const { data: job, error: jobError } = await admin.from('lead_research_jobs').select('research_snapshot_id').eq('organization_id', organizationId).eq('user_id', userId).eq('lead_id', leadId).not('research_snapshot_id', 'is', null).order('created_at', { ascending: false }).limit(1).single();
    if (jobError) throw jobError;
    const { data, error } = await admin.from('research_snapshots').select('payload').eq('id', job.research_snapshot_id).eq('organization_id', organizationId).eq('user_id', userId).single();
    if (error) throw error;
    snapshot = ResearchSnapshotV1Schema.parse(data.payload);
    if (snapshot.subject.leadId !== leadId && snapshot.subject.leadRef !== leadId) throw new Error('SCOPED_SNAPSHOT_NOT_FOUND');
    configuration = await loadReportV2SellerConfiguration({ organizationId, userId }, admin);
    const baseline = projectResearchSnapshotV1ToReportV2({ snapshot, ...configuration, generatedAt: new Date().toISOString() });
    console.log('Research: fresh public sources, scoped production reads only.');
    projection = await gatherReportV2Research({ projection: baseline, ...configuration, organizationId, language: 'es' }, { generate: generateData });
  }
  if (args['inspect-context']) {
    const context = {
      entity: projection.entity, claims: projection.claims, facts: projection.facts,
      sellerProfile: configuration.sellerProfile, companyContext: snapshot.subject.company.description,
      qualification: projection.qualification, committee: projection.committee, gaps: projection.initialGaps,
    };
    const sizes = Object.entries(context).map(([name, value]) => {
      const originalBytes = Buffer.byteLength(JSON.stringify(value) ?? 'null');
      const metadataOnlyBytes = Buffer.byteLength(JSON.stringify(stripInternalIdsForReportPrompt(value, true)) ?? 'null');
      const compactBytes = Buffer.byteLength(serializeReportV2Context(value));
      return { name, originalBytes, metadataOnlyBytes, compactBytes, savedPercent: Number((100 * (1 - compactBytes / originalBytes)).toFixed(1)), tableSavedPercent: Number((100 * (1 - compactBytes / metadataOnlyBytes)).toFixed(1)) };
    });
    console.log(JSON.stringify({ stage: 'offline_context_inspection', models: getReportModels('reasoning'), networkCalls: 0, writes: 0, sizes, note: 'Input JSON bytes, not token counts or a quality evaluation. All evidence retained.' }, null, 2));
    return;
  }
  await mkdir(output, { recursive: true });
  await save('snapshot.json', snapshot);
  await save('configuration.json', configuration);
  await save('research.json', projection);
  console.log(JSON.stringify({ stage: 'research_ready', claims: projection.claims.length, sources: projection.sources.length, researchMetrics: projection.researchMetrics }));
  let editorialAttempt = 0;
  let auditAttempt = 0;
  const result = await synthesizeReportV2({
    researchSnapshotId: snapshot.id, scope: { organizationId: snapshot.scope.organizationId!, ownerUserId: snapshot.scope.ownerUserId },
    ...projection, sellerProfile: configuration.sellerProfile, companyContext: snapshot.subject.company.description,
    synthesisContextHash: configuration.synthesisContextHash, language: 'es',
  }, {
    reason: async (input) => {
      const result = await reasonAboutReportV2Account(input, {
      generateWithTelemetry: generate,
      specialists: async (input) => {
        const result = await briefReportV2Specialists(input, { generate });
        await save('specialists.json', result);
        return result;
      },
      });
      await save('analysis.json', result);
      return result;
    },
    write: async (input) => {
      await save(`editor-context-${editorialAttempt + 1}.json`, {
        availableClaims: input.claims.length,
        selectedClaimIds: (input.repair ? input.claims : selectReportV2EditorClaims(input.analysis, input.claims, input.signals)).map((claim) => claim.id),
        repair: Boolean(input.repair),
      });
      const result = await writeReportV2(input, { generate });
      await save(`editor-${++editorialAttempt}.json`, result);
      return result;
    },
    audit: async (input) => {
      const result = await auditReportV2(input, { generate });
      await save(`audit-${++auditAttempt}.json`, result);
      return result;
    },
  });
  validateReportV2CoverageGapConsistency(result.document);
  const estimatedModelCostUsd = calls.reduce((sum, call) => {
    const usage = call.usage as any;
    const inputRate = 0.2;
    const outputRate = 1.2;
    const cached = Number(usage?.prompt_tokens_details?.cached_tokens) || 0;
    const written = Number(usage?.prompt_tokens_details?.cache_write_tokens) || 0;
    const plain = Math.max(0, (Number(usage?.prompt_tokens) || 0) - cached - written);
    return sum + (plain * inputRate + cached * inputRate * 0.1 + written * inputRate * 1.25 + (Number(usage?.completion_tokens) || 0) * outputRate) / 1_000_000;
  }, 0);
  await save('model-calls.json', calls);
  const tokenUsage = calls.reduce((sum, call) => ({ input: sum.input + (Number(call.usage?.prompt_tokens) || 0), output: sum.output + (Number(call.usage?.completion_tokens) || 0) }), { input: 0, output: 0 });
  await save('result.json', { ...result, tokenUsage, elapsedMs: Date.now() - startedAt, writesToProduction: 0, emailsSent: 0, simulatedRole: Boolean(args.role), profileOnly: Boolean(args['profile-only']), estimatedModelCostUsd, costNote: 'Internal-rate estimate from recorded successful calls, not an official bill or full research cost; excludes search, hosting and failed attempts. Rates: input $0.20/M, output $1.20/M, cache read x0.1, cache write x1.25; 2026-09-08.' });
  await writeFile(path.join(output, 'report.md'), `${args.role ? '> SIMULACION DE ROL. No representa un contacto real adicional.\n\n' : ''}${args['profile-only'] ? '> EVALUACION SOLO CON PERFIL. Sin fuentes web en esta variante.\n\n' : ''}${reportV2Markdown(result.document)}`, 'utf8');
  console.log(JSON.stringify({ stage: 'finished', status: result.document.synthesis.status, audit: result.document.audit.status, issues: result.document.audit.issues, calls: calls.length, tokenUsage, estimatedModelCostUsd, seconds: Math.round((Date.now() - startedAt) / 1000), report: path.join(output, 'report.md') }));
}

main().catch(async (error) => {
  if (!args['inspect-context']) {
    await mkdir(output, { recursive: true });
    await save('failure.json', { error: String(error), stack: error?.stack, elapsedMs: Date.now() - startedAt });
    await save('model-calls.json', calls);
  }
  console.error(error);
  process.exitCode = 1;
});
