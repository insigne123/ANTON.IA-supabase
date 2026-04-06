import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import { generateStructured } from '@/ai/openai-json';

const outputSchema = z.object({
  intent: z.enum(['meeting_request', 'positive', 'negative', 'unsubscribe', 'auto_reply', 'neutral', 'unknown']),
  sentiment: z.enum(['positive', 'negative', 'neutral']),
  shouldContinue: z.boolean(),
  confidence: z.number().min(0).max(1),
  summary: z.string().optional(),
  reason: z.string().optional(),
});

type ReplyClassified = z.infer<typeof outputSchema>;

export const classifyReplyFlow = ai.defineFlow(
  {
    name: 'classifyReply',
    inputSchema: z.object({
      text: z.string(),
      language: z.string().optional(),
    }),
    outputSchema,
  },
  async (input): Promise<ReplyClassified> => {
    const { text, language } = input;

    const prompt = `
You are an expert sales assistant. Classify the reply from a lead and decide if the campaign should continue.

Rules:
- If the reply requests a meeting/call/demo or shows clear interest -> intent=meeting_request or positive, shouldContinue=false.
- If the reply is negative or asks to stop -> intent=negative or unsubscribe, shouldContinue=false.
- If the reply is an automatic reply/out of office -> intent=auto_reply, shouldContinue=true.
- If the reply is neutral or asks to follow up later -> intent=neutral, shouldContinue=true.
- If unsure -> intent=unknown, shouldContinue=false.

Return JSON with:
- intent (meeting_request|positive|negative|unsubscribe|auto_reply|neutral|unknown)
- sentiment (positive|negative|neutral)
- shouldContinue (boolean)
- confidence (0..1)
- summary (short, 1 sentence)
- reason (short)

Language: ${language || 'es'}
Reply:
${text}
`;

    const output = await generateStructured({
      prompt,
      schema: outputSchema,
      temperature: 0.2,
    });

    if (!output) {
      return {
        intent: 'unknown',
        sentiment: 'neutral',
        shouldContinue: false,
        confidence: 0.2,
        summary: 'No classification output',
        reason: 'model_empty',
      };
    }

    return output as ReplyClassified;
  }
);
