// End to end: does what the web researcher (RESEARCH_CLAUDE_WEB_ENABLED) finds reach the email, and is the email better for it?
// The chain is the real one, stage by stage, with no database and no sends:
//   gatherReportV2Research (± the researcher) -> synthesizeReportV2 (Luna, as production) -> buildDraftContextV2 with that report
//   -> the first email of the app (generateOutreachFromDraftContextV2 + preflight + one corrective retry) -> a Claude judge that sees
//   exactly the evidence the writer saw.
// What it measures that evaluate-research-sources.ts does not: how much of the research survives the report (audit, angle, freshness,
// «mentions the company») and the draft context filters, and what the email says once it does.
//
// ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY_TEST" node --loader ./scripts/ts-test-loader.mjs scripts/evaluate-research-drafts.ts \
//   [--targets=Enaex,Besalco] [--modes=sin,con,pro] [--out=dir] [--concurrency=3] [--reuse=dir [--reuse-docs]]
// Modes: sin = only the company's own site, con = plus the researcher that picks pages, pro = con plus the Claude that picks the signals out of
// the facts (RESEARCH_SIGNAL_HARVEST_ENABLED). `pro` reads the research of `con` (from --reuse, or it runs it) so both see the same pages.
// Needs OPENAI_API_KEY (Luna: research, report and email) and ANTHROPIC_API_KEY (the researcher and the judge). Without SERPER_API_KEY the
// search engine of production is replaced by nothing, so `sin` is «only the company's own site» and `con` is what the researcher adds.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gatherReportV2Research } from '../src/lib/server/research-report-v2-research';
import { claudeWebSourcesSettings } from '../src/lib/server/claude-web-sources';
import { harvestResearchSignals, signalHarvestSettings } from '../src/lib/server/research-signal-harvest';
import { consolidateReportV2Claims } from '../src/ai/flows/extract-report-v2-claims';
import { buildStableReportV2Id } from '../src/lib/report-v2-ids';
import { synthesizeReportV2 } from '../src/ai/flows/synthesize-report-v2';
import { qualifyEntityV2 } from '../src/qualification/icp-gate';
import { buildReportV2Committee } from '../src/ai/flows/build-report-v2-committee';
import { generateOutreachFromDraftContextV2 } from '../src/ai/flows/generate-outreach-from-report';
import { judgeOutreach, judgeVerdict } from '../src/ai/flows/judge-outreach';
import { buildDraftContextV2, createDefaultDraftWritingStyleV2, normalizeDraftSellerProfileV2 } from '../src/lib/server/draft-context-v2';
import { DRAFT_FIXTURE_IDS, draftSnapshotFixture } from '../src/lib/server/draft-v2-test-fixtures';
import { validateDraftPreflightV2 } from '../src/lib/server/draft-preflight-v2';
import { resolveEffectiveCta } from '../src/lib/server/native-drafts';
import { OUTREACH_OPENING_KINDS } from '../src/lib/outreach-example-library';
import { canonicalSha256 } from '../src/lib/messaging-contracts';
import { isClaudeModel } from '../src/ai/anthropic-json';

const writerModel = process.env.OUTREACH_EVAL_MODEL?.trim() || 'gpt-6-luna';
const judgeModel = process.env.OUTREACH_JUDGE_MODEL?.trim() || 'claude-opus-5-5';
if (!process.env.OPENAI_API_KEY || !process.env.ANTHROPIC_API_KEY) throw new Error('OPENAI_API_KEY and ANTHROPIC_API_KEY required');
// The writer is the one of the bank (Luna unless told otherwise); the judge is set only once every email is written.
process.env.SUPLIA_OPENAI_REASONING_MODEL = writerModel;
process.env.OPENAI_REASONING_MODEL = writerModel;
const arg = (name: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);

