// Live, explicit opt-in: reads public company websites and calls the model, the same path as «Completar con IA» in «Perfil».
// Never loads .env files, never touches the database, never sends anything. Usage:
//   OPENAI_API_KEY=… npx tsx scripts/evaluate-profile-autofill.ts --live [--only=grupoexpro.com]
import { generateCompanyProfile } from '../src/ai/flows/generate-company-profile';

const CORPUS: Array<{ companyName?: string; website?: string; note: string }> = [
  { companyName: 'GrupoExpro', website: 'grupoexpro.com', note: 'Portada con selector de país' },
  { companyName: 'PSOL', website: 'psol.cl', note: 'Evaluaciones psicolaborales' },
  { companyName: 'Yago', website: 'yago.cl', note: 'Automatización con IA' },
  { companyName: 'Buk', website: 'buk.cl', note: 'Software de RR. HH.' },
  { companyName: 'Defontana', website: 'defontana.com', note: 'ERP' },
  { companyName: 'Bsale', website: 'bsale.cl', note: 'Punto de venta' },
  { companyName: 'Fintoc', website: 'fintoc.com', note: 'Pagos' },
  { companyName: 'Rankmi', website: 'rankmi.com', note: 'Gestión de personas' },
  { website: 'grupoexpro.com', note: 'Solo sitio (como cuando se detecta por el correo)' },
];
const FIELDS = ['companyName', 'sector', 'description', 'services', 'valueProposition', 'painPoints', 'differentiators', 'proofPoints',
  'referenceClients', 'targetIndustries', 'targetRoles', 'targetCompanySize', 'targetLocations'] as const;

async function main() {
  if (!process.argv.includes('--live') || !process.env.OPENAI_API_KEY) {
    throw new Error('Requires --live and OPENAI_API_KEY. No automatic env-file loading.');
  }
  const only = process.argv.find((arg) => arg.startsWith('--only='))?.slice(7);
  const rows: unknown[] = [];
  for (const entry of CORPUS.filter((item) => !only || item.website === only)) {
    const started = Date.now();
    try {
      const output = await generateCompanyProfile({ ...entry, organizationId: '00000000-0000-4000-8000-000000000001' });
      const filled = FIELDS.filter((field) => {
        const value = output[field];
        return Array.isArray(value) ? value.length > 0 : String(value || '').trim().length > 0;
      });
      rows.push({ input: entry, ms: Date.now() - started, filled: filled.length, of: FIELDS.length, pagesRead: output.pagesRead.length,
        withSource: Object.keys(output.sources).length, emptyReason: output.emptyReason, output });
    } catch (error) {
      // Only a bounded error category; never dump provider headers or credentials.
      const message = error instanceof Error ? error.message : '';
      rows.push({ input: entry, ms: Date.now() - started, error: message.match(/(?:OPENAI|GLM)_HTTP_\d{3}/)?.[0] || message.slice(0, 120) || 'generation_failed' });
    }
  }
  console.log(JSON.stringify(rows, null, 2));
}

void main();
