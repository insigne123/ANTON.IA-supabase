// Explicit live-model evaluation. No database writes, approvals or email sends.
// Run with the repo TS loader and OPENAI_API_KEY in the environment.
import { generateOutreachFromDraftContextV2 } from '../src/ai/flows/generate-outreach-from-report';
import { draftContextFixture } from '../src/lib/server/draft-v2-test-fixtures';
import { buildSharedSequenceBrief, RESEARCH_SEQUENCE_STEPS } from '../src/lib/outreach-sequence-brief';
import { validateDraftPreflightV2 } from '../src/lib/server/draft-preflight-v2';

if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY required');
const context = draftContextFixture();
context.recipient.displayName = 'Claudia';
context.company.name = 'Randstad Chile';
context.company.domain = 'randstad.cl';
context.person.title = null;
context.seller.companyName = 'Yago';
context.seller.services = ['Desarrollo de plataformas web empresariales'];
context.seller.valueProposition = 'Plataformas web para centralizar información y consultar el avance de procesos.';
context.seller.description = context.seller.valueProposition;
context.seller.proofPoints = [];
context.hypotheses = [];
context.evidence = [context.evidence[0]];
context.evidence[0].statement = 'Randstad Chile se hace cargo de todas o parte de las vacantes de talento de una compañía.';
const brief = buildSharedSequenceBrief(context);
const priorMessages: any[] = [];
for (let index = 0; index < 4; index++) {
  const step = RESEARCH_SEQUENCE_STEPS[index - 1];
  const output = await generateOutreachFromDraftContextV2({ context, sharedSequenceBrief: brief,
    ...(index ? { sequenceContext: { sequenceInstruction: 'Desarrolla el mismo tema comercial.', priorMessages: [...priorMessages], currentStep: { index, total: 3, ...step } } } : {}),
  });
  // Mirror the server: initial appends the approved CTA, follow-ups keep their
  // own question, the closing step carries no meeting CTA.
  const body = index === 0 ? `${output.body}\n\n${context.constraints.cta.exactText}` : output.body;
  const validation = validateDraftPreflightV2(context, { subject: output.subject, body, personalization: output.personalization, hypothesisIds: output.hypothesisIds }, { checkGeneratedCopy: true, ...(index === 0 ? {} : index === 3 ? { expectedCtaCount: 0 as const } : { expectedCtaCount: 'model' as const }) });
  console.log(JSON.stringify({ index, subject: output.subject, body, valid: validation.valid, issues: validation.issues, warnings: validation.preflight.warnings }));
  priorMessages.push({ kind: index ? 'follow_up' : 'initial', index, name: step?.name || 'Inicial', subject: output.subject, body });
}
