/**
 * How a person writes a prospecting email: one voice for every writer of the app (research drafts, Cowork's Writer, campaign follow-ups).
 *
 * 11 Nov 2026: after 41 versions of rules the drafts were correct and still read as a form filled in. Side by side they share one skeleton
 * (a fact, a sentence explaining the recipient's own trade to them, «Soy X, de Y;», the same closing) and one way of speaking: things act
 * («la lectura de concentración suma otro dato») and nobody says «I» or «you». More rules about what not to write did not move that. What the
 * public work on the subject agrees on did (docs/correos-voz-humana.md): show the model whole emails instead of describing them, write
 * first and edit for the voice as a separate job, and count the tells instead of guessing.
 */

export const OUTREACH_VOICE_VERSION = 'outreach-voice/v1';

export type VoiceStep = 'initial' | 'follow_up' | 'close';
export type VoiceTreatment = 'tu' | 'usted';

/** What a person does when writing one of these, each with the machine's version next to it. The pairs show a change, not words to copy. */
export const HUMAN_VOICE_GUIDE = [
  'Cómo escribe una persona un correo de prospección, y en qué se nota cuando lo escribió una máquina:',
  '1. Le habla a alguien. Casi todas las oraciones llevan un «tú» (o «usted», «ustedes») o un «yo» o «nosotros». No narra desde lejos ni le explica al otro cómo funciona su propio trabajo: lo que podría pasarle se lo dice a él, como algo que le puede pasar.',
  '   Máquina: «En transporte, cuando un camión queda detenido, se acumulan los despachos y aumentan los reclamos de clientes.»',
  '   Persona: «Si se te queda un camión parado un viernes, el lunes partes con los despachos atrasados y con tus clientes llamando.»',
  '2. Las personas hacen cosas; las cosas no. El sujeto es alguien (tú, tu equipo, nosotros, quien postula), no un sustantivo abstracto.',
  '   Máquina: «La conciliación automática entrega los movimientos listos para su revisión.»',
  '   Persona: «Cuando llegas el lunes la conciliación ya está hecha, y solo te queda mirar lo que no calzó.»',
  '3. Une las ideas con las palabras con que se unen al hablar, en vez de apilar oraciones sueltas.',
  '   Máquina: «Hacemos la mantención preventiva de la flota. El costo se fija por contrato.»',
  '   Persona: «Hacemos la mantención preventiva de la flota, y como el costo queda fijo por contrato sabes desde el primer día cuánto vas a pagar.»',
  '4. No fuerza la relación entre lo que le pasa al otro y lo que vende. Si la oración que las une suena rebuscada («revisar las facturas se suma a coordinar los despachos»), la quita y va directo a lo que hace, o dice con franqueza que lo está suponiendo.',
  '5. Usa palabras de todos los días y verbos simples (es, tiene, hacemos, vemos). No «cuenta con», «permite», «brinda», «realizar», «mediante», «a través de», «vinculado a»; tampoco gerundios para alargar («permitiendo», «asegurando») ni filas de sustantivos («reportes de estado para encargados de áreas de operación»).',
  '6. Las frases no miden lo mismo: una que explica y una corta que remata. Una frase corta sola está bien.',
  '7. No suena a folleto ni a informe: sin punto y coma, sin dos puntos para anunciar una idea, sin tríadas, sin «no es X, es Y». Tampoco a chat: sin exclamaciones ni muletillas.',
  '8. Es breve, con una sola idea y un solo pedido, fácil de contestar. Y no se parece al correo anterior: dos correos de la misma persona no entran igual.',
].join('\n');

/**
 * What the guide shows as the person's version of a sentence. A rewrite that lifts one states a thing nobody told it: shown «…los comparas en
 * la misma pantalla», a draft about another product said its reports were compared «en la misma pantalla» (bench, 11 Nov 2026). The pairs are
 * about trades the sellers of the bench are not in, so a good bench does not come from the guide.
 */
