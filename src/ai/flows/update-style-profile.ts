'use server';

import { z } from 'genkit';
import type { StyleProfile } from '@/lib/types';
import { generateStructured } from '@/ai/openai-json';

const UpdateStyleInputSchema = z.object({
  currentStyle: z.any(),
  userInstruction: z.string(),
  sampleLead: z.any().optional(),
});

const UpdateStyleOutputSchema = z.object({
  updatedStyle: z.any(),
  explanation: z.string(),
});

export async function updateStyleProfile(input: z.infer<typeof UpdateStyleInputSchema>) {
  const prompt = `
Eres un experto en copywriting B2B y diseno de estilos para email outbound.
Tu tarea es modificar un Perfil de Estilo JSON segun la instruccion del usuario.

# Perfil actual
${JSON.stringify(input.currentStyle, null, 2)}

# Instruccion del usuario
${JSON.stringify(input.userInstruction)}

# Lead de ejemplo opcional
${JSON.stringify(input.sampleLead || {})}

# Reglas
- Modifica solo los campos necesarios para reflejar la instruccion.
- No cambies el nombre del estilo salvo que el usuario lo pida explicitamente.
- Si el usuario pide cambios concretos de redaccion, actualiza subjectTemplate y bodyTemplate.
- Usa placeholders como {{lead.firstName}}, {{company.name}}, {{sender.name}} cuando corresponda.
- No inventes datos de empresas, clientes o resultados.
- Devuelve un JSON con esta forma exacta:
{
  "updatedStyle": { ... },
  "explanation": "..."
}
`;

  return generateStructured({
    prompt,
    schema: UpdateStyleOutputSchema,
    temperature: 0.5,
  });
}

export type UpdateStyleProfileInput = z.infer<typeof UpdateStyleInputSchema>;
export type UpdateStyleProfileOutput = z.infer<typeof UpdateStyleOutputSchema>;
