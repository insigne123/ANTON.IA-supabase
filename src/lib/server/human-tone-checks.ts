import { sentenceFragments } from '@/lib/sentence-fragments';

export { sentenceFragments };

// Chequeos deterministas de tono humano para borradores generados por el modelo.
// Port de validador_correos.py (guía externa) más dos reglas propias que la
// línea base demostró necesarias: mezcla de tratamiento y ficha corporativa.
// Solo se aplican a texto del modelo, nunca a ediciones del usuario, y solo
// cuando el llamador lo pide (checkHumanTone) para no cambiar el firewall
// factual existente.
export type HumanToneCode =
  | 'tone_muletilla'
  | 'tone_formato'
  | 'tone_asunto'
  | 'tone_tratamiento'
  | 'tone_pregunta'
  | 'tone_ficha'
  | 'tone_fragmento';

export type HumanToneFinding = {
  code: HumanToneCode;
  message: string;
  blocking: boolean;
};

export type HumanToneCheckInput = {
  subject: string;
  body: string;
  ctaExactText?: string;
  recipientFirstName?: string | null;
  companyName?: string | null;
  maxModelQuestions?: number;
  hasSignal?: boolean;
  // The corrective retry: a ficha without a dated fact is then a notice, not a draft that is never created.
  finalAttempt?: boolean;
  // Names the subject may capitalise besides the person and the company: the seller's, and those written capitalised in the evidence
  // («Plan Minero Conjunto», «Talleres Neptuno»). In production a subject with one of them was turned back as Title Case eight times.
  knownNames?: string[];
  // The seller's company, whose name may carry an English word («Talent Solutions»).
  sellerName?: string | null;
};

// Copied from an English source («El Project incluye…», «apoyo (support) a la construcción (construction)»): never Spanish, unlike
// «staffing», «call center» or «peak», which are said here.
const ENGLISH_ONLY = new Set(['the', 'and', 'of', 'with', 'for', 'from', 'after', 'project', 'support', 'construction', 'graduation',
  'leading', 'services', 'solutions', 'company', 'business', 'development', 'through', 'which', 'will', 'would', 'growth', 'includes',
  'including', 'expected', 'stations', 'network', 'loans', 'financing', 'founder', 'founders', 'commercial', 'subsidiaries',
  'united', 'kingdom', 'netherlands', 'korea', 'lines']);

// Bloquean. Se comparan sin tildes ni mayúsculas.
const MULETILLAS = [
  'espero que este correo', 'espero que te encuentres', 'espero que se encuentre',
  'espero que estes bien', 'espero que este bien', 'me pongo en contacto', 'mi nombre es',
  'me complace', 'nos complace', 'tenemos el agrado', 'quisiera tomarme', 'queria tomarme',
  'en el dinamico mundo', 'en un mundo cada vez', 'hoy en dia las empresas',
  'el activo mas importante', 'estimado cliente', 'por medio de la presente',
  'por medio del presente', 'nos permitimos',
  'soluciones integrales', 'solucion integral', 'soluciones a la medida', 'propuesta de valor',
  'potenciar', 'potenciamos', 'potenciando', 'sinergia', 'sinergias', 'de vanguardia',
  'a la vanguardia', 'innovador', 'innovadora', 'innovadores', 'innovadoras',
  'robusto', 'robusta', 'robustos', 'robustas', 'holistico', 'holistica',
  'disruptivo', 'disruptiva', 'revolucionar', 'paradigma', 'al siguiente nivel',
  'valor agregado', 'aliado estrategico', 'socio estrategico', 'partner estrategico',
  'excelencia', 'clase mundial', 'ecosistema', 'apalancar', 'empoderar',
  'altamente calificado', 'altamente calificados', 'altamente especializado',
  'mision vision y valores',
  'cabe destacar', 'cabe mencionar', 'es importante destacar', 'es importante mencionar',
  'vale la pena mencionar', 'vale la pena destacar', 'en resumen', 'en definitiva',
  'en pocas palabras', 'la clave esta en', 'genuinamente', 'profundizar', 'ahondar',
  'fomentar', 'no se trata solo de', 'no solo se trata de',
  'lamentamos profundamente', 'inconvenientes ocasionados', 'maxima prioridad',
  'todas las medidas necesarias', 'ajenas a nuestra voluntad', 'valioso tiempo',
  'enriquecedor', 'enriquecedora', 'entendemos perfectamente', 'invitamos a considerar',
  'me encantaria tener la oportunidad',
  'no dudes en', 'no dude en', 'entera disposicion', 'sera un placer',
  'agradeciendo de antemano', 'favorable acogida',
  // Frases que no dicen nada: aparecían en la mitad de los borradores del banco del 30 de octubre de 2026.
  'es una alternativa', 'puede ser una alternativa', 'es una opcion', 'puede ser una opcion',
  'pone sobre la mesa', 'forma parte del trabajo', 'es parte del trabajo',
  'segun su reporte', 'en la conversacion salio', 'reporte interno',
  // «Así, el equipo puede…»: 36 de las 120 frases más artificiales que marcó el juez el 23 de octubre (borradores-ganchos-y-reglas.md).
  'puede implicar', 'asi el equipo', 'asi su equipo', 'asi el apoyo',
  // Lectura del banco del 30 de octubre de 2026 (v24): seguían pasando.
  'asi puede', 'asi pueden', 'asi podra', 'asi podran', 'puede acompanar', 'como parte de la gestion',
  // Su web dicha de vuelta en las investigaciones reales del 30 de octubre de 2026 (DFV, ManpowerGroup).
  'servicios integrales', 'soluciones de negocio',
];