export const HUMAN_VOICE_GUIDE_EXAMPLES = HUMAN_VOICE_GUIDE.split('\n').filter((line) => /^\s+Persona: /.test(line)).join(' ');

export type VoiceSample = {
  id: string;
  step: VoiceStep;
  treatment: VoiceTreatment;
  /** The paragraphs between the greeting and the ask. */
  body: string[];
  /** The one thing it asks for, last. In a first email of a research draft the server adds it. */
  ask: string;
};

/**
 * Whole emails written by hand for sellers and companies that do not exist, in the Spanish of a Chilean salesperson. They teach how it
 * sounds: no figure, name or claim of theirs is a fact, and a writer never carries one into an email (voiceFactsChanged turns that back).
 * Several shapes on purpose: a batch whose emails all follow one sample reads as a mailing.
 */
export const VOICE_SAMPLES: VoiceSample[] = [
  {
    id: 'inicial-hecho-directo', step: 'initial', treatment: 'tu',
    body: [
      'Vi que abren el centro de distribución de Lampa en marzo. En Dotal armamos el equipo de bodega para partidas como esa, sin que tengas que contratarlos a todos de planta.',
      'Nosotros reclutamos, contratamos y administramos a la gente. Si en mayo necesitas la mitad, el equipo se ajusta y pagas solo por los que siguen.',
    ],
    ask: '¿Te parece si lo vemos 15 minutos esta semana?',
  },
  {
    id: 'inicial-motivo-riesgo', step: 'initial', treatment: 'tu',
    body: [
      'Te escribo por la temporada. Con las cuadrillas entrando y saliendo, lo más probable es que la asistencia termine en una planilla que alguien de tu equipo cuadra a mano cada quincena, y ahí es donde aparecen los errores de pago.',
      'En Turnia hacemos que cada trabajador marque desde su teléfono y que las horas lleguen listas a remuneraciones. Tu equipo solo revisa las diferencias.',
    ],
    ask: '¿Tienes 15 minutos esta semana para verlo?',
  },
  {
    id: 'inicial-lo-dificil', step: 'initial', treatment: 'tu',
    body: [
      'Vi que se adjudicaron el aseo de las tres clínicas nuevas. Partir tres sedes al mismo tiempo es lo más difícil del contrato, porque tienes que tener a la gente contratada y capacitada antes del primer día.',
      'Ahí entramos nosotros. En Dotal dejamos contratado al equipo de cada sede y lo administramos mientras dure el contrato, y tú te quedas con la operación y no con el papeleo.',
    ],
    ask: '¿Lo vemos en 15 minutos esta semana?',
  },
  {
    id: 'inicial-un-parrafo', step: 'initial', treatment: 'tu',
    body: [
      'Tienen cinco búsquedas de vendedores abiertas en regiones, y en Selecta hacemos esa selección por ustedes. Te mandamos una terna por cargo con cada candidato ya entrevistado y con sus referencias revisadas, para que solo tengas que elegir.',
    ],
    ask: '¿Te acomoda una llamada de 15 minutos esta semana?',
  },
  {
    id: 'inicial-empresa-de-pasada', step: 'initial', treatment: 'tu',
    body: [
      'En una constructora del tamaño de Obras del Sur, cada obra nueva te obliga a salir a buscar cuadrilla justo cuando menos tiempo tienes, y eso es lo que resolvemos en Dotal.',
      'Ponemos a los maestros y jornales por el tiempo que dure la obra y nos hacemos cargo de sus contratos y finiquitos. Cuando termina la obra, dejas de pagar por ellos.',
    ],
    ask: '¿Te parece si lo conversamos 15 minutos esta semana?',
  },
  {
    id: 'inicial-suposicion', step: 'initial', treatment: 'tu',
    body: [
      'Con dos locales nuevos antes de Navidad, me imagino que ya están contratando gente para sala y caja, y en Selecta te ayudamos con la parte más lenta, que es elegir.',
      'Cada postulante da una prueba corta desde su teléfono y a ti te llega un informe para compararlos, en vez de leer currículums uno por uno.',
    ],
    ask: '¿Lo vemos en 15 minutos esta semana?',
  },
  {
    id: 'inicial-quien-soy', step: 'initial', treatment: 'tu',
    body: [
      'Trabajo en Dotal, donde ponemos personal temporal para obras. Vi que parten la obra de Quilicura en noviembre, y armar cuadrillas en pocas semanas es lo que más hacemos.',
      'Reclutamos a los maestros y jornales, los contratamos nosotros y llegan a la obra el día que partes.',
    ],
    ask: '¿Tienes 15 minutos esta semana para verlo?',
  },
  {
    id: 'inicial-no-se-como', step: 'initial', treatment: 'tu',
    body: [
      'No sé cómo están cubriendo hoy los turnos de noche, pero si es con horas extra del mismo equipo, te puedo ayudar a salir de eso.',
      'En Dotal ponemos conserjes de reemplazo por el tiempo que necesites, ya contratados y con su inducción hecha. Tú nos dices qué turnos y desde cuándo.',
    ],
    ask: '¿Te acomoda una llamada de 15 minutos esta semana?',
  },
  {
    id: 'inicial-usted-fiscalizacion', step: 'initial', treatment: 'usted',
    body: [
      'Le escribo por la fiscalización de contratistas que anunció la Dirección del Trabajo para la región. En esas semanas su equipo termina dedicado a juntar contratos y anexos, y todo lo demás queda esperando.',
      'En Dotal llevamos esa administración por ustedes. Dejamos contratos, anexos y finiquitos al día, de modo que cuando llegue la revisión solo tengan que entregarlos.',
    ],
    ask: '¿Le parece si lo conversamos 15 minutos esta semana?',
  },
  {
    id: 'inicial-usted-sucursales', step: 'initial', treatment: 'usted',
    body: [
      'Vi que abren cinco sucursales en regiones durante el primer semestre. En Dotal ponemos al personal de atención para aperturas como esas, por los meses que usted defina.',
      'Nosotros los seleccionamos y los contratamos, y su equipo solo les enseña el trabajo de la sucursal.',
    ],
    ask: '¿Le acomoda una llamada de 15 minutos esta semana?',
  },
  {
    id: 'seguimiento-detalle', step: 'follow_up', treatment: 'tu',
    body: [
      'Sobre la bodega de Lampa: nosotros también hacemos la inducción, así que la gente llega el primer día sabiendo usar el equipo y tu jefe de turno no tiene que parar a enseñar.',
    ],
    ask: '¿Quién ve hoy la inducción cuando entra un grupo grande?',
  },
  {
    id: 'seguimiento-dato', step: 'follow_up', treatment: 'tu',
    body: [
      'Un detalle que no te conté: la marcación funciona sin señal y se sincroniza cuando el trabajador vuelve a tener red, por lo que sirve igual en los cuarteles más alejados.',
    ],
    ask: '¿Cómo registran hoy la asistencia en terreno?',
  },
  {
    id: 'seguimiento-partir-chico', step: 'follow_up', treatment: 'tu',
    body: [
      'Te dejo una idea concreta para las tres clínicas. Podemos partir solo con la sede más grande, y si a los dos meses funciona, sumamos las otras con el mismo equipo de supervisión.',
    ],
    ask: '¿Lo conversamos 15 minutos esta semana?',
  },
  {
    id: 'seguimiento-pregunta', step: 'follow_up', treatment: 'tu',
    body: [
      'Me quedé con una duda sobre las búsquedas en regiones. Nosotros entrevistamos a los candidatos allá mismo, y por eso las ternas llegan con gente que de verdad vive en la zona.',
    ],
    ask: '¿Hoy las entrevistas las hacen ustedes desde Santiago?',
  },
  {
    id: 'seguimiento-usted', step: 'follow_up', treatment: 'usted',
    body: [
      'Le agrego algo sobre la fiscalización. Además de los contratos, dejamos ordenado el respaldo de cada finiquito, que es lo que más demora en reunirse cuando lo piden con plazo.',
    ],
    ask: '¿Quién reúne hoy esos respaldos en su equipo?',
  },
  {
    id: 'cierre-bandeja', step: 'close', treatment: 'tu',
    body: [
      'No quiero llenarte la bandeja. Si más adelante necesitan armar un equipo rápido para Lampa, lo vemos entonces. Esta es la última vez que te escribo sobre esto.',
    ],
    ask: '¿Lo dejamos hasta aquí?',
  },
  {
    id: 'cierre-mas-adelante', step: 'close', treatment: 'tu',
    body: [
      'Imagino que la temporada los tiene con otras urgencias, y la asistencia puede esperar. No te escribo más sobre este tema.',
    ],
    ask: '¿Prefieres que lo retome más adelante?',
  },
  {
    id: 'cierre-directo', step: 'close', treatment: 'tu',
    body: [
      'Te escribí un par de veces por las tres clínicas y no quiero insistir. Con este correo cierro el tema por mi lado.',
    ],
    ask: '¿Lo dejamos para otro momento?',
  },
  {
    id: 'cierre-usted', step: 'close', treatment: 'usted',
    body: [
      'Entiendo que la fiscalización no sea su prioridad esta semana. Para no insistir, este es mi último correo sobre esto.',
    ],
    ask: '¿Lo dejo aquí por ahora?',
  },
];

