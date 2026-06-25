# SUPL.IA Gmail Analyst Plan

## Objetivo

Implementar un subagente especializado en Gmail para SUPL.IA capaz de buscar, leer y analizar correos del usuario con aprobacion humana, minimizacion de datos y trazabilidad completa.

Caso objetivo inicial:

Usuario: "Quiero que me digas todos los leads a los que he contactado con mi mail por el tema de Axis".

Resultado esperado:

- SUPL.IA entiende que necesita revisar Gmail.
- Prepara una busqueda segura y limitada.
- Pide aprobacion simple antes de leer Gmail.
- Busca mensajes enviados relacionados con Axis.
- Extrae destinatarios, asuntos, fechas, thread ids y evidencia minima.
- Cruza los contactos con CRM, contacted leads y datos internos.
- Devuelve un resumen accionable con artifact trazable.
- No envia correos.
- No modifica CRM sin aprobacion separada.
- No guarda cuerpos completos por defecto.

## Alcance V1

Solo Gmail.

No implementar Outlook en esta fase.

No implementar envio desde este subagente. El envio ya existe como `email.send` y sigue bajo approvals actuales.

No leer attachments.

No guardar cuerpos completos de emails por defecto.

No hacer acciones CRM automaticamente.

## Base Existente

El repo ya tiene piezas utiles:

- OAuth Google en `src/app/(app)/gmail/page.tsx`.
- Scope actual incluye `https://www.googleapis.com/auth/gmail.readonly` y `https://www.googleapis.com/auth/gmail.send`.
- Refresh tokens guardados en `provider_tokens` mediante `tokenService`.
- Refresh token helper en `src/lib/server-auth-helpers.ts`.
- Lectura parcial de Gmail para replies en `src/lib/server/reply-sync.ts`.
- SUPL.IA ya tiene tools, pending actions, approvals, jobs, artifacts, tool runs, leases, memoria y observabilidad.
- SUPL.IA ya puede ejecutar acciones aprobadas desde `src/app/api/suplia/actions/[actionId]/approve/route.ts`.

## Nombre Del Subagente

Nombre recomendado: `gmail-analyst`.

Rol:

- Interpretar pedidos del usuario relacionados con Gmail.
- Traducir lenguaje natural a queries Gmail seguras.
- Preparar acciones aprobables antes de leer mailbox.
- Ejecutar busquedas Gmail limitadas.
- Leer metadata, snippets y threads cuando sea necesario.
- Extraer contactos y leads desde mensajes reales.
- Cruzar resultados con CRM/contacted/campaigns.
- Resumir hallazgos sin inventar datos.
- Mantener privacidad, minimizacion y trazabilidad.

## Guardrails

- Toda lectura Gmail iniciada por SUPL.IA requiere aprobacion simple.
- `gmail.profile.get` puede correr sin aprobacion porque solo valida conexion y cuenta.
- `gmail.search_messages`, `gmail.get_message`, `gmail.get_thread` y herramientas high-level de mailbox requieren aprobacion simple.
- No usar cuerpo completo por defecto.
- Body completo solo si `includeBody` fue aprobado explicitamente.
- No guardar body completo en artifacts por defecto.
- Guardar snippets truncados a 300 caracteres.
- Si se incluye body, truncar a 2,000 caracteres por mensaje en output.
- Max resultados por defecto: 25.
- Max resultados inicial absoluto: 100.
- Fecha por defecto: ultimos 12 meses si el usuario no especifica rango.
- No buscar en spam/trash salvo instruccion explicita del usuario.
- No leer attachments en V1.
- No modificar CRM/contacted/campaigns desde este subagente sin tool aprobada separada.
- No enviar respuestas ni follow-ups desde este subagente.
- Registrar cada busqueda como `suplia_tool_runs`.
- Dejar evidencia minima: query, maxResults, includeBody, message ids, thread ids, fechas y asunto.

