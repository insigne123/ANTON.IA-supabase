'use server';
/**
 * @fileOverview Flow to generate a phone call script based on a company research report.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';

const GeneratePhoneScriptInputSchema = z.object({
    report: z.any().describe('The detailed research report for the lead and their company.'),
    companyProfile: z.any().describe('The profile of your own company to tailor the pitch.'),
    lead: z.any().describe('The person to contact.'),
});

const GeneratePhoneScriptOutputSchema = z.object({
    opening: z.string().describe('Personalized greeting and context hook.'),
    pitch: z.string().describe('30-second elevator pitch connecting their pain to our solution.'),
    objections: z.string().describe('Handling of possible objections (markdown list).'),
    closing: z.string().describe('Call to action for booking a meeting.'),
});

export async function generatePhoneScript(
    input: z.infer<typeof GeneratePhoneScriptInputSchema>
) {
    return generatePhoneScriptFlow(input);
}

const prompt = ai.definePrompt({
    name: 'generatePhoneScriptPrompt',
    input: { schema: GeneratePhoneScriptInputSchema },
    output: { schema: GeneratePhoneScriptOutputSchema },
    prompt: `Idioma: Español (Chile/Latam). Tono: Conversacional, seguro, consultivo (no robot de telemarketing).
Objetivo: Generar un GUION TELEFÓNICO estructurado para llamar a este prospecto.

MI EMPRESA:
{{json companyProfile}}

REPORTE DE INVESTIGACIÓN (Pains, Use Cases, Noticias):
{{json report}}

PROSPECTO (Lead):
{{json lead}}

Instrucciones:
1. **opening**: Saludo breve + "Hook de Relevancia" (mencionar noticia reciente, cargo específico o pain detectado). Ejemplo: "Hola Juan, vi que en [Empresa] están expandiendo..."
2. **pitch**: Propuesta de valor en 30 segundos. "Ayudamos a empresas como [Empresa] a resolver [Pain detectado] mediante [Solución]. ¿Te hace sentido?"
3. **objections**: Anticipa 2-3 objeciones probables basadas en su industria/rol (ej: "Ya tenemos proveedor", "Presupuesto", "Envíamelo por correo") y sugiere respuestas cortas y efectivas.
4. **closing**: Cierre directo pidiendo reunión. "Lo mejor sería mostrartelo en 15min. ¿Tienes disponibilidad el jueves?"
`,
});

const generatePhoneScriptFlow = ai.defineFlow(
    {
        name: 'generatePhoneScriptFlow',
        inputSchema: GeneratePhoneScriptInputSchema,
        outputSchema: GeneratePhoneScriptOutputSchema,
    },
    async (input) => {
        const { output } = await prompt(input);
        if (!output) {
            throw new Error('Failed to generate phone script.');
        }
        return output;
    }
);