function hash(seed: string) {
  let value = 2166136261;
  for (const char of seed) {
    value ^= char.codePointAt(0) || 0;
    value = Math.imul(value, 16777619) >>> 0;
  }
  return value;
}

/**
 * The sample one email takes its shape from. Which one depends on the recipient (seed): two people of a campaign get different samples, and
 * so different shapes, while a retry of the same draft keeps its own. One at a time: shown two, every email came out as their average and
 * the batch read as a new template («Te escribo porque en X hacemos…» in five of eight, bench of 11 Nov 2026). Samples of the other treatment are left out: shown a «tú» email, the
 * writer mixes both.
 */
export function selectVoiceSamples(input: { step: VoiceStep; treatment: VoiceTreatment; seed: string; count?: number }): VoiceSample[] {
  const pool = VOICE_SAMPLES.filter((sample) => sample.step === input.step && sample.treatment === input.treatment);
  const fallback = VOICE_SAMPLES.filter((sample) => sample.step === input.step);
  const candidates = pool.length ? pool : fallback;
  const count = Math.max(1, Math.min(input.count ?? 1, candidates.length));
  const start = hash(`${input.seed}|${input.step}`) % candidates.length;
  return Array.from({ length: count }, (_, index) => candidates[(start + index) % candidates.length]);
}