## Policies A Agregar

Agregar en `src/lib/server/suplia-policy.ts`:

- `gmail.profile.get`
  - riskLevel: `low`
  - requiresApproval: `false`
  - approvalKind: `none`
  - razon: lectura de estado de conexion Gmail.

- `gmail.search_messages`
  - riskLevel: `medium`
  - requiresApproval: `true`
  - approvalKind: `simple`
  - razon: lee metadata/snippets del mailbox privado.

- `gmail.get_message`
  - riskLevel: `medium`
  - requiresApproval: `true`
  - approvalKind: `simple`
  - razon: lee un mensaje privado.

- `gmail.get_thread`
  - riskLevel: `medium`
  - requiresApproval: `true`
  - approvalKind: `simple`
  - razon: lee un hilo privado.

- `gmail.search_threads`
  - riskLevel: `medium`
  - requiresApproval: `true`
  - approvalKind: `simple`
  - razon: agrupa y lee metadata/snippets de hilos privados.

- `gmail.find_contacted_leads`
  - riskLevel: `medium`
  - requiresApproval: `true`
  - approvalKind: `simple`
  - razon: busca en Gmail para identificar personas contactadas.

- `gmail.match_crm`
  - riskLevel: `low`
  - requiresApproval: `false`
  - approvalKind: `none`
  - razon: cruce interno con CRM/contactados despues de obtener resultados.

- `gmail.summarize_results`
  - riskLevel: `low`
  - requiresApproval: `false`
  - approvalKind: `none`
  - razon: resumen interno de resultados ya obtenidos.

## Tools A Agregar

### `gmail.profile.get`

Proposito:

- Confirmar que Gmail esta conectado.
- Obtener email de la cuenta conectada.
- Detectar si el token permite lectura.

Input:

- `{}`

Output:

- `connected: boolean`
- `emailAddress?: string`
- `hasReadonlyScope?: boolean`
- `provider: "gmail"`
- `note?: string`

Errores:

- Gmail no conectado.
- Refresh token invalido.
- Scope insuficiente.

### `gmail.search_messages`

Proposito:

- Buscar mensajes Gmail con query aprobada.

Input:

- `query: string`
- `maxResults?: number`
- `includeBody?: boolean`
- `format?: "metadata" | "full"`
- `pageToken?: string`

Defaults:

- `maxResults: 25`
- `includeBody: false`
- `format: "metadata"`

Max:

- `maxResults: 100`

Output:

- `query`
- `messages`
- `resultCount`
- `nextPageToken?`
- `profileEmail`
- `privacyMode`

Cada message:

- `id`
- `threadId`
- `subject`
- `from`
- `to`
- `cc`
- `bcc`
- `date`
- `internalDate`
- `snippet`
- `bodyText?` solo si `includeBody=true`
- `bodyHtml?` solo si `includeBody=true` y truncado

### `gmail.get_message`

Proposito:

- Leer un mensaje especifico por id.

Input:

- `messageId: string`
- `includeBody?: boolean`

Output:

- Mensaje normalizado.

Guardrail:

- Si `includeBody=true`, output truncado.

### `gmail.get_thread`

Proposito:

- Leer un thread especifico y normalizar participantes.

Input:

- `threadId: string`
- `includeBodies?: boolean`
- `maxMessages?: number`

Output:

- `threadId`
- `messages`
- `participants`
- `firstDate`
- `lastDate`
- `subject`
- `messageCount`

### `gmail.search_threads`

Proposito:

- Buscar mensajes y agruparlos por thread.

Input:

- `query: string`
- `maxResults?: number`
- `includeBodies?: boolean`

Output:

- `threads`
- `threadCount`
- `messageCount`

### `gmail.find_contacted_leads`

Proposito:

- Tool high-level para resolver el caso principal.

Input:

- `topic: string`
- `query?: string`
- `after?: string`
- `before?: string`
- `newerThan?: string`
- `maxResults?: number`
- `includeBody?: boolean`
- `sentOnly?: boolean`

