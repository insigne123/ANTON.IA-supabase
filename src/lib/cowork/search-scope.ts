import type { CoworkSearchCriteria } from './search-proposal';

/**
 * Where a search looks (Plan 14, 1). A search keeps the place the person asked for, and never runs without one. In the saved
 * evaluations «Busca empresas de Chile» once came out with no place at all, and requests without a place came out with
 * «Chile» in one attempt and nothing in the next: a search with no place brings people from any country and spends the quota
 * on them. It matters most inside a long task, where the plan approves its search by itself and nobody reads the card first.
 *
 * As the agents reviewed in Plan 14 do (HuggingChat: «a scope-changing fix silently changes what the user asked for»), a place
 * that was asked for and dropped, narrowed or widened without saying so goes back to the model once. A search with no place at
 * all gets the person's market without spending a call: the places in «Perfil», or the account's default (Chile).
 */

export type CoworkSearchDefaults = { places: string[]; source: 'profile' | 'default' };

export type CoworkSearchScope = {
  criteria: CoworkSearchCriteria;
  /** Places the request names that the criteria leave out. */
  missing: string[];
  /** Feedback for the model when a place asked for is missing, or null. */
  problem: string | null;
  /** The place added because nobody said where, and where it came from. */
  added: CoworkSearchDefaults | null;
};

const fold = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** A place a request may name, how a request says it and how a criteria value may spell it. */
type Place = { name: string; said: RegExp; spelled: string[] };

const place = (name: string, said: RegExp, ...spelled: string[]): Place => ({ name, said, spelled: [fold(name), ...spelled] });

// Countries of the region and Chile's regions and main cities, as people write them (folded: no accents, lower case). A city is
// covered only by its own name: «Antofagasta» does not cover Calama. Santiago and the Región Metropolitana are one place.
const PLACES: Place[] = [
  place('Chile', /\bchilen[oa]s?\b|\bchile\b/),
  place('Santiago', /\bsantiago\b(?!\s+(?:de\s+(?:compostela|cuba|los caballeros)|del estero))/, 'region metropolitana'),
  place('Región Metropolitana', /\bregion metropolitana\b/, 'santiago'),
  place('Valparaíso', /\bvalparaiso\b/),
  place('Viña del Mar', /\bvina del mar\b/),
  place('Concepción', /\bconcepcion\b/),
  place('Antofagasta', /\bantofagasta\b/),
  place('Calama', /\bcalama\b/),
  place('Iquique', /\biquique\b/),
  place('Arica', /\barica\b/),
  place('La Serena', /\bla serena\b/),
  place('Coquimbo', /\bcoquimbo\b/),
  place('Rancagua', /\brancagua\b/),
  place('Talca', /\btalca\b/),
  place('Temuco', /\btemuco\b/),
  place('Puerto Montt', /\bpuerto montt\b/),
  place('Punta Arenas', /\bpunta arenas\b/),
  place('Copiapó', /\bcopiapo\b/),
  place('Chillán', /\bchillan\b/),
  place('Valdivia', /\bvaldivia\b/),
  place('Osorno', /\bosorno\b/),
  place('Biobío', /\bbio\s?bio\b/, 'bio bio'),
  place('Atacama', /\batacama\b/),
  place('Magallanes', /\bmagallanes\b/),
  place('Araucanía', /\baraucania\b/),
  place('Maule', /\bmaule\b/),
  place('Ñuble', /\bnuble\b/),
  place('Tarapacá', /\btarapaca\b/),
  place('Perú', /\bperu\b|\bperuan[oa]s?\b/),
  place('Argentina', /\bargentin[oa]s?\b/),
  place('Colombia', /\bcolombia\b|\bcolombian[oa]s?\b/),
  place('México', /\bmexico\b|\bmexican[oa]s?\b/),
  place('Brasil', /\bbrasil\b|\bbrasilen[oa]s?\b/, 'brazil'),
  place('Uruguay', /\buruguay\b|\buruguay[oa]s?\b/),
  place('Paraguay', /\bparaguay\b|\bparaguay[oa]s?\b/),
  place('Bolivia', /\bbolivia\b|\bbolivian[oa]s?\b/),
  place('Ecuador', /\becuador\b|\becuatorian[oa]s?\b/),
  place('Venezuela', /\bvenezuela\b|\bvenezolan[oa]s?\b/),
  place('Panamá', /\bpanama\b|\bpanamen[oa]s?\b/),
  place('Costa Rica', /\bcosta rica\b|\bcostarricenses?\b/),
  place('España', /\bespana\b/, 'spain'),
  // Never the bare «usa»: in Spanish it is the verb («usa el tono formal»).
  place('Estados Unidos', /\bestados unidos\b|\bee\.?\s?uu\b/, 'united states', 'usa', 'ee.uu', 'eeuu'),
];
const COUNTRIES = new Set(['Chile', 'Perú', 'Argentina', 'Colombia', 'México', 'Brasil', 'Uruguay', 'Paraguay', 'Bolivia', 'Ecuador',
  'Venezuela', 'Panamá', 'Costa Rica', 'España', 'Estados Unidos']);


