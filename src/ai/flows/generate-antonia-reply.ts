'use server';

import { z } from 'genkit';
import { ai } from '@/ai/genkit';
import { generateStructured } from '@/ai/openai-json';

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
});

const GenerateAntoniaReplyOutputSchema = z.object({
  subject: z.string(),
  bodyText: z.string(),
  bodyHtml: z.string(),
  recommendedAssetNames: z.array(z.string()).default([]),
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
- Responder a un lead real que ya interactuo con ANTONIA.
- Sonar humano, sobrio y convincente.
- Buscar avanzar a una reunion si el contexto lo permite.
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

Ultimo inbound:
${JSON.stringify(input.lastInbound)}

Resumen del hilo:
${JSON.stringify(input.conversationSummary || [])}

Research:
${JSON.stringify(input.researchSummary || '')}

Assets disponibles:
${JSON.stringify(input.assets || [])}

Reglas:
- Maximo 140 palabras.
- No uses frases roboticas ni menciones IA.
- Si el lead pide reunion y existe booking link, usalo de forma natural.
- Si el lead pide brochure o deck, solo recomienda un asset disponible si realmente corresponde.
- Si el caso parece complejo, mantente prudente y cierra con CTA simple.
- Devuelve HTML simple con <p>, <br>, <strong> y nada mas.

Devuelve solo JSON valido:
{"subject":"...","bodyText":"...","bodyHtml":"...","recommendedAssetNames":["..."]}
`;

    try {
      const output = await generateStructured({
        prompt,
        schema: GenerateAntoniaReplyOutputSchema,
        temperature: 0.35,
      });
      return output;
    } catch (error) {
      return buildFallbackReply(input);
    }
  }
);