Defaults:

- `sentOnly: true`
- `newerThan: "12m"`
- `maxResults: 50`
- `includeBody: false`

Query generada por defecto:

- `in:sent newer_than:12m Axis`

Output:

- `query`
- `contacts`
- `messagesScanned`
- `threadsScanned`
- `duplicatesRemoved`
- `crmMatches`
- `summary`

Cada contact:

- `email`
- `name?`
- `company?`
- `lastSubject`
- `lastContactedAt`
- `messageIds`
- `threadIds`
- `evidenceSnippets`
- `matchedLeadId?`
- `matchedContactedId?`
- `crmStatus?`
- `source: "gmail"`

### `gmail.match_crm`

Proposito:

- Cruce interno de contactos extraidos con CRM/contacted.

Input:

- `contacts: object[]`

Output:

- `matchedContacts`
- `unmatchedContacts`
- `summary`

Busca en:

- `leads`
- `contacted_leads`
- `unified_crm_data`

### `gmail.summarize_results`

Proposito:

- Convertir resultados en resumen final y artifact.

Input:

- `contacts`
- `topic`
- `query`

Output:

- `summaryText`
- `topContacts`
- `recommendedNextActions`
- `artifactData`

## Modulo Server Nuevo

Crear:

`src/lib/server/gmail-mailbox.ts`

Responsabilidades:

- Refrescar token Gmail.
- Obtener perfil Gmail.
- Buscar mensajes.
- Leer mensaje.
- Leer thread.
- Parsear headers.
- Decodificar base64url.
- Extraer cuerpos de texto/html.
- Normalizar participantes.
- Construir query segura.
- Truncar snippets/body.
- Evitar guardar datos sensibles completos.

Funciones recomendadas:

- `getGmailMailboxAccessToken(auth)`
- `getGmailMailboxProfile(accessToken)`
- `searchGmailMailboxMessages(accessToken, input)`
- `fetchGmailMailboxMessage(accessToken, messageId, options)`
- `fetchGmailMailboxThread(accessToken, threadId, options)`
- `parseGmailMailboxMessage(message, options)`
- `extractGmailMailboxParticipants(message)`
- `buildGmailMailboxQuery(input)`
- `extractEmailAddresses(value)`
- `truncateMailboxText(value, limit)`

Reutilizar o mover logica existente desde `reply-sync.ts` cuando convenga:

- `decodeBase64Url`
- `extractGmailBodies`
- `getHeader`
- parsing de thread/message

## Query Builder

Crear helper puro testeable:

`src/lib/gmail-query-builder.ts` o dentro de `src/lib/server/gmail-mailbox.ts` si se mantiene simple.

Inputs:

- `topic`
- `sentOnly`
- `after`
- `before`
- `newerThan`
- `from`
- `to`
- `subject`

Reglas:

- Si `sentOnly=true`, agregar `in:sent`.
- Si `newerThan` existe, agregar `newer_than:<value>`.
- Si `after` existe, agregar `after:YYYY/MM/DD`.
- Si `before` existe, agregar `before:YYYY/MM/DD`.
- Si `topic` contiene espacios, usar comillas.
- Sanitizar caracteres de query peligrosos.
- Max longitud query: 400 caracteres.

Ejemplos:

- Topic `Axis`: `in:sent newer_than:12m Axis`
- Topic `Axis software`: `in:sent newer_than:12m "Axis software"`
- Topic y fecha: `in:sent after:2026/01/01 "Axis"`

## Integracion Con SUPL.IA Tools

Editar:

`src/lib/server/suplia-tools.ts`

Agregar imports del modulo Gmail.

Agregar handlers:

- `getGmailProfile`
- `searchGmailMessages`
- `getGmailMessage`
- `getGmailThread`
- `searchGmailThreads`
- `findGmailContactedLeads`
- `matchGmailContactsToCrm`
- `summarizeGmailResults`

