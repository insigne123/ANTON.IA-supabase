import assert from 'node:assert/strict';
import test from 'node:test';
import { coworkConversationMarkdown, coworkHandoffMessage, coworkHitConversationLimit } from './handoff';

const run = (id: string, message: string) => ({ id, message, status: 'completed', created_at: '2026-10-24T12:00:00Z' }) as any;
const completed = (reply: string) => [{ kind: 'run.completed', payload: { reply, document: null }, created_at: '2026-10-24T12:01:00Z' }] as any;

test('a new conversation picks up one at its limit with what was asked, the last answer and the files, and leaves the next step to write (COW-14)', () => {
  const message = coworkHandoffMessage('Correos para la feria', [
    { run: run('a', '¿A quién le escribo primero de la feria? (ID del contacto: 00000000-0000-4000-8000-000000000001)\n\nAdjuntos:\n- asistentes-feria.csv'), events: completed('Empieza por Marcela Rojas.') },
    { run: run('b', 'Escríbeles a los tres primeros'), events: completed('Listo: dejé tres borradores en «Por escribir».') },
    { run: run('c', 'Ahora los siguientes'), events: [] },
  ]);
  assert.equal(message, [
    'Sigo desde la conversación «Correos para la feria», que llegó a su máximo.',
    'Lo que pedí al comienzo: «¿A quién le escribo primero de la feria?».',
    'Lo último que respondiste: «Listo: dejé tres borradores en «Por escribir».».',
    'Archivos que usamos: asistentes-feria.csv (los adjunto de nuevo si los necesitas).',
    'Ahora necesito: ',
  ].join('\n\n'));
});

test('only the limit of the conversation offers a new one; other failures keep «Reintentar»', () => {
  assert.equal(coworkHitConversationLimit({ category: 'model_budget_conversation' }), true);
  assert.equal(coworkHitConversationLimit({ message: 'Esta conversación llegó a su máximo de uso del asistente. Lo hecho quedó guardado…' }), true, 'turns saved before the category');
  assert.equal(coworkHitConversationLimit({ category: 'model_timeout', message: 'El asistente tardó demasiado en responder.' }), false);
  assert.equal(coworkHitConversationLimit(null), false);
});

test('a conversation downloads as Markdown: each message, each answer with its question and the document it delivered (COW-10)', () => {
  const markdown = coworkConversationMarkdown('Correos para la feria', [
    { run: run('a', '¿A quién le escribo primero? (ID del contacto: 00000000-0000-4000-8000-000000000001)\n\nAdjuntos:\n- feria.csv'),
      events: [{ kind: 'run.completed', payload: { reply: 'Empieza por Marcela Rojas.', question: '¿Le escribo?', document: { title: 'Plan', content: '1. Marcela' } }, created_at: '' }] as any },
    { run: run('b', 'Sí'), events: [] },
  ], new Date('2026-10-24T15:00:00Z'));
  assert.equal(markdown, ['# Correos para la feria', '_Conversación con Cowork en ANTON.IA · descargada el 24 de octubre de 2026 a las 12:00_',
    '## Tú\n\n¿A quién le escribo primero?\n\nAdjuntos: feria.csv', '## Cowork\n\nEmpieza por Marcela Rojas.\n\n¿Le escribo?\n\n### Plan\n\n1. Marcela', '## Tú\n\nSí'].join('\n\n') + '\n');
});
