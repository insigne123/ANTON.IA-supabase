import fs from 'node:fs/promises';
import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const ROOT = process.cwd();

function summarize(value: unknown) {
  try {
    const text = JSON.stringify(value);
    return text.length > 260 ? `${text.slice(0, 260)}...` : text;
  } catch {
    return String(value);
  }
}

async function loadModule(relPath: string) {
  const mod = await import(relPath);
  return (mod as any).default || mod;
}

type FlowResult = {
  name: string;
  ok: boolean;
  durationMs: number;
  preview: string;
  error?: string;
};

async function run() {
  const tests: Array<{ name: string; run: () => Promise<unknown> }> = [
    {
      name: 'generateCampaignFlow',
      run: async () => {
        const mod = await loadModule('../src/ai/flows/generate-campaign.ts');
        const out = await mod.generateCampaignFlow({
          goal: 'Conseguir 5 reuniones B2B por semana',
          companyName: 'ANTON.IA',
          targetAudience: 'Head of Sales',
          language: 'es',
        });
        return { steps: out?.steps?.length || 0 };
      },
    },
    {
      name: 'classifyReplyFlow',
      run: async () => {
        const mod = await loadModule('../src/ai/flows/classify-reply.ts');
        const out = await mod.classifyReplyFlow({
          text: 'Gracias. Me interesa y podemos agendar una llamada.',
          language: 'es',
        });
        return { intent: out?.intent, shouldContinue: out?.shouldContinue };
      },
    },
    {
      name: 'generatePhoneScript',
      run: async () => {
        const mod = await loadModule('../src/ai/flows/generate-phone-script.ts');
        const out = await mod.generatePhoneScript({
          report: {
            pains: ['Tiempo de respuesta comercial alto'],
            leadContext: { profileSummary: 'Lidera crecimiento comercial' },
          },
          companyProfile: { name: 'ANTON.IA', services: 'Automatizacion de outreach' },
          lead: { fullName: 'Ana Torres', title: 'Head of Sales' },
        });
        return { hasOpening: Boolean(out?.opening), hasPitch: Boolean(out?.pitch) };
      },
    },
    {
      name: 'updateStyleProfile',
      run: async () => {
        const mod = await loadModule('../src/ai/flows/update-style-profile.ts');
        const out = await mod.updateStyleProfile({
          currentStyle: {
            id: 'default',
            name: 'Base',
            tone: 'professional',
            cta: { label: 'Llamada', duration: '15' },
          },
          userInstruction: 'Haz el estilo mas breve y consultivo para decisores C-level.',
        });
        return { hasExplanation: Boolean(out?.explanation) };
      },
    },
    {
      name: 'renderEmailTemplate',
      run: async () => {
        const mod = await loadModule('../src/ai/flows/render-email-template.ts');
        const out = await mod.renderEmailTemplate({
          mode: 'leads',
          aiIntensity: 'medium',
          tone: 'professional',
          length: 'short',
          baseSubject: 'Colaboracion con {{company}}',
          baseBody: 'Hola {{lead.name}}, podemos ayudarte con automatizacion.',
          data: {
            companyProfile: {
              name: 'ANTON.IA',
              services: 'Automatizacion',
              valueProposition: 'Subir conversion',
            },
            report: { pains: ['Baja conversion'] },
            lead: { name: 'Camila', company: 'Empresa X' },
            job: {},
          },
        });
        return { hasSubject: Boolean(out?.subject), hasBody: Boolean(out?.body) };
      },
    },
    {
      name: 'enhanceCompanyReport',
      run: async () => {
        const mod = await loadModule('../src/ai/flows/enhance-company-report.ts');
        const input = {
          report: { summary: 'base report' },
          companyProfile: { name: 'Empresa X' },
          lead: { name: 'Lead X' },
          myCompany: { name: 'ANTON.IA', description: 'AI Agent' },
        };
        const out = await mod.enhanceCompanyReport(input);
        return { passthrough: out?.summary === 'base report' };
      },
    },
    {
      name: 'generateOutreachFromReport',
      run: async () => {
        const mod = await loadModule('../src/ai/flows/generate-outreach-from-report.ts');
        const out = await mod.generateOutreachFromReport({
          mode: 'services',
          report: { pains: ['Baja tasa de respuesta'] },
          companyProfile: { name: 'ANTON.IA', services: 'Automatizacion comercial' },
          lead: { name: 'Pedro', title: 'CMO' },
        });
        return { hasSubject: Boolean(out?.subject), hasBody: Boolean(out?.body) };
      },
    },
    {
      name: 'generateCompanyProfile',
      run: async () => {
        const mod = await loadModule('../src/ai/flows/generate-company-profile.ts');
        const out = await mod.generateCompanyProfile({ companyName: 'Globant' });
        return { sector: out?.sector, hasWebsite: Boolean(out?.website) };
      },
    },
    {
      name: 'replyClassifierHelper',
      run: async () => {
        const mod = await loadModule('../src/lib/reply-classifier.ts');
        const out = await mod.classifyReply('No me interesa, por favor no me contacten.');
        return { intent: out?.intent, shouldContinue: out?.shouldContinue };
      },
    },
  ];

  const results: FlowResult[] = [];

  for (const test of tests) {
    const startedAt = Date.now();
    try {
      const out = await test.run();
      results.push({
        name: test.name,
        ok: true,
        durationMs: Date.now() - startedAt,
        preview: summarize(out),
      });
      console.log(`PASS ${test.name} (${Date.now() - startedAt}ms)`);
    } catch (error: any) {
      results.push({
        name: test.name,
        ok: false,
        durationMs: Date.now() - startedAt,
        preview: '',
        error: String(error?.message || error),
      });
      console.log(`FAIL ${test.name} (${Date.now() - startedAt}ms)`);
    }
  }

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;

  const report = {
    generatedAt: new Date().toISOString(),
    passed,
    failed,
    results,
  };

  const outPath = path.join(ROOT, 'scripts', 'antonia-flow-test-report.json');
  await fs.writeFile(outPath, JSON.stringify(report, null, 2), 'utf8');

  console.log('\n[antonia-flows] summary');
  console.log(`passed=${passed} failed=${failed}`);
  console.log(`[antonia-flows] report: scripts/antonia-flow-test-report.json`);

  if (failed > 0) {
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error('[antonia-flows] fatal:', error);
  process.exitCode = 1;
});
