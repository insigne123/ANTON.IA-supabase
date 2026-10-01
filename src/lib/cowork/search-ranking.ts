import { classifyAudienceRole, type AudienceRolePolicy } from './audience-analysis';

/**
 * Orders the people a search found: who may decide the purchase first, then who can refer, then the rest; a few per
 * company before more of the same one; and grouped by company for reading. The model writes the rolePolicy for the
 * offer when it proposes the search (the card shows it); this applies it to every person the same way. It never drops anyone.
 */

const ROLE_ORDER: Record<string, number> = {
  decision_maker_candidate: 0, needs_review: 1, referrer_candidate: 2, unknown: 3, excluded_by_criteria: 4,
};
/** Before a fourth person of the same company, three of every other one. */
export const COWORK_SEARCH_PER_COMPANY = 3;
/** Said once per result, not per person: a role read from a title is a hypothesis. */
export const COWORK_SEARCH_ROLE_NOTE = 'El rol sale del cargo: es una hipótesis para ordenar, no autoridad de compra comprobada. No elimina registros ni autoriza contacto.';

export type CoworkRankInput = {
  title: string | null;
  /** The company as the provider names it; people without one rank as their own company. */
  companyKey: string | null;
  industry?: string | null;
  employees?: number | null;
};

function quoted(terms: string[] | undefined) {
  const term = terms?.find(Boolean);
  return term ? ` «${term.slice(0, 40)}»` : '';
}

/** Why this person is on the list, in one line the panel and the model read the same way. */
export function coworkFitReason(classification: ReturnType<typeof classifyAudienceRole>, company: { industry?: string | null; employees?: number | null }) {
  const matched = 'matchedTerms' in classification ? classification.matchedTerms as Record<string, string[]> : undefined;
  const role = classification.reason === 'missing_title' ? 'Sin cargo informado'
    : classification.role === 'decision_maker_candidate'
      ? (classification.persona === 'buyer_and_user_candidate' ? 'Posible comprador y usuario' : 'Posible comprador') + (matched ? `: cargo con${quoted(matched.decisionTerms)}` : ' por su cargo')
      : classification.role === 'referrer_candidate' ? 'Puede derivarte' + (matched ? `: cargo con${quoted([...(matched.referralTerms || []), ...(matched.userTerms || [])])}` : ' por su cargo')
        : classification.role === 'needs_review' ? `Revisar: el cargo calza con incluir y con excluir${quoted(matched?.excludeTerms)}`
          : classification.role === 'excluded_by_criteria' ? `Fuera de tus criterios: cargo con${quoted(matched?.excludeTerms)}`
            : 'Cargo sin señal de compra para esta oferta';
  const place = [company.industry ? company.industry.slice(0, 60) : null,
    typeof company.employees === 'number' ? `${company.employees.toLocaleString('es-CL')} empleados` : null].filter(Boolean).join(', ');
  return (place ? `${role} · ${place}` : role).slice(0, 180);
}

/**
 * The ranked people from offset, at most limit of them, grouped by company, and how many there are in all. companyOrder
 * is the order the companies came in (step 1 of «empresas primero»); without it the provider's order decides ties.
 * The same people in the same order give the same list, so «Traer más» continues with offset + limit.
 */
export function rankCoworkSearchPeople<T extends CoworkRankInput>(people: T[], options: {
  rolePolicy?: AudienceRolePolicy | null; limit: number; offset?: number; perCompany?: number; companyOrder?: string[];
}) {
  const perCompany = Math.max(1, options.perCompany ?? COWORK_SEARCH_PER_COMPANY);
  const companyIndex = new Map((options.companyOrder || []).map((key, index) => [key, index]));
  const scored = people.map((person, index) => {
    const classification = classifyAudienceRole(person.title, options.rolePolicy);
    const company = person.companyKey || `person:${index}`;
    return { person, index, company, classification, rank: ROLE_ORDER[classification.role] ?? ROLE_ORDER.unknown };
  });
  scored.sort((a, b) => a.rank - b.rank
    || (companyIndex.get(a.company) ?? Number.MAX_SAFE_INTEGER) - (companyIndex.get(b.company) ?? Number.MAX_SAFE_INTEGER)
    || a.index - b.index);
  // A few per company first, then everyone else in the same order.
  const order: typeof scored = [];
  const perCompanyTaken = new Map<string, number>();
  const placed = new Set<number>();
  for (const entry of scored) {
    const count = perCompanyTaken.get(entry.company) || 0;
    if (count >= perCompany) continue;
    perCompanyTaken.set(entry.company, count + 1);
    placed.add(entry.index);
    order.push(entry);
  }
  for (const entry of scored) if (!placed.has(entry.index)) order.push(entry);
  const offset = Math.max(0, options.offset || 0);
  const chosen = order.slice(offset, offset + Math.max(0, options.limit));
  // Grouped for reading: each company where its best person ranks, its people together in rank order.
  const firstAt = new Map<string, number>();
  chosen.forEach((entry, position) => { if (!firstAt.has(entry.company)) firstAt.set(entry.company, position); });
  const items = chosen
    .map((entry, position) => ({ entry, position }))
    .sort((a, b) => firstAt.get(a.entry.company)! - firstAt.get(b.entry.company)! || a.position - b.position)
    .map(({ entry }) => ({ ...entry.person, role: entry.classification.role,
      fit: coworkFitReason(entry.classification, { industry: entry.person.industry, employees: entry.person.employees }) }));
  return { items, total: order.length };
}