/** A sample as the writer reads it: with its greeting and its ask when the writer writes those too. */
export function voiceSampleText(sample: VoiceSample, options: { greeting?: string | null; withAsk?: boolean } = {}) {
  return [options.greeting || null, ...sample.body, options.withAsk === false ? null : sample.ask].filter(Boolean).join('\n\n');
}

/** Every capitalised name of the samples: none of them may reach an email. */
export const VOICE_SAMPLE_NAMES: readonly string[] = [...new Set(VOICE_SAMPLES.flatMap((sample) => properNames([...sample.body, sample.ask].join(' '))))];

export type VoiceTellCode = 'narrador' | 'cosa_que_actua' | 'punto_y_coma' | 'gerundio' | 'fila_de_sustantivos' | 'ritmo_parejo'
  | 'sin_conectores' | 'formula' | 'palabra_de_informe';

export type VoiceTell = {
  code: VoiceTellCode;
  /** What is wrong and how a person says it, for the writer. */
  advice: string;
  excerpt: string;
};

const ADVICE: Record<VoiceTellCode, string> = {
  narrador: 'Esta oración no le habla a nadie: explica desde lejos cómo es su rubro. Dísela a la persona, como algo que le puede pasar a ella o a su equipo, o quítala.',
  cosa_que_actua: 'Aquí actúa una cosa y no una persona. Pon de sujeto a quien lo hace o a quien lo recibe (tú, tu equipo, nosotros).',
  punto_y_coma: 'Nadie escribe punto y coma en un correo: sepáralo en dos oraciones o únelas con «y», «porque» o «así que».',
  gerundio: 'El gerundio alarga la frase como un informe. Di lo que pasa con un verbo conjugado.',
  fila_de_sustantivos: 'Hay una fila de sustantivos unidos con «de», «para» y «a». Dilo con un verbo y con las palabras que usarías al hablar.',
  ritmo_parejo: 'Todas las oraciones miden casi lo mismo. Deja una más larga que explique y una corta.',
  sin_conectores: 'Las oraciones están apiladas, sin nada que las una. Únelas como al hablar: porque, pero, así que, por eso.',
  formula: 'Esta es una fórmula de plantilla. Di directo lo que quieres decir.',
  palabra_de_informe: 'Esta palabra es de informe. Usa la de todos los días (hacer, usar, tener, con, por).',
};

