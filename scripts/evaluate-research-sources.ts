// Does the researcher that picks pages (RESEARCH_CLAUDE_WEB_ENABLED) bring better evidence than the pipeline without a search engine?
// Runs the real report v2 research (src/lib/server/research-report-v2-research.ts) on real companies with the production models for
// resolving, planning and extracting (Luna), once with only the company's own site and once with the Claude researcher added, and has a
// Claude judge say how well the evidence would open an email to the person. No database, no sends: it reads public pages and calls the models.
//
// node --loader ./scripts/ts-test-loader.mjs scripts/evaluate-research-sources.ts [--targets=Enaex,Besalco] [--modes=sin,con] [--out=dir]
// Needs OPENAI_API_KEY (Luna) and ANTHROPIC_API_KEY (the researcher and the judge). With SERPER_API_KEY the research uses the search engine of
// production in both modes, so `sin` is what production does today and `con` is production plus the researcher: the comparison that decides
// whether to turn the flag on. Without it the search engine is replaced by nothing, and what the run measures is what the researcher brings
// from scratch (the lift over «only the company's site»), not whether it beats Serper.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { gatherReportV2Research } from '../src/lib/server/research-report-v2-research';
import { claudeWebSourcesSettings } from '../src/lib/server/claude-web-sources';
import { generateStructuredWithTelemetry } from '../src/ai/openai-json';

if (!process.env.OPENAI_API_KEY || !process.env.ANTHROPIC_API_KEY) throw new Error('OPENAI_API_KEY and ANTHROPIC_API_KEY required');
const arg = (name: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);

const TARGETS = [
  { companyName: 'Enaex', domain: 'enaex.com' },
  { companyName: 'Aguas Andinas', domain: 'aguasandinas.cl' },
  { companyName: 'Besalco', domain: 'besalco.cl' },
  { companyName: 'Sodexo Chile', domain: 'sodexo.cl' },
  { companyName: 'SMU', domain: 'smu.cl' },
  { companyName: 'Salfacorp', domain: 'salfacorp.cl' },
  { companyName: 'Ingevec', domain: 'ingevec.cl' },
  { companyName: 'Gasco', domain: 'gasco.cl' },
];
const names = arg('targets')?.split(',').map(value => value.trim().toLowerCase());
const targets = names ? TARGETS.filter(target => names.includes(target.companyName.toLowerCase())) : TARGETS;
const modes = (arg('modes')?.split(',') ?? ['sin', 'con']).filter((mode): mode is 'sin' | 'con' => mode === 'sin' || mode === 'con');
const outDir = resolve(arg('out') || join('.eval-research', new Date().toISOString().replace(/[:.]/g, '-')));
mkdirSync(outDir, { recursive: true });

const SELLER = { companyName: 'Yago SpA', products: [{ key: 'axis', name: 'AXIS', description: 'consulta antecedentes laborales de postulantes en el PJUD y procesa 1.000 personas en unos 30 minutos' }] } as any;
const researcher = claudeWebSourcesSettings({ ...process.env, RESEARCH_CLAUDE_WEB_ENABLED: 'true' });
const NOW = Date.now();
const DAY = 86_400_000;

const JudgeSchema = z.object({
  senales_utiles: z.number().int().min(0).max(20).describe('Cuántos hechos de la lista, de los últimos 6 meses y con fecha, sirven de motivo concreto para escribirle a esa persona hoy'),
  utilidad: z.number().int().min(1).max(5).describe('5 si con esta evidencia se abre un correo específico, verdadero y reciente; 1 si solo alcanza para describir la empresa'),
  mejor_gancho: z.string().max(400).describe('El hecho que usarías para abrir, con su fecha, o vacío si ninguno sirve'),
  que_falta: z.string().max(300),
}).strict();

async function judge(target: typeof TARGETS[number], facts: Array<{ text: string; source: string; date: string | null }>) {
  const prompt = `Evalúas la evidencia que reunió un sistema de investigación sobre una empresa, para que un vendedor le escriba un correo en frío a su Gerente de Personas. Hoy es ${new Date(NOW).toISOString().slice(0, 10)}.
El vendedor ofrece AXIS: consulta antecedentes laborales de postulantes en el PJUD y procesa 1.000 personas en unos 30 minutos.
Empresa: ${target.companyName} (${target.domain}).
Evidencia (hecho, sitio de la fuente, fecha de la fuente):
${facts.length ? facts.map((fact, index) => `${index + 1}. ${fact.text} [${fact.source}; ${fact.date ?? 'sin fecha'}]`).join('\n') : '(ninguna)'}

Sé estricto: un hecho sin fecha o de hace más de 6 meses no es una señal reciente; describir lo que hace la empresa no es un motivo para escribirle hoy. Devuelve JSON con la forma pedida.`;
  const result = await generateStructuredWithTelemetry({ provider: 'openai', openAiModel: 'claude-opus-5-5', schema: JudgeSchema, temperature: 0.2, prompt });
  return result.data;
}