// Relaciones forzadas entre el servicio y el hecho: «Las áreas verdes también entran en la coordinación de las obras civiles mineras»,
// «la diversidad e inclusión también se juega en el trabajo cotidiano» (secuencias reales del 31 de octubre de 2026). Y el seguimiento que,
// sin otra prueba del servicio en el perfil, dice algo abstracto del tema: «La responsabilidad social corporativa es otra perspectiva para el
// programa», «una mirada preventiva también considera la seguridad de las personas». Ninguna aparece en los 612 correos iniciales del corpus.
// En el reintento solo avisan: un borrador que no se crea por una de ellas es peor que uno que la trae y revisa la persona.
const RELACIONES_FORZADAS = ['tambien entra en', 'tambien entran en', 'tambien se juega en', 'suma una mirada', 'suma una instancia',
  'otra perspectiva', 'una mirada preventiva', 'tambien se puede trabajar', 'es una forma concreta de', 'tambien considera', 'ese cruce'];

// La misma frase con palabras en medio: «su costo acompaña la cosecha», «el costo de esa dotación acompaña el peak».
const HOLLOW_PATTERNS: Array<[RegExp, string]> = [
  [/(?<!\w)(?:costo|gasto)(?: \w+){0,4} acompan(?:a|e|an|en)(?!\w)/, 'el costo acompaña'],
  // «Así, ese turno puede volver a tener cobertura»: repite lo anterior como consecuencia. «Así que» es otra cosa.
  [/(?<!\w)asi(?! que)(?: \w+){0,3} (?:puede|pueden|puedes|podra|podran|podras)(?!\w)/, 'así … puede'],
  [/(?<!\w)asi (?:usted|ustedes|tu|el equipo|su equipo) (?:cuenta|cuentan|tiene|tienen|queda|quedan)(?!\w)/, 'así, usted cuenta…'],
];

// Solo advierten: a veces son válidas con un dato concreto.
const PALABRAS_A_REVISAR = ['optimizar', 'optimizamos', 'maximizar', 'transformar', 'clave',
  'integral', 'agil', 'flexible', 'eficiente'];

const ASUNTOS_GENERICOS = ['propuesta comercial', 'oportunidad de colaboracion',
  'presentacion de servicios', 'presentacion corporativa', 'importante', 'urgente'];

const FORMAS_TU = ['tu', 'te', 'ti', 'contigo', 'tienes', 'puedes', 'quieres', 'necesitas',
  'sabes', 'avisame', 'cuentame', 'dime', 'escribeme', 'mandame', 'parece que te', 'te parece'];

// Solo marcas que no se confunden con la tercera persona: «Acme abrirá sus tiendas» o «a los cajeros les toca doblar
// turno» van bien en un correo de tú, y bloquearlas devolvía primeros intentos correctos (banco del 30 de octubre de 2026).
// «ustedes» tampoco: es el plural de tú. Son las mismas que usa resolveEffectiveCta para elegir el CTA (Plan 15).
const USTED_MARCAS = ['usted', 'consigo', 'le escribo', 'le escribi', 'le escribimos', 'le comparto', 'le cuento',
  'le comento', 'le parece', 'le sirve', 'le serviria', 'le interesa', 'le interesaria', 'le propongo', 'le pregunto',
  'le ofrezco', 'le acomoda', 'le consulto', 'le dejo', 'le envio', 'le mando', 'su agenda', 'su tiempo', 'su respuesta'];

