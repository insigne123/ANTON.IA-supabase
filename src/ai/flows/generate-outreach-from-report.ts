'use server';
/**
 * @fileOverview Flow to generate a personalized outreach email based on a company research report.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import { generateStructured, generateStructuredWithTelemetry } from '@/ai/openai-json';
import { NATIVE_DRAFT_PROMPT_VERSION } from '@/lib/native-draft-version';
import {
  DraftContextV2Schema,
  requiredReportAwareDraftPersonalizationV2,
  type DraftContextV2,
} from '@/lib/server/draft-context-v2';
import {
  draftEvidencePersonalizationStatementV2,
  GeneratedOutreachV2Schema,
  type GeneratedOutreachV2,
} from '@/lib/server/draft-preflight-v2';
import {
  OutreachSequenceContextV2Schema,
  type OutreachSequenceContextV2,
} from '@/lib/campaigns-v2/outreach-sequence-context';

const GenerateOutreachInputSchema = z.object({
  report: z.any().describe('The detailed research report for the lead and their company.'),
  companyProfile: z.any().describe('The profile of your own company to tailor the message.'),
  lead: z.any().describe('The person to contact.'),
  mode: z.enum(['services', 'vacancy']).optional().describe('The intent of the email.'),
});

const GenerateOutreachOutputSchema = z.object({
  subject: z.string().trim().min(1).max(80).describe('The generated email subject line.'),
  body: z.string().trim().min(1).describe('The generated email body.'),
});

const GenerateOutreachFromDraftContextV2InputSchema = z.object({
  context: DraftContextV2Schema,
  instruction: z.string().trim().min(1).max(1_000).optional(),
  sequenceContext: OutreachSequenceContextV2Schema.optional(),
  rewrite: z.object({
    previous: GeneratedOutreachV2Schema,
    errors: z.array(z.string().trim().min(1).max(2_000)).max(20).default([]),
    instruction: z.string().trim().min(1).max(1_000).optional(),
  }).optional(),
});

const GeneratedOutreachModelV2Schema = z.object({
  subject: z.string().trim().min(1).max(80),
  contextParagraph: z.string().trim().min(1).max(700)
    .describe('Un párrafo breve con un solo detalle verificable del destinatario, escrito como situación concreta y sin describir la investigación.'),
  offerParagraph: z.string().trim().min(1).max(700)
    .describe('Un párrafo breve que conecta una capacidad concreta del remitente con una consecuencia práctica, sin CTA.'),
}).strict();

export type GenerateOutreachFromDraftContextV2Input = {
  context: DraftContextV2;
  instruction?: string;
  sequenceContext?: OutreachSequenceContextV2;
  rewrite?: {
    previous: GeneratedOutreachV2;
    errors: string[];
    instruction?: string;
  };
};

export type GeneratedOutreachFromDraftContextV2 = GeneratedOutreachV2 & {
  provider: 'openai';
  model: string;
  promptVersion: typeof NATIVE_DRAFT_PROMPT_VERSION;
};

export async function generateOutreachFromReport(
  input: z.infer<typeof GenerateOutreachInputSchema>
): Promise<z.infer<typeof GenerateOutreachOutputSchema>> {
  return generateOutreachFromReportFlow(input);
}

const generateOutreachFromReportFlow = ai.defineFlow(
  {
    name: 'generateOutreachFromReportFlow',
    inputSchema: GenerateOutreachInputSchema,
    outputSchema: GenerateOutreachOutputSchema,
  },
  async (input) => {
    const intentInstruction = input.mode === 'vacancy'
      ? 'Escribe un correo para postular/ayudar respecto a una vacante puntual.'
      : 'Escribe un correo de prospección ofreciendo los SERVICIOS de mi empresa al lead. No menciones vacantes.';

    const prompt = `Idioma: Español (Chile). Tono profesional, claro y humano.
Objetivo: ${intentInstruction}

Crea:
1) 3 bullets de contexto cruzando la empresa objetivo y mi empresa (pain -> solucion).
2) Asunto (max 8 palabras).
3) Email (120-160 palabras), con CTA claro a una breve llamada.

MI EMPRESA:
${JSON.stringify(input.companyProfile)}

REPORTE OBJETIVO (resumen n8n):
${JSON.stringify(input.report)}

LEAD:
${JSON.stringify(input.lead)}

Devuelve SOLO JSON valido con esta forma:
{"subject":"...","body":"..."}
`;

    const output = await generateStructured({
      prompt,
      schema: GenerateOutreachOutputSchema,
      temperature: 0.4,
    });

    if (!output) {
      throw new Error('Failed to generate outreach email.');
    }

    return { subject: output.subject, body: output.body };
  }
);

function modelForDraftPriority(priority: DraftContextV2['quality']['priority']) {
  if (priority === 'A') {
    return String(
      process.env.SUPLIA_OPENAI_REASONING_MODEL
      || process.env.OPENAI_REASONING_MODEL
      || 'gpt-5.6-terra',
    ).trim();
  }
  return String(process.env.OPENAI_EMAIL_MODEL || process.env.OPENAI_BALANCED_MODEL || process.env.OPENAI_MODEL || 'gpt-5.6-luna').trim();
}

function modelForDraftRequest(input: GenerateOutreachFromDraftContextV2Input) {
  if (input.rewrite) {
    return String(
      process.env.SUPLIA_OPENAI_REASONING_MODEL
      || process.env.OPENAI_REASONING_MODEL
      || 'gpt-5.6-terra',
    ).trim();
  }
  return modelForDraftPriority(input.context.quality.priority);
}

function draftWordCount(value: string) {
  return value.match(/[\p{L}\p{N}]+/gu)?.length || 0;
}

function draftGreeting(context: DraftContextV2) {
  const firstName = String(context.recipient.displayName || '')
    .trim()
    .split(/\s+/)[0]
    ?.replace(/[,.:;!?]+$/g, '');
  return firstName ? `Hola ${firstName},` : 'Hola,';
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function privateWritingInstruction(value: unknown) {
  return String(value || '')
    .replace(/retoma el contexto del correo inicial sin repetirlo\. reafirma brevemente la relevancia y pregunta si pudo revisarlo\.?/gi, 'Continúa desde el correo anterior sin resumirlo. Aterriza una consecuencia práctica para el equipo.')
    .replace(/aporta un ángulo o beneficio nuevo y formula una pregunta consultiva fácil de responder\.?/gi, 'Describe una sola acción práctica sin repetir la descripción de la empresa.')
    .replace(/(?:y\s+)?pregunta si pudo revisarlo\.?/gi, '')
    .replace(/(?:y\s+)?formula una pregunta consultiva fácil de responder\.?/gi, '')
    .replace(/\bfollow[- ]?ups?\b/gi, 'mensaje')
    .replace(/\bseguimientos?\b/gi, 'mensaje')
    .replace(/\bun ángulo\b/gi, 'una idea')
    .replace(/\botro ángulo\b/gi, 'otra idea')
    .replace(/\bángulos\b/gi, 'ideas')
    .replace(/\bángulo\b/gi, 'idea')
    .replace(/\bideas?\s+acotadas?\b/gi, 'detalle concreto')
    .replace(/\buna idea nuevo\b/gi, 'una idea nueva')
    .replace(/\benfoques?\s+acotados?\b/gi, 'ideas concretas')
    .replace(/\bpor tu rol\b/gi, '')
    .replace(/\bpor tu cargo\b/gi, '')
    .replace(/\bcon (?:ese|este) alcance\b/gi, '')
    .replace(/\bmi foco (?:sería|seria|es)\b/gi, '')
    .replace(/\buna idea puntual\b/gi, 'un detalle concreto')
    .replace(/\b(?:es )?una forma acotada\b/gi, '')
    .replace(/\bte (?:comparto|dejo) el punto(?: nuevamente)?\b/gi, '')
    .replace(/\bsin sumar otra capa de trabajo\b/gi, '')
    .replace(/\bese es el contexto que tenía presente\b/gi, '')
    .replace(/\bpor si (?:alcanzaste|pudiste) a? ?revisarlo\b/gi, '')
    .replace(/\bretomo la idea\b/gi, '')
    .replace(/\bsecuencias?\b/gi, 'mensajes')
    .replace(/\betapas?\b/gi, 'mensajes')
    .replace(/\bpasos?\b/gi, 'mensajes')
    .replace(/\s+/g, ' ')
    .trim();
}

function redactPromptTitles(value: unknown, context: DraftContextV2) {
  let result = String(value || '');
  for (const title of [context.person.title, context.seller.jobTitle]) {
    const normalizedTitle = String(title || '').trim();
    if (normalizedTitle.length < 6 || normalizedTitle.split(/\s+/).length < 2) continue;
    result = result.replace(new RegExp(escapeRegExp(normalizedTitle), 'gi'), '');
  }
  return privateWritingInstruction(result);
}

function sequenceWritingContext(input: OutreachSequenceContextV2, context: DraftContextV2) {
  return {
    sequenceInstruction: privateWritingInstruction(input.sequenceInstruction),
    previousSubjects: input.priorMessages.map((message) => ({
      index: message.index,
      subject: redactPromptTitles(message.subject, context),
    })),
    currentStep: {
      index: input.currentStep.index,
      total: input.currentStep.total,
      instruction: privateWritingInstruction(input.currentStep.instruction),
    },
  };
}

function validationWritingFeedback(errors: string[]) {
  return errors.map((error) => (
      /frase prohibida/i.test(error)
        ? 'Usaste una fórmula vetada. Sustituye esa oración completa por una acción concreta en voz activa.'
        : /enumera la fuente/i.test(error)
          ? 'La personalización quedó como un catálogo. Elige un solo detalle de REQUIRED_FACTUAL_PERSONALIZATION y exprésalo en una oración natural, sin lista, sin viñetas y sin unir categorías con comas o con "y".'
          : /conectar explícitamente/i.test(error)
            ? 'La oferta quedó plana. En offerParagraph menciona la empresa del remitente, una acción concreta que realiza y una consecuencia práctica conectada con el hecho del destinatario.'
            : error
  ));
}

function selectedCommercialAngle(context: DraftContextV2) {
  const selectedOrder = new Map(
    (context.report?.outreachBrief.selectedHypothesisIds || []).map((claimId, index) => [claimId, index]),
  );
  return context.hypotheses
    .filter((hypothesis) => (
      selectedOrder.has(hypothesis.claimId)
      && hypothesis.kind !== 'use_case_hypothesis'
      && !/\b(?:prioridad(?:es)?|explorar si|sin asumir|no confirma|informaci[oó]n p[uú]blica disponible)\b/i.test(hypothesis.statement)
    ))
    .sort((left, right) => {
      const leftOrder = selectedOrder.get(left.claimId) ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = selectedOrder.get(right.claimId) ?? Number.MAX_SAFE_INTEGER;
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      return right.confidence - left.confidence;
    })
    .map((hypothesis) => ({
      claimId: hypothesis.claimId,
      statement: hypothesis.statement,
    }))[0] || null;
}

function boundedWritingStyle(profile: Record<string, unknown>) {
  const bounded: Record<string, unknown> = {};
  for (const key of ['tone', 'length', 'language', 'instructions', 'subjectTemplate', 'bodyTemplate']) {
    const value = typeof profile[key] === 'string' ? profile[key].trim() : '';
    if (value) bounded[key] = value.slice(0, 1_000);
  }
  const cta = profile.cta && typeof profile.cta === 'object' && !Array.isArray(profile.cta)
    ? profile.cta as Record<string, unknown>
    : null;
  if (cta) {
    bounded.cta = {
      ...(typeof cta.label === 'string' ? { label: cta.label.trim().slice(0, 240) } : {}),
      ...(typeof cta.duration === 'string' ? { duration: cta.duration.trim().slice(0, 80) } : {}),
    };
  }
  return bounded;
}

function draftContextPrompt(input: GenerateOutreachFromDraftContextV2Input) {
  const requiredPersonalization = requiredReportAwareDraftPersonalizationV2(input.context);
  const requiredEvidence = requiredPersonalization.map((provenance) => {
    const evidence = input.context.evidence.find((item) => item.evidenceId === provenance.evidenceId);
    return {
      statement: draftEvidencePersonalizationStatementV2(evidence?.statement || ''),
      subjectScope: evidence?.subjectScope || 'company',
    };
  });
  const writingContext = {
    recipient: {
      displayName: input.context.recipient.displayName,
    },
    company: input.context.company,
    seller: {
      name: input.context.seller.name,
      companyName: input.context.seller.companyName,
      valueProposition: input.context.seller.valueProposition,
      capabilities: input.context.seller.services.slice(0, 4),
      proofPoint: input.context.seller.proofPoints[0] || null,
      description: input.context.seller.description,
    },
    style: boundedWritingStyle(input.context.style.profile),
  };
  const commercialAngle = selectedCommercialAngle(input.context);
  const commercialAnglePrompt = commercialAngle
    ? `
REQUIRED_COMMERCIAL_ANGLE (hipótesis, no hecho verificado):
${JSON.stringify({ statement: commercialAngle.statement })}

Usa este ángulo solo como criterio interno para elegir la capacidad del vendedor. No copies la hipótesis, no verbalices cautela metodológica y no afirmes que la empresa tiene una necesidad. Si no puedes conectarlo con naturalidad, omítelo.
`
    : `
COMMERCIAL_BRIDGE:
No hay una hipótesis comercial específica seleccionada. Conecta el hecho con una capacidad concreta del vendedor sin afirmar que la empresa tiene un problema, prioridad o intención de compra. No expliques esta cautela dentro del correo.
`;
  const reportRestrictions = input.context.report?.outreachBrief.doNotClaim || [];
  const greeting = draftGreeting(input.context);
  const approvedCtaWords = draftWordCount(input.context.constraints.cta.exactText);
  const serverAddedWords = approvedCtaWords + draftWordCount(greeting);
  const sequenceMaxWords = input.sequenceContext ? 68 : 112;
  const maximumModelBodyWords = Math.max(
    1,
    Math.min(sequenceMaxWords, input.context.constraints.body.maxWords) - serverAddedWords,
  );
  // Server normalization can remove an unapproved CTA or shorten a catalogued phrase.
  const minimumModelBodyWords = Math.min(
    maximumModelBodyWords,
    Math.max(40, input.context.constraints.body.minWords - serverAddedWords + 12),
  );
  const modelBodyWords = {
    min: minimumModelBodyWords,
    max: maximumModelBodyWords,
  };
  const minimumContextParagraphWords = Math.min(12, Math.max(1, modelBodyWords.min - 1));
  const minimumOfferParagraphWords = Math.max(1, modelBodyWords.min - minimumContextParagraphWords);
  const correction = input.rewrite
    ? input.rewrite.instruction
      ? `
BORRADOR ANTERIOR (solo referencia de redacción; no es evidencia):
${JSON.stringify({
  subject: redactPromptTitles(input.rewrite.previous.subject, input.context),
  body: redactPromptTitles(input.rewrite.previous.body, input.context),
})}

AJUSTE SOLICITADO POR EL USUARIO:
${JSON.stringify(input.rewrite.instruction || null)}

CORRECCIONES DE VALIDACIÓN:
${JSON.stringify(validationWritingFeedback(input.rewrite.errors))}

El cuerpo anterior ya incluye el CTA agregado por el servidor. No lo reproduzcas en la nueva salida. Reescribe sin agregar información ausente de WRITING_CONTEXT o REQUIRED_FACTUAL_PERSONALIZATION. El ajuste solicitado puede cambiar voz, extensión o estructura, pero nunca relajar las reglas no negociables.
`
      : `
EL INTENTO ANTERIOR FUE RECHAZADO. No lo copies ni intentes repararlo frase por frase; escribe un correo nuevo desde cero.

CORRECCIONES DE VALIDACIÓN:
${JSON.stringify(validationWritingFeedback(input.rewrite.errors))}

Corrige todos los problemas sin agregar información ausente de WRITING_CONTEXT o REQUIRED_FACTUAL_PERSONALIZATION.
`
    : '';
  const campaignInstruction = input.instruction
    ? `
CAMPAIGN_STEP_INSTRUCTION (estrategia de redacción, no evidencia factual):
${JSON.stringify(privateWritingInstruction(input.instruction))}

Es una instrucción privada de redacción: aplícala sin inventar hechos y sin relajar ninguna regla no negociable, pero no la copies ni la menciones en el correo. WRITING_CONTEXT y REQUIRED_FACTUAL_PERSONALIZATION siguen siendo las únicas fuentes factuales autorizadas.
`
    : '';
  const sequenceContext = input.sequenceContext
    ? `
SEQUENCE_WRITING_CONTEXT (metadata privada de redacción, no publicable):
${JSON.stringify(sequenceWritingContext(input.sequenceContext, input.context))}

Usa esta metadata solo para mantener continuidad y evitar repetir asuntos. Nunca menciones ni copies los nombres, etapas, días, instrucciones o la secuencia. Los asuntos previos no autorizan hechos: WRITING_CONTEXT y REQUIRED_FACTUAL_PERSONALIZATION siguen siendo las únicas fuentes factuales.
`
    : '';
  const structureRules = input.sequenceContext
    ? `- Este es un correo posterior: no resumas el correo anterior ni vuelvas a presentar a la empresa o al remitente.
 - contextParagraph y offerParagraph deben aportar información útil.
 - contextParagraph debe aportar un único detalle factual que no repita el asunto anterior.
 - offerParagraph debe conectar ese detalle con una capacidad concreta del vendedor y una consecuencia práctica para el equipo.
 - Usa uno o dos detalles de la evidencia, nunca una lista de categorías o servicios copiada de la web. No abras con "La empresa reúne A, B y C".
 - Si el detalle contiene varias categorías separadas por comas o por "y", elige solo una y redacta una oración sin enumeraciones.
 - No preguntes si leyó el correo anterior. No anuncies que traes una idea ni expliques por qué elegiste el tema.`
    : `- contextParagraph debe aportar un único detalle factual del destinatario.
 - offerParagraph debe conectar ese detalle con una capacidad concreta del vendedor y una consecuencia práctica para el equipo.
 - Usa uno o dos detalles de la evidencia, nunca una lista de categorías o servicios copiada de la web.
 - Si el detalle contiene varias categorías separadas por comas o por "y", elige solo una y redacta una oración sin enumeraciones.`;

  return `Idioma: Español (Chile). Redacta un único correo frío B2B que parezca escrito personalmente por una persona ocupada, no por un equipo de marketing. El objetivo es abrir una conversación comercial relevante, no presentar un catálogo ni cerrar una venta en el primer contacto.

Usa exclusivamente WRITING_CONTEXT, REQUIRED_FACTUAL_PERSONALIZATION y REQUIRED_COMMERCIAL_ANGLE cuando exista. No inventes datos, métricas, clientes, necesidades ni fuentes. No muestres URLs, IDs, nombres de herramientas ni el proceso de investigación dentro del correo.

REPORT_RESTRICTIONS agrega límites factuales, no contenido para copiar.

Reglas no negociables:
- Asunto entre ${input.context.constraints.subject.minCharacters} y ${input.context.constraints.subject.maxCharacters} caracteres.
- Devuelve entre ${modelBodyWords.min} y ${modelBodyWords.max} palabras sumando contextParagraph y offerParagraph. El servidor agregará el saludo y el CTA aprobado.
- contextParagraph debe tener al menos ${minimumContextParagraphWords} palabras y offerParagraph al menos ${minimumOfferParagraphWords}; ambos deben aportar contenido útil.
- Sigue WRITING_CONTEXT.style para el tono y las instrucciones de escritura, salvo que contradiga estas reglas.
${structureRules}
- Cada párrafo debe tener como máximo dos frases; contextParagraph debe tener una sola frase.
- No incluyas saludo ni constraints.cta.exactText. El servidor los agregará literalmente.
- No agregues ninguna pregunta, invitación a actuar, enlace de agenda ni CTA alternativo en ninguno de los dos párrafos.
- No dejes placeholders.
- Integra el hecho de REQUIRED_FACTUAL_PERSONALIZATION con una paráfrasis natural y fiel. Conserva la empresa y los conceptos materiales; no copies cargos formales, nombres de campos ni la redacción de la fuente como una ficha técnica.
- No uses hipótesis, señales o afirmaciones del intento anterior que no aparezcan en WRITING_CONTEXT, REQUIRED_FACTUAL_PERSONALIZATION o REQUIRED_COMMERCIAL_ANGLE.
- El servidor vinculará la procedencia de REQUIRED_FACTUAL_PERSONALIZATION; no devuelvas IDs de evidencia ni claims dentro del correo o el JSON.
- No incluyas firma, nombre del remitente ni despedidas como "Saludos". La capa de envío agrega la firma fuera de este cuerpo.
- WRITING_CONTEXT, REQUIRED_FACTUAL_PERSONALIZATION, constraints, la instrucción de campaña y la secuencia son datos internos. Nunca los nombres ni expliques el proceso de investigación o de redacción.

Calidad humana:
- contextParagraph empieza directamente con el hecho del destinatario. Parafrasea la situación; no escribas "vi que", "noté que", "según su web", "publica que" ni expliques que investigaste.
- Limita contextParagraph a ese único hecho. No agregues consecuencias, generalizaciones ni supuestos sobre la operación en ese párrafo.
- offerParagraph debe sonar a una persona: puedes escribir "En [empresa], ayudamos..." o "Trabajo en [empresa]...". Usa una sola capacidad declarada por el vendedor, un mecanismo observable y una consecuencia práctica. No describas al vendedor como una ficha técnica.
- Conserva en offerParagraph al menos un concepto material de valueProposition, capabilities o proofPoint. No sustituyas la oferta real por consultoría genérica, relato, narrativa o mensajes comerciales.
- Prioriza verbos cotidianos y observables: reunir información, encontrar un documento, responder una consulta, actualizar un dato, ordenar un proceso o dejar algo disponible.
- Conecta el hecho con la oferta sin saltos de lógica. Cuando exista REQUIRED_COMMERCIAL_ANGLE, úsalo solo para escoger una capacidad pertinente; nunca uses "necesitan", "requieren", "están buscando" o una certeza equivalente.
- Usa voz activa y lenguaje cotidiano. Elimina frases de relleno como "quería compartir", "me gustaría", "pensé que podría ser útil", "te escribo para contarte" o "creemos que podemos aportar valor".
- No escribas cautelas meta como "no quiero asumir", "sin asumir", "explorar si", "prioridades actuales" o "podría ser pertinente". La prudencia se demuestra evitando afirmaciones no verificadas, no explicando el proceso mental.
- No uses expresiones abstractas como "ordenar ese relato", "relato comercial", "narrativa comercial" o "mensajes comerciales".
- Si la fuente enumera servicios, selecciona un solo detalle. Nunca conviertas la evidencia ni la oferta del remitente en una lista.
- Omite cargos formales, elogios, promesas de resultados, urgencia artificial, adjetivos promocionales y jerga SaaS.
- El asunto nombra un solo tema concreto del correo; no funciona como titular comercial ni anuncia una idea.

REQUIRED_FACTUAL_PERSONALIZATION:
${JSON.stringify(requiredEvidence)}

REPORT_RESTRICTIONS:
${JSON.stringify(reportRestrictions)}

WRITING_CONTEXT:
${JSON.stringify(writingContext)}
${commercialAnglePrompt}
${campaignInstruction}
${sequenceContext}
${correction}
Devuelve SOLO JSON válido con esta forma exacta:
{"subject":"...","contextParagraph":"...","offerParagraph":"..."}`;
}

/**
 * Native drafting bypasses the configurable provider route: this path must fail closed
 * when OpenAI is unavailable rather than falling back to generic copy from another source.
 */
export async function generateOutreachFromDraftContextV2(
  input: GenerateOutreachFromDraftContextV2Input,
): Promise<GeneratedOutreachFromDraftContextV2> {
  const parsed = GenerateOutreachFromDraftContextV2InputSchema.parse(input);
  const result = await generateStructuredWithTelemetry({
    prompt: draftContextPrompt(parsed),
    schema: GeneratedOutreachModelV2Schema,
    provider: 'openai',
    openAiModel: modelForDraftRequest(parsed),
    temperature: parsed.rewrite ? 0.35 : 0.2,
  });
  return {
    subject: result.data.subject,
    body: [
      draftGreeting(parsed.context),
      result.data.contextParagraph,
      result.data.offerParagraph,
    ].join('\n\n'),
    personalization: requiredReportAwareDraftPersonalizationV2(parsed.context),
    hypothesisIds: [],
    provider: 'openai',
    model: result.telemetry.modelName,
    promptVersion: NATIVE_DRAFT_PROMPT_VERSION,
  };
}