const TARGETS = [
  { companyName: 'Enaex', domain: 'enaex.com', about: 'Enaex produce nitrato de amonio y explosivos y presta servicios de tronadura a la minería en Chile y otros países.' },
  { companyName: 'Aguas Andinas', domain: 'aguasandinas.cl', about: 'Aguas Andinas es la sanitaria que abastece de agua potable y trata aguas servidas en la Región Metropolitana de Santiago.' },
  { companyName: 'Besalco', domain: 'besalco.cl', about: 'Besalco es un grupo chileno de construcción, ingeniería, maquinaria y concesiones, con obras civiles, mineras e inmobiliarias.' },
  { companyName: 'Sodexo Chile', domain: 'sodexo.cl', about: 'Sodexo Chile presta servicios de alimentación, aseo y mantenimiento a empresas, faenas mineras, hospitales y colegios.' },
  { companyName: 'SMU', domain: 'smu.cl', about: 'SMU es una cadena chilena de supermercados con las marcas Unimarc, Alvi y Mayorista 10.' },
  { companyName: 'Salfacorp', domain: 'salfacorp.cl', about: 'Salfacorp es una constructora e inmobiliaria chilena con obras de edificación, infraestructura e ingeniería.' },
  { companyName: 'Ingevec', domain: 'ingevec.cl', about: 'Ingevec es una constructora e inmobiliaria chilena de edificación en altura y obras industriales.' },
  { companyName: 'Gasco', domain: 'gasco.cl', about: 'Gasco distribuye gas licuado y gas natural en Chile y otros países de la región.' },
];
const names = arg('targets')?.split(',').map(value => value.trim().toLowerCase());
const targets = names ? TARGETS.filter(target => names.includes(target.companyName.toLowerCase())) : TARGETS;
type Mode = 'sin' | 'con' | 'pro';
const modes = (arg('modes')?.split(',') ?? ['sin', 'con']).filter((mode): mode is Mode => mode === 'sin' || mode === 'con' || mode === 'pro');
const concurrency = Math.max(1, Number(arg('concurrency') || 3));
// --reuse=dir loads the researches a previous run saved in dir/research (so a change in the stages after the research is compared on the same evidence).
const reuseDir = arg('reuse') ? resolve(arg('reuse')!) : null;
// --reuse-docs also loads the report documents of that run (dir/documents), to compare the stages after the report on the same document.
const reuseDocs = process.argv.includes('--reuse-docs');
// --inject (only with `pro`): the best signal of the Claude is also put in the snapshot as the draft bank does with a hand-fed one (an upper bound
// of what a crisp signal does to the email with the writer of production, whatever the filters between the report and the draft let through).
const inject = process.argv.includes('--inject');
const outDir = resolve(arg('out') || join('.eval-research-drafts', new Date().toISOString().replace(/[:.]/g, '-')));
mkdirSync(join(outDir, 'research'), { recursive: true });
mkdirSync(join(outDir, 'documents'), { recursive: true });

const SELLER_PROFILE = { companyName: 'Yago SpA', products: [{ key: 'axis', name: 'AXIS', description: 'consulta antecedentes laborales de postulantes en el PJUD y procesa 1.000 personas en unos 30 minutos' }] } as any;
// The seller as «Perfil» stores it: the same AXIS profile the draft bank uses.
const SELLER = normalizeDraftSellerProfileV2({
  name: 'Nicolás Yarur', jobTitle: 'Gerente Comercial', companyName: 'Yago SpA', companyDomain: 'yago.cl', sector: 'Software B2B para recursos humanos',
  services: ['AXIS: consultas judiciales automáticas en el Poder Judicial (PJUD) para revisar antecedentes laborales'],
  valueProposition: 'Revisa antecedentes laborales de postulantes con consultas judiciales automáticas, sin trámites manuales.',
  description: 'Yago automatiza una verificación repetitiva sobre las personas que una empresa contrata.',
  proofPoints: ['Un cliente en piloto ya lo usa a diario en reclutamiento'],
});
const RECIPIENT_ROLE = 'Gerente de Personas';
const researcher = claudeWebSourcesSettings({ ...process.env, RESEARCH_CLAUDE_WEB_ENABLED: 'true' });
const NOW = Date.now();
const DAY = 86_400_000;
// The research of the snapshot is «from three days ago» and valid for a month, as in the draft bank: with fixed dates the set stops serving the day they expire.
const ASOF = new Date(NOW - 3 * DAY).toISOString();
const VALID_UNTIL = new Date(NOW + 27 * DAY).toISOString();

