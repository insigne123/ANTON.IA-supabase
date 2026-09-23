# Etapa 6 · Detección y seguimiento de respuestas — cierre

Fecha: 23 de septiembre de 2026. Migración `20260923020000_reply_detection_stage6` aplicada y verificada en producción (`yfdelflsheurzaicwayi`).

Regla de cierre aplicada: cada función quedó conectada al agente (4 lecturas nuevas en el catálogo Cowork), respeta el alcance del usuario (org + buzón propio, sin IDs inventados) y produce un resultado comprobable (cobertura declarada, cadena con identificadores). Código existente o prueba simulada no cuentan: por eso cada punto abajo cita su prueba.

## 6.1 Rebotes y bloqueos accionables desde chat — cerrada

- Lectura `replies.attention`: rebotes duros/blandos, respuestas sin clasificar y automáticas (informativas) con acción recomendada por ítem (`do_not_contact_fix_email`, `retry_later`, `review_deliverability`, `classify_reply`, `info_only`).
- Pruebas: `src/lib/server/cowork/reply-reads.test.ts` (separación por grupos, errores genéricos).

## 6.2 Humano vs automática — cerrada

- Detección determinista por cabeceras del proveedor (`Auto-Submitted`, `X-Auto-Response-Suppress`, `Precedence`, `X-Autoreply`, `X-MS-Exchange-Autoresponse`) en `src/lib/reply-autoresponse.ts`; el remitente solo nunca decide.
- La ingesta (`recordInboundReply`) clasifica `auto_reply` sin llamar al modelo cuando hay prueba de cabeceras: la automática nunca infla el conteo humano y se ahorra el costo del modelo.
- `metrics.overview` ahora reporta `repliesThisWeek` solo humano + `autoRepliesThisWeek` + `bouncesThisWeek` separados.
- Aceptación con mensajes reales: corpus de plantillas genuinas (OOO de Outlook, vacaciones en español, respuesta automatizada, mailer daemon) y contraejemplos humanos cortos en `src/lib/reply-autoresponse.test.ts`. No es buzón real: la verificación contra el buzón conectado queda pendiente del recorrido autenticado.
- Pruebas: 6 tests de autorespuesta + métricas con filtro `not reply_intent in (auto_reply,delivery_failure)`.

## 6.3 Barrido del historial — cerrada

- Tabla `cowork_mailbox_sweep_state` (RLS solo `service_role`, verificada en prod) con cursor durable: pageToken de Gmail o nextLink de Graph, ambos generados por el servidor.
- `sweepMailboxForOwner` (`src/lib/server/mailbox-sweep.ts`): páginas de 50 metadatos, 2 páginas y 5 contactos por tick; el descubrimiento alimenta el pipeline verificado por hilo (`syncSingleContactRow`, extraído sin cambiar su semántica). Política pura `mailboxSweepDue`: reanuda cursor fresco, reinicia cursor rancio (>24 h), repite ventana cada 12 h.
- Conectado al cron `reply-sync` sin poder romper el tick (try/catch por buzón, resumen `sweepPages`/`sweepSynced`).
- Cobertura real en `contacted.search`, `contacted.timeline` y las 4 lecturas nuevas: `mailboxCoverage` por buzón + `mailboxSyncedAt`. Sin tabla (migración rezagada) degrada a cobertura desconocida, nunca a cobertura afirmada.
- Pruebas: política (5 casos), PGlite (tabla, RLS, PK). El primer barrido real corre con el despliegue; `last_completed_at` vacío hasta entonces, declarado como tal.

## 6.4 Interesados nunca seguidos — cerrada

- Lectura `replies.stalled`: interés humano (`positive`, `meeting_request`) sin envío posterior ni compromiso abierto tras 48 h, ordenado por antigüedad, con `daysWaiting` y cobertura.
- Pruebas: selector puro (7 casos borde: outbound posterior, compromiso abierto, automática, negativa, <48 h, sin fecha) + lector con mock.

## 6.5 Estado de cuenta — cerrada

- Lectura `contacted.account` (UUID de contacto): expande a todos los hilos/personas con empresa normalizada exacta (nunca difusa), con responsables, últimos eventos y conflictos explícitos (`multiple_owners`, `do_not_contact_present`, `mixed_replied_pending`). Índice `contacted_leads_org_company_idx` verificado en prod.
- Pruebas: agrupación exacta, conflictos, lector con mock.

## 6.6 Cadena hasta la reunión — cerrada

- `update_contacted_work` acepta `origin` opcional validado (`replyEventKey`, `threadKey`, `derivedAt`, `derivedBy`); la ruta `work` lo fija server-side desde `lead_responses` al crear un compromiso sobre una respuesta observada. Sin evento coincidente, el compromiso queda sin origen (cadena parcial honesta).
- Lectura `replies.meeting_chain`: eslabones envío→respuestas→compromiso→confirmación, cada uno con id y fecha; veredicto `complete` solo con origen verificado de punta a punta.
- Pruebas: PGlite (origen válido/inválido/legado), cadena completa/parcial/sin verificar. Fallo real encontrado y corregido en el camino: `"unverified_origin".includes("verified_origin")` era `true`; el comparador ahora es de igualdad exacta.

## Verificación ejecutada

- PGlite aislado: `scripts/test-reply-stage6-migrations.mjs` PASS.
- Unit: autorespuesta (6), seguimiento/cuenta/cadena (5), lecturas (7), política sweep (1) + regresiones reply-sync, extended-reads, parallel-reads, read-plan, capabilities, axis-replay — todas en verde.
- `typecheck` limpio, `next build` OK (solo aviso preexistente `<img>`).
- Prod: tabla con RLS, índice, función con validación de origen, `contacted_leads` intacta (694 filas), sweep en 0 filas (a la espera del despliegue).

## Límites declarados (no cerrados aquí)

- Aceptación autenticada con el buzón real y recorrido de chat desplegado: pendiente de despliegue + sesión del usuario.
- `findOutlookReply`/`findGmailReply` (ruta de un solo mensaje) no siempre trae cabeceras: sin cabeceras rige el clasificador habitual, nunca una afirmación falsa de humanidad.
- Ventana de envíos del barrido: 180 días hacia atrás; respuestas a envíos más antiguos las sigue cubriendo el tick por fila.
