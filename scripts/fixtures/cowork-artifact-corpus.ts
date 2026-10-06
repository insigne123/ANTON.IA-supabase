// Cases for code artifacts (Plan 12, 3b): what a person asks to see, and changes to an artifact already made, in the
// words of the chat and as the canvas sends them («Pedir cambios» and «Arreglarlo»). They run with --artifacts, on the
// production fixture world of the corpus; without it they measure how Cowork answers the same requests in the chat.
import { coworkArtifactChangeMessage, coworkArtifactFixMessage } from '../../src/lib/cowork/code-artifact-frame';
import { COWORK_ARTIFACT_EXAMPLES } from '../../src/lib/server/cowork/code-artifact-examples';
import { CORPUS_COMMON_CHECKS, type CorpusCase, type CorpusHistoryTurn, type CorpusTurnResult } from './cowork-conversation-corpus';

const at = '2026-09-25T13:00:00Z';
const PIPELINE = { name: 'artifact-pipeline-por-etapa-v1.html', title: 'Pipeline por etapa' };
const made: CorpusHistoryTurn = { request: 'muéstrame mi pipeline en un gráfico por etapa', at, artifacts: [PIPELINE],
  reply: 'Tus 4 contactos guardados están en Nuevos: ninguno avanzó de etapa todavía. El tablero muestra el pipeline por etapa, con la tabla de detalle debajo; puedes ordenarla y usar «Ver datos» en el gráfico.' };
const code = { [PIPELINE.name]: COWORK_ARTIFACT_EXAMPLES[0].code };
// The same page with a real bug: it reads rows from a property the table does not have, so it throws on open.
const brokenJs = COWORK_ARTIFACT_EXAMPLES[0].code.js.replace('const deals = antonia.data.pipeline.rows;', 'const deals = antonia.data.pipeline.items.map(row => row);');
const broken = { [PIPELINE.name]: { ...COWORK_ARTIFACT_EXAMPLES[0].code, js: brokenJs } };
const brokenLine = brokenJs.split('\n').findIndex(line => line.includes('.items.map(')) + 1;
const edited = (result: CorpusTurnResult) => (result.artifact?.brief as { previous?: unknown } | undefined)?.previous === PIPELINE.name;
const drawn = (result: CorpusTurnResult) => Boolean(result.artifact) && result.artifact?.render?.ok !== false;
/** Without --artifacts the same request is answered in the chat: a table, figures or a document count. */
const visual = (result: CorpusTurnResult) => Boolean(result.artifact) || Boolean(result.document)
  || (result.blocks || []).some(block => ['metrics', 'chart', 'table'].includes(block.type));

export const ARTIFACT_CORPUS: CorpusCase[] = [
  { id: 'art-prospectos-filtro', title: 'Prospectos en una tabla que se filtra',
    request: 'muéstrame mis contactos guardados en una tabla que pueda filtrar por empresa y ver quién tiene correo',
    origin: 'Plan 12, 3b: una lista que se filtra es un artefacto, no un texto.',
    checks: [...CORPUS_COMMON_CHECKS,
      { label: 'entrega algo visual', test: visual },
      { label: 'el artefacto usa los contactos', test: r => !r.artifact || r.artifact.tables.some(table => table.name === 'contacts' || table.name === 'pipeline') },
      { label: 'el artefacto se dibuja sin errores', test: r => !r.artifact || drawn(r) }] },
  { id: 'art-tablero-campanas', title: 'Tablero de campañas', request: 'hazme un tablero de mis campañas: cuántas tengo, en qué estado y a cuántas personas van',
    origin: 'Plan 12, 3b.',
    checks: [...CORPUS_COMMON_CHECKS,
      { label: 'entrega algo visual', test: visual },
      { label: 'el artefacto usa las campañas', test: r => !r.artifact || r.artifact.tables.some(table => table.name === 'campaigns') },
      { label: 'no muestra estados en inglés', test: r => !/\b(draft|paused|approved)\b/.test(`${r.reply}\n${r.artifact?.render?.text || ''}`) }] },
  { id: 'art-cambio-boton', title: '«Pedir cambios» desde el lienzo', history: [made], artifacts: code,
    request: coworkArtifactChangeMessage(PIPELINE, 'agrega un gráfico de contactos por empresa'),
    origin: 'Plan 12, 3b: el mensaje que manda «Pedir cambios» nombra el archivo; se edita esa versión.',
    checks: [...CORPUS_COMMON_CHECKS,
      { label: 'edita el artefacto anterior', test: edited },
      { label: 'la versión nueva se dibuja sin errores', test: drawn },
      { label: 'no pide confirmación para un cambio pedido', test: r => Boolean(r.artifact) }] },
  { id: 'art-cambio-chat', title: 'Cambio pedido en el chat', history: [made], artifacts: code,
    request: 'al gráfico del pipeline agrégale un filtro por empresa',
    origin: 'Plan 12, 3b: «el gráfico del pipeline» es el artefacto del turno anterior, por el historial.',
    checks: [...CORPUS_COMMON_CHECKS,
      { label: 'edita el artefacto anterior', test: edited },
      { label: 'la versión nueva se dibuja sin errores', test: drawn }] },
  { id: 'art-arreglar', title: '«Arreglarlo» desde el lienzo', history: [made], artifacts: broken,
    request: coworkArtifactFixMessage(PIPELINE, { message: 'Cannot read properties of undefined (reading \'map\')', line: brokenLine }),
    origin: 'Plan 12, 3b: el error llega a la Diseñadora con el código para que lo corrija en su causa.',
    checks: [...CORPUS_COMMON_CHECKS,
      { label: 'edita el artefacto anterior', test: edited },
      { label: 'la versión nueva se dibuja sin errores', test: drawn },
      { label: 'dice qué falló y cómo quedó', test: r => /error|fall[óo]|corregí|arregl|no exist|ahora (?:lee|usa|toma|muestra)/i.test(r.reply) }] },
];