/** What a research of the company would leave in the snapshot: its overview and the role. The same in both modes, so only the report differs. */
function buildSnapshot(target: typeof TARGETS[number], index: number, signal?: { statement: string; date: string; host: string }) {
  const snapshot: any = draftSnapshotFixture({ includeRole: true });
  const asOf = ASOF;
  const validUntil = VALID_UNTIL;
  const slug = target.companyName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  snapshot.subject = {
    leadRef: slug, leadId: slug, email: `contacto@${target.domain}`, person: { title: RECIPIENT_ROLE },
    company: { name: target.companyName, domain: target.domain, websiteUrl: `https://${target.domain}`, description: target.about, country: 'CL' },
  };
  snapshot.sources = [
    { id: 'source-empresa', type: 'official_site', url: `https://${target.domain}`, canonicalUrl: `https://${target.domain}`, title: target.companyName, provider: 'eval', retrievedAt: asOf, reliability: 0.85 },
    { id: 'source-rol', type: 'linkedin', url: `https://www.linkedin.com/in/eval-${slug}`, canonicalUrl: `https://www.linkedin.com/in/eval-${slug}`, title: RECIPIENT_ROLE, provider: 'eval', retrievedAt: asOf, reliability: 0.75 },
  ];
  snapshot.evidence = [
    { id: 'evidence-empresa', subjectScope: 'company', kind: 'fact', path: 'eval.company', statement: target.about, sourceId: 'source-empresa', extractedAt: asOf, confidence: 0.8, extraction: { method: 'rule', provider: 'eval', version: 'eval/v1' } },
    { id: 'evidence-rol', subjectScope: 'person', kind: 'profile_field', path: 'eval.person', statement: `El contacto figura como ${RECIPIENT_ROLE} en ${target.companyName}.`, sourceId: 'source-rol', extractedAt: asOf, confidence: 0.75, extraction: { method: 'rule', provider: 'eval', version: 'eval/v1' } },
  ];
  snapshot.claims = [
    { id: 'claim-empresa-overview', kind: 'company_overview', subjectScope: 'company', classification: 'fact', statement: target.about, supportingEvidenceIds: ['evidence-empresa'], contradictingEvidenceIds: [], confidence: 0.8,
      freshness: { asOf, validUntil, policyVersion: 'research-freshness/v1' }, derivation: { method: 'rule', promptVersion: 'eval/v1' } },
    { id: 'claim-rol', kind: 'lead_role', subjectScope: 'person', classification: 'fact', statement: `El contacto ocupa el cargo de ${RECIPIENT_ROLE}.`, supportingEvidenceIds: ['evidence-rol'], contradictingEvidenceIds: [], confidence: 0.75,
      freshness: { asOf, validUntil, policyVersion: 'research-freshness/v1' }, derivation: { method: 'rule', promptVersion: 'eval/v1' } },
  ];
  if (signal) {
    snapshot.sources.push({ id: 'source-senal', type: 'news', url: `https://${target.domain}/noticias`, canonicalUrl: `https://${target.domain}/noticias`, title: `${target.companyName} señal`, provider: 'eval', retrievedAt: asOf, reliability: 0.8 });
    snapshot.evidence.push({ id: 'evidence-senal', subjectScope: 'company', kind: 'fact', path: 'eval.signal', statement: `${signal.statement.replace(/[.]+$/, '')} (${signal.host}, ${signal.date}).`, sourceId: 'source-senal', extractedAt: asOf, confidence: 0.8, extraction: { method: 'rule', provider: 'eval', version: 'eval/v1' } });
    snapshot.claims.push({ id: 'claim-senal', kind: 'company_overview', subjectScope: 'company', classification: 'fact', statement: signal.statement, supportingEvidenceIds: ['evidence-senal'], contradictingEvidenceIds: [], confidence: 0.78,
      freshness: { asOf, validUntil, policyVersion: 'research-freshness/v1' }, derivation: { method: 'rule', promptVersion: 'eval/v1' } });
  }
  void index;
  return snapshot;
}