// Apertura que le describe su propia empresa en vez de darle un motivo.
const FICHA_COPULAS = ['se dedica a', 'es una empresa', 'se hace cargo de', 'comunica que',
  'publica que', 'lider en', 'cuenta con', 'se describe como', 'se presenta como', 'se define como'];

// Su publicidad dicha de vuelta: «Hualpén es la principal compañía de transporte privado» (investigación real del 30 de octubre de 2026).
// Siempre se puede quitar el adjetivo y dejar el hecho, así que bloquea con o sin señal.
const PUFFERY_NOUNS = 'compania|empresa|productor|productora|operador|operadora|cadena|proveedor|proveedora|grupo|red|flota|exportador|exportadora|fabricante|distribuidor|distribuidora|actor|referente|marca|minera|naviera|aerolinea|banco|clinica|universidad|portal|plataforma|consultora|holding|constructora|aseguradora';
const PUFFERY_PATTERNS = [
  // Con el sustantivo detrás: «es la principal causa de rotación» o «el primer grupo de contratados» no son publicidad.
  new RegExp(`(?<!\\w)(?:la|el|los|las) (?:principal|principales|mayor|mayores) (?:${PUFFERY_NOUNS})(?!\\w)`),
  new RegExp(`(?<!\\w)(?:${PUFFERY_NOUNS}) (?:mas grande|mas grandes|lider|lideres|numero uno)(?!\\w)`),
  /(?<!\w)(?:uno de los|una de las) (?:principales|mayores|mas grandes) (?:companias|empresas|productores|operadores|cadenas|proveedores|grupos|exportadores|fabricantes|distribuidores|actores|referentes|marcas|mineras|navieras|bancos|clinicas|portales|plataformas|consultoras|holdings|constructoras|aseguradoras|universidades)(?!\w)/,
  // «el que falta es el líder de turno» sí es del rubro.
  /(?<!\w)(?:es|son|somos) (?:el |la |los |las )?lider(?:es)? (?:en|mundial|mundiales|nacional|regional|del mercado|de la industria|del rubro|del sector)(?!\w)/,
  /(?<!\w)lider(?:es)? (?:mundial|mundiales|del mercado|de la industria|nacional|regional|del rubro|en su rubro)(?!\w)/,
  /(?<!\w)(?:posicion de liderazgo|liderazgo mundial|liderazgo global|de primer nivel)(?!\w)/,
  /(?<!\w)(?:la|el) (?:flota|red|planta|cartera|operacion) mas grande(?!\w)/,
  // «Acme está entre los portales de empleo más grandes de Chile» (real research, 31 Oct 2026).
  /(?<!\w)entre (?:los|las) (?:\w+ ){1,4}(?:mas grandes|mayores|principales|lideres)(?!\w)/,
];

const NUMERO_PALABRAS = ['dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez'];

