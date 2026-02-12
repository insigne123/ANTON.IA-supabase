'use server';

import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import type { StyleProfile } from '@/lib/types';
import { generateStructured } from '@/ai/openai-json';

// Esquema de entrada para el flujo
const UpdateStyleInputSchema = z.object({
    currentStyle: z.any(), // StyleProfile, pero z.any() para flexibilidad
    userInstruction: z.string(),
    sampleLead: z.any().optional(), // Contexto opcional para entender mejor
});

// Esquema de salida
const UpdateStyleOutputSchema = z.object({
    updatedStyle: z.any(), // Partial<StyleProfile>
    explanation: z.string(), // Explicación de qué cambió
});

export const updateStyleProfileFlow = ai.defineFlow(
    {
        name: 'updateStyleProfile',
        inputSchema: UpdateStyleInputSchema,
        outputSchema: UpdateStyleOutputSchema,
    },
    async (input) => {
        const prompt = `
Eres un experto en Copywriting B2B y diseño de correos electrónicos.
Tu tarea es modificar un "Perfil de Estilo" (JSON) basado en las instrucciones del usuario.

# Current Style Profile (JSON):
${JSON.stringify(input.currentStyle, null, 2)}

# User Instruction:
"${input.userInstruction}"

# Tarea:
1. Analiza la instrucción del usuario.
2. Modifica los campos del perfil de estilo que sean necesarios (tone, length, structure, personalization, templates).
3. NO cambies el nombre ni el ID del estilo a menos que se pida explícitamente.
4. Si la instrucción pide cambiar el contenido (ej: "menciona Coca-Cola"), edita \`bodyTemplate\` y \`subjectTemplate\`.
   - Recuerda usar tokens como {{lead.firstName}}, {{company.name}}, {{sender.name}}.
   - Si el usuario pide algo específico sobre su empresa, intégralo en el template.
5. Devuelve el JSON del estilo actualizado Y una breve explicación de qué cambiaste.

# Formato de Salida (JSON):
Devuelve UNICAMENTE un objeto JSON con esta estructura:
{
  "updatedStyle": { ...campos modificados del estilo... },
  "explanation": "Texto breve explicando los cambios hechos (en español)."
}
`;

        const output = await generateStructured({
            prompt,
            schema: UpdateStyleOutputSchema,
            temperature: 0.5,
        });

        if (!output) {
            throw new Error('No se pudo generar una respuesta de la IA.');
        }

        return output;
    }
);

export async function updateStyleProfile(input: z.infer<typeof UpdateStyleInputSchema>) {
    return updateStyleProfileFlow(input);
}
