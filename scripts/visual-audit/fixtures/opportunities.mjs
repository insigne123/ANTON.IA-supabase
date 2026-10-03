// The new Opportunities page: a search profile, six opportunities across sources (hiring, tenders, Compra Ágil, SEIA) and
// the last sync of each source.
export default function opportunities(ctx) {
  const profile = ctx.uid(9501);
  const items = [
    ['hiring', 'Retail Andino contrata 40 vendedores para nuevas tiendas', 'Retail Andino', 'retailandino.cl', 'Región Metropolitana', null, null, 88, ['Contratación masiva', 'Rubro objetivo']],
    ['hiring', 'Logística Sur busca 25 operarios de bodega', 'Logística Sur', 'logisticasur.cl', 'Biobío', null, null, 81, ['Contratación masiva']],
    ['tender', 'Servicio de verificación de antecedentes para personal externo', 'Municipalidad de Providencia', null, 'Región Metropolitana', 18000000, 'CLP', 76, ['Palabra clave: antecedentes']],
    ['compra_agil', 'Compra Ágil: revisión de antecedentes de postulantes', 'Servicio de Salud Maule', null, 'Maule', 2400000, 'CLP', 70, ['Monto dentro de rango']],
    ['seia', 'Proyecto Centro de Distribución Pudahuel', 'Inmobiliaria Pacífico', 'grupopacifico.cl', 'Región Metropolitana', 45000000, 'USD', 64, ['Inversión sobre el mínimo']],
    ['hiring', 'Seguridad Austral recluta 60 guardias', 'Seguridad Austral', 'seguridadaustral.cl', 'Valparaíso', null, null, 58, ['Rubro objetivo']],
  ];
  return {
    tables: {
      commercial_opportunity_profiles: [{ id: profile, organization_id: ctx.ORG, created_by: ctx.OWNER, name: 'Contratación masiva en Chile', offer: 'Verificación de antecedentes laborales y judiciales', roles: ['Gerente de Personas'], regions: ['Región Metropolitana', 'Valparaíso', 'Biobío'], min_ads: 5, keywords: ['antecedentes', 'reclutamiento'], unspsc_codes: ['80111600'], seia_sectors: ['Inmobiliarios'], min_investment_usd: 10000000, sources: ['jsearch', 'mercado_publico', 'compra_agil', 'seia'], active: true, created_at: ctx.daysAgo(20), updated_at: ctx.daysAgo(2) }],
      commercial_opportunities: items.map(([kind, title, company, domain, region, amount, currency, score, reasons], index) => ({
        id: ctx.uid(9510 + index), organization_id: ctx.ORG, profile_id: profile, kind, dedupe_key: `${kind}:${index}`, title, company_name: company, company_domain: domain,
        company_linkedin_url: null, buyer_name: kind === 'tender' || kind === 'compra_agil' ? company : null, region, amount, currency,
        deadline_at: kind === 'tender' || kind === 'compra_agil' ? ctx.daysAhead(6 + index) : null, published_at: ctx.daysAgo(index + 1), url: `https://example.org/oportunidad/${index + 1}`,
        score, reasons, status: index === 5 ? 'dismissed' : 'new', claimed_by: index === 0 ? ctx.OWNER : null, signal_count: kind === 'hiring' ? 3 + index : 1,
        first_seen_at: ctx.daysAgo(index + 3), last_seen_at: ctx.daysAgo(index), data: {}, created_at: ctx.daysAgo(index + 3), updated_at: ctx.daysAgo(index),
      })),
      commercial_opportunity_runs: ['jsearch', 'mercado_publico', 'compra_agil', 'seia'].map((source, index) => ({
        id: ctx.uid(9530 + index), organization_id: ctx.ORG, profile_id: profile, source, trigger: 'schedule', status: 'completed', requested_by: null,
        started_at: ctx.hoursAgo(10 + index), finished_at: ctx.hoursAgo(10 + index), fetched: 40 - index * 8, created: 3 - (index % 2), updated: 2, cost_estimate_usd: 0.4, error: null,
      })),
    },
  };
}
