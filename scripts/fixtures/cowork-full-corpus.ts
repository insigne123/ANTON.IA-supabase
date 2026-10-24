// The conversation corpus every Cowork evaluation replays (evaluate-cowork-conversations.ts, evaluate-cowork-harness.ts): the production
// conversations first, then the marketing use cases, every button on the Cowork home and the operations of the AXIS package. One place, so
// two runtimes are always measured on the same cases and the same checks.
import { CORPUS as PRODUCTION_CORPUS } from './cowork-conversation-corpus';
import { EDIT_CORPUS, FILE_CORPUS, MARKETING_CORPUS, STARTER_CORPUS } from './cowork-marketing-corpus';
import { AXIS_CORPUS } from './cowork-axis-paquete';
import { AXIS_REST_CORPUS } from './cowork-axis-resto';
import { THREAD_AGENDA_CORPUS, THREAD_CORPUS, THREAD_SEND_AGENDA_CORPUS, THREAD_SEND_CORPUS } from './cowork-thread-corpus';
import { AGENDA_CORPUS } from './cowork-agenda-corpus';
import { REINTENTO_CORPUS } from './cowork-reintento-corpus';
import { WEB_CORPUS } from './cowork-web-corpus';
import { LECTURAS_CORPUS } from './cowork-lecturas-corpus';
import { ICP_CORPUS } from './cowork-icp-corpus';
import { OPPORTUNITIES_CORPUS } from './cowork-opportunities-corpus';
import { TELEFONO_CORPUS } from './cowork-telefono-corpus';
import { BATCH_CORPUS } from './cowork-batch-corpus';
import { USO_REAL_CORPUS } from './cowork-uso-real-corpus';
import { CHAT_CORPUS } from './cowork-chat-corpus';
import { VERSION_CORPUS } from './cowork-version-corpus';
import { ARTIFACT_CORPUS } from './cowork-artifact-corpus';
import { CAMPANA_CORPUS } from './cowork-campana-corpus';
import { PREFERENCIAS_CORPUS } from './cowork-preferencias-corpus';
import { INTEGRAL_CORPUS } from './cowork-integral-corpus';

// Production conversations first, then the marketing use cases (email and LinkedIn),
// every button on the Cowork home and the 44 operations of the AXIS package (axis-*).
export const CORPUS = [...PRODUCTION_CORPUS, ...MARKETING_CORPUS, ...STARTER_CORPUS, ...EDIT_CORPUS, ...FILE_CORPUS, ...AXIS_CORPUS, ...AXIS_REST_CORPUS];

// «¿Qué toca hoy?» (scripts/fixtures/cowork-agenda-corpus.ts).
CORPUS.push(...AGENDA_CORPUS);

// Retrying failed sends (scripts/fixtures/cowork-reintento-corpus.ts).
CORPUS.push(...REINTENTO_CORPUS);
// Onboarding by the company's website (scripts/fixtures/cowork-web-corpus.ts).
CORPUS.push(...WEB_CORPUS);

// The reads that close gaps 6, 7 and 10 of the AXIS bank (scripts/fixtures/cowork-lecturas-corpus.ts).
CORPUS.push(...LECTURAS_CORPUS);
// «¿Cuál es mi ICP?» (scripts/fixtures/cowork-icp-corpus.ts).
CORPUS.push(...ICP_CORPUS);
// «¿Qué licitaciones hay hoy?»: Cowork points to «Oportunidades» (scripts/fixtures/cowork-opportunities-corpus.ts).
CORPUS.push(...OPPORTUNITIES_CORPUS);
// Revealing a phone (scripts/fixtures/cowork-telefono-corpus.ts).
CORPUS.push(...TELEFONO_CORPUS);

// Answering someone who wrote (scripts/fixtures/cowork-thread-corpus.ts): drafting the reply, and, with email.reply_thread on
// (COWORK_REPLY_THREAD_ENABLED; the hilo-enviar-* cases have it on), proposing to send it in the thread.
CORPUS.push(...THREAD_CORPUS, ...THREAD_AGENDA_CORPUS, ...THREAD_SEND_CORPUS, ...THREAD_SEND_AGENDA_CORPUS);

// Several people on LinkedIn with one approval (scripts/fixtures/cowork-batch-corpus.ts): the lote-* cases have the batch on.
CORPUS.push(...BATCH_CORPUS);

// What the owner actually asked between 24 Sep and 5 Oct (Plan 12), on the production world (scripts/fixtures/cowork-uso-real-corpus.ts): ur-*.
CORPUS.push(...USO_REAL_CORPUS);
// Remembering preferences with a card (Plan 12, 5; scripts/fixtures/cowork-preferencias-corpus.ts): pref-*, with preference.save on.
CORPUS.push(...PREFERENCIAS_CORPUS);

CORPUS.push(...ARTIFACT_CORPUS);

CORPUS.push(...CAMPANA_CORPUS);

// Chatting with a colleague (Plan 13; scripts/fixtures/cowork-chat-corpus.ts): general questions, honest disagreement, owning a
// mistake and the one-line heads-up about today: chat-*.
CORPUS.push(...CHAT_CORPUS);

// «Otra versión» and the 👎 (Plan 13; scripts/fixtures/cowork-version-corpus.ts): ver-*. COWORK_EVAL_VERSIONS=off runs them without.
CORPUS.push(...VERSION_CORPUS);
CORPUS.push(...INTEGRAL_CORPUS);
