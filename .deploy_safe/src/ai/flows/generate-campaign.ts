import { ai } from '@/ai/genkit';
import { z } from 'genkit';

export const generateCampaignFlow = ai.defineFlow(
    {
        name: 'generateCampaign',
        inputSchema: z.object({
            // Frontend usage
            goal: z.string().optional(),
            companyName: z.string().optional(),
            targetAudience: z.string().optional(),
            language: z.string().optional(),

            // Antonia usage
            jobTitle: z.string().optional(),
            industry: z.string().optional(),
            missionTitle: z.string().optional(),
            campaignContext: z.string().optional(),
            userName: z.string().optional(),
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
    async (input) => {
        const { goal, jobTitle, industry, missionTitle, campaignContext, userName, companyName, targetAudience, language } = input;

        // Mode detection: If jobTitle is present, it's a specific Antonia mission
        const isAntoniaMission = !!jobTitle;

        let prompt = '';

        if (isAntoniaMission) {
            prompt = `
                Act as an expert B2B copywriter for a campaign mission: "${missionTitle || 'Outreach'}".
                
                Target Persona: ${jobTitle} in the ${industry} industry.
                Context/Offer: ${campaignContext || 'General partnership opportunity'}
                Sender Name: ${userName || '{{sender.name}}'}
                Language: ${language || 'es'}

                Write a 3-step campaign sequence for initial contact + 2 smart follow-ups.
                
                Requirements:
                - 3 steps only
                - Step 1: name "Initial Contact", offsetDays: 0
                - Step 2: name "Follow-up 1", offsetDays: 3
                - Step 3: name "Follow-up 2", offsetDays: 7
                - Subject: Catchy and relevant to the target persona
                - Body: HTML format (use <p>, <br>, <strong>)
                - Personalization: Use {{lead.name}} for lead name, {{company}} for lead company, {{sender.name}} for sender
                - Tone: Professional but conversational
                - Length: Concise and impactful
            `;
        } else {
            prompt = `
              Act as an expert email marketing copywriter.
              Create a drip campaign sequence (3-5 emails) for the following scenario:
              
              Goal: ${goal || 'Outreach'}
              My Company: ${companyName || 'Unknown'}
              Target Audience: ${targetAudience || 'General'}
              Language: ${language || 'es'}

              For each email step, provide:
              - A descriptive internal name (e.g. "Value Proposition", "Case Study").
              - Recommended offset days from the previous email.
              - A catchy Subject line.
              - The Body in HTML format (use <p>, <br>, <strong>). 
                - Use placeholders {{lead.name}} for the lead's name and {{company}} for the lead's company.
                - Use {{sender.name}} for my name.
            `;
        }

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
