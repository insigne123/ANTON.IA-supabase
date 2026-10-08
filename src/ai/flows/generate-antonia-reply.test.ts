import assert from 'node:assert/strict';
import test from 'node:test';

import { generateAntoniaReply } from './generate-antonia-reply';

const input = {
  decisionReason: 'reply autopilot desactivado; generar borrador solamente',
  desiredAction: 'draft' as const,
  lead: { name: 'Carolina', company: 'Constructora Pehuén' },
  sender: { name: 'Carla Muñoz', company: 'ServiPro' },
  organizationContext: { valueProposition: 'Ponemos la dotación que necesitas por el tiempo que la necesitas.' },
  lastInbound: { text: '¿Ustedes también hacen los finiquitos cuando termina la obra?', intent: 'positive' },
  conversationSummary: [{ role: 'outbound' as const, subject: 'personal para las obras', text: 'Hola Carolina, ¿le parece si lo conversamos?' }],
  researchSummary: 'Constructora Pehuén contratará trabajadores para dos obras en el Biobío.',
  sellerOffer: { services: ['Administración laboral (contratos, anexos y finiquitos)'], valueProposition: 'Ponemos la dotación que necesitas.' },
};

test('the reply sees what the sender sells, apart from the lead research, and null assets do not fall back to the template', async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousFetch = globalThis.fetch;
  let prompt = '';
  try {
    process.env.OPENAI_API_KEY = 'test-openai-key';
    globalThis.fetch = async (_input, init) => {
      prompt = JSON.parse(String(init?.body)).messages.map((message: { content: string }) => message.content).join('\n');
      return Response.json({ choices: [{ message: { content: JSON.stringify({
        subject: 'Re: personal para las obras', bodyText: 'Sí, también hacemos los finiquitos.', bodyHtml: '<p>Sí, también hacemos los finiquitos.</p>', recommendedAssetNames: null,
      }) } }] });
    };
    const reply = await generateAntoniaReply(input);
    assert.equal(reply.bodyText, 'Sí, también hacemos los finiquitos.');
    assert.deepEqual(reply.recommendedAssetNames, []);
    assert.match(prompt, /Lo que vende el remitente \(unica fuente de lo que ofreces; no es informacion del lead\):\n\{"services":\["Administración laboral \(contratos, anexos y finiquitos\)"\]/);
    assert.match(prompt, /Research del lead \(sobre su empresa, no sobre lo que vendes\)/);
    assert.match(prompt, /Si pidio informacion por correo, dasela en este correo/);
    assert.match(prompt, /Usa el mismo tratamiento \(tu o usted\) del correo que enviaste/);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  }
});
