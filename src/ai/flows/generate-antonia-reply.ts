'use server';

import { z } from 'genkit';
import { ai } from '@/ai/genkit';
import { generateStructured } from '@/ai/openai-json';
import { OUTREACH_TONE_BLOCK } from '@/lib/outreach-tone';

const AssetSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  url: z.string().optional(),
});

const GenerateAntoniaReplyInputSchema = z.object({
  decisionReason: z.string(),
  desiredAction: z.enum(['send', 'draft', 'review']),
  lead: z.object({
    name: z.string().optional(),
    email: z.string().optional(),
    company: z.string().optional(),
    title: z.string().optional(),
  }),
  sender: z.object({
    name: z.string().optional(),
    company: z.string().optional(),
    title: z.string().optional(),
  }),
  organizationContext: z.object({
    bookingLink: z.string().optional(),
    meetingInstructions: z.string().optional(),
    missionGoal: z.string().optional(),
    valueProposition: z.string().optional(),
  }),
  lastInbound: z.object({
    subject: z.string().optional(),
    text: z.string(),
    intent: z.string(),
    summary: z.string().optional(),
  }),
  conversationSummary: z.array(z.object({
    role: z.enum(['outbound', 'inbound']),
    subject: z.string().optional(),
    text: z.string(),
    createdAt: z.string().optional(),
  })).optional(),
  researchSummary: z.string().optional(),
  assets: z.array(AssetSchema).optional(),
  /** What the sender sells, from their profile: the only source for what the reply may offer. */
  sellerOffer: z.object({
    description: z.string().optional(),
    services: z.array(z.string()).optional(),
    valueProposition: z.string().optional(),
    proofPoints: z.array(z.string()).optional(),
  }).optional(),
});

const GenerateAntoniaReplyOutputSchema = z.object({
  subject: z.string(),
  bodyText: z.string(),
  bodyHtml: z.string(),
  recommendedAssetNames: z.array(z.string()).default([]),
});

/** What the model returns: without assets it sometimes sends null, which used to throw and fall back to the template reply. */
const ModelReplySchema = GenerateAntoniaReplyOutputSchema.extend({
  recommendedAssetNames: z.array(z.string()).nullish(),
});

function buildFallbackReply(input: z.infer<typeof GenerateAntoniaReplyInputSchema>) {
  const firstName = String(input.lead.name || '').trim().split(' ')[0] || 'Hola';
  const bookingLink = String(input.organizationContext.bookingLink || '').trim();
  const greeting = `${firstName}, gracias por responder.`;
  const bodyLines = [greeting];

  if (input.lastInbound.intent === 'meeting_request' || input.desiredAction === 'send') {
    bodyLines.push('Con gusto avanzamos con una conversacion breve para revisar contexto y ver si hace sentido trabajar juntos.');
    if (bookingLink) {
      bodyLines.push(`Si te acomoda, puedes tomar un horario aqui: ${bookingLink}`);
    } else {
      bodyLines.push('Si te parece, comparteme 2 o 3 horarios y coordinamos.');
    }
  } else {
    bodyLines.push('Te comparto un poco mas de contexto para que evaluemos si vale la pena avanzar.');
    if (input.organizationContext.valueProposition) {
      bodyLines.push(input.organizationContext.valueProposition);
    }
  }

  if (input.organizationContext.meetingInstructions) {
    bodyLines.push(input.organizationContext.meetingInstructions);
  }

  bodyLines.push('Quedo atento.');

  const bodyText = bodyLines.join('\n\n');
  const bodyHtml = bodyLines.map((line) => `<p>${line}</p>`).join('');
  const subject = input.lastInbound.intent === 'meeting_request' ? 'Coordinemos reunion' : 'Gracias por responder';

  return {
    subject,
    bodyText,
    bodyHtml,
    recommendedAssetNames: [],
  };
}

export async function generateAntoniaReply(
  input: z.infer<typeof GenerateAntoniaReplyInputSchema>
): Promise<z.infer<typeof GenerateAntoniaReplyOutputSchema>> {
  return generateAntoniaReplyFlow(input);
}

const generateAntoniaReplyFlow = ai.defineFlow(
  {
    name: 'generateAntoniaReplyFlow',
    inputSchema: GenerateAntoniaReplyInputSchema,
    outputSchema: GenerateAntoniaReplyOutputSchema,
  },
  async (input) => {
    const prompt = `
Eres un ejecutivo comercial B2B senior escribiendo respuestas por email en espanol de Chile.

Objetivo:
- Responder a un lead real que ya interactuo con ANTONIA, contestando lo que escribio.
- Sonar humano, sobrio y convincente.
- Avanzar al siguiente paso que el lead aceptaria: pedir reunion solo si mostro interes o la pidio.
- Nunca inventar precios, features, certificaciones o integraciones.
- Si falta informacion, responder de forma segura sin alucinar.

Decision del sistema:
${input.decisionReason}

Accion deseada:
${input.desiredAction}

Lead:
${JSON.stringify(input.lead)}

Sender:
${JSON.stringify(input.sender)}

Contexto comercial:
${JSON.stringify(input.organizationContext)}

Lo que vende el remitente (unica fuente de lo que ofreces; no es informacion del lead):
${JSON.stringify(input.sellerOffer || null)}

Ultimo inbound:
${JSON.stringify(input.lastInbound)}

Resumen del hilo:
${JSON.stringify(input.conversationSummary || [])}

Research del lead (sobre su empresa, no sobre lo que vendes):
${JSON.stringify(input.researchSummary || '')}

Assets disponibles:
${JSON.stringify(input.assets || [])}

Reglas:
- Maximo 140 palabras.
- La primera frase responde lo que el lead escribio. No repitas ni resumas el correo anterior.
- Si pidio informacion por correo, dasela en este correo: en dos o tres frases, que haces y como le sirve a su empresa, con los servicios de "Lo que vende el remitente". No le pidas una llamada para mandarsela; cierra con una pregunta facil.
- Si pregunta si haces algo, responde si o no segun "Lo que vende el remitente". Si pregunta un precio que no esta ahi, di de que depende y pide solo esos datos, sin agregar otra venta.
- Si dice que ya tiene proveedor o que no tiene presupuesto, agradece en una o dos frases y respeta su respuesta: no vuelvas a vender, no nombres servicios ni pidas reunion. Solo pregunta si puedes escribirle mas adelante.
- Usa el mismo tratamiento (tu o usted) del correo que enviaste en el hilo.
- ${OUTREACH_TONE_BLOCK}
- Un solo pedido: si ya propusiste reunión, no agregues otra pregunta ni otro CTA.
- Si el lead pide reunion y existe booking link, usalo de forma natural.
- Si el lead pide brochure o deck, solo recomienda un asset disponible si realmente corresponde.
- Si el caso parece complejo, mantente prudente y cierra con CTA simple.
- Devuelve HTML simple con <p>, <br> y nada mas (sin <strong> salvo que resalte un dato concreto).

Devuelve solo JSON valido:
{"subject":"...","bodyText":"...","bodyHtml":"...","recommendedAssetNames":["..."]}
`;

    try {
      const output = await generateStructured({
        prompt,
        schema: ModelReplySchema,
        temperature: 0.35,
      });
      return { ...output, recommendedAssetNames: output.recommendedAssetNames ?? [] };
    } catch (error) {
      return buildFallbackReply(input);
    }
  }
);