Registrar tools en `SUPLIA_TOOLS`.

## Integracion Con Subagentes

Editar:

`src/lib/server/suplia-agent-registry.ts`

Agregar tipo:

- `gmail-analyst`

Agregar definicion:

- modelTier: `orchestrator` o `reasoning`.
- Recomendacion: `orchestrator` para v1.

Handler `runGmailAnalyst`:

- Detecta objetivo y tema.
- Construye query segura.
- Si el step es approval, devuelve pending action `gmail.find_contacted_leads`.
- Si ya hay resultados, genera resumen/artifact.

Output esperado:

- `queryPlan`
- `topic`
- `searchScope`
- `maxResults`
- `privacyMode`
- `requiresApproval: true`

Pending action:

- `actionType: "gmail.find_contacted_leads"`
- `title: "Buscar en Gmail contactos sobre <topic>"`
- `description: "SUPL.IA buscara en mensajes enviados de Gmail. No enviara correos ni modificara CRM."`
- payload con query y limites.

## Integracion Con Jobs

Editar:

`src/lib/server/suplia-job-runner.ts`

Agregar deteccion de mensajes Gmail en `shouldCreateSupliaJobFromMessage`:

- `gmail`
- `mail`
- `correo`
- `bandeja`
- `enviados`
- `inbox`
- `hilos`
- `mensajes`
- `a quienes contacte`
- `a quien contacte`
- `leads que contacte`
- `por el tema`
- `sobre`

Crear job type:

- `gmail_mailbox_analysis`

Steps iniciales para job Gmail:

- step 1: `gmail_analysis_plan`, agent `gmail-analyst`, no approval.
- step 2: `gmail_search_approval`, agent `gmail-analyst`, requires approval.

Opcion pragmatica V1:

- Reutilizar el job inicial existente pero si el mensaje es Gmail, crear steps Gmail en lugar de prospeccion.

Recomendacion:

- Crear `GMAIL_JOB_STEP_DEFINITIONS` separado.
- En `createSupliaJobFromMessage`, elegir definiciones segun intent.

## Integracion Con Approval Endpoint

Editar:

`src/app/api/suplia/actions/[actionId]/approve/route.ts`

Agregar supported actions:

- `gmail.search_messages`
- `gmail.get_message`
- `gmail.get_thread`
- `gmail.search_threads`
- `gmail.find_contacted_leads`

Agregar `successMessage`:

- Para `gmail.find_contacted_leads`: "Listo. Encontre X contacto(s) relacionados con <topic> en Gmail. No se envio nada."

Agregar `artifactForResult`:

- type: `lead_list` o nuevo `mailbox_contact_list`.
- title: `Contactos Gmail encontrados (<count>)`.
- content con lista breve.
- data completa con metadata permitida.

## Artifact Types

Editar:

`src/lib/suplia/types.ts`

Agregar si se quiere especificidad:

- `mailbox_search`
- `mailbox_contact_list`
- `gmail_thread_summary`

Alternativa V1:

- Usar `lead_list` y `tool_result` para no tocar UI.

Recomendacion:

- Agregar `mailbox_contact_list`.

## Modelo De Datos Opcional

Para V1 no es obligatorio crear tabla nueva. Tool runs y artifacts bastan.

Si se quiere trazabilidad mas fuerte, crear migracion:

`supabase/migrations/<date>_suplia_gmail_mailbox_searches.sql`

Tabla `suplia_gmail_mailbox_searches`:

- `id uuid primary key`
- `organization_id uuid`
- `user_id uuid`
- `conversation_id uuid`
- `job_id uuid`
- `tool_run_id uuid`
- `query text`
- `topic text`
- `max_results integer`
- `include_body boolean`
- `result_count integer`
- `thread_count integer`
- `metadata jsonb`
- `created_at timestamptz`

