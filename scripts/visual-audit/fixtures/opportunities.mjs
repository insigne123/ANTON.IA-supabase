// The new Opportunities page: a search profile, six opportunities across sources (hiring, tenders, Compra Ágil, SEIA) and
// the last sync of each source.
// The JSON each kind stores, as the app writes it (records.ts): the tender tabs read these fields.
const DATA = {
  tender: { source: 'mercado_publico', code: '1057-88-LE26', buyerUnit: 'Unidad de Abastecimiento', status: 'publicada', keywords: ['antecedentes'],
    description: 'Servicio de verificación de antecedentes laborales y judiciales para el personal externo de la municipalidad.',
    items: [{ code: '80111600', name: 'Servicios de personal temporal' }] },
  compra_agil: { source: 'compra_agil', code: '1057539-228-COT26', buyerUnit: 'Abastecimiento', status: 'publicada', keywords: ['antecedentes'],
    description: null, items: [] },
  project: { owner: 'Inmobiliaria Pacífico', presentation: 'DIA', typology: 'Centro de distribución', sector: 'inmobiliario', state: 'En Calificación',
    communes: 'Pudahuel', presentedAt: null, qualifiedAt: null, investmentMusd: 45 },
};

/** What a sync stores for a company that is hiring (records.ts, HiringOpportunityData): its ads, roles, regions and evidence. */
function hiringData(ctx, { ads, lastWeek, roles, regions, industry, size, isContact = false, evidence }) {
  return {
    ads, adsLastWeek: lastWeek, roles, regions, publishers: ['Laborum', 'Trabajando.com'], sources: ['jsearch'], size, industry,
    isClient: false, isContact, firstPostedAt: ctx.daysAgo(24), lastPostedAt: ctx.daysAgo(1), windowDays: 30,
    evidence: evidence.map(([title, location, publisher, days]) => ({ source: 'jsearch', title, location, publisher, url: null, postedAt: ctx.daysAgo(days) })),
  };
}

