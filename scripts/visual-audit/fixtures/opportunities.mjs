// The new Opportunities page: a search profile, six opportunities across sources (hiring, tenders, Compra Ágil, SEIA) and
// the last sync of each source.
// The JSON each kind stores, as the app writes it (records.ts): the tender tabs read these fields.
const DATA = {
  tender: { source: 'mercado_publico', code: '1057-88-LE26', buyerUnit: 'Unidad de Abastecimiento', status: 'publicada', keywords: ['antecedentes'],
    description: 'Servicio de verificación de antecedentes laborales y judiciales para el personal externo de la municipalidad.',
    items: [{ code: '80111600', name: 'Servicios de personal temporal' }],
    // Plan 15: what the model said when it read the tender against the offer.
    ai: { fit: 'alta', reason: 'Piden verificar antecedentes laborales y judiciales del personal externo', profileKey: 'demo' } },
  compra_agil: { source: 'compra_agil', code: '1057539-228-COT26', buyerUnit: 'Abastecimiento', status: 'publicada', keywords: ['antecedentes'],
    description: null, items: [] },
  hiring_post: { author: 'Marcela Ibáñez', authorTitle: 'Gerente de Operaciones', postUrl: 'https://www.linkedin.com/feed/update/urn:li:activity:7000000000000000000/',
    text: 'Esta semana abrimos tres nuevos centros de distribución y vamos a sumar más de cien personas al equipo.', postedAt: null },
  project: { owner: 'Inmobiliaria Pacífico', presentation: 'DIA', typology: 'Centro de distribución', sector: 'inmobiliario', state: 'En Calificación',
    communes: 'Pudahuel', presentedAt: null, qualifiedAt: null, investmentMusd: 45 },
};

