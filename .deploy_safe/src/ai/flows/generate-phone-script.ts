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
    prompt: `Idioma: Español (Latinoamérica - Chile, Colombia, Perú). Tono: Conversacional, seguro, consultivo (no robot de telemarketing).
Objetivo: Generar un GUION TELEFÓNICO estructurado y altamente personalizado para llamar a este prospecto.

MI EMPRESA:
{{json companyProfile}}

REPORTE DE INVESTIGACIÓN (Pains, Use Cases, Noticias, Contexto LinkedIn):
{{json report}}

PROSPECTO (Lead):
{{json lead}}

CONTEXTO IMPORTANTE:
- Si el reporte incluye "leadContext" con datos de LinkedIn (profileSummary, iceBreaker, recentActivitySummary), ÚSALOS para personalizar el guion.
- Si hay "pains" detectados, menciona el más relevante en el opening o pitch.
- Si hay noticias recientes de la empresa, menciónalas como hook de relevancia.
- Adapta el lenguaje al país del prospecto (Chile, Colombia o Perú) si está disponible.

Instrucciones para cada sección:

1. **opening** (Apertura personalizada):
   - Saludo cordial usando el nombre del prospecto
   - Hook de relevancia basado en:
     * Actividad reciente de LinkedIn (si está en leadContext.recentActivitySummary)
     * Noticia de la empresa (si está en el reporte)
     * Cargo específico y responsabilidades (si está en leadContext.profileSummary)
     * Pain detectado más crítico
   - Ejemplo: "Hola Juan, vi tu publicación reciente sobre [tema] en LinkedIn. Me pareció muy interesante tu perspectiva sobre..."
   - O: "Hola María, noté que en [Empresa] están expandiendo su operación en [ciudad]. Como [cargo], imagino que..."

2. **pitch** (Propuesta de valor - 30 segundos máximo):
   - Conecta un pain específico detectado con la solución de tu empresa
   - Usa lenguaje consultivo, no agresivo
   - Menciona un beneficio tangible
   - Termina con pregunta de validación: "¿Te hace sentido?" o "¿Es algo que te resuena?"
   - Ejemplo: "Ayudamos a empresas como [Empresa] a [resolver pain específico] mediante [solución concreta]. Nuestros clientes en [industria] han logrado [beneficio]. ¿Es algo que te resuena?"

3. **objections** (Manejo de objeciones):
   - Anticipa 2-3 objeciones probables basadas en:
     * Industria del prospecto
     * Rol/cargo (decision maker vs influencer)
     * Tamaño de empresa
   - Para cada objeción, sugiere una respuesta corta (1-2 frases) que:
     * Valide la preocupación
     * Ofrezca una perspectiva diferente
     * Mantenga la conversación abierta
   - Formato: Lista con viñetas, cada objeción con su respuesta
   - Ejemplo:
     * "Ya tenemos un proveedor" → "Entiendo perfectamente. Muchos de nuestros clientes también tenían proveedores cuando nos conocieron. Lo que nos diferencia es [valor único]. ¿Te parece si te muestro cómo complementamos lo que ya tienes?"

4. **closing** (Cierre con llamado a la acción):
   - Pide una reunión corta y específica (15-20 minutos)
   - Ofrece 2 opciones de horario para facilitar el sí
   - Usa lenguaje directo pero amable
   - Ejemplo: "Lo mejor sería mostrártelo en una llamada de 15 minutos. ¿Tienes disponibilidad el jueves en la mañana o prefieres el viernes en la tarde?"

IMPORTANTE:
- Usa un lenguaje natural y conversacional, como si estuvieras hablando con un colega
- Evita jerga excesiva o tecnicismos innecesarios
- Si no hay suficiente información para personalizar, usa un enfoque más general pero mantén el tono consultivo
- Adapta expresiones regionales si conoces el país del prospecto (Chile: "bacán", Colombia: "chévere", Perú: "chevere/genial")
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
