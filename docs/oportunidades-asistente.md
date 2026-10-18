# Oportunidades: Asistente

La conversación general de Oportunidades (`OPPORTUNITIES_WORKSPACE_ENABLED`), 18 oct 2026. Se organiza como una app de chat: conversaciones a la izquierda, la conversación abierta a la derecha.

## Qué hace

- La vista «Asistente» está junto a «Embudo», «Lista» y «Demanda futura» para administradores, y junto a «Mis oportunidades» para el resto.
- Cada persona tiene sus propias conversaciones (`opportunity_assistant_threads`), privadas como el chat de cada oportunidad. La primera pregunta da el nombre.
- «Por licitación» lista las oportunidades donde la persona ya conversó con su chat (`opportunity_chat_messages`), si todavía puede abrirlas.
- Una respuesta trae:
  - el texto en markdown;
  - hasta 6 tarjetas de oportunidades con «Abrir»;
  - hasta 3 preguntas para seguir.
- Cuando la pregunta es sobre una oportunidad y necesita sus documentos (requisitos, garantías, cómo postular), la respuesta ofrece «Seguir en la conversación de esta licitación». El botón abre la oportunidad, pasa a su chat y hace allí la pregunta reformulada. El chat de la oportunidad es el que lee las bases y cita los fragmentos.

## Qué lee la IA

`workspace-assistant.ts` arma el contexto con los mismos permisos que la página (`opportunity_workspace_list` con el usuario que pregunta). Lee hasta 60 oportunidades:

- las que contienen las palabras de la pregunta (`assistantKeywords`: sin palabras comunes, hasta 4);
- las recomendadas;
- las asignadas, solo para administradores;
- el resto, hasta completar el cupo.

Cada oportunidad lleva tipo, título, comprador, cierre en hora de Chile, monto, estado del trabajo, evaluación y el primer motivo. Van primero las abiertas, ordenadas por cierre.

Los administradores también tienen la «Demanda futura»: las líneas del Plan Anual de Compras del último año leído, primero las de los meses que vienen (30) y luego las más grandes (10).

Además se leen la oferta y los servicios del workspace, y los últimos 6 turnos de la conversación.

El modelo (rol `chat`, Haiku) responde con `assistantAnswerSchema`. Las reglas de `resolveAssistantAnswer`:

- quedan solo las tarjetas cuyo id estaba en la lista, una vez cada una, con título y comprador tomados de los datos y no del modelo;
- el traspaso se acepta solo hacia una oportunidad de la lista.

## Trabajo y costo

Cada pregunta es un trabajo `assistant`, con la llave `assistant:{usuario}:{requestId}`, la misma clave que la pregunta guardada. La ruta lo responde en la misma petición con `runQueuedOpportunityJobNow`. Si un worker ya lo tomó, la página consulta la conversación cada 4 s.

Un trabajo `assistant` no tiene oportunidad, así que `opportunity_claim_job` lo toma también cuando quien pregunta no administra, y con la misma prioridad que el chat.

Hace una llamada por pregunta, en la categoría `chat` del presupuesto mensual (US$20), con salida de hasta 3.000 tokens.

Si el presupuesto se agota o la llamada falla, la conversación muestra el motivo y «Intentar de nuevo».

## API

- `GET /api/commercial-opportunities/assistant` devuelve `{ available, threads, opportunities }`. `available` es false antes de la migración.
- `POST /api/commercial-opportunities/assistant` acepta dos acciones:
  - `{ action: 'ask', question, requestId, threadId? }` devuelve `{ threadId, answered, state }`;
  - `{ action: 'delete', threadId }`.
- `GET /api/commercial-opportunities/assistant/{threadId}` devuelve `{ thread, messages }`. Un mensaje sin respuesta trae `job: { state, error }`.

## Migraciones

Una a la vez, en este orden:

1. `20261018130000_opportunity_jobs_assistant.sql`: agrega el tipo `assistant` a `opportunity_jobs` y hace que `opportunity_claim_job` tome las respuestas del asistente de quien no administra.
2. `20261018131000_opportunity_assistant.sql`: crea las tablas `opportunity_assistant_threads` y `opportunity_assistant_messages`, solo para `service_role` y con RLS activo.

## Validación

Las pruebas unitarias no usan red:

- palabras de búsqueda, nombre de la conversación, ficha de cada oportunidad en hora de Chile, prompt y filtro de tarjetas y traspaso;
- con base y modelo en memoria: hilo y trabajo, permisos de la lista, orden, conversación previa, demanda solo para administradores, lista lateral, motivo de un trabajo detenido y borrado;
- vistas renderizadas: vacía por rol, respuesta con tarjetas y traspaso, espera, error con reintento y lista lateral.

La prueba pgTAP `opportunity_assistant.test.sql` revisa RLS, permisos, límites, el tipo de trabajo, el reclamo del trabajo de un integrante y el borrado en cascada.
