/** Pure stage-9 builders: transversal contact policy, the Chilean outreach law
 * summary and the industry-obligation knowledge base. No I/O.
 *
 * Contact caps are product defaults pending a business decision: they never
 * break the canonical 7-touch cadence (0/2/4/4/5/7/15 day gaps) but stop two
 * engines from doubling up on the same person. */

export const CONTACT_POLICY = {
  version: 'contact-policy/v1',
  maxPerPersonPerDay: 1,
  maxPerPersonPer7d: 3,
  maxPerPersonPer40d: 8,
  maxPerCompanyPerDay: 1,
  note: 'Topes por defecto; la jefatura comercial puede ajustarlos.',
} as const;

export type FrequencyHold = {
  held: boolean;
  window: 'day' | 'week' | '40d' | null;
  count: number;
  limit: number;
  nextEligibleAt: string | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Counts sends to one person inside the trailing windows. */
export function evaluateFrequency(sentAt: Array<string | null | undefined>, nowMs = Date.now()): FrequencyHold {
  const moments = sentAt
    .map((at) => (at ? Date.parse(at) : NaN))
    .filter((ms) => Number.isFinite(ms) && ms <= nowMs)
    .sort((a, b) => a - b);
  const windows = [
    { window: 'day' as const, ms: DAY_MS, limit: CONTACT_POLICY.maxPerPersonPerDay },
    { window: 'week' as const, ms: 7 * DAY_MS, limit: CONTACT_POLICY.maxPerPersonPer7d },
    { window: '40d' as const, ms: 40 * DAY_MS, limit: CONTACT_POLICY.maxPerPersonPer40d },
  ];
  for (const { window, ms, limit } of windows) {
    const inside = moments.filter((at) => nowMs - at < ms);
    if (inside.length >= limit) {
      return { held: true, window, count: inside.length, limit, nextEligibleAt: new Date(inside[0] + ms).toISOString() };
    }
  }
  return { held: false, window: null, count: moments.filter((at) => nowMs - at < 40 * DAY_MS).length, limit: CONTACT_POLICY.maxPerPersonPer40d, nextEligibleAt: null };
}

export type PolicyVerdict = 'allow' | 'defer' | 'block';

export function evaluateContactPolicy(input: {
  suppressed: boolean;
  doNotContact: boolean;
  excludedDomain: boolean;
  frequency: FrequencyHold;
  companyDayCollision: boolean;
  replied: boolean;
}): { verdict: PolicyVerdict; reasons: string[]; nextEligibleAt: string | null } {
  const reasons: string[] = [];
  if (input.suppressed) reasons.push('unsubscribed');
  if (input.doNotContact) reasons.push('do_not_contact');
  if (input.excludedDomain) reasons.push('excluded_domain');
  if (reasons.length) return { verdict: 'block', reasons, nextEligibleAt: null };
  if (input.replied) reasons.push('recipient_replied');
  if (input.companyDayCollision) reasons.push('company_day_collision');
  if (input.frequency.held) reasons.push(`person_frequency_${input.frequency.window}`);
  if (!reasons.length) return { verdict: 'allow', reasons: [], nextEligibleAt: null };
  const nextEligibleAt = input.frequency.held ? input.frequency.nextEligibleAt : null;
  return { verdict: 'defer', reasons, nextEligibleAt };
}

/** 9.1 Chilean outreach framework. Jurisdiction, dates and official sources;
 * general information, never legal advice. Reviewed 2026-09-23. */
export const OUTREACH_LAW = {
  jurisdiction: 'CL',
  reviewedAt: '2026-09-23',
  disclaimer: 'Información general sobre el marco vigente; no es asesoría legal.',
  current: {
    law: 'Ley 19.628',
    name: 'Sobre protección de la vida privada',
    published: '1999-08-28',
    validUntil: '2026-11-30',
    rules: [
      'El tratamiento de datos personales requiere autorización legal o consentimiento expreso del titular (art. 4).',
      'La ley contempla el tratamiento de datos provenientes de fuentes accesibles al público.',
      'El titular puede oponerse al uso de sus datos con fines de publicidad, investigación de mercado o encuestas.',
    ],
    source: 'Biblioteca del Congreso Nacional — leychile.cl (Ley 19628)',
  },
  incoming: {
    law: 'Ley 21.719',
    name: 'Regula la protección y el tratamiento de los datos personales y crea la Agencia de Protección de Datos Personales',
    published: '2024-12-13',
    inForce: '2026-12-01',
    rules: [
      'Crea la Agencia de Protección de Datos Personales: fiscaliza, dicta instrucciones y sanciona.',
      'Derechos ARCO ampliados, principios de transparencia y consentimiento, Registro Nacional de Sanciones.',
      'A agosto de 2026 el Gobierno evaluaba postergar la vigencia: verificar el texto vigente antes de operar.',
    ],
    source: 'Biblioteca del Congreso Nacional — leychile.cl (Ley 21719); informe BCN 12-25',
  },
  outreach: [
    'Toda baja debe ser efectiva y sin reactivación: responder pidiendo no ser contactado detiene las secuencias.',
    'Nunca contactar una dirección con evaluación do_not_contact, aunque cambie la campaña.',
    'Conservar evidencia de origen del dato y de la baja para responder requerimientos.',
  ],
} as const;

export type Obligation = {
  id: string;
  role: string;
  law: string;
  lawName: string;
  published: string;
  inForce: string;
  buyerRoles: string[];
  why: string;
  source: string;
};

const BASE_OBLIGATIONS: Obligation[] = [
  {
    id: 'karin',
    role: 'Prevención del acoso laboral, sexual y la violencia en el trabajo',
    law: 'Ley 21.643 (Ley Karin)',
    lawName: 'Modifica el Código del Trabajo en prevención, investigación y sanción del acoso',
    published: '2024-01-15',
    inForce: '2024-08-01',
    buyerRoles: ['jefe de personas', 'recursos humanos', 'prevencionista', 'fiscal', 'gerente general'],
    why: 'Todo empleador debe tener protocolo de prevención y procedimiento de investigación.',
    source: 'Dirección del Trabajo — dt.gob.cl; Diario Oficial 15-01-2024',
  },
  {
    id: 'datos-21719',
    role: 'Gobierno y protección de datos personales',
    law: 'Ley 21.719',
    lawName: 'Protección y tratamiento de datos personales; crea la Agencia',
    published: '2024-12-13',
    inForce: '2026-12-01',
    buyerRoles: ['fiscal', 'compliance', 'tecnología', 'gerente general'],
    why: 'Consentimiento, derechos de titulares y sanciones con autoridad fiscalizadora desde diciembre de 2026.',
    source: 'Biblioteca del Congreso Nacional — leychile.cl (Ley 21719)',
  },
];

const INDUSTRY_OBLIGATIONS: Record<string, { industry: string; aliases: string[]; obligations: Obligation[] }> = {
  salud: {
    industry: 'salud',
    aliases: ['salud', 'clinica', 'hospital', 'isapre', 'fonasa', 'laboratorio'],
    obligations: [
      {
        id: 'salud-16744',
        role: 'Seguridad y salud ocupacional del personal sanitario',
        law: 'Ley 16.744',
        lawName: 'Seguro social contra riesgos de accidentes del trabajo y enfermedades profesionales',
        published: '1968-02-01',
        inForce: '1968-02-01',
        buyerRoles: ['prevencionista', 'jefe de personas', 'director médico', 'gerente de operaciones'],
        why: 'Mutualidades y prevención obligatoria para el personal expuesto.',
        source: 'Biblioteca del Congreso Nacional — leychile.cl (Ley 16744)',
      },
    ],
  },
  mineria: {
    industry: 'minería',
    aliases: ['mineria', 'minería', 'minera', 'cobre', 'litio'],
    obligations: [
      {
        id: 'mineria-594',
        role: 'Condiciones sanitarias y ambientales en faena',
        law: 'DS 594',
        lawName: 'Reglamento sobre condiciones sanitarias y ambientales básicas en los lugares de trabajo',
        published: '1999-09-29',
        inForce: '2000-01-27',
        buyerRoles: ['prevencionista', 'superintendente', 'gerente de operaciones'],
        why: 'Faenas exigen prevención acreditada y condiciones verificables.',
        source: 'Biblioteca del Congreso Nacional — leychile.cl (DS 594)',
      },
    ],
  },
  banca: {
    industry: 'banca y servicios financieros',
    aliases: ['banca', 'banco', 'financiero', 'financiera', 'seguros', 'afp'],
    obligations: [
      {
        id: 'banca-20393',
        role: 'Prevención de delitos económicos y lavado de activos',
        law: 'Ley 20.393',
        lawName: 'Responsabilidad penal de las personas jurídicas; exige modelo de prevención con encargado autónomo',
        published: '2009-12-02',
        inForce: '2009-12-02',
        buyerRoles: ['oficial de cumplimiento', 'fiscal', 'gerente de riesgos', 'auditor'],
        why: 'Sin modelo de prevención con encargado autónomo, la empresa responde penalmente.',
        source: 'Biblioteca del Congreso Nacional — leychile.cl (Ley 20393)',
      },
    ],
  },
  retail: {
    industry: 'retail y consumo',
    aliases: ['retail', 'comercio', 'tienda', 'supermercado', 'ecommerce', 'consumo'],
    obligations: [
      {
        id: 'retail-19496',
        role: 'Derechos del consumidor y reclamos (SERNAC)',
        law: 'Ley 19.496',
        lawName: 'Protección de los derechos de los consumidores',
        published: '1997-03-07',
        inForce: '1997-06-05',
        buyerRoles: ['gerente comercial', 'servicio al cliente', 'fiscal'],
        why: 'Reclamos, garantías y publicidad exigen trazabilidad comercial.',
        source: 'Biblioteca del Congreso Nacional — leychile.cl (Ley 19496)',
      },
    ],
  },
  sector_publico: {
    industry: 'sector público',
    aliases: ['sector publico', 'sector público', 'estado', 'municipalidad', 'ministerio', 'servicio publico', 'gobierno'],
    obligations: [
      {
        id: 'publico-21180',
        role: 'Transformación digital del Estado',
        law: 'Ley 21.180',
        lawName: 'Transformación digital del Estado',
        published: '2019-11-11',
        inForce: '2019-11-11',
        buyerRoles: ['jefe de informática', 'jefe de servicio', 'modernización'],
        why: 'Procedimientos electrónicos y expedientes digitales obligatorios por fases.',
        source: 'Biblioteca del Congreso Nacional — leychile.cl (Ley 21180)',
      },
    ],
  },
  manufactura: {
    industry: 'manufactura e industria',
    aliases: ['manufactura', 'industria', 'fabrica', 'planta', 'produccion'],
    obligations: [
      {
        id: 'manufactura-594',
        role: 'Condiciones sanitarias y ambientales en planta',
        law: 'DS 594',
        lawName: 'Reglamento sobre condiciones sanitarias y ambientales básicas en los lugares de trabajo',
        published: '1999-09-29',
        inForce: '2000-01-27',
        buyerRoles: ['prevencionista', 'jefe de planta', 'gerente de operaciones'],
        why: 'Plantas exigen prevención acreditada y fiscalización sanitaria.',
        source: 'Biblioteca del Congreso Nacional — leychile.cl (DS 594)',
      },
    ],
  },
};

export function resolveIndustry(value: unknown): { key: string; industry: string } | null {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return null;
  for (const [key, entry] of Object.entries(INDUSTRY_OBLIGATIONS)) {
    if (entry.aliases.some((alias) => text.includes(alias))) return { key, industry: entry.industry };
  }
  return null;
}

/** 9.2 Base obligations for every employer plus industry specifics only when
 * the industry is disambiguated. Unknown industries never invent obligations. */
export function findObligations(industry: unknown): { industry: string | null; disambiguated: boolean; obligations: Obligation[] } {
  const resolved = resolveIndustry(industry);
  if (!resolved) {
    return { industry: null, disambiguated: false, obligations: BASE_OBLIGATIONS };
  }
  return {
    industry: INDUSTRY_OBLIGATIONS[resolved.key].industry,
    disambiguated: true,
    obligations: [...BASE_OBLIGATIONS, ...INDUSTRY_OBLIGATIONS[resolved.key].obligations],
  };
}