const wordCount = (value: string) => value.match(/[\p{L}\p{N}]+/gu)?.length || 0;
const hostOf = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return '?'; } };
const withCta = (context: any, exactText: string) => exactText === context.constraints.cta.exactText ? context : { ...context, constraints: { ...context.constraints, cta: { ...context.constraints.cta, exactText } } };

/** Like the app: one generation and one corrective retry with the errors of the preflight. */
async function writeEmail(context: any, openingKind: string | undefined) {
  const validate = (candidate: { subject: string; body: string; personalization: unknown; hypothesisIds: unknown }) => {
    const effective = withCta(context, resolveEffectiveCta(context, candidate.body, undefined));
    const body = `${candidate.body}\n\n${effective.constraints.cta.exactText}`;
    const validation = validateDraftPreflightV2(effective, { subject: candidate.subject, body, personalization: candidate.personalization as never, hypothesisIds: candidate.hypothesisIds as never }, { checkGeneratedCopy: true, checkHumanTone: true });
    return { validation, body };
  };
  const base = { context, ...(openingKind ? { openingKind } : {}) } as Record<string, unknown>;
  let output = await generateOutreachFromDraftContextV2(base as never);
  let checked = validate({ subject: output.subject, body: output.body, personalization: output.personalization, hypothesisIds: output.hypothesisIds });
  let attempts = 1;
  if (!checked.validation.valid) {
    output = await generateOutreachFromDraftContextV2({ ...base, rewrite: { previous: { subject: output.subject, body: output.body, personalization: output.personalization, hypothesisIds: output.hypothesisIds }, errors: checked.validation.issues.map((issue: any) => issue.message) } } as never);
    checked = validate({ subject: output.subject, body: output.body, personalization: output.personalization, hypothesisIds: output.hypothesisIds });
    attempts = 2;
  }
  return { subject: output.subject, body: checked.body, valid: checked.validation.valid, attempts, issues: checked.validation.issues.map((issue: any) => String(issue.message)), cta: resolveEffectiveCta(context, checked.body, undefined) };
}