export default function opportunities(ctx) {
  const profile = ctx.uid(9501);
  // Hiring companies carry their own data; the ad count (`signal_count`) is what «Mínimo de avisos» compares.
  const HIRING = {
    'Retail Andino': { signals: 12, data: hiringData(ctx, {
      ads: 12, lastWeek: 4, industry: 'Retail', size: '1001-5000', isContact: true,
      roles: [{ role: 'Vendedor', ads: 7 }, { role: 'Cajero', ads: 3 }, { role: 'Jefe de tienda', ads: 2 }],
      regions: [{ region: 'Región Metropolitana', ads: 9 }, { region: 'Valparaíso', ads: 3 }],
      evidence: [['Vendedor part time · Mall Plaza Oeste', 'Cerrillos', 'Laborum', 1], ['Cajero tienda nueva', 'Maipú', 'Trabajando.com', 2],
        ['Jefe de tienda', 'Viña del Mar', 'Laborum', 4]],
    }) },
    'Logística Sur': { signals: 9, data: hiringData(ctx, {
      ads: 9, lastWeek: 3, industry: 'Logística', size: '201-500',
      roles: [{ role: 'Operario de bodega', ads: 6 }, { role: 'Grúa horquilla', ads: 3 }],
      regions: [{ region: 'Biobío', ads: 9 }],
      evidence: [['Operario de bodega turno noche', 'Concepción', 'Trabajando.com', 1], ['Operador grúa horquilla', 'Talcahuano', 'Laborum', 3]],
    }) },
    'Seguridad Austral': { signals: 8, data: hiringData(ctx, {
      ads: 8, lastWeek: 1, industry: 'Seguridad', size: '501-1000',
      roles: [{ role: 'Guardia de seguridad', ads: 8 }], regions: [{ region: 'Valparaíso', ads: 8 }],
      evidence: [['Guardia de seguridad OS10', 'Valparaíso', 'Laborum', 2]],
    }) },
  };
  const items = [
    ['hiring', 'Retail Andino contrata 40 vendedores para nuevas tiendas', 'Retail Andino', 'retailandino.cl', 'Región Metropolitana', null, null, 88, ['Contratación masiva', 'Rubro objetivo']],
    ['hiring', 'Logística Sur busca 25 operarios de bodega', 'Logística Sur', 'logisticasur.cl', 'Biobío', null, null, 81, ['Contratación masiva']],
    ['tender', 'Servicio de verificación de antecedentes para personal externo', 'Municipalidad de Providencia', null, 'Región Metropolitana', 18000000, 'CLP', 76, ['Palabra clave: antecedentes']],
    ['compra_agil', 'Compra Ágil: revisión de antecedentes de postulantes', 'Servicio de Salud Maule', null, 'Maule', 2400000, 'CLP', 70, ['Monto dentro de rango']],
    ['project', 'Proyecto Centro de Distribución Pudahuel', 'Inmobiliaria Pacífico', 'grupopacifico.cl', 'Región Metropolitana', 45000000, 'USD', 64, ['Inversión sobre el mínimo']],
    ['hiring', 'Seguridad Austral recluta 60 guardias', 'Seguridad Austral', 'seguridadaustral.cl', 'Valparaíso', null, null, 58, ['Rubro objetivo']],
  ];
  return {
    tables: {
      commercial_opportunity_profiles: [{ id: profile, organization_id: ctx.ORG, created_by: ctx.OWNER, name: 'Contratación masiva en Chile', offer: 'Verificación de antecedentes laborales y judiciales', roles: ['Gerente de Personas'], regions: ['Región Metropolitana', 'Valparaíso', 'Biobío'], min_ads: 5, keywords: ['antecedentes', 'reclutamiento'], unspsc_codes: ['80111600'], seia_sectors: ['Inmobiliarios'], min_investment_usd: 10000000, sources: ['hiring', 'tender', 'compra_agil', 'project'], active: true, created_at: ctx.daysAgo(20), updated_at: ctx.daysAgo(2) }],
      commercial_opportunities: items.map(([kind, title, company, domain, region, amount, currency, score, reasons], index) => ({
        id: ctx.uid(9510 + index), organization_id: ctx.ORG, profile_id: profile, kind, dedupe_key: `${kind}:${index}`, title, company_name: company, company_domain: domain,
        company_linkedin_url: null, buyer_name: kind === 'tender' || kind === 'compra_agil' ? company : null, region, amount, currency,
        deadline_at: kind === 'tender' || kind === 'compra_agil' ? ctx.daysAhead(6 + index) : null, published_at: ctx.daysAgo(index + 1), url: `https://example.org/oportunidad/${index + 1}`,
        score, reasons, status: index === 5 ? 'dismissed' : 'new', claimed_by: index === 0 ? ctx.OWNER : null, signal_count: kind === 'hiring' ? HIRING[company]?.signals ?? 3 + index : 1,
        first_seen_at: ctx.daysAgo(index + 3), last_seen_at: ctx.daysAgo(index), data: (kind === 'hiring' ? HIRING[company]?.data : DATA[kind]) ?? {}, created_at: ctx.daysAgo(index + 3), updated_at: ctx.daysAgo(index),
      })),
      commercial_opportunity_runs: ['jsearch', 'mercado_publico', 'compra_agil', 'seia'].map((source, index) => ({
        id: ctx.uid(9530 + index), organization_id: ctx.ORG, profile_id: profile, source, trigger: 'schedule', status: 'completed', requested_by: null,
        started_at: ctx.hoursAgo(10 + index), finished_at: ctx.hoursAgo(10 + index), fetched: 40 - index * 8, created: 3 - (index % 2), updated: 2, cost_estimate_usd: 0.4, error: null,
      })),
      // Who an admin let in (Plan 15): nobody yet, so the member still gets the 404 the audit expects.
      commercial_opportunity_members: [],
    },
  };
}