/** A process the team received (an invitation through the buyer's platform): bases of its own, loaded by an admin. */
const PRIVATE = { origin: 'admin_upload', type: 'private_tender', description: 'Alimentos del Valle invita a cotizar el servicio de aseo industrial de su planta de producción, con visita obligatoria el jueves.' };

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
    // From here on, the opportunities the workspace's stages need (fixtures/opportunity-workspace.mjs gives them their team and work).
    ['tender', 'Servicio de guardias de seguridad para 12 sucursales', 'Banco Regional del Sur', null, 'Región Metropolitana', 96000000, 'CLP', 83, ['Palabra clave: guardias', 'Monto dentro de rango']],
    ['private', 'Invitación a cotizar: aseo industrial para planta de producción', 'Alimentos del Valle', null, 'Región del Maule', 48000000, 'CLP', 74, ['Recibida directamente por el equipo']],
    ['tender', 'Suministro de personal de aseo para hospital base', 'Servicio de Salud Araucanía Sur', null, 'La Araucanía', 31000000, 'CLP', 55, ['Palabra clave: personal de aseo']],
    ['compra_agil', 'Compra Ágil: personal administrativo de apoyo', 'Municipalidad de Maipú', null, 'Región Metropolitana', 5200000, 'CLP', 66, ['Monto dentro de rango']],
    ['tender', 'Servicios de contact center para atención ciudadana', 'Servicio de Registro Civil', null, 'Región Metropolitana', 120000000, 'CLP', 72, ['Palabra clave: outsourcing']],
    ['tender', 'Servicio de selección de personal para gobierno regional', 'Gobierno Regional de Valparaíso', null, 'Valparaíso', 22000000, 'CLP', 79, ['Palabra clave: selección']],
    ['tender', 'Servicio de reclutamiento masivo de operarios', 'Empresa Portuaria Austral', null, 'Magallanes', 38000000, 'CLP', 61, ['Palabra clave: reclutamiento']],
    ['linkedin_post', 'Gerente de Operaciones anuncia tres nuevos centros de distribución', 'Distribuidora Pacífico', 'distribuidorapacifico.cl', 'Región Metropolitana', null, null, 69, ['Publicación con intención de contratar']],
    ['compra_agil', 'Compra Ágil: insumos de oficina', 'Servicio de Salud Metropolitano Norte', null, 'Región Metropolitana', 900000, 'CLP', 31, ['Monto bajo']],
    ['hiring', 'Minera del Norte busca 30 operadores de planta', 'Minera del Norte', 'mineradelnorte.cl', 'Antofagasta', null, null, 62, ['Contratación masiva']],
  ];
  // What the evaluation, the summary line and the deadline of each one say (the page reads data.evaluation, data.summary and
  // data.excludedMotive); the first six keep the deadline they always had.
  const EXTRA = {
    0: { evaluation: 'recommended', summary: 'Abre tiendas nuevas y contrata 40 vendedores: el momento para ofrecer verificación de antecedentes.' },
    1: { evaluation: 'recommended', summary: 'Busca 25 operarios de bodega en el Biobío con avisos todas las semanas.' },
    2: { evaluation: 'recommended', summary: 'Piden verificar antecedentes laborales y judiciales del personal externo: calza con lo que ofreces.', deadlineDays: 8 },
    3: { evaluation: 'review', summary: 'Compra pequeña de revisión de antecedentes; sirve para crear historial en el Estado.', deadlineDays: 9 },
    4: { evaluation: 'review', summary: 'Proyecto de 45 millones de dólares: sirve para llegar a quien contratará la obra.' },
    5: { evaluation: 'excluded', excludedMotive: 'sin_compra', summary: 'Avisos de guardias, pero no muestra una compra de lo que ofreces.' },
    6: { evaluation: 'recommended', summary: 'Doce sucursales con guardias las 24 horas; la oferta calza y el plazo es corto.', deadlineDays: 2 },
    7: { evaluation: 'review', summary: 'Invitación directa a cotizar aseo industrial; piden visita a planta antes de ofertar.', deadlineDays: 12 },
    8: { evaluation: 'excluded', excludedMotive: 'requisito', summary: 'Exigen turnos de enfermería asociados al aseo, algo que no ofreces.', deadlineDays: 6 },
    9: { evaluation: 'recommended', summary: 'Apoyo administrativo por tres meses; monto chico y bases simples.', deadlineDays: 5 },
    10: { evaluation: 'review', summary: 'Contact center para atención ciudadana; ya se presentó la oferta.', deadlineDays: 15 },
    11: { evaluation: 'recommended', summary: 'Selección de personal para el gobierno regional; ganada hace una semana.', deadlineDays: -10 },
    12: { evaluation: 'recommended', summary: 'Reclutamiento masivo para el puerto; otra empresa se adjudicó el servicio.', deadlineDays: -20 },
    13: { evaluation: 'recommended', summary: 'El gerente de Operaciones anunció tres centros nuevos: abre la conversación con un mensaje breve.' },
    14: { evaluation: 'excluded', excludedMotive: 'otro_producto', summary: 'Piden insumos de oficina, otra cosa.', deadlineDays: 3 },
    15: { summary: 'Busca 30 operadores de planta en Antofagasta; aún sin evaluar.' },
  };
  return {
    tables: {
      commercial_opportunity_profiles: [{ id: profile, organization_id: ctx.ORG, created_by: ctx.OWNER, name: 'Contratación masiva en Chile', offer: 'Verificación de antecedentes laborales y judiciales', roles: ['Gerente de Personas'], regions: ['Región Metropolitana', 'Valparaíso', 'Biobío'], min_ads: 5, keywords: ['antecedentes', 'reclutamiento'], unspsc_codes: ['80111600'], seia_sectors: ['Inmobiliarios'], min_investment_usd: 10000000, sources: ['hiring', 'tender', 'compra_agil', 'project'], active: true, created_at: ctx.daysAgo(20), updated_at: ctx.daysAgo(2) }],
      commercial_opportunities: items.map(([kind, title, company, domain, region, amount, currency, score, reasons], index) => ({
        id: ctx.uid(9510 + index), organization_id: ctx.ORG, profile_id: profile, kind, dedupe_key: `${kind}:${index}`, title, company_name: company, company_domain: domain,
        company_linkedin_url: null, buyer_name: kind === 'tender' || kind === 'compra_agil' ? company : null, region, amount, currency,
        deadline_at: kind === 'tender' || kind === 'compra_agil' || kind === 'private' ? ctx.daysAhead(EXTRA[index]?.deadlineDays ?? 6 + index) : null, published_at: ctx.daysAgo(index + 1), url: `https://example.org/oportunidad/${index + 1}`,
        score, reasons, status: index === 5 ? 'dismissed' : 'new', claimed_by: index === 0 ? ctx.OWNER : null, signal_count: kind === 'hiring' ? HIRING[company]?.signals ?? 3 + index : 1,
        first_seen_at: ctx.daysAgo(index + 3), last_seen_at: ctx.daysAgo(index), created_at: ctx.daysAgo(index + 3), updated_at: ctx.daysAgo(index),
        data: {
          ...((kind === 'hiring' ? HIRING[company]?.data : kind === 'private' ? PRIVATE : DATA[kind === 'linkedin_post' ? 'hiring_post' : kind]) ?? {}),
          // Each purchase after the first ones has a code and a description of its own (and the model's reading of the fit).
          ...((kind === 'tender' || kind === 'compra_agil') && index > 3 ? {
            code: `${1000 + index}-${index * 7 + 3}-${kind === 'tender' ? 'LE26' : 'COT26'}`, description: EXTRA[index]?.summary ?? null,
            ai: { fit: { recommended: 'alta', review: 'media', excluded: 'baja' }[EXTRA[index]?.evaluation] ?? 'media', reason: EXTRA[index]?.summary ?? '', profileKey: 'demo' },
          } : {}),
          ...(EXTRA[index]?.evaluation ? { evaluation: EXTRA[index].evaluation } : {}),
          ...(EXTRA[index]?.excludedMotive ? { excludedMotive: EXTRA[index].excludedMotive } : {}),
          ...(EXTRA[index]?.summary ? { summary: { text: EXTRA[index].summary } } : {}),
        },
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