type Row = Record<string, any>;
async function runOne(target: typeof TARGETS[number], index: number, mode: Mode): Promise<Row> {
  const started = Date.now();
  const row: Row = { company: target.companyName, mode, stage: 'research' };
  try {
    const baseline = {
      entity: { companyName: target.companyName, companyDomain: target.domain, contactCountry: 'CL', operatingCountries: [], countryScopedPaths: {}, excludedPaths: [], ambiguities: [],
        contact: { fullName: 'Contacto', title: RECIPIENT_ROLE, seniority: 'manager', department: 'Recursos Humanos', tenureMonths: null, companyTenureMonths: null, linkedinUrl: null } },
      qualification: { verdict: 'qualified', allowedDepth: 'shallow', reasons: [], redirectTo: [] },
      sources: [], facts: [], claims: [], shortIdMap: {}, committee: [], initialGaps: [],
    } as any;
    const generatedAt = new Date().toISOString();
    const slug = target.companyName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const file = (dir: string, name: string) => join(dir, 'research', `${slug}-${name}.json`);
    const researchOf = async (name: 'sin' | 'con'): Promise<any> => reuseDir && existsSync(file(reuseDir, name))
      ? JSON.parse(readFileSync(file(reuseDir, name), 'utf8'))
      : gatherReportV2Research({ projection: baseline, sellerProfile: SELLER_PROFILE, organizationId: DRAFT_FIXTURE_IDS.organization, language: 'es', generatedAt, depth: 'standard' }, {
        ...(process.env.SERPER_API_KEY ? {} : { search: async () => ({ items: [] }) as any }),
        claudeWeb: name === 'con' ? researcher : null,
        signalHarvest: null,
      });
    let projection: any = await researchOf(mode === 'pro' ? 'con' : mode);
    if (mode === 'pro') {
      const settings = signalHarvestSettings({ ...process.env, RESEARCH_SIGNAL_HARVEST_ENABLED: 'true' });
      if (!settings) throw new Error('The signal harvest needs ANTHROPIC_API_KEY');
      const harvest = await harvestResearchSignals({
        companyName: target.companyName, companyDomain: target.domain, country: 'CL', contactTitle: RECIPIENT_ROLE, department: 'Recursos Humanos', sellerOffer: SELLER_PROFILE.products[0].description,
        sources: projection.sources, facts: projection.facts, existingSignals: projection.claims.filter((claim: any) => claim.dimension === 'signal').map((claim: any) => claim.statement), today: generatedAt,
      }, settings);
      // The claims of the research as drafts again, with the new signals among them, consolidated as the research does.
      const drafts = projection.claims.map((claim: any) => ({
        internalId: projection.shortIdMap[claim.id] || buildStableReportV2Id('f', { statement: claim.statement }), type: 'fact', dimension: claim.dimension, targetField: 'industry',
        statement: claim.statement, evidenceIds: claim.evidenceIds, observedAt: claim.observedAt, freshnessDays: claim.freshnessDays, jurisdiction: claim.jurisdiction, scope: claim.scope, confidence: claim.confidence,
      }));
      const consolidated = consolidateReportV2Claims({ drafts: [...drafts, ...harvest.drafts], facts: projection.facts });
      projection = { ...projection, claims: consolidated.claims, shortIdMap: consolidated.shortIdMap };
      const sourceById = new Map<string, any>(projection.sources.map((item: any) => [item.id, item]));
      const factById = new Map<string, any>(projection.facts.map((item: any) => [item.id, item]));
      const items = harvest.drafts.map(draft => ({ statement: draft.statement, date: String(draft.observedAt).slice(0, 10),
        host: new URL(sourceById.get(factById.get(draft.evidenceIds[0])?.sourceId)?.url ?? `https://${target.domain}`).hostname.replace(/^www\./, '') }))
        .sort((left, right) => right.date.localeCompare(left.date));
      row.harvest = { candidates: harvest.candidates, picked: harvest.picked, accepted: harvest.drafts.length, rejected: harvest.rejected, usage: harvest.usage, items,
        signals: items.map(item => `${item.date} · ${item.statement}`) };
    }
    writeFileSync(file(outDir, mode), JSON.stringify(projection, null, 1));
    const recentFacts = projection.facts.filter((fact: any) => {
      const source = projection.sources.find((item: any) => item.id === fact.sourceId);
      const date = fact.observedAt || source?.publishedAt;
      return date && NOW - Date.parse(date) <= 180 * DAY && Date.parse(date) <= NOW + DAY;
    });
    Object.assign(row, {
      stage: 'report', seconds: Math.round((Date.now() - started) / 1000), pages: projection.researchMetrics?.pages, claudeWeb: projection.researchMetrics?.claudeWeb ?? null,
      facts: projection.facts.length, recentFacts: recentFacts.length, claims: projection.claims.length,
      signalClaims: projection.claims.filter((claim: any) => claim.type === 'fact' && claim.dimension === 'signal' && claim.observedAt).length,
    });

    // As production, between the research and the synthesis.
    projection.qualification = qualifyEntityV2({ entity: projection.entity, rules: null, productKeys: SELLER_PROFILE.products.map((product: any) => product.key), headcount: null });
    projection.committee = buildReportV2Committee({ entity: projection.entity, qualification: projection.qualification, claims: projection.claims });
    const documentFile = (dir: string) => join(dir, 'documents', `${slug}-${mode}.json`);
    const document: any = reuseDir && reuseDocs && existsSync(documentFile(reuseDir))
      ? JSON.parse(readFileSync(documentFile(reuseDir), 'utf8'))
      : (await synthesizeReportV2({
        researchSnapshotId: DRAFT_FIXTURE_IDS.snapshot, scope: { organizationId: DRAFT_FIXTURE_IDS.organization, ownerUserId: DRAFT_FIXTURE_IDS.user },
        language: 'es', ...projection, sellerProfile: SELLER_PROFILE, companyContext: target.about, generatedAt, revision: 1, synthesisContextHash: 'eval', depth: 'standard',
      })).document;
    writeFileSync(documentFile(outDir), JSON.stringify(document, null, 1));
    const angle = document.sections.find((section: any) => section.key === 'angle');
    Object.assign(row, {
      stage: 'context', seconds: Math.round((Date.now() - started) / 1000), reportStatus: document.synthesis.status, audit: document.audit.status,
      auditIssues: document.audit.issues.map((issue: any) => `${issue.severity}:${issue.type}`),
      reportClaims: document.evidenceGraph.claims.length, reportSources: document.evidenceGraph.sources.length,
      angleClaims: (angle?.paragraphs ?? []).filter((paragraph: any) => paragraph.context === 'target').flatMap((paragraph: any) => paragraph.claimIds).length,
    });

    const snapshot = buildSnapshot(target, index, inject && row.harvest?.items?.[0] ? row.harvest.items[0] : undefined);
    const built = buildDraftContextV2({ snapshot, artifact: { contentHash: canonicalSha256(snapshot), capturedAt: ASOF }, seller: SELLER, style: createDefaultDraftWritingStyleV2(), reportDocument: document, now: new Date() });
    if (built.status !== 'ready') return { ...row, stage: 'blocked', blocked: built.reason, message: built.message };
    const context: any = built.context;
    const evidence = context.evidence.map((item: any) => ({ hecho: String(item.statement), fuente: hostOf(item.source.url), de_informe: item.provenance?.kind === 'report_v2' }));
    Object.assign(row, { stage: 'email', evidence, evidenceCount: evidence.length, fromReport: evidence.filter((item: any) => item.de_informe).length });

    context.recipient.displayName = null;
    const openingKind = OUTREACH_OPENING_KINDS[index % OUTREACH_OPENING_KINDS.length];
    const email = await writeEmail(context, openingKind);
    Object.assign(row, { stage: 'done', seconds: Math.round((Date.now() - started) / 1000), openingKind, email, words: wordCount(email.body) });
    return row;
  } catch (error) {
    return { ...row, error: String(error instanceof Error ? error.message : error).slice(0, 400) };
  }
}