// Stock phrases of a follow-up nobody wrote by hand (campaign follow-ups in production, 6 Nov 2026) and of a letter.
const FORMULAS = [
  /\bretomo (?:mi|el|este|nuestro)\b/, /\bqueria (?:consultar|dejar|saber|comentar|compartir|contar)\w*\b/, /\bsi (?:te|le|les) parece pertinente\b/,
  /\bcuando sea oportuno\b/, /\bme permito\b/, /\baprovecho (?:la|esta|para)\b/, /\ben (?:ese|este) (?:sentido|contexto|marco)\b/, /\bquedo atent[oa]\b/,
  /\bsin otro particular\b/, /\bes por (?:ello|eso) que\b/, /\ba continuacion\b/, /\bcabe senalar\b/, /\bcomo te comentaba\b/, /\bte escribo nuevamente\b/,
  /\bnuevamente el tema\b/, /\ben el marco de\b/, /\bde manera (?:eficiente|efectiva|oportuna|integral)\b/,
];

// The register of a report where a spoken word exists.
const REPORT_WORDS = [
  /\bcuent(?:a|an|as|o|amos) con\b/, /\bpermit(?:e|en|ira|iran|iendo)\b/, /\bbrind(?:a|an|amos|ar|ando)\b/, /\brealiz(?:a|an|amos|ar|as|ando)\b/,
  /\butiliz(?:a|an|amos|ar|as|ando)\b/, /\bmediante\b/, /\ba traves de\b/, /\basimismo\b/, /\badicionalmente\b/, /\bno obstante\b/, /\bdich[oa]s?\b/,
  /\ben relacion (?:a|con)\b/, /\bcon el (?:fin|objetivo|proposito) de\b/, /\ba fin de\b/, /\befectu(?:a|an|ar|amos)\b/, /\bdispon(?:e|en|emos) de\b/,
  /\bvinculad[oa]s? (?:a|con)\b/, /\bcomplementari[oa]s?\b/, /\brequier(?:e|en)\b/, /\bposee[n]?\b/, /\bcorrespondientes?\b/, /\brespectiv[oa]s?\b/,
];

