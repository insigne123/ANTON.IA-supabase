import assert from 'node:assert/strict';
import test from 'node:test';

import { answerHelpQuestion, createHelpRateLimiter } from './answer-help-question';
import { visibleHelpSections } from './manual';

const member = visibleHelpSections({ opportunities: false, admin: false });

test('answers from the manual and keeps only the sections the person can see', async () => {
  const prompts: string[] = [];
  const answer = await answerHelpQuestion({ question: '¿Cómo envío mi primer correo?', sectionId: 'por-escribir', sections: member }, {
    generate: async (options) => {
      prompts.push(options.prompt);
      return {
        answer: 'Investiga al contacto en «Por escribir» y pulsa «Contactar».',
        answered: true,
        sectionIds: ['[por-escribir]', 'correo', 'administracion', 'inventada', 'correo'],
      };
    },
  });
  assert.equal(answer.source, 'ai');
  if (answer.source !== 'ai') return;
  assert.equal(answer.answered, true);
  assert.deepEqual(answer.sections.map((section) => section.id), ['por-escribir', 'correo'], 'hidden and unknown sections are dropped');
  assert.deepEqual(answer.sections[0], { id: 'por-escribir', title: 'Por escribir', href: '/ayuda/por-escribir', screen: '/saved/leads/enriched' });
  assert.match(prompts[0], /La persona está en la pantalla «Por escribir» \[por-escribir\]/);
  assert.match(prompts[0], /PREGUNTA: ¿Cómo envío mi primer correo\?$/);
  assert.doesNotMatch(prompts[0], /\[administracion\]/, 'a member is never told about the admin panel');
});

test('when the model fails or answers nothing, the closest FAQs of the manual answer instead', async () => {
  for (const generate of [
    async () => { throw new Error('timeout'); },
    async () => ({ answer: '  ', answered: true, sectionIds: [] }),
  ]) {
    const answer = await answerHelpQuestion({ question: 'Me quedé sin créditos', sections: member }, { generate });
    assert.equal(answer.source, 'manual');
    if (answer.source !== 'manual') return;
    assert.equal(answer.answered, true);
    assert.equal(answer.matches[0].section.id, 'creditos');
    assert.equal(answer.matches[0].q, 'Me quedé sin créditos. ¿Qué hago?');
    assert.match(answer.matches[0].a, /administrador/);
  }
  const nothing = await answerHelpQuestion({ question: 'xylofón', sections: member }, { generate: async () => { throw new Error('down'); } });
  assert.deepEqual(nothing, { source: 'manual', answer: null, answered: false, matches: [] });
});

test('a long question is cut to the limit; a screen the person cannot see is ignored', async () => {
  let prompt = '';
  await answerHelpQuestion({ question: 'a'.repeat(900), sectionId: 'administracion', sections: member }, {
    generate: async (options) => { prompt = options.prompt; return { answer: 'Ok.', answered: false, sectionIds: [] }; },
  });
  assert.match(prompt, /PREGUNTA: a{500}$/);
  assert.match(prompt, /La persona está en el Centro de ayuda/);
});

test('the rate limit allows a few questions per window and per person', () => {
  const allow = createHelpRateLimiter(2, 1_000);
  assert.equal(allow('ana', 0), true);
  assert.equal(allow('ana', 10), true);
  assert.equal(allow('ana', 20), false);
  assert.equal(allow('luis', 20), true, 'per person');
  assert.equal(allow('ana', 1_001), true, 'the window moves');
});