No guardar body completo en esta tabla.

Recomendacion:

- V1 sin tabla nueva.
- Si despues se requiere historial consultable, agregar tabla.

## Leases Y Rate Limits

Extender `src/lib/suplia/tool-limits.ts`.

Agregar lease policies:

- `gmail.search_messages`: `gmail:read`, max 1 por org.
- `gmail.get_message`: `gmail:read`, max 2 por org.
- `gmail.get_thread`: `gmail:read`, max 2 por org.
- `gmail.search_threads`: `gmail:read`, max 1 por org.
- `gmail.find_contacted_leads`: `gmail:read`, max 1 por org.

Env vars:

- `SUPLIA_GMAIL_READ_CONCURRENCY_PER_ORG`
- `SUPLIA_GMAIL_READ_MAX_RESULTS`

## Privacidad Y Seguridad

Minimizacion:

- Metadata primero.
- Snippet corto.
- Body solo bajo `includeBody=true` aprobado.
- No attachments.
- No guardar raw Gmail payload.

Output seguro:

- No incluir auth tokens.
- No incluir raw headers completos si no aportan.
- No incluir BCC salvo que sea necesario para identificar contacto en enviados.
- Truncar todo texto largo.

Consentimiento:

- La pending action debe explicar query, rango, max results e include body.
- El usuario debe aprobar antes de buscar.

## Prompt Del Subagente

Instrucciones base para `gmail-analyst`:

- Eres el subagente Gmail de SUPL.IA.
- Tu tarea es convertir pedidos sobre Gmail en busquedas seguras, limitadas y aprobables.
- No leas Gmail sin aprobacion.
- No envies correos.
- No modifiques CRM.
- No inventes contactos ni empresas.
- Si falta tema, pregunta una aclaracion breve.
- Si el usuario pide "a quienes contacte", prioriza `in:sent`.
- Si el usuario pide respuestas recibidas, prioriza inbox/from y threads.
- Por defecto usa metadata/snippet, no body completo.
- Devuelve query, limites y motivo.

## Flujo Principal V1

Pedido:

"Dime todos los leads a los que contacte con mi mail por el tema Axis"

Flujo:

1. SUPL.IA crea job `gmail_mailbox_analysis`.
2. `gmail-analyst` identifica tema `Axis` y scope `sent`.
3. `gmail-analyst` prepara pending action `gmail.find_contacted_leads`.
4. Usuario aprueba.
5. Tool refresca token Gmail.
6. Tool ejecuta query `in:sent newer_than:12m Axis`.
7. Tool lee metadata/snippets de resultados.
8. Tool extrae destinatarios de `To`, `Cc`, opcionalmente `Bcc`.
9. Tool agrupa por email y thread.
10. Tool cruza con `leads`, `contacted_leads`, `unified_crm_data`.
11. Tool devuelve contacts y summary.
12. Approval endpoint crea artifact.
13. SUPL.IA responde con resumen y evidencia minima.

## Estructura Del Resultado

Resumen esperado:

- "Encontre 18 contactos en Gmail relacionados con Axis en mensajes enviados de los ultimos 12 meses. 11 ya existen en CRM, 6 aparecen en contacted_leads y 7 no estan guardados. No envie nada ni modifique datos."

Tabla/artifact:

- Nombre
- Email
- Empresa detectada
- Ultimo asunto
- Ultima fecha
- Thread count
- Match CRM
- Match contacted
- Evidencia breve

## Manejo De Errores

Gmail no conectado:

- Responder que el usuario debe conectar Gmail.
- No crear busqueda.

Scope insuficiente:

- Pedir reconectar Gmail para actualizar permisos.

Refresh token invalido:

- Marcar tool failed.
- Indicar reconexion.

Gmail rate limit:

- Usar runtime error `deferred` o `rate_limited`.
- Reprogramar step con backoff.

Query sin resultados:

- Devolver artifact vacio claro.
- Sugerir ampliar rango o cambiar keywords.

