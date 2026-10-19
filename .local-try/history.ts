import { createClient } from '@supabase/supabase-js';
import { findAgency, readAgencyHistory } from '@/lib/server/public-procurement/market';

const client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const cases: Array<[string, string]> = [
  ['Servicio de aseo y mantención de áreas verdes', 'Municipalidad de Maipú'],
  ['Servicio de guardias de seguridad', 'Hospital de Talca'],
  ['Adquisición de insumos médicos', 'Hospital Clínico San Borja Arriarán'],
  ['Servicio de vigilancia y seguridad', 'I MUNICIPALIDAD DE COQUIMBO'],
  ['Arriendo de vehículos', 'Servicio Nacional de Aduanas'],
  ['Servicio de transporte de personal', 'Gobierno Regional de Los Lagos'],
  ['Conservación de caminos', 'Ministerio de Obras Públicas'],
];
async function main() {
for (const [title, buyer] of cases) {
  const started = Date.now();
  const agency = await findAgency(client, buyer);
  const history = await readAgencyHistory(client, { title, buyerName: buyer });
  console.log(`\n${buyer} → ${agency ? `${agency.name} (${agency.ids.length} códigos)` : 'SIN MATCH'} · ${Date.now() - started} ms`);
  console.log(`  parecidas del organismo: ${history.similar.length}`, history.agencyStats ? JSON.stringify({ ...history.agencyStats, winners: history.agencyStats.winners.map(w => `${w.name} ${w.wins}`) }) : '');
  for (const t of history.similar.slice(0, 3)) console.log(`   · ${t.publishedOn} ${t.code} ${t.name.slice(0, 70)} [${t.status}] ${t.bidders ?? '?'} of. score ${t.score}`);
  console.log(`  mercado: ${history.market?.similar.length ?? 0}`, history.market ? JSON.stringify({ med: history.market.stats.medianBidders, ratio: history.market.stats.medianAwardRatio, w: history.market.stats.winners.map(w => `${w.name} ${w.wins}`) }) : '');
}
}
main().catch(error => { console.error(error); process.exit(1); });