// Phase 1: research, report, context and email for every company and mode (the judge is not in this phase).
const jobs = targets.flatMap((target, index) => modes.map(mode => ({ target, index, mode })));
const rows: Row[] = new Array(jobs.length);
let next = 0;
await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, async () => {
  while (next < jobs.length) {
    const at = next++;
    const { target, index, mode } = jobs[at]!;
    const row = await runOne(target, index, mode);
    rows[at] = row;
    console.log(`${target.companyName.padEnd(14)} ${mode}: ${row.error ? `FALLÓ en ${row.stage}: ${row.error}` : row.blocked ? `bloqueado: ${row.blocked}` : `${row.pages} páginas, ${row.facts} hechos (${row.recentFacts} recientes), ${row.signalClaims} señales${row.harvest ? ` (${row.harvest.accepted} de ${row.harvest.picked} propuestas por Claude)` : ''}, informe ${row.reportStatus}/${row.audit}, ${row.angleClaims} afirmaciones del ángulo, ${row.evidenceCount} evidencias en el borrador (${row.fromReport} del informe), ${row.words} palabras, ${row.seconds}s`}`);
  }
}));

// Phase 2: the judge, with the evidence the writer saw. Set here so the writer above never ran with it.
process.env.OPENAI_EMAIL_MODEL = judgeModel;
if (isClaudeModel(judgeModel) ? !process.env.ANTHROPIC_API_KEY : !process.env.OPENAI_API_KEY) throw new Error('The judge key is missing');
for (const row of rows) {
  if (!row?.email) continue;
  const target = targets.find(item => item.companyName === row.company)!;
  try {
    const datos = {
      tipo: 'frio', tratamiento: 'tu',
      destinatario: { nombre: null, cargo: RECIPIENT_ROLE, empresa: target.companyName, dominio: target.domain },
      actividadEmpresa: target.about,
      // Everything the writer was given as evidence besides the overview: what the research found.
      hechos_de_la_investigacion: row.evidence.filter((item: any) => item.hecho !== target.about).map((item: any) => `${item.hecho} [${item.fuente}]`),
      hechos_permitidos: [
        `Vendedor: ${SELLER.name}, ${SELLER.jobTitle} de ${SELLER.companyName}`, SELLER.description,
        ...SELLER.services.map((service: string) => `${SELLER.companyName} ofrece: ${service}`), SELLER.valueProposition, ...(SELLER.proofPoints || []),
      ].filter(Boolean),
      cta_aprobado: row.email.cta,
    };
    const score = await judgeOutreach({ datos, asunto: row.email.subject, cuerpo: row.email.body });
    row.judge = { ...score, veredicto: judgeVerdict(score) };
    console.log(`${row.company.padEnd(14)} ${row.mode}: H${score.suena_humano} E${score.especificidad} P${score.un_solo_pedido} T${score.tono_y_tratamiento} V${score.veracidad} => ${row.judge.veredicto}`);
  } catch (error) {
    row.judgeError = String(error instanceof Error ? error.message : error).slice(0, 300);
  }
}

