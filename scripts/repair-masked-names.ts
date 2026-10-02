// Asks the provider again for the «Por escribir» contacts that still show a hidden surname («Rafael Du***n») and keeps the
// real name with the email lookup's rules: only gaps, never what someone typed (Plan 6, PR-F; docs/contactos-identidad.md).
//
// A dry run by default: it lists them and how each would be asked, without calling the provider or writing.
// --apply calls the provider (about 1 credit per person; no email or phone is revealed) and writes only when the person it
// returns fits the visible ends of the hidden name. Nothing is sent to anyone. --limit=N asks at most N people.
// Never loads env files: pass NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, plus APOLLO_API_KEY with --apply.
//
//   node --loader ./scripts/ts-test-loader.mjs scripts/repair-masked-names.ts [--apply] [--limit=N]
import { createClient } from '@supabase/supabase-js';
import { executeApolloEnrichment, getApolloApiKey } from '../src/lib/server/apollo-provider/apollo';
import { getGatewayConfig } from '../src/lib/server/apollo-provider/gateway';
import { repairMaskedNames, type MaskedNameMatch, type MaskedRepairStatus } from '../src/lib/server/masked-name-repair';

const LABELS: Record<MaskedRepairStatus, string> = {
  would_query: 'se consultaría',
  no_lookup: 'sin id del proveedor ni LinkedIn: no se puede consultar',
  skipped: 'no consultado',
  fixed: 'nombre completo guardado',
  unchanged: 'sin cambios en el nombre',
  not_found: 'el proveedor no lo encontró',
  mismatch: 'no se escribió: no es la misma persona',
  error: 'error',
};

async function main() {
  const apply = process.argv.includes('--apply');
  const limitArg = process.argv.find(arg => arg.startsWith('--limit='));
  const limit = limitArg ? Number(limitArg.split('=')[1]) : undefined;
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) throw new Error('--limit debe ser un entero mayor que 0.');
  const url = String(process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
  const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !serviceKey) throw new Error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el entorno.');
  const apiKey = getApolloApiKey();
  if (apply && !apiKey) throw new Error('Con --apply hace falta APOLLO_API_KEY en el entorno.');

  const client = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const config = getGatewayConfig();
  const match: MaskedNameMatch = async ({ providerId, linkedinUrl }) => {
    const result = await executeApolloEnrichment({
      lead: { ...(providerId ? { id: providerId, sourceProviderId: providerId } : {}), ...(linkedinUrl ? { linkedinUrl } : {}) },
      revealEmail: false,
      revealPhone: false,
      enrichmentLevel: 'basic',
      matchOnly: true,
    }, apiKey, config);
    return { found: Boolean(result.success), person: result.extracted_data, credits: result.credits_consumed ?? null };
  };

  const report = await repairMaskedNames({ client, apply, limit, ...(apply ? { match, pauseMs: 1_000 } : {}) });
  console.log(`Contactos de «Por escribir» con el apellido oculto: ${report.before}`);
  console.log(`  por id del proveedor: ${report.lookups.byId}`);
  console.log(`  por LinkedIn: ${report.lookups.byLinkedin}`);
  console.log(`  sin id ni LinkedIn: ${report.lookups.none}`);
  for (const row of report.rows) {
    const how = row.lookup === 'id' ? 'por id' : row.lookup === 'linkedin' ? 'por LinkedIn' : '';
    console.log(`- ${row.id}  ${row.maskedName}  ${[how, LABELS[row.status]].filter(Boolean).join(' · ')}${row.detail ? ` (${row.detail})` : ''}`);
  }
  if (!apply) {
    console.log(`Simulación: no se llamó al proveedor ni se escribió nada. Con --apply se consultan ${report.lookups.byId + report.lookups.byLinkedin} (≈1 crédito por persona).`);
    return;
  }
  const count = (status: MaskedRepairStatus) => report.rows.filter(row => row.status === status).length;
  console.log(`Corregidos: ${count('fixed')} · sin cambios: ${count('unchanged')} · no encontrados: ${count('not_found')} · otra persona: ${count('mismatch')} · errores: ${count('error')} · no consultados: ${count('skipped')}`);
  console.log(`Créditos usados: ${report.credits}`);
  console.log(`Con el apellido oculto: antes ${report.before}, después ${report.after}`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
