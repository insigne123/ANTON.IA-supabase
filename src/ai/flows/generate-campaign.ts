import { ai } from '@/ai/genkit';
import { z } from 'genkit';

export const generateCampaignFlow = ai.defineFlow(
    {
        name: 'generateCampaign',
        inputSchema: z.object({
            goal: z.string().describe('The main goal of the campaign (e.g. "Recover inactive clients")'),
            companyName: z.string().optional().describe('Name of the user company'),
            targetAudience: z.string().optional().describe('Description of the target audience'),
            language: z.string().optional().default('es').describe('Language for the emails'),
        }),
        outputSchema: z.object({
            steps: z.array(z.object({
                name: z.string(),
                offsetDays: z.number(),
                subject: z.string(),
                bodyHtml: z.string(),
            })),
        }),
    },
    async ({ goal, companyName, targetAudience, language }) => {
        const prompt = `
      Act as an expert email marketing copywriter.
      Create a drip campaign sequence (3-5 emails) for the following scenario:
      
      Goal: ${goal}
      My Company: ${companyName || 'Unknown'}
      Target Audience: ${targetAudience || 'General'}
      Language: ${language}

      For each email step, provide:
      - A descriptive internal name (e.g. "Value Proposition", "Case Study").
      - Recommended offset days from the previous email (0 for the first one).
      - A catchy Subject line.
      - The Body in HTML format (use <p>, <br>, <strong>). 
        - Use placeholders {{lead.name}} for the lead's name and {{company}} for the lead's company.
        - Use {{sender.name}} for my name.
        - Keep it professional but engaging.
    `;

        const { output } = await ai.generate({
            prompt,
            output: {
                schema: z.object({
                    steps: z.array(z.object({
                        name: z.string(),
                        offsetDays: z.number(),
                        subject: z.string(),
                        bodyHtml: z.string(),
                    })),
                }),
            },
        });

        if (!output) {
            throw new Error('Failed to generate campaign content');
        }

        return output;
    }
);