writeFileSync(join(outDir, 'results.json'), JSON.stringify({ generatedAt: new Date().toISOString(), searchEngine: process.env.SERPER_API_KEY ? 'serper' : 'none', writerModel, judgeModel, rows }, null, 2));
let md = '# Investigación → informe → borrador, de punta a punta\n\n';
for (const row of rows) {
  if (!row) continue;
  md += `---\n\n## ${row.company} · ${row.mode}\n\n`;
  if (row.error || row.blocked) { md += `${row.error ? `ERROR en ${row.stage}: ${row.error}` : `BLOQUEADO: ${row.blocked} — ${row.message}`}\n\n`; continue; }
  md += `Informe ${row.reportStatus}/${row.audit} ${row.auditIssues.join(', ')} · ${row.angleClaims} afirmaciones del ángulo · evidencias del borrador: ${row.evidenceCount} (${row.fromReport} del informe)\n\n`;
  if (row.harvest) md += `Señales de Claude (${row.harvest.accepted} de ${row.harvest.picked}${row.harvest.rejected.length ? `; rechazadas: ${row.harvest.rejected.join(', ')}` : ''}):\n${row.harvest.signals.map((signal: string) => `- ${signal}`).join('\n')}\n\n`;
  for (const item of row.evidence) md += `- ${item.de_informe ? '(informe) ' : ''}${item.hecho.slice(0, 220)} [${item.fuente}]\n`;
  md += `\n**Asunto:** ${row.email.subject}\n\n${row.email.body}\n\n`;
  if (row.judge) md += `Juez: humano ${row.judge.suena_humano} · específico ${row.judge.especificidad} · pedido ${row.judge.un_solo_pedido} · tono ${row.judge.tono_y_tratamiento} · veracidad ${row.judge.veracidad} → ${row.judge.veredicto}${row.judge.hechos_sin_respaldo.length ? ` · sin respaldo: ${row.judge.hechos_sin_respaldo.join(' | ')}` : ''}\n\n`;
}
writeFileSync(join(outDir, 'muestras.md'), md);

const average = (mode: string, pick: (row: Row) => number | null | undefined) => {
  const values = rows.filter(row => row?.mode === mode && row.judge).map(pick).filter((value): value is number => typeof value === 'number');
  return values.length ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100 : null;
};
for (const mode of modes) {
  console.log(`\n${mode}: evidencias del informe ${average(mode, row => row.fromReport)}, afirmaciones del ángulo ${average(mode, row => row.angleClaims)}, humano ${average(mode, row => row.judge.suena_humano)}, específico ${average(mode, row => row.judge.especificidad)}, tono ${average(mode, row => row.judge.tono_y_tratamiento)}, veracidad ${average(mode, row => row.judge.veracidad)}, enviar ${rows.filter(row => row?.mode === mode && row.judge?.veredicto === 'enviar').length}/${rows.filter(row => row?.mode === mode && row.judge).length}`);
}
console.log(`\nResultados en ${outDir}`);