const ABSTRACT_SUBJECT = /(?:^|[.,:]\s+|\by\s+)(?:la|el|una|un|esa|ese|esta|este|su|nuestra|nuestro) (?:[\p{L}]+ ){0,3}?(?:[\p{L}]+(?:cion|sion|miento|encia|ancia|idad|ura)|duda|lectura|carga|falta|demora|espera|dotacion|apoyo|servicio|plataforma|herramienta|solucion|proceso)(?: [\p{L}]+){0,6}? (?:suma|suman|complica|complican|deja|dejan|permite|permiten|entrega|entregan|ayuda|ayudan|facilita|facilitan|mantiene|mantienen|exige|exigen|implica|implican|obliga|obligan|genera|generan|evita|evitan|reduce|reducen|termina|terminan|suele|suelen|acompana|acompanan|reune|reunen|cubre|cubren)\b/u;

const FIRST_PERSON = /\b(?:yo|nosotros|nos|me|mi|mis|nuestr[oa]s?|soy|somos|estoy|estamos|vi|supe|lei|veo|creo|pienso|imagino|entiendo|tengo|puedo|quiero|escribo|cuento|mando|dejo|agrego|pregunto|propongo|muestro|ofrezco|envio|comparto|llamo|trabajo)\b|\b[\p{L}]+(?:amos|emos|imos)\b/u;
const SECOND_PERSON = /\b(?:tu|tus|te|ti|contigo|usted|ustedes|le|les|su|sus|tienes|puedes|quieres|necesitas|recibes|pagas|eliges|revisas|decides|comparas|ves|sabes|dejas|haces|usas|llevas|sumas|quedas|evitas|ahorras|partes|abres|llegas)\b/u;
// «Abren el centro en marzo», «Publicaron doce avisos», «Si llegan a la apertura con medio equipo…»: the verb alone speaks to «ustedes».
// «Cuando se acumulan postulaciones» speaks to nobody.
const SPEAKS_TO_THEM = /^[¿¡]?(?:(?:si|cuando|como|aunque|mientras|y|pero)\s+)?(?!(?:se|no se|tambien|quien|quienes|bien|segun|algun|ningun|orden|volumen|examen|origen|imagen|margen|resumen)\b)[\p{L}]{3,}(?:an|en|aron|ieron|aran|eran|iran)\b/u;
const CONNECTORS = /\b(?:porque|pero|asi que|por eso|aunque|ya que|es que|entonces|ademas|igual|de modo que|para que|sin que|si)\b|,\s+y\b/;