// «fuera de Santiago», «excepto Chile», «que no sean de Lima»: the place is named to leave it out.
const EXCLUDED = /(?:fuera de|excepto|salvo|menos|sin contar|que no (?:sean?|esten?) (?:de|en)|no en|ni en)\s+(?:la\s+|el\s+)?$/;
// «en cualquier país», «de todo el mundo», «global»: the person asked not to limit where.
const ANYWHERE = /\b(?:cualquier (?:pais|lugar|parte|region)|todo el mundo|todos los paises|global(?:mente)?|internacional(?:es|mente)?|sin importar (?:el |la |de )?(?:pais|lugar|region|ubicacion)|en todas partes)\b/;
// «Latinoamérica», «LATAM»: a region of several countries, which the criteria list one by one.
const LATAM = /\b(?:latam|latinoamerica|america latina|sudamerica|sur ?america|hispanoamerica)\b/;

/** The places a request names to search in, in the order it names them. */
export function coworkRequestedPlaces(request: string): string[] {
  const text = fold(request);
  const found: Array<{ name: string; at: number }> = [];
  for (const entry of PLACES) {
    const pattern = new RegExp(entry.said.source, 'g');
    for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
      if (EXCLUDED.test(text.slice(Math.max(0, match.index - 30), match.index))) continue;
      found.push({ name: entry.name, at: match.index });
      break;
    }
  }
  // «Viña del Mar» also says «Valparaíso» only when written; «Santiago» and «Región Metropolitana» are one place.
  const names = found.sort((a, b) => a.at - b.at).map(item => item.name);
  return names.filter((name, index) => !(name === 'Región Metropolitana' && names.includes('Santiago')) && names.indexOf(name) === index);
}

/** A city or region is covered by any value that names it («Santiago, Chile» covers Santiago). A country only by itself: «Santiago,
 * Chile» narrows Chile to one city, which is a change of scope too. */
const covers = (values: string[], name: string) => {
  const entry = PLACES.find(item => item.name === name);
  const spelled = entry ? entry.spelled : [fold(name)];
  const country = COUNTRIES.has(name);
  return values.some(value => {
    const folded = fold(value).trim().replace(/[.\s]+$/, '');
    return spelled.some(spelling => country ? folded === spelling : folded.includes(spelling));
  });
};

const list = (items: string[]) => items.length > 1 ? `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}` : items[0];

/**
 * Whether the answer that comes with the search says it changed the place on purpose («Amplié a todo Chile porque en Calama
 * hay pocos»): it names the place that was asked for and says it changed it.
 */
