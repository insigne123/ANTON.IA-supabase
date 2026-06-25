export type SupliaWorkflowIntakeResult = {
  needsClarification: boolean;
  missingFields: string[];
  confidence: number;
};

function normalize(value: string) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9@.\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function analyzeProspectingIntake(message: string): SupliaWorkflowIntakeResult {
  const text = normalize(message);
  const hasAudience = /\b(a|para|en)\s+(constructoras?|retail|restaurantes?|clinicas?|colegios?|universidades?|saas|software|agencias?|inmobiliarias?|fintech|startup|startups|manufactura|logistica|ecommerce|b2b|pymes?|empresas?\s+(?:de|que)|industria|sector|mercado)\b/.test(text);
  const hasOffer = /\b(vender|promocionar|ofrecer|servicio|servicios|producto|software|plataforma|solucion|outsourcing|consultoria|reclutamiento|staffing|automatizacion|mi empresa|mi negocio)\b/.test(text);
  const hasVolume = /\b\d+\s+(leads?|contactos?|empresas?|personas?)\b/.test(text) || /\b(leads?|contactos?|empresas?)\b/.test(text);
  const hasGeography = /\b(chile|mexico|colombia|peru|argentina|espana|usa|estados unidos|latam|santiago|bogota|lima|madrid|miami|mercado local)\b/.test(text);
  const hasRole = /\b(ceo|founder|fundador|gerente|director|dueno|dueño|owner|marketing|ventas|operaciones|rrhh|recursos humanos|cto|cfo|coo)\b/.test(text);

  const missingFields: string[] = [];
  if (!hasAudience) missingFields.push('tipo de empresa o segmento objetivo');
  if (!hasOffer) missingFields.push('oferta o servicio a promocionar');
  if (!hasGeography) missingFields.push('mercado o geografia');
  if (!hasRole) missingFields.push('rol decisor ideal');

  const concreteSignals = [hasAudience, hasOffer, hasVolume, hasGeography, hasRole].filter(Boolean).length;
  return {
    needsClarification: concreteSignals < 3 || (!hasAudience && !hasOffer),
    missingFields,
    confidence: Math.min(0.95, 0.35 + concreteSignals * 0.14),
  };
}

export function buildProspectingClarificationReply(message: string, intake = analyzeProspectingIntake(message)) {
  const missing = intake.missingFields.slice(0, 4);
  const lines = [
    'Puedo ayudarte, pero antes de planear la busqueda necesito acotar el objetivo para no gastar creditos en leads incorrectos.',
    '',
    'Respondeme con estos datos:',
  ];

  const questions = missing.length > 0
    ? missing
    : ['tipo de empresa objetivo', 'oferta principal', 'mercado o pais', 'rol decisor ideal'];
  questions.forEach((item, index) => lines.push(`${index + 1}. ${item}.`));
  lines.push('', 'Si prefieres, dime "asume con mi perfil" y preparo un plan preliminar usando el contexto guardado de tu empresa.');
  return lines.join('\n');
}

export function shouldUseProfileAssumptions(message: string) {
  return /\b(asume|asumelo|usa mi perfil|con mi perfil|segun mi perfil|como siempre)\b/i.test(message);
}