function plain(value: string) {
  return String(value || '').toLocaleLowerCase('es').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function words(value: string) {
  return value.match(/[\p{L}\p{N}]+/gu) || [];
}

/** The sentences of an email, without its greeting line. */
export function voiceSentences(body: string): string[] {
  const lines = String(body || '').split('\n').map((line) => line.trim()).filter(Boolean);
  const content = lines.length > 1 && /^(?:hola|estimad[oa]s?|buen[oa]s)\b/i.test(lines[0]) && lines[0].length <= 60 ? lines.slice(1) : lines;
  return content.join(' ').split(/(?<=[.!?])\s+(?=[\p{Lu}¿¡«"])/u).map((sentence) => sentence.trim()).filter((sentence) => words(sentence).length >= 2);
}

function excerpt(value: string) {
  const text = value.trim().replace(/\s+/g, ' ');
  return text.length > 140 ? `${text.slice(0, 137)}...` : text;
}

/**
 * What gives an email away as written by a machine, found by reading it and not by a model: each with the sentence it is in and how a person
 * would say it. Deterministic and cheap: the voice pass is told what it is fixing, and the bench counts them before and after a change.
 * A person's email may carry one; several, or the same ones across a batch, is the form filled in.
 */
export function voiceTells(body: string, options: { recipientCompany?: string | null } = {}): VoiceTell[] {
  const tells: VoiceTell[] = [];
  const add = (code: VoiceTellCode, where: string) => tells.push({ code, advice: ADVICE[code], excerpt: excerpt(where) });
  const sentences = voiceSentences(body);
  const company = plain(options.recipientCompany || '').split(/\s+/).find((token) => token.length >= 4) || '';
  for (const sentence of sentences) {
    const text = plain(sentence);
    const question = /\?\s*$/.test(sentence);
    const personal = FIRST_PERSON.test(text) || SECOND_PERSON.test(text) || SPEAKS_TO_THEM.test(text) || (company !== '' && text.includes(company));
    if (!question && !personal && words(sentence).length >= 6) add('narrador', sentence);
    // «En retail, cuando falta gente…»: the lecture on their own trade, whoever it names.
    else if (!question && /^en (?:el |la |los |las |un |una )?[^,.;:]{2,70}, (?:cuando|si|cada vez que)\b/.test(text) && !SECOND_PERSON.test(text)) add('narrador', sentence);
    if (ABSTRACT_SUBJECT.test(text) && !/^(?:nosotros|en [^,]{2,40},? (?:hacemos|ponemos|tenemos))/.test(text)) add('cosa_que_actua', sentence);
    if (sentence.includes(';')) add('punto_y_coma', sentence);
    if (/,\s+[\p{L}]{3,}(?:ando|iendo|yendo)\b/u.test(text)) add('gerundio', sentence);
    if (/[\p{L}]+(?:\s+(?:de|del|para|a|al)\s+(?:(?:la|el|los|las|un|una|su|sus)\s+)?[\p{L}]+(?:\s+(?!(?:de|del|para|a|al|que|y|en|con|por)\b)[\p{L}]+)?){4,}/u.test(text)) add('fila_de_sustantivos', sentence);
    const formula = FORMULAS.find((pattern) => pattern.test(text));
    if (formula) add('formula', sentence.slice(Math.max(0, (text.match(formula)?.index ?? 0) - 20)));
    const report = REPORT_WORDS.find((pattern) => pattern.test(text));
    if (report) add('palabra_de_informe', text.match(report)?.[0] || sentence);
  }
  const statements = sentences.filter((sentence) => !/\?\s*$/.test(sentence));
  if (statements.length >= 3) {
    const lengths = statements.map((sentence) => words(sentence).length);
    if (Math.max(...lengths) - Math.min(...lengths) <= 4) add('ritmo_parejo', statements.join(' '));
    if (!CONNECTORS.test(plain(statements.join(' ')))) add('sin_conectores', statements.join(' '));
  }
  return tells;
}

/** A run of `size` words that two texts share, or null: a rewrite that lifts a phrase of the sample it was shown. */
export function voiceSharedPhrase(text: string, sample: string, size = 5): string | null {
  const tokens = (value: string) => words(plain(value));
  const source = tokens(sample);
  const grams = new Set<string>();
  for (let index = 0; index + size <= source.length; index += 1) grams.add(source.slice(index, index + size).join(' '));
  const own = tokens(text);
  for (let index = 0; index + size <= own.length; index += 1) {
    const gram = own.slice(index, index + size).join(' ');
    if (grams.has(gram)) return gram;
  }
  return null;
}

/** The shape of an email: how each of its paragraphs begins, with names and figures left out. A batch that shares one is a mailing. */
export function voiceSkeleton(body: string): string {
  const paragraphs = String(body || '').split(/\n\s*\n/).map((paragraph) => paragraph.trim()).filter(Boolean);
  const content = paragraphs.length > 1 && /^(?:hola|estimad[oa]s?|buen[oa]s)\b/i.test(paragraphs[0]) && paragraphs[0].length <= 60 ? paragraphs.slice(1) : paragraphs;
  return content.map((paragraph) => words(paragraph).slice(0, 2)
    .map((word, index) => (/^\d/.test(word) ? '#' : index > 0 && /^\p{Lu}/u.test(word) ? 'N' : plain(word))).join(' ')).join(' | ');
}

function figures(value: string) {
  return (String(value || '').match(/\d+(?:[.,]\d+)*/g) || []).map((figure) => figure.replace(/[.,]/g, ''));
}

/** Capitalised words that are not the first of their sentence: names of people, companies, places and products. */
export function properNames(value: string): string[] {
  const names = new Set<string>();
  for (const sentence of String(value || '').split(/(?<=[.!?:])\s+|\n+/)) {
    const tokens = sentence.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || [];
    tokens.forEach((token, index) => {
      if (index > 0 && /^\p{Lu}/u.test(token) && token.length >= 3) names.add(token);
    });
  }
  return [...names];
}

const TUTEO = /\b(?:tu|tus|te|ti|contigo|tienes|puedes|quieres|necesitas)\b/;
const USTED = /\b(?:usted|le escribo|le parece|le acomoda|le sirve|le dejo|le agrego|le cuento|su equipo)\b/;

/** The treatment an email already uses: «usted» only when it is marked and nothing tutea. */
export function voiceTreatmentOf(text: string): VoiceTreatment {
  const value = plain(text);
  return USTED.test(value) && !TUTEO.test(value) ? 'usted' : 'tu';
}

export type VoiceKeep = {
  /** The names the email may carry besides its own: the recipient, their company and the seller's. */
  names?: string[];
  questions?: { min: number; max: number };
  words?: { min: number; max: number };
};

/**
 * Why a rewrite for the voice may not replace the email it was given, or null: it says the same things. A new figure, a new name (one of
 * the samples above all), a lost variable or link, another treatment, another number of questions or a length out of range. Checked by the
 * code because the pass is asked to change how an email sounds, never what it says.
 */
export function voiceFactsChanged(before: string, after: string, keep: VoiceKeep = {}): string | null {
  const known = new Set(figures(before));
  const added = figures(after).filter((figure) => !known.has(figure));
  if (added.length) return `Agregaste una cifra que el correo no tenía (${added.slice(0, 3).join(', ')}).`;
  const allowed = new Set([...properNames(before), ...(keep.names || []).flatMap((name) => words(String(name || '')))].map(plain));
  const beforeWords = new Set(words(before).map(plain));
  const newNames = properNames(after).filter((name) => !allowed.has(plain(name)) && !beforeWords.has(plain(name)));
  if (newNames.length) return `Agregaste un nombre que el correo no tenía (${newNames.slice(0, 3).join(', ')}).`;
  const variables = (value: string) => (value.match(/\{\{\s*[^{}]+?\s*\}\}/g) || []).map((item) => item.replace(/\s+/g, '')).sort().join(',');
  if (variables(before) !== variables(after)) return 'Cambiaste las variables ({{nombre}}, {{empresa}}, {{cargo}}): van las mismas.';
  const links = (value: string) => (value.match(/https?:\/\/\S+/g) || []).sort().join(' ');
  if (links(before) !== links(after)) return 'Cambiaste un enlace: va tal cual.';
  const beforeText = plain(before);
  const afterText = plain(after);
  if (USTED.test(beforeText) && !TUTEO.test(beforeText) && TUTEO.test(afterText)) return 'El correo trata de usted: no tutees.';
  if (TUTEO.test(beforeText) && !/\busted\b/.test(beforeText) && /\busted\b/.test(afterText)) return 'El correo tutea: no pases a usted.';
  const questions = (after.match(/\?/g) || []).length;
  if (keep.questions && (questions < keep.questions.min || questions > keep.questions.max)) {
    return keep.questions.max === 0 ? 'El correo no lleva preguntas: el pedido se agrega después.' : `El correo lleva ${keep.questions.min === keep.questions.max ? keep.questions.min : `de ${keep.questions.min} a ${keep.questions.max}`} pregunta, al final.`;
  }
  const count = words(after).length;
  if (keep.words && (count < keep.words.min || count > keep.words.max)) return `El correo quedó en ${count} palabras: debe tener entre ${keep.words.min} y ${keep.words.max}.`;
  return null;
}