Demasiados resultados:

- Respetar maxResults.
- Indicar truncado.
- Sugerir refinar busqueda.

Cancelacion:

- Revisar `context.assertRunnable` entre fetches.
- Conservar resultados parciales ya procesados.

## Tests Unitarios

Agregar tests:

- `gmail-query-builder.test.ts`
  - construye `in:sent newer_than:12m Axis`.
  - quotea temas con espacios.
  - respeta `after` y `before`.
  - limita longitud de query.

- `gmail-mailbox.test.ts`
  - parsea headers.
  - extrae emails de `To`, `Cc`, `Bcc`, `From`.
  - decodifica base64url.
  - trunca snippet/body.
  - no incluye body por defecto.

- `suplia-policy.test.ts`
  - tools Gmail read requieren approval simple.
  - profile get no requiere approval.

- `tool-limits.test.ts`
  - tools Gmail usan lease `gmail:read`.

- `gmail-contact-extraction.test.ts`
  - dedupe por email.
  - agrupa por thread.
  - conserva ultima fecha.

## Tests De Integracion Mock

Agregar tests con fetch mock o handlers simulados:

- Gmail profile conectado.
- Search devuelve mensajes fake.
- Fetch message normaliza headers.
- `gmail.find_contacted_leads` extrae contactos.
- `gmail.match_crm` cruza emails con filas mock.
- Approval endpoint soporta `gmail.find_contacted_leads`.
- Cancelacion durante lote corta procesamiento.

## Validacion Manual

Checklist:

- Reconectar Gmail y confirmar scope readonly.
- Preguntar a SUPL.IA: "Dime todos los leads a los que contacte por Axis".
- Confirmar que crea pending action antes de leer Gmail.
- Aprobar.
- Confirmar que no envia nada.
- Confirmar artifact con resultados.
- Confirmar tool run con query y limites.
- Confirmar que no guarda body completo.
- Probar sin Gmail conectado.
- Probar query sin resultados.
- Probar maxResults bajo.
- Probar cancelacion de job durante lectura.

## Orden De Implementacion

1. Crear helpers puros de Gmail query y parsing.
2. Crear `src/lib/server/gmail-mailbox.ts`.
3. Agregar policies Gmail.
4. Agregar lease policy Gmail read.
5. Agregar tools Gmail en `suplia-tools.ts`.
6. Agregar supported actions en approval endpoint.
7. Agregar subagente `gmail-analyst`.
8. Agregar job type/steps Gmail en runner.
9. Agregar artifact type opcional.
10. Agregar tests unitarios.
11. Agregar tests mock de integracion.
12. Ejecutar `npm run typecheck`.
13. Ejecutar `npm run lint`.
14. Ejecutar `npm test`.
15. Ejecutar `npm run build`.
16. Probar con Gmail real conectado.

## Definition Of Done

El subagente se considera terminado cuando:

- Puede responder el caso Axis end-to-end.
- No lee Gmail sin aprobacion.
- No envia emails.
- No modifica CRM.
- Extrae contactos desde enviados.
- Cruza contactos con CRM/contacted.
- Devuelve artifact trazable.
- Respeta max results y rango temporal.
- No guarda body completo por defecto.
- Maneja Gmail no conectado.
- Maneja scope insuficiente.
- Maneja rate limits con reprogramacion.
- Typecheck pasa.
- Lint pasa.
- Tests pasan.
- Build pasa.

## Futuras Extensiones Fuera De V1

- Outlook con la misma interfaz provider-agnostic.
- Lectura de attachments bajo aprobacion fuerte o separada.
- Busqueda semantica sobre mailbox indexado.
- Watch/history API de Gmail para sync incremental.
- Clasificacion avanzada de hilos.
- Crear tareas CRM desde hallazgos, con aprobacion separada.
- Crear campanhas desde leads encontrados, con approvals existentes.