const rows: any[] = [];
for (const target of targets) {
  for (const mode of modes) {
    const started = Date.now();
    const projection = {
      entity: { companyName: target.companyName, companyDomain: target.domain, contactCountry: 'CL', operatingCountries: [], countryScopedPaths: {}, excludedPaths: [], ambiguities: [],
        contact: { fullName: 'Contacto', title: 'Gerente de Personas', seniority: 'manager', department: 'Recursos Humanos', tenureMonths: null, companyTenureMonths: null, linkedinUrl: null } },
      qualification: { verdict: 'qualified', allowedDepth: 'shallow', reasons: [], redirectTo: [] },
      sources: [], facts: [], claims: [], shortIdMap: {}, committee: [], initialGaps: [],
    } as any;
    try {
      // Without a Serper key the search engine is replaced by nothing: with `sin` the research reads the company's own site; with `con` it also reads what the researcher picked.
      const result = await gatherReportV2Research({ projection, sellerProfile: SELLER, organizationId: 'eval', language: 'es' }, {
        ...(process.env.SERPER_API_KEY ? {} : { search: async () => ({ items: [] }) as any }),
        claudeWeb: mode === 'con' ? researcher : null,
      });
      const sourceOf = new Map(result.sources.map((source: any) => [source.id, source]));
      const facts = result.facts.map((fact: any) => {
        const source: any = sourceOf.get(fact.sourceId);
        return { text: String(fact.text), source: source ? new URL(source.url).hostname.replace(/^www\./, '') : '?', date: (fact.observedAt || source?.publishedAt || null) as string | null, url: source?.url as string | undefined };
      });
      const recent = facts.filter(fact => fact.date && NOW - Date.parse(fact.date) <= 180 * DAY && Date.parse(fact.date) <= NOW + DAY);
      const verdict = await judge(target, facts.slice(0, 40));
      const row = {
        company: target.companyName, mode, seconds: Math.round((Date.now() - started) / 1000),
        pages: result.researchMetrics.pages, claudeWeb: (result.researchMetrics as any).claudeWeb ?? null, warnings: result.researchWarnings,
        facts: facts.length, recentFacts: recent.length, judge: verdict,
        sample: recent.slice(0, 6).map(fact => `${fact.date?.slice(0, 10)} · ${fact.source} · ${fact.text.slice(0, 140)}`),
      };
      rows.push(row);
      console.log(`${target.companyName.padEnd(14)} ${mode}: ${row.pages} páginas, ${row.facts} hechos (${row.recentFacts} con fecha de los últimos 6 meses), ${row.seconds}s · juez: ${verdict.senales_utiles} señales útiles, utilidad ${verdict.utilidad}/5 — ${verdict.mejor_gancho.slice(0, 110)}`);
    } catch (error) {
      console.log(`${target.companyName.padEnd(14)} ${mode}: FALLÓ ${error instanceof Error ? error.message : error}`);
      rows.push({ company: target.companyName, mode, error: String(error instanceof Error ? error.message : error) });
    }
  }
}
writeFileSync(join(outDir, 'results.json'), JSON.stringify({ generatedAt: new Date().toISOString(), searchEngine: process.env.SERPER_API_KEY ? 'serper' : 'none', researcher, rows }, null, 2));
const average = (mode: string, pick: (row: any) => number) => {
  const mine = rows.filter(row => row.mode === mode && !row.error);
  return mine.length ? Math.round((mine.reduce((sum, row) => sum + pick(row), 0) / mine.length) * 100) / 100 : null;
};
for (const mode of modes) {
  console.log(`\n${mode}: páginas ${average(mode, row => row.pages)}, hechos ${average(mode, row => row.facts)}, hechos recientes ${average(mode, row => row.recentFacts)}, señales útiles (juez) ${average(mode, row => row.judge.senales_utiles)}, utilidad ${average(mode, row => row.judge.utilidad)}/5`);
}
console.log(`\nResultados en ${outDir}`);
