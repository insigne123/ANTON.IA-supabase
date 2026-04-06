
'use server';
/**
 * @fileOverview Flow to generate a company profile using AI.
 *
 * - generateCompanyProfile - A function that takes a company name and returns a detailed profile.
 * - GenerateCompanyProfileInput - The input type for the generateCompanyProfile function.
 * - GenerateCompanyProfileOutput - The return type for the generateCompanyProfile function.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';

const GenerateCompanyProfileInputSchema = z.object({
  companyName: z.string().describe('The name of the company.'),
});
export type GenerateCompanyProfileInput = z.infer<typeof GenerateCompanyProfileInputSchema>;

const GenerateCompanyProfileOutputSchema = z.object({
  sector: z.string().describe('El sector industrial en el que opera la empresa.'),
  website: z.string().describe('El sitio web oficial de la empresa.'),
  description: z.string().describe('Una descripción detallada de la empresa.'),
  services: z.string().describe('Un resumen de los productos o servicios que ofrece la empresa.'),
  valueProposition: z.string().describe('La propuesta de valor única de la empresa.'),
});
export type GenerateCompanyProfileOutput = z.infer<typeof GenerateCompanyProfileOutputSchema>;


const profileGenerationPrompt = ai.definePrompt({
    name: 'companyProfileGenerator',
    input: { schema: GenerateCompanyProfileInputSchema },
    output: { schema: GenerateCompanyProfileOutputSchema },
    prompt: `Eres un experto analista de negocios. Basado en el nombre de la empresa proporcionado, genera un perfil de empresa detallado en español.
    
    Nombre de la empresa: {{{companyName}}}
    
    Completa los siguientes detalles en español. Si no encuentras información, haz una suposición razonable basada en el nombre de la empresa.
    - Sector/Industria
    - Sitio web
    - Descripción de la empresa
    - Servicios que ofrece
    - Propuesta de valor`,
});


export const generateCompanyProfileFlow = ai.defineFlow(
  {
    name: 'generateCompanyProfileFlow',
    inputSchema: GenerateCompanyProfileInputSchema,
    outputSchema: GenerateCompanyProfileOutputSchema,
  },
  async (input) => {
    const { output } = await profileGenerationPrompt(input);
    if (!output) {
      throw new Error('Failed to generate company profile.');
    }
    return output;
  }
);

export async function generateCompanyProfile(input: GenerateCompanyProfileInput): Promise<GenerateCompanyProfileOutput> {
    return generateCompanyProfileFlow(input);
}
