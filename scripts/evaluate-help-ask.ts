/**
 * Live check of «Pregúntale a la IA» (docs/ui-ux/ayuda-y-manual.md): real questions against the real model, answered only
 * from the manual. Reads no database and sends nothing. Needs OPENAI_API_KEY in the environment; never loads .env files.
 *
 *   npx tsx scripts/evaluate-help-ask.ts --live
 */
import { answerHelpQuestion } from '../src/lib/help/answer-help-question';
import { visibleHelpSections } from '../src/lib/help/manual';

type Case = {
  question: string;
  admin?: boolean;
  /** One of these sections must be cited. Empty: the manual does not cover it and the answer must say so. */
  expect: string[];
  /** Words the answer must contain (without accents or case). */
  mentions?: string[];
};

const CASES: Case[] = [
  { question: '¿Cómo envío mi primer correo?', expect: ['primeros-pasos', 'por-escribir', 'correo'], mentions: ['enviar ahora'] },
  { question: 'Busqué el correo de un contacto y desapareció de la lista, ¿dónde quedó?', expect: ['por-completar'], mentions: ['por escribir'] },
  { question: 'Pegué un perfil de LinkedIn y no encontró a la persona', expect: ['buscar'], mentions: ['empresa'] },
  { question: '¿A cuántas personas puedo escribir en una campaña?', expect: ['campanas'], mentions: ['100'] },
  { question: '¿La IA manda los correos sola?', expect: ['primeros-pasos', 'correo'], mentions: ['no'] },
  { question: '¿Dónde cambio mi firma?', expect: ['firmas'], mentions: ['firmas y estilo'] },
  { question: 'Me quedé sin créditos, ¿qué hago?', expect: ['creditos'], mentions: ['administrador'] },
  { question: 'Alguien me respondió pero no lo veo en la app', expect: ['conversaciones'], mentions: ['actualizar mis respuestas'] },
  { question: '¿Por qué la IA no puede redactar mis correos?', expect: ['perfil', 'por-escribir'], mentions: ['perfil'] },
  { question: '¿Cómo invito a alguien de mi equipo?', admin: true, expect: ['administracion'], mentions: ['invitar'] },
  { question: '¿Cuánto cuesta el plan premium?', expect: [] },
  { question: '¿Cuál es la capital de Francia?', expect: [] },
];

const plain = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

async function main() {
  if (!process.argv.includes('--live')) {
    console.log('Usa --live para llamar al modelo real (necesita OPENAI_API_KEY).');
    return;
  }
  if (!process.env.OPENAI_API_KEY) throw new Error('Falta OPENAI_API_KEY en el entorno.');
  let passed = 0;
  const rows: string[] = [];
  for (const item of CASES) {
    const started = Date.now();
    const sections = visibleHelpSections({ opportunities: false, admin: Boolean(item.admin) });
    const answer = await answerHelpQuestion({ question: item.question, sections });
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    if (answer.source !== 'ai') {
      rows.push(`| ${item.question} | — | respaldo del manual | ${seconds} | NO |`);
      continue;
    }
    const cited = answer.sections.map((section) => section.id);
    const text = plain(answer.answer);
    const ok = item.expect.length === 0
      ? !answer.answered
      : answer.answered && cited.some((id) => item.expect.includes(id)) && (item.mentions || []).every((word) => text.includes(plain(word)));
    if (ok) passed += 1;
    rows.push(`| ${item.question} | ${answer.answered ? 'sí' : 'no'} | ${cited.join(', ') || '—'} | ${seconds} | ${ok ? 'sí' : 'NO'} |`);
    console.log(`\n${item.question}\n→ ${answer.answer}\n  secciones: ${cited.join(', ') || '—'} · ${seconds} s · ${ok ? 'OK' : 'REVISAR'}`);
  }
  console.log('\n| Pregunta | ¿Respondida? | Secciones citadas | Segundos | Correcta |\n|---|---|---|---|---|');
  console.log(rows.join('\n'));
  console.log(`\n${passed} de ${CASES.length} correctas.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