function normalize(value: unknown) {
  return String(value || '')
    .toLocaleLowerCase('es')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function containsWord(haystack: string, phrase: string) {
  return new RegExp(`(?<!\\w)${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?!\\w)`).test(haystack);
}

function stripCta(body: string, ctaExactText?: string) {
  const cta = String(ctaExactText || '').trim();
  if (!cta) return body;
  const index = body.lastIndexOf(cta);
  return index === -1 ? body : `${body.slice(0, index)} ${body.slice(index + cta.length)}`;
}

function firstContentLine(body: string) {
  for (const line of String(body || '').split('\n')) {
    // \p{L}, not \w: «Hola María,» or «Hola Andrés,» was read as the opening and the opening was never checked.
    const withoutGreeting = line.replace(/^(?:hola|estimad[oa]s?|buen[oa]s\s+(?:d[ií]as|tardes))(?:\s+[\p{L}'-]+){0,3}\s*(?:,|:|$)\s*/iu, '').trim();
    if (/[\p{L}\p{N}]/u.test(withoutGreeting)) return withoutGreeting;
  }
  return '';
}

/** The blocked phrases a text already carries: the writer is told the source uses them, so it does not copy them and pay for a retry. */
export function blockedPhrasesIn(value: unknown) {
  const normalized = normalize(value);
  return [...new Set([
    ...MULETILLAS.filter((phrase) => containsWord(normalized, phrase)),
    ...RELACIONES_FORZADAS.filter((phrase) => containsWord(normalized, phrase)),
    ...PUFFERY_PATTERNS.map((pattern) => normalized.match(pattern)?.[0]).filter((match): match is string => Boolean(match)),
  ])];
}

export function checkHumanTone(input: HumanToneCheckInput): { errors: HumanToneFinding[]; warnings: HumanToneFinding[] } {
  const errors: HumanToneFinding[] = [];
  const warnings: HumanToneFinding[] = [];
  const subject = String(input.subject || '').trim();
  const modelBody = stripCta(String(input.body || ''), input.ctaExactText);
  const normText = normalize(`${subject}\n${input.body || ''}`);
  const normModel = normalize(modelBody);
  const normSubject = normalize(subject);

  const found = [
    ...MULETILLAS.filter((phrase) => containsWord(normText, phrase)),
    ...HOLLOW_PATTERNS.filter(([pattern]) => pattern.test(normText)).map(([, label]) => label),
  ];
  if (found.length > 0) {
    errors.push({
      code: 'tone_muletilla',
      message: `Frases de plantilla o de IA: ${found.slice(0, 4).map((f) => `«${f}»`).join(', ')}. Reescríbelas con palabras simples y concretas.`,
      blocking: true,
    });
  }
  const forced = RELACIONES_FORZADAS.filter((phrase) => containsWord(normText, phrase));
  if (forced.length > 0) {
    const finding = { code: 'tone_muletilla', message: `Frases de plantilla o de IA: ${forced.map((f) => `«${f}»`).join(', ')}. No inventes cómo funciona su operación: di qué harías en ese lugar o momento.`, blocking: !input.finalAttempt } as const;
    if (finding.blocking) errors.push({ ...finding });
    else warnings.push({ ...finding });
  }
  const review = PALABRAS_A_REVISAR.filter((word) => containsWord(normText, word));
  if (review.length > 0) {
    warnings.push({ code: 'tone_muletilla', message: `Palabras a revisar (válidas solo con un dato concreto): ${review.join(', ')}.`, blocking: false });
  }

  const raw = `${subject}\n${input.body || ''}`;
  if (raw.includes('—') || raw.includes(' – ')) {
    errors.push({ code: 'tone_formato', message: 'Cambia los guiones largos por punto, coma o dos puntos.', blocking: true });
  }
  if (/[\u{1F000}-\u{1FAFF}☀-➿️]/u.test(raw)) {
    errors.push({ code: 'tone_formato', message: 'Quita los emojis.', blocking: true });
  }
  if (/(^|\n)\s*(\*\*|__|`|#{1,6}\s)/m.test(modelBody)) {
    errors.push({ code: 'tone_formato', message: 'Quita el formato Markdown (negritas, títulos, código). El correo va en texto plano.', blocking: true });
  }
  if (/^\s*(?:[-*•·]|\d+[.)])\s+/m.test(modelBody)) {
    errors.push({ code: 'tone_formato', message: 'El correo va en prosa, sin viñetas ni listas numeradas.', blocking: true });
  }
  if (raw.split('!').length - 1 > 1) {
    errors.push({ code: 'tone_formato', message: 'Usa como máximo un signo de exclamación.', blocking: true });
  }
  const maxQuestions = input.maxModelQuestions ?? 1;
  const questions = (modelBody.match(/\?/g) || []).length;
  if (questions > maxQuestions) {
    errors.push({ code: 'tone_pregunta', message: 'Deja una sola pregunta o pedido en el correo.', blocking: true });
  }

  const properNouns = new Set<string>();
  for (const name of [input.recipientFirstName, input.companyName]) {
    for (const token of normalize(name).split(' ').filter((token) => token.length >= 3)) properNouns.add(token);
  }
  // The evidence's names only excuse a capital, never count as no word: «Evaluaciones para Nuevo Nivel Mina» has three useful words.
  const capitalised = new Set(properNouns);
  for (const name of input.knownNames || []) {
    for (const token of normalize(name).split(' ').filter((token) => token.length >= 3)) capitalised.add(token);
  }
  if (subject) {
    // A figure is not a word: «Capacitación para las Líneas 8 y 9» has five, and was turned back twice as seven (real research, 30 Oct 2026).
    const useful = subject.split(/\s+/).filter((word) => /\p{L}/u.test(word) && !properNouns.has(normalize(word).replace(/^[¿?¡!"'([{]+|[.,;:!?)"'\]}]+$/g, '')));
    if (useful.length < 2 || useful.length > 6) {
      errors.push({ code: 'tone_asunto', message: `El asunto tiene ${useful.length} palabras útiles (sin contar nombres propios); debe tener entre 2 y 6.`, blocking: true });
    }
    const rest = subject.split(/\s+/).slice(1).filter((word) => /^[A-Za-zÁÉÍÓÚÜÑ]/.test(word) && !capitalised.has(normalize(word)));
    const upper = rest.filter((word) => /^[A-ZÁÉÍÓÚÜÑ]/.test(word));
    if (rest.length > 0 && upper.length >= 3 && upper.length / rest.length >= 0.5) {
      errors.push({ code: 'tone_asunto', message: 'El asunto parece título (Mayúscula En Cada Palabra). Escríbelo como oración, en minúscula.', blocking: true });
    }
    const generic = ASUNTOS_GENERICOS.filter((phrase) => containsWord(normSubject, phrase));
    if (generic.length > 0) {
      errors.push({ code: 'tone_asunto', message: `Asunto genérico (${generic.join(', ')}). Usa algo específico del destinatario.`, blocking: true });
    }
  }

  const hasUsted = USTED_MARCAS.some((mark) => containsWord(normModel, mark));
  const tuForms = FORMAS_TU.filter((form) => containsWord(normModel, form));
  if (hasUsted && tuForms.length > 0) {
    errors.push({ code: 'tone_tratamiento', message: `Mezcla tuteo y usted en el mismo correo (usted + ${tuForms.slice(0, 3).join(', ')}). Elige uno y mantenlo en todo el correo.`, blocking: true });
  }

  const opening = normalize(firstContentLine(modelBody));
  const company = normalize(input.companyName);
  if (opening && company) {
    const firstToken = company.split(' ')[0];
    // The company written as a name, with its capital: «una cadena de retail con 40 tiendas» does not name «Tiendas Ejemplo» (bank, 30 Oct 2026).
    const namesCompany = Boolean(firstToken) && [...firstContentLine(modelBody).matchAll(/[\p{L}\p{N}]+/gu)]
      .some((match) => normalize(match[0]) === firstToken && /^[\p{Lu}\p{N}]/u.test(match[0]));
    const copula = namesCompany && FICHA_COPULAS.find((phrase) => opening.includes(phrase));
    const conNumero = namesCompany && new RegExp(`\\bcon (?:mas de |\\d+|${NUMERO_PALABRAS.join('|')})\\b`).test(opening);
    // «En una cadena de retail como Acme, con 40 tiendas, …» names the company in passing, as the prompt asks when there is no signal.
    // Only as the frame of an observation of the trade («En una … como Acme, …»), not ahead of a pitch («Para una … como Acme, sumar personal…»).
    // «En una faena como la de Minera Cascada, con más de 2.000 trabajadores, la dotación temporal puede servir» frames a pitch, not the trade.
    const inPassing = new RegExp(`^en [^,]{0,80}\\b(?:como|de) (?:(?:la|el|los|las)(?: de)? )?${firstToken}\\b`).test(opening)
      && !/\b(?:puede|pueden|podria|podrian) (?:servir|ayudar|ser util)\b/.test(opening);
    if ((copula || conNumero) && !inPassing) {
      // Sin señal también pide el reintento: nombrar a la empresa de pasada siempre se puede, y en las investigaciones reales del
      // 30 de octubre de 2026 dos de tres aperturas quedaron como «SQM cuenta con cinco líneas de negocio.». En el reintento solo
      // avisa: un borrador que no se crea por cómo abre es peor que uno que abre con su ficha y revisa la persona.
      const blocking = Boolean(input.hasSignal) || !input.finalAttempt;
      const finding = {
        code: 'tone_ficha',
        message: input.hasSignal
          ? 'La apertura le describe su propia empresa en vez de darle un motivo. Usa el dato fechado, o abre con lo que se complica en su rubro y nombra a la empresa de pasada («En una empresa como …, …»), no su ficha.'
          : 'La apertura le describe su propia empresa en vez de darle un motivo. Abre con lo que se complica en su rubro o en su cargo y nombra a la empresa de pasada, con su dato en esa misma oración («En una empresa con … como …, …»).',
        blocking,
      } as const;
      if (blocking) errors.push({ ...finding });
      else warnings.push({ ...finding });
    }
  }

  // «Tawa Chile resume su aporte como «Contribuimos con las organizaciones»» (real research, 30 Oct 2026): their site, quoted.
  // A short name in quotes («Mantenimiento Vial y Control Carretera») is not a quote of their pitch.
  const quoted = [...modelBody.matchAll(/[«"“]([^»"”]{3,160})[»"”]/g)].map((match) => match[1])
    .find((text) => text.trim().split(/\s+/).length >= 6 || /\p{L}{3,}(?:amos|emos|imos)\b|\bnuestr[oa]s?\b/iu.test(text));
  if (quoted) {
    errors.push({ code: 'tone_ficha', message: `No cites a la empresa entre comillas («${quoted.slice(0, 60)}»): di con tus palabras lo que hace en concreto.`, blocking: true });
  }

  // A name of a company may carry one («White Lion Foods», «Talent Solutions»): those are left alone.
  // Only the two companies' names: the evidence's capitals include «United Kingdom».
  const ownNames = new Set([input.companyName, input.sellerName].flatMap((name) => normalize(name).split(' ')));
  const english = [...new Set(`${subject}\n${modelBody}`.split(/[^\p{L}]+/u)
    .filter((word) => ENGLISH_ONLY.has(word.toLowerCase()) && !ownNames.has(normalize(word))))];
  // «filiales en el Reino Unido (United Kingdom)» (real research, 30 Oct 2026): the original in English as a gloss. Spanish in brackets
  // («(Metro de Santiago)»), an acronym («(ITO)»), a figure («(Ley 21.015)») or one brand name («(ExproFacility)») are not glosses.
  const SPANISH_LINK = /^(?:de|del|la|el|los|las|y|en|para|con|por)$/i;
  for (const match of `${subject}\n${modelBody}`.matchAll(/\(([A-Za-z]+(?: [A-Za-z]+){0,3})\)/g)) {
    const words = match[1].split(' ');
    const gloss = !words.some((word) => SPANISH_LINK.test(word)) && words.some((word) => /[a-z]/.test(word))
      && (words.length >= 2 || ENGLISH_ONLY.has(words[0].toLowerCase()) || /^[a-z]/.test(words[0]));
    if (gloss && !english.includes(match[0])) english.push(match[0]);
  }
  if (english.length > 0) {
    // On the corrective retry only a notice, like the ficha: the writer keeps «United Kingdom» as a name, and a draft not created is worse.
    const finding = { code: 'tone_formato', message: `Hay palabras en inglés copiadas de la fuente (${english.slice(0, 4).map((word) => `«${word}»`).join(', ')}): escríbelas en español («Reino Unido», «proyecto»).`, blocking: !input.finalAttempt } as const;
    if (finding.blocking) errors.push({ ...finding });
    else warnings.push({ ...finding });
  }

  // «Soy Carolina, de PSOL; Tawa Chile encuentra y selecciona talento…» (real research, 30 Oct 2026): after the introduction comes what the
  // seller does; what the recipient's company does goes in the opening.
  const recipientToken = normalize(input.companyName).split(' ')[0];
  const afterIntroduction = modelBody.match(/(?:^|\n|[.!?]\s+)soy\s+[^,;.\n]{1,40},\s+de\s+[^,;.\n]{1,60}[;,.]\s*([^.\n]{0,120})/iu)?.[1];
  if (afterIntroduction && recipientToken && new RegExp(`^(?:en |la |el |los |las )?${recipientToken}\\b`).test(normalize(afterIntroduction))) {
    errors.push({ code: 'tone_ficha', message: 'Después de «Soy …, de …;» di qué hace tu empresa, no lo que hace la de ellos: eso va en la apertura.', blocking: true });
  }

  // «Es una línea distinta de diversidad e inclusión», «La capacitación es distinta de nuestras asesorías» (follow-ups of real research,
  // 31 Oct 2026): asked for a new angle, the writer said so instead of just taking it. «Cada faena es distinta a otra» is left alone.
  if (/\b(?:es|son|suma|sumamos|aporta|ofrece) (?:\p{L}+ ){0,4}distint[ao]s? (?:de|a)\b(?! otr)/u.test(normModel)) {
    errors.push({ code: 'tone_muletilla', message: 'No compares este servicio con lo que ya ofreciste («es una línea distinta de…»): di directamente qué harías por ellos.', blocking: true });
  }

  // «En ServiPro hacemos facility management… En ServiPro llevamos más de 28 años…» (follow-ups of real research, 31 Oct 2026). A
  // signature («Ejecutiva comercial, ServiPro») is not the body.
  const sellerToken = normalize(input.sellerName).replace(/\b(?:s ?p ?a|s ?a|ltda|limitada|inc|llc|spa)\b/g, ' ').replace(/\s+/g, ' ').trim();
  if (sellerToken.length >= 3) {
    const prose = modelBody.replace(/<br\s*\/?>|<\/p>/gi, '\n').replace(/<[^>]+>/g, ' ')
      .split(/\n\s*(?:saludos|un saludo|atentamente|cordialmente|abrazo|gracias)\b/i)[0];
    const mentions = ` ${normalize(prose)} `.split(` ${sellerToken} `).length - 1;
    if (mentions >= 2) {
      const finding = { code: 'tone_muletilla', message: `Nombras a ${String(input.sellerName).trim()} ${mentions} veces: déjalo una vez y en la otra oración habla en primera persona («hacemos…», «llevamos…»).`, blocking: !input.finalAttempt } as const;
      if (finding.blocking) errors.push({ ...finding });
      else warnings.push({ ...finding });
    }
  }

  // «Vi que en Acme se pueden suscribir planes mensuales.» (real research, 1 Nov 2026): without a dated fact, «vi que» sells what the
  // company says of itself as news. The opening names it in passing instead, as the prompt asks.
  // Only when the caller knows there is none (the preflight passes it): other callers keep their «Vi que».
  if (input.hasSignal === false && /(?<!\w)vi que(?!\w)/.test(normModel)) {
    const finding = { code: 'tone_ficha', message: 'Sin un hecho con fecha, no digas «Vi que…»: nombra el dato de la empresa de pasada en la primera oración («En una empresa de software como Acme, …»).', blocking: !input.finalAttempt } as const;
    if (finding.blocking) errors.push({ ...finding });
    else warnings.push({ ...finding });
  }

  // «La plataforma captura imágenes durante el test; esta es la última vez que te escribo sobre esto» (real research, 31 Oct 2026).
  if (/[;,]\s*esta es la [úu]ltima vez\b/i.test(modelBody)) {
    const finding = { code: 'tone_formato', message: 'Escribe «Esta es la última vez…» como oración aparte, después de un punto, no pegada a otra idea con «;» o coma.', blocking: !input.finalAttempt } as const;
    if (finding.blocking) errors.push({ ...finding });
    else warnings.push({ ...finding });
  }

  const puffery = PUFFERY_PATTERNS.map((pattern) => normModel.match(pattern)?.[0]).find(Boolean);
  if (puffery) {
    errors.push({ code: 'tone_ficha', message: `Quita la publicidad de la empresa («${puffery}»): decirle que es la principal o la más grande no le da un motivo para responder. Deja el hecho, sin el adjetivo.`, blocking: true });
  }

  const lowModel = modelBody.toLocaleLowerCase('es');
  if (/\bno (?:es|son|era|se trata de)\b[^.?!\n]{1,60}?,\s*(?:es|son|sino)\b/.test(lowModel) || /\bno solo\b[^.?!\n]{1,80}?\bsino\b/.test(normModel)) {
    warnings.push({ code: 'tone_muletilla', message: 'Posible contraste del tipo «no es X, es Y». Revisa si hace falta.', blocking: false });
  }
  const fragments = sentenceFragments(modelBody);
  if (fragments.length > 0) {
    errors.push({ code: 'tone_fragmento', message: `Oración incompleta, sin verbo: ${fragments.slice(0, 2).map((f) => `«${f}»`).join(', ')}. Escríbela completa o júntala con la siguiente.`, blocking: true });
  }
  const paragraphs = modelBody.split(/\n\s*\n/).map((p) => p.split(/\s+/).filter(Boolean).length);
  if (paragraphs.some((count) => count > 55)) {
    warnings.push({ code: 'tone_formato', message: 'Hay un párrafo de más de 55 palabras; divídelo, porque se lee en el celular.', blocking: false });
  }
  return { errors, warnings };
}

export function feedbackForToneRetry(findings: HumanToneFinding[]) {
  return findings.map((finding) => finding.message);
}
