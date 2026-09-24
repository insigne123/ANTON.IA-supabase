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
  | 'tone_ficha';

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
};

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
];

// Solo advierten: a veces son válidas con un dato concreto.
const PALABRAS_A_REVISAR = ['optimizar', 'optimizamos', 'maximizar', 'transformar', 'clave',
  'integral', 'agil', 'flexible', 'eficiente'];

const ASUNTOS_GENERICOS = ['propuesta comercial', 'oportunidad de colaboracion',
  'presentacion de servicios', 'presentacion corporativa', 'importante', 'urgente'];

const FORMAS_TU = ['tu', 'te', 'ti', 'contigo', 'tienes', 'puedes', 'quieres', 'necesitas',
  'sabes', 'avisame', 'cuentame', 'dime', 'escribeme', 'mandame', 'parece que te', 'te parece'];

const USTED_MARCAS = ['usted', 'le', 'les', 'su', 'sus', 'consigo', 'se lo', 'le escribo'];

// Apertura que le describe su propia empresa en vez de darle un motivo.
const FICHA_COPULAS = ['se dedica a', 'es una empresa', 'se hace cargo de', 'comunica que',
  'publica que', 'lider en', 'cuenta con'];

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
    const withoutGreeting = line.replace(/^(?:hola|estimad[oa]s?|buen[oa]s\s+(?:dias|tardes))(?:\s+\w+){0,3}\s*(?:,|:|$)\s*/i, '').trim();
    if (/\w/.test(withoutGreeting)) return withoutGreeting;
  }
  return '';
}

export function checkHumanTone(input: HumanToneCheckInput): { errors: HumanToneFinding[]; warnings: HumanToneFinding[] } {
  const errors: HumanToneFinding[] = [];
  const warnings: HumanToneFinding[] = [];
  const subject = String(input.subject || '').trim();
  const modelBody = stripCta(String(input.body || ''), input.ctaExactText);
  const normText = normalize(`${subject}\n${input.body || ''}`);
  const normModel = normalize(modelBody);
  const normSubject = normalize(subject);

  const found = MULETILLAS.filter((phrase) => containsWord(normText, phrase));
  if (found.length > 0) {
    errors.push({
      code: 'tone_muletilla',
      message: `Frases de plantilla o de IA: ${found.slice(0, 4).map((f) => `«${f}»`).join(', ')}. Reescríbelas con palabras simples y concretas.`,
      blocking: true,
    });
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
  if (subject) {
    const useful = subject.split(/\s+/).filter((word) => /\w/.test(word) && !properNouns.has(normalize(word).replace(/^[¿?¡!"'([{]+|[.,;:!?)"'\]}]+$/g, '')));
    if (useful.length < 2 || useful.length > 6) {
      errors.push({ code: 'tone_asunto', message: `El asunto tiene ${useful.length} palabras útiles (sin contar nombres propios); debe tener entre 2 y 6.`, blocking: true });
    }
    const rest = subject.split(/\s+/).slice(1).filter((word) => /^[A-Za-zÁÉÍÓÚÜÑ]/.test(word) && !properNouns.has(normalize(word)));
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
    const copula = firstToken && FICHA_COPULAS.find((phrase) => opening.includes(phrase) && opening.includes(firstToken));
    const conNumero = firstToken && new RegExp(`\\bcon (?:mas de |\\d+|${NUMERO_PALABRAS.join('|')})\\b`).test(opening) && opening.includes(firstToken);
    if (copula || conNumero) {
      // Con señal disponible se bloquea: el modelo tiene material para
      // corregirlo en el reintento. Sin señal no hay con qué cumplirlo, así
      // que se avisa y decide el humano (que revisa el 100% al inicio).
      const blocking = input.hasSignal !== false;
      const finding = {
        code: 'tone_ficha',
        message: input.hasSignal
          ? 'La apertura le describe su propia empresa en vez de darle un motivo. Usa el dato fechado o la pregunta, no su ficha.'
          : 'La apertura le describe su propia empresa en vez de darle un motivo. Como no hay una señal concreta, abre con una observación honesta de su industria y deja el dato de la empresa para el resto del correo.',
        blocking,
      } as const;
      if (blocking) errors.push({ ...finding });
      else warnings.push({ ...finding });
    }
  }

  const lowModel = modelBody.toLocaleLowerCase('es');
  if (/\bno (?:es|son|era|se trata de)\b[^.?!\n]{1,60}?,\s*(?:es|son|sino)\b/.test(lowModel) || /\bno solo\b[^.?!\n]{1,80}?\bsino\b/.test(normModel)) {
    warnings.push({ code: 'tone_muletilla', message: 'Posible contraste del tipo «no es X, es Y». Revisa si hace falta.', blocking: false });
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