export function coworkExplainsSearchScope(reply: string, missing: string[]): boolean {
  const text = fold(reply);
  const changes = /\b(?:ampli[eo]|amplie|ampliar|ampliando|en vez de|en lugar de|cambi[eo]|cambie|no solo|tambien en|mas alla de|acote|acoto|acotar)\b/.test(text);
  return changes && missing.every(name => PLACES.find(item => item.name === name)?.spelled.some(spelling => text.includes(spelling)) ?? text.includes(fold(name)));
}

/** The places a search uses when nobody said where: the ones in «Perfil», or the account's default (COWORK_DEFAULT_SEARCH_LOCATION, Chile unless set). */
export function coworkSearchDefaults(userContext: unknown, configured: string | undefined = process.env.COWORK_DEFAULT_SEARCH_LOCATION): CoworkSearchDefaults | null {
  const own = (userContext as { idealCustomer?: { locations?: unknown } } | null | undefined)?.idealCustomer?.locations;
  const places = Array.isArray(own) ? own.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map(item => item.trim().slice(0, 80)).slice(0, 5) : [];
  if (places.length) return { places, source: 'profile' };
  const fallback = (configured ?? 'Chile').trim();
  return fallback ? { places: [fallback.slice(0, 80)], source: 'default' } : null;
}

/** The sentence that says where a search looks when nobody said it. */
export function coworkSearchScopeNotice(added: CoworkSearchDefaults): string {
  return added.source === 'profile'
    ? `Busco en ${list(added.places)}, el mercado de tu Perfil; si es en otro lugar, dímelo.`
    : `Busco en ${list(added.places)} porque no dijiste dónde; si es en otro lugar, dímelo.`;
}

/**
 * The search as it will run: the place asked for must be in it, and a search with no place at all gets the person's market.
 * A single LinkedIn profile, given companies (companyDomains) or a request for anywhere keep the criteria as they are.
 */
export function coworkSearchScope(criteria: CoworkSearchCriteria, request: string, defaults: CoworkSearchDefaults | null): CoworkSearchScope {
  const unchanged: CoworkSearchScope = { criteria, missing: [], problem: null, added: null };
  if (criteria.linkedinUrl || criteria.companyDomains?.length) return unchanged;
  const text = fold(request);
  if (ANYWHERE.test(text)) return unchanged;
  const where = [...(criteria.locations || []), ...(criteria.companyLocations || [])];
  const field = criteria.target === 'companies' ? 'companyLocations' : 'locations';
  const region = LATAM.test(text);
  // A region of several countries is listed country by country: any of them keeps it, none drops it.
  if (region && !where.length) {
    return { ...unchanged, missing: ['Latinoamérica'],
      problem: `El pedido es de Latinoamérica y la búsqueda no tiene ubicación: pon en ${field} los países que pidió (hasta cinco, por ejemplo «Chile», «Perú», «Colombia»).` };
  }
  const requested = region ? [] : coworkRequestedPlaces(request);
  const missing = requested.filter(name => !covers(where, name));
  if (missing.length) {
    return { ...unchanged, missing,
      problem: `El pedido nombra ${list(missing)} y la búsqueda ${where.length ? `busca en ${list(where)}` : 'no tiene ubicación'}: cambiaste el alcance sin decirlo. `
        + `Pon el lugar tal como lo pidió en ${field} (por ejemplo «${COUNTRIES.has(missing[0]) ? missing[0] : `${missing[0]}, Chile`}»). `
        + 'Si de verdad conviene otro lugar, explícalo en answer.reply en una frase («Amplié a todo Chile porque…»).' };
  }
  if (where.length || requested.length || region || !defaults?.places.length) return unchanged;
  const places = defaults.places.slice(0, 5);
  return { ...unchanged,
    criteria: criteria.target === 'companies' ? { ...criteria, companyLocations: places } : { ...criteria, locations: places },
    added: { ...defaults, places } };
}

/** Whether a text already names one of these places («Busco en Chile…»), so the notice is not said twice. */
export function coworkMentionsPlaces(text: string, places: string[]): boolean {
  const folded = fold(text);
  return places.some(name => folded.includes(fold(name)));
}
