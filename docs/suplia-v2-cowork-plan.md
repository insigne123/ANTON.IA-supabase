# SUPL.IA v2 — Plan de construcción del copiloto operativo de ANTON.IA

**Fecha:** 10 de septiembre de 2026
**Autor:** análisis sobre el código real del repositorio `ANTON.IA` (rama de trabajo local, `main`)
**Alcance:** la sección conversacional con control operativo sobre la app — chat, herramientas, artefactos, código, subagentes, programación y aprendizaje.
**Proveedor de modelo:** OpenAI (configuración actual de producción: `gpt-5.6-luna` / `terra` / `sol` por tier).

---

## 0. Resumen ejecutivo

El pedido original ("construir una sección nueva que funcione como Claude Cowork, con control absoluto sobre la app") describe un sistema que **ya existe en el repositorio y se llama SUPL.IA**. No es un prototipo abandonado: es la superficie más grande del proyecto después del pipeline de campañas.

Lo verificado leyendo el código:

| Pieza | Dónde vive | Tamaño |
|---|---|---|
| Catálogo de herramientas | `src/lib/server/suplia-tools.ts` | 110 KB, 77 herramientas |
| Registro de subagentes | `src/lib/server/suplia-agent-registry.ts` | 49 KB, 15 agentes |
| Motor de jobs multiagente | `src/lib/server/suplia-job-runner.ts` | 55 KB |
| Orquestador de turno | `src/lib/server/suplia-orchestrator.ts` | 42 KB |
| Políticas de riesgo y aprobación | `src/lib/server/suplia-policy.ts` | 16 KB |
| Bandeja de revisión | `src/lib/server/suplia-review-inbox.ts` | 31 KB |
| Workspace (frontend) | `src/components/suplia/SupliaWorkspace.tsx` | 125 KB en un solo archivo |
| Esquema en Supabase | 9 migraciones `*_suplia_*.sql` | conversaciones, mensajes, artifacts + versiones, tool runs, leases, jobs, steps, agent runs, memorias, feedback, review inbox |

Es decir: **la parte difícil ya está construida**. Lo que falta no es arquitectura de fondo, son cuatro brechas concretas que hoy impiden que la experiencia se sienta como Cowork:

1. **No hay loop agéntico.** El modelo recibe un prompt gigante y devuelve un único JSON con `toolRequests`. Si trae herramientas, se ejecutan y se hace **una segunda llamada completa** con `allowToolRequests: false`. Resultado: exactamente **una ronda de herramientas por turno**, imposible encadenar `buscar → leer detalle → decidir → responder`. No se usa `tool_calls` nativo del API en ninguna parte del código (verificado: cero coincidencias de `tool_calls` en `src/`).
2. **El streaming es falso.** `src/app/api/suplia/chat/route.ts` emite cinco fases fijas con `setInterval(…, 1600)` mientras el trabajo real ocurre en paralelo. El texto llega completo al final y el cliente lo anima con un typewriter. `src/ai/openai-json.ts` no tiene `stream: true` en ninguna ruta.
3. **No ejecuta código.** Todo lo que el usuario pide como "genérame el Excel", "hazme el gráfico", "cruza estos dos CSV" hoy sólo puede salir de herramientas precocinadas. No hay sandbox, no hay intérprete, no hay generación de archivos arbitrarios.
4. **No hay skills ni adaptabilidad real.** El comportamiento está congelado en un prompt de ~80 líneas dentro de `suplia-brain.ts`. No se puede enseñar un playbook nuevo sin desplegar código.

Este documento describe cómo cerrar esas cuatro brechas **sin tocar la capa de seguridad**, que es el activo más valioso del sistema y la única razón por la que "control absoluto sobre la app" no termina en un incidente de datos.

**Anti-objetivo declarado:** no se construye una sección nueva en paralelo. Construir SUPL.IA v2 al lado de SUPL.IA v1 duplicaría 77 herramientas, 15 agentes y 9 migraciones, y garantizaría que las dos versiones diverjan. El plan es una migración por feature flag sobre el mismo esquema.

---

## 1. Qué significa exactamente "como Claude Cowork y como OpenCode"

Conviene descomponer la aspiración en capacidades verificables, porque "que sea poderoso y adaptable" no es un criterio de aceptación.

**De Cowork:**

- El modelo decide sólo qué herramientas usar y en qué orden, encadenando tantas como necesite.
- El texto aparece token a token desde el primer segundo; el razonamiento se muestra colapsable.
- El resultado importante no queda en el chat: queda como un **artefacto** con identidad propia, versionado, editable y compartible.
- El agente produce archivos reales (xlsx, pdf, png, csv) que el usuario descarga.
- Las acciones sensibles se detienen y piden aprobación con costo e impacto visibles.
- El trabajo largo sobrevive al cierre del navegador.

**De OpenCode:**

- Escribe y ejecuta código como parte de la resolución, no como respuesta final.
- Opera sobre un espacio de trabajo con archivos que persisten dentro de la sesión.
- Su comportamiento se extiende con **skills** en disco (formato `SKILL.md`), no recompilando.
- Se puede invocar subagentes especializados con su propio contexto.

**Lo que NO se toma de OpenCode:** acceso al repositorio de la app, capacidad de desplegar, o ejecución de código con credenciales de producción. Un agente comercial que puede editar el código de la plataforma que lo hospeda es un vector de escalamiento de privilegios, no una feature. La sección "Seguridad" desarrolla esto.

---

## 2. Estado real del sistema (línea base verificada)

### 2.1 Flujo de un mensaje hoy

```
POST /api/suplia/chat  (stream: true)
  └─ SSE abre y emite fases falsas cada 1600 ms
  └─ processSupliaMessage()                      [suplia-orchestrator.ts]
       ├─ clasifica intent   (regex + LLM tier fast si confianza < 0.8)
       ├─ carga estado completo de conversación desde Supabase
       ├─ compacta contexto si supera SUPLIA_CONTEXT_COMPACT_THRESHOLD_TOKENS (150 000)
       ├─ runSupliaBrain()                        [suplia-brain.ts]
       │    └─ generateStructuredWithTelemetry()  [ai/openai-json.ts]
       │         └─ POST /chat/completions  response_format: json_schema, SIN stream
       ├─ si output.toolRequests.length > 0:
       │    ├─ runSupliaTool() por cada una       [suplia-tool-runner.ts]
       │    └─ runSupliaBrain() otra vez, allowToolRequests: false   ← 2ª generación completa
       ├─ pendingActions → tarjetas de aprobación
       └─ getSupliaState()  → 6 queries, devuelve el estado entero
  └─ send('final', { state })  → el cliente reemplaza todo su estado
```

Coste por turno con herramientas: **dos generaciones completas** del JSON grande, más el catálogo de herramientas serializado (~14 KB) viajando en cada prompt sin cache.

### 2.2 Lo que hay que preservar intacto

Esta capa es correcta y no se toca:

- `suplia-policy.ts` — `riskLevel` (`low|medium|high|critical`) × `approvalKind` (`none|simple|strong`) por herramienta, con `DEFAULT_POLICY` en modo denegar (`requiresApproval: true`, `approvalKind: 'strong'`). Una herramienta nueva sin política declarada es sensible por defecto. Es la decisión de diseño correcta.
- `approval-guards.ts` + `/api/suplia/actions/[actionId]/approve` — confirmación textual fuerte para `email.bulk_send`.
- `suplia-tool-leases.ts` — leases y heartbeats, evita doble ejecución.
- `repairSupliaNoOpOperationalOutput()` en `suplia-brain.ts` — impide que el modelo diga "voy a buscar" sin emitir una operación trazable. Es un parche a la falta de loop agéntico; **cuando exista el loop, deja de ser necesario y debe retirarse**, no mantenerse en paralelo.
- `suplia-safety.ts` — `wrapExternalContent()` envuelve resultados de Gmail y research en delimitadores.
- RLS por `organization_id` en las 9 migraciones `suplia_*` (incluida `20260628090000_suplia_research_cache`, que ya cachea los resultados de research).

### 2.3 Los 15 subagentes existentes

`planner`, `icp-strategist`, `prospector`, `company-scorer`, `lead-scorer`, `enricher`, `copywriter`, `compliance`, `campaign-operator`, `reply-analyst`, `thread-responder`, `gmail-analyst`, `crm-operator`, `memory-agent`, `reporter`.

Cada uno con `modelTier` propio. Se ejecutan dentro de jobs multiagente, **no desde el chat**. Una de las mejoras del plan es exponerlos como herramientas invocables desde el loop.

### 2.4 Las 77 herramientas por familia

`prospecting.*` (9) · `crm.*` (6) · `campaign.*` / `campaigns.*` (10) · `email.*` (4) · `gmail.*` (8) · `research.*` (7) · `replies.*` (3) · `thread.*` (2) · `playbook.*` (6) · `memory.*` (4) · `contacted.*` (2) · `antonia.*` (3) · `followup.*` (2) · `privacy.*` (2) · `compliance.*` (2) · `pipeline.*`, `metrics.*`, `lead.*`, `profile.*`, `app.context.get`, `planner`, `prospector`.

(Suman 77 nombres únicos registrados.) Cobertura funcional: alta. **No hace falta escribir herramientas nuevas de negocio en la Fase 1.** El problema es que el modelo sólo puede usar una ronda de ellas.

---

## 3. Arquitectura objetivo

### 3.1 El loop agéntico (núcleo del cambio)

Reemplazar el protocolo "un JSON gigante por turno" por el uso nativo del API:

```
messages = [ system, ...historial compactado, user ]

loop (máx SUPLIA_AGENTIC_MAX_ITERATIONS, default 8):

  POST /chat/completions {
    model, messages,
    tools: catálogoNativo,          // JSON Schema por herramienta
    tool_choice: 'auto',
    stream: true,
    reasoning_effort: según tier
  }

  por cada chunk:
    delta.content            → SSE 'text.delta'
    delta.tool_calls         → acumular argumentos por índice

  al cerrar el turno del modelo:
    si finish_reason == 'tool_calls':
      por cada tool_call:
        política = getSupliaPolicy(nombre)
        si !política.requiresApproval:
          → runSupliaTool()                        (capa actual, sin cambios)
          → SSE 'tool.started' / 'tool.completed'
          → messages.push({ role:'tool', tool_call_id, content: resultado })
        si política.requiresApproval:
          → recordSupliaToolPendingApproval()      (capa actual, sin cambios)
          → SSE 'approval.requested'
          → messages.push({ role:'tool', tool_call_id,
                            content: 'Requiere aprobación humana. Pendiente: <id>' })
      continuar el loop

    si finish_reason == 'stop':
      persistir mensaje, emitir 'final', salir
```

Cuatro consecuencias directas:

1. **Encadenamiento.** "Revisa el CRM y dime cuál de esos leads abrió el último correo" pasa de imposible a natural: `crm.search` → `contacted.get_timeline` → respuesta.
2. **Una generación por vuelta en vez de dos completas del JSON grande.** Menos tokens de salida por turno con herramientas.
3. **Cache de prefijo.** Con `messages` nativos y el bloque estable (system + tools) al principio, el proveedor cachea el prefijo. Hoy el prompt monolítico cambia en cada llamada y no cachea nada.
4. **El modelo puede pedir aprobación a mitad del razonamiento y seguir trabajando con lo que sí puede hacer**, en vez de terminar el turno.

**Punto crítico de diseño:** las políticas se evalúan **en el servidor sobre el nombre de la herramienta que llegó**, nunca sobre lo que el modelo declara. El modelo no elige si algo necesita aprobación; sólo pide ejecutar algo y el servidor decide. Esto ya funciona así y debe seguir igual.

**Riesgo a controlar:** 77 herramientas declaradas en `tools` es mucho contexto y degrada la precisión de selección. Solución: **catálogo dinámico por fase**. Se declaran ~20-25 herramientas por turno, filtradas por el intent regex existente más las familias mencionadas en la conversación, más un `tools.discover(query)` que permite al modelo pedir explícitamente el resto del catálogo cuando lo necesita. Esto se implementa en `buildNativeToolCatalog()`.

### 3.2 Protocolo de eventos del stream

Reemplazar las fases falsas por eventos semánticos. El plan histórico del repo (`docs/suplia-cowork-implementation-plan.md`) ya los enumeró; se adoptan tal cual, ampliados:

| Evento | Payload | Consumo en UI |
|---|---|---|
| `turn.started` | `{ turnId, at }` | inicializa la burbuja |
| `text.delta` | `{ delta }` | render incremental markdown |
| `thinking.delta` | `{ delta }` | bloque colapsable "Pensó durante Xs" |
| `tool.started` | `{ toolRunId, name, title, input }` | chip discreto en el hilo |
| `tool.completed` | `{ toolRunId, status, summary }` | chip resuelto |
| `approval.requested` | `{ actionId, title, risk, cost, payload }` | tarjeta de aprobación |
| `approval.resolved` | `{ actionId, decision }` | colapsa la tarjeta |
| `artifact.created` | `{ artifactId, type, title }` | abre canvas lateral |
| `artifact.updated` | `{ artifactId, versionId }` | refresca canvas |
| `file.ready` | `{ fileId, name, mime, bytes }` | tarjeta de descarga |
| `job.progress` | `{ jobId, stepKey, status }` | barra de progreso |
| `turn.completed` | `{ turnId, deltas }` | sólo deltas, no estado entero |

**Cambio importante en `turn.completed`:** hoy `getSupliaState()` devuelve el estado completo (hasta 200 mensajes, 30 artifacts, 40 tool runs, memorias y jobs) en cada respuesta, y el cliente lo reemplaza todo. Debe devolver únicamente los ids afectados en el turno. El estado se mantiene por suscripción de Supabase Realtime, no por polling de 4 segundos.

### 3.3 Persistencia del stream y trabajo largo

Firebase App Hosting corre sobre Cloud Run. Una conexión SSE viva está sujeta al timeout de request del servicio (configurable, con un techo de 60 minutos) y a que la instancia no se recicle. Un agente que trabaja 20 minutos no puede depender de que el navegador siga conectado.

Diseño: **el turno es un registro en base de datos, no una conexión.**

- El POST crea una fila en `suplia_turns` (`status: running`) y devuelve el `turnId` de inmediato.
- El loop escribe cada evento en `suplia_turn_events` (append-only) *y* lo emite por SSE si hay alguien escuchando.
- El cliente se reconecta con `GET /api/suplia/turns/{turnId}/events?after={seq}` y recupera lo perdido.
- Si el turno excede el presupuesto de la request (`SUPLIA_TURN_INLINE_BUDGET_MS`, default 90 s), se promueve a job: el resto continúa en el runner de jobs existente (`suplia-job-runner.ts`) y el usuario recibe notificación al terminar.

Esto reutiliza el mecanismo de jobs que ya existe en vez de inventar un worker nuevo.

### 3.4 Herramientas: los tres anillos

El "control absoluto sobre la app" se implementa en anillos con superficie de riesgo creciente. Es la diferencia entre un asistente potente y una brecha de datos.

**Anillo 1 — Lectura tenant-scoped (sin aprobación).**
Todo lo que ya existe como `requiresApproval: false`. Se accede **siempre** a través de los módulos de `src/lib/server/*` con el `AuthContext` del usuario y filtro explícito por `organization_id`, que es el patrón del repo. Nunca con `service_role` libre.

**Anillo 2 — Escritura, créditos y datos privados (aprobación).**
Apollo, enrichment, Gmail, CRM, envíos, campañas, memorias persistentes, misiones ANTONIA. Ya está cubierto.

**Anillo 3 — Nuevo: capacidades genéricas.**
Aquí vive lo que hoy falta:

| Herramienta | Qué hace | Política |
|---|---|---|
| `code.run` | Ejecuta Python/Node en sandbox aislado, sin credenciales | `low` sin aprobación, con límites de tiempo y cuota |
| `files.write` / `files.read` / `files.list` | Espacio de trabajo de la conversación | `low` |
| `files.deliver` | Publica un archivo como descargable para el usuario | `low` |
| `data.query` | SQL **de sólo lectura** sobre una vista blanca tenant-scoped | `medium`, aprobación simple |
| `artifact.create` / `artifact.update` | Artefactos como herramienta, no como campo del JSON | `low` |
| `ask.user` | Pregunta interactiva que corta el loop | `low` |
| `agent.run` | Invoca uno de los 15 subagentes con objetivo propio | `low`, hereda las políticas de sus tools |
| `skill.load` | Carga un `SKILL.md` al contexto | `low` |
| `web.search` / `web.fetch` | Búsqueda y lectura web (Serper, ya configurado) | `low` / `medium` |
| `schedule.create` | Programa un job recurrente | `medium`, aprobación simple |

Sobre `data.query`: es la petición más tentadora ("acceso a las bases de datos") y la más peligrosa. **No se da acceso SQL general.** Se define un esquema `suplia_analytics` con vistas que ya filtran por `organization_id` vía RLS, se ejecuta con un rol de Postgres de sólo lectura sobre ese esquema, con `statement_timeout` y límite de filas. Un agente con SQL arbitrario y `service_role` puede leer los leads de todos los tenants con una consulta mal razonada; con vistas RLS-scoped, físicamente no puede.

### 3.5 Ejecución de código y generación de archivos

Es lo que habilita "genera Excels, PDFs, gráficos, lo que necesite".

Dos caminos posibles:

**Opción A — Code Interpreter de OpenAI (Responses API).** El contenedor lo administra OpenAI, se le suben archivos de entrada, el modelo escribe y ejecuta Python, y los archivos generados vuelven como `container_file_citation` para descargar. Los contenedores expiran a los 20 minutos de inactividad. Ventaja: cero infraestructura. Desventaja: los datos del tenant salen hacia el contenedor de OpenAI, no hay control de red, y obliga a migrar esa ruta a Responses API.

**Opción B — Sandbox propio (E2B / Vercel Sandbox / Daytona / Modal).** MicroVM aislada, controlada por nosotros, con política de red denegar-por-defecto. Cold start entre 0,3 s y 1,6 s según proveedor; facturación por segundo. Vercel Sandbox y Cloudflare facturan CPU activa en vez de reloj de pared, lo cual importa porque un sandbox de agente pasa la mayor parte del tiempo esperando al modelo.

**Recomendación: B, con E2B o Vercel Sandbox.** Razones: (1) el dato que se procesa son leads y correos de terceros bajo la Ley 21.719 chilena, y el registro de tratamiento del repo (`docs/privacy-register-of-processing.md`, `privacy-vendors-and-transfers.md`) ya obliga a declarar cada subencargado y transferencia — un contenedor administrado por el proveedor del modelo es un destinatario más que declarar; (2) con sandbox propio se aplica `allowInternetAccess: false`, que es lo que impide que código generado por un modelo manipulado exfiltre la lista de leads; (3) no obliga a migrar de Chat Completions a Responses API en esta fase.

Contrato del sandbox:

- Un sandbox por conversación, con TTL de 30 minutos de inactividad.
- Red denegada por defecto; sin variables de entorno de la app; sin credenciales de Supabase, Apollo, Gmail ni OpenAI dentro.
- Los datos entran como archivos que **el servidor** deposita tras aplicar RLS. El sandbox nunca consulta la base de datos: recibe un CSV ya filtrado.
- Los archivos generados se suben a Supabase Storage bajo `organization_id/conversation_id/`, y `files.deliver` genera una URL firmada de vida corta.
- Límites: 60 s por ejecución, 512 MB, cuota diaria por organización.

Para xlsx/pdf/docx existe además la opción de generarlos **en el servidor Next** con las librerías que el repo ya tiene (`xlsx` 0.18.5, `jspdf` + `jspdf-autotable`) como herramientas tipadas (`export.xlsx`, `export.pdf`). Es más barato, más rápido y más predecible que pasar por sandbox, y cubre el 80 % de los casos reales ("dame la lista de leads en Excel"). **El sandbox se reserva para lo que no es plantilla:** análisis ad-hoc, cruces de datos, gráficos con matplotlib, transformaciones que el usuario inventa en el momento.

### 3.6 Artefactos como ciudadanos de primera clase

Ya existen (`suplia_artifacts` + `suplia_artifact_versions`, con 22 tipos y versionado). Cambios:

1. **Pasan a ser herramientas** (`artifact.create` / `artifact.update`) en vez de un campo del JSON de salida. Así el modelo puede crear uno a mitad del razonamiento y seguir trabajando, que es exactamente el comportamiento de Cowork.
2. **Renderers tipados en React, no HTML libre.** Los tipos ya declarados (`lead_list`, `company_research`, `campaign_draft`, `email_draft`, `risk_report`, `pipeline_summary`, `icp_strategy`…) tienen componente propio con acciones: copiar, exportar a xlsx/csv/pdf, crear campaña desde aquí, aprobar, editar.
3. **Un tipo nuevo `custom_ui`** para lo que no encaja en ningún tipo: HTML generado, renderizado en `<iframe sandbox="allow-scripts">` con origen distinto y CSP estricta, sin acceso al token de sesión. Esto cubre "que cree artefactos o lo que necesite", con el aislamiento que eso exige.
4. **Exportación real.** Hoy sólo `.md`. Debe salir csv/xlsx para listas y pdf para reportes.

### 3.7 Skills — la adaptabilidad sin desplegar

Adoptar el formato `SKILL.md` (frontmatter `name` + `description`, cuerpo con instrucciones, carpeta con recursos y scripts opcionales), que desde diciembre de 2025 es un estándar abierto publicado en `agentskills.io` y soportado por más de 40 productos incluidos Codex, OpenCode y Copilot. Usar el formato estándar en vez de inventar uno propio significa que las skills que ya existen para otros agentes son reutilizables.

Implementación:

- Tabla `suplia_skills` (la propuso el plan histórico y sigue siendo correcta): `organization_id`, `slug`, `name`, `description`, `body`, `kind` (`prompt|tool|agent`), `enabled`, `created_by`, RLS por `organization_members`.
- **Divulgación progresiva:** en el system prompt sólo viajan `name` + `description` de las skills activas (unas 30 palabras cada una). El cuerpo completo entra al contexto sólo cuando el modelo llama `skill.load(slug)`. Esto es lo que permite tener 50 skills sin inflar el prompt.
- Skills iniciales, derivadas de lo que ya sabe la organización: copy frío Chile, ICP constructoras, investigación de cuenta objetivo, follow-up sin respuesta, brief competitivo, manejo de objeciones. Nótese que el repo ya tiene `playbook.*` como herramientas — las skills son la capa de instrucciones y los playbooks la de datos; conviene que `playbook.apply` sea el mecanismo por el que una skill trae su contenido.

**Guardarraíl obligatorio:** el cuerpo de una skill es texto que un usuario escribió. Se inyecta al contexto como instrucción, y por lo tanto **una skill puede intentar convencer al modelo de saltarse reglas**. Dos defensas: (1) las políticas de aprobación se evalúan en servidor y ninguna instrucción de contexto puede alterarlas; (2) límite de longitud, y auditoría de quién activó qué skill y cuándo.

### 3.8 Memoria

`suplia_memories` ya existe con ciclo `inferred → proposed → approved → rejected → archived` y herramientas `memory.propose/save/search/forget`. Falta:

- Que las memorias aprobadas entren al system prompt de forma compacta (parcialmente hecho en `suplia-context.ts`).
- Un panel donde el usuario vea y edite qué recuerda el sistema. Es requisito de confianza y también de la Ley 21.719 (derecho de acceso y rectificación sobre datos personales que la memoria pueda contener).
- Separar memoria de **organización** (ICP, propuesta de valor, tono) de memoria de **usuario** (preferencias de trabajo). Hoy no está distinguido.

### 3.9 Subagentes desde el chat

Los 15 agentes hoy sólo corren dentro de jobs. Exponerlos como `agent.run(name, goal, context)` permite que el loop delegue: el `reporter` produce un informe con su propio contexto y devuelve sólo el resultado, sin contaminar la ventana del hilo principal. Es el patrón de subagentes de Cowork y el que hace viable el trabajo largo.

Regla: un subagente hereda las políticas de las herramientas que use. No hay escalamiento por delegación.

---

## 4. Decisiones tecnológicas

| Decisión | Opciones evaluadas | Recomendación | Razón |
|---|---|---|---|
| Runtime del loop | (a) implementarlo a mano sobre `fetch`; (b) OpenAI Agents SDK (`@openai/agents`); (c) Vercel AI SDK 6 (`ToolLoopAgent`) | **(a) a mano, con la interfaz inspirada en (b)** | El repo ya tiene su propia capa de tool runs, leases, políticas, aprobaciones y telemetría. Adoptar un framework obliga a mapear todo eso a sus abstracciones o a duplicarlo. El loop en sí son ~200 líneas. |
| — si se prefiere framework | | AI SDK 6, no Agents SDK | AI SDK 6 (dic 2025) trae `ToolLoopAgent`, `needsApproval` por herramienta (encaja con `requiresApproval` existente), streaming tipado a `useChat` y MCP estable. El repo ya es Next/React, es el ajuste natural. Agents SDK está más orientado a Responses API y a handoffs. |
| UI del chat | (a) evolucionar `SupliaWorkspace.tsx`; (b) OpenAI ChatKit; (c) CopilotKit / AG-UI | **(a)** | ChatKit y CopilotKit imponen su propio protocolo de eventos y su modelo de sesión; la UI actual ya tiene la identidad visual del proyecto y las tarjetas de aprobación. De AG-UI se toma **el vocabulario de eventos**, no la dependencia. |
| Sandbox | E2B · Vercel Sandbox · Daytona · Modal · Cloudflare · Code Interpreter de OpenAI | **E2B o Vercel Sandbox** | Ambos con SDK TypeScript de primera clase, cold start sub-2 s, y política de red configurable a denegar-por-defecto — que es el requisito duro. Vercel factura CPU activa (mejor para loops con espera); E2B tiene el ecosistema más maduro para agentes. Decidir con una prueba de una tarde. |
| Streaming del modelo | Chat Completions con `stream: true` · Responses API | **Chat Completions por ahora** | `src/ai/openai-json.ts` ya está construido sobre Chat Completions con fallback por tier y telemetría. Migrar a Responses API es un proyecto aparte; sólo se justifica si se adopta Code Interpreter gestionado. |
| Realtime de estado | polling actual · Supabase Realtime | **Supabase Realtime** | Ya está en el stack. Elimina el `setInterval` de 4 s y el reemplazo completo de estado. |
| Markdown | `renderRichText` casero · react-markdown + remark-gfm + shiki | **react-markdown + remark-gfm + shiki** | El renderer actual no soporta tablas, listas anidadas, blockquotes ni resaltado. El modelo emite markdown más rico del que la UI sabe mostrar. |
| Formato de skills | propio · `SKILL.md` estándar | **`SKILL.md`** | Estándar abierto con adopción amplia; skills portables entre herramientas. |

### 4.1 Repositorios de referencia investigados

| Proyecto | Qué mirar | Qué NO copiar |
|---|---|---|
| [`e2b-dev/fragments`](https://github.com/e2b-dev/fragments) | Plantilla Next.js de artefactos generados por IA con sandbox E2B. Es la referencia más cercana a "el agente crea una UI y se renderiza". Ver cómo aísla la preview. | Su modelo de un sandbox por fragmento, demasiado caro para uso continuo. |
| [`kortix-ai/suna`](https://github.com/kortix-ai/suna) | Agente generalista open source sobre Next.js + Supabase + microVM por sesión, con browser, shell y archivos. Coincide casi exactamente con el stack de ANTON.IA. Ver el diseño de sesión↔sandbox y cómo muestran archivos generados en el hilo. | Su nivel de permisos por defecto; es un agente de propósito general, no multi-tenant comercial. |
| [`sst/opencode`](https://github.com/sst/opencode) | Arquitectura cliente/servidor con SDK y plugins; el modelo de agentes y skills. | Todo lo relativo a operar sobre el repo de código. |
| [`openai/openai-agents-js`](https://github.com/openai/openai-agents-js) | El diseño de `needsApproval` → `RunToolApprovalItem` → `RunState` serializable → reanudar. Es exactamente el patrón que hace falta para que una aprobación sobreviva a la conexión. | La dependencia completa, salvo que se decida adoptar el framework. |
| [`ComposioHQ/open-claude-cowork`](https://github.com/ComposioHQ/open-claude-cowork) | Enfoque de conectores SaaS y brokering de credenciales del lado servidor. | — |
| [`eigent-ai/eigent`](https://github.com/eigent-ai/eigent) | Coordinación multiagente y delegación con roles. Comparar con el registro de 15 agentes ya existente. | — |
| AG-UI (CopilotKit) | El vocabulario de eventos para streaming agente↔UI. | La dependencia; sólo el vocabulario. |

---

## 5. Modelo de datos — migraciones nuevas

Forward-only, una por vez, siguiendo `docs/database.md`. RLS por `organization_id` en todas.

| Migración | Contenido |
|---|---|
| `..._suplia_turns.sql` | `suplia_turns` (`id`, `conversation_id`, `organization_id`, `user_id`, `status`, `mode`, `started_at`, `finished_at`, `error`, `usage`) y `suplia_turn_events` (`turn_id`, `seq`, `type`, `payload`, `created_at`) con índice `(turn_id, seq)`. Append-only. |
| `..._suplia_skills.sql` | `suplia_skills` (`organization_id`, `slug` único por org, `name`, `description`, `body`, `kind`, `enabled`, `created_by`, timestamps) + auditoría de activación. |
| `..._suplia_files.sql` | `suplia_files` (`conversation_id`, `organization_id`, `storage_path`, `name`, `mime`, `bytes`, `origin` `upload|generated`, `created_by`). Bucket de Storage con política por org. |
| `..._suplia_analytics_views.sql` | Esquema `suplia_analytics` con vistas de sólo lectura sobre leads, contactados, campañas y respuestas, cada una con RLS por `organization_id`. Rol Postgres de sólo lectura acotado a ese esquema. |
| `..._suplia_sandbox_sessions.sql` | `suplia_sandbox_sessions` (`conversation_id`, `provider`, `external_id`, `status`, `expires_at`, `cpu_seconds_used`) para cuota y limpieza. |
| `..._suplia_realtime.sql` | Publicación realtime + políticas de lectura sobre `suplia_messages`, `suplia_jobs`, `suplia_job_steps`, `suplia_pending_actions`, `suplia_artifacts`, `suplia_turn_events`. |
| `..._suplia_messages_index.sql` | Índice `(conversation_id, created_at)` si no existe. Hoy `loadConversationMessagesForPrompt` pagina hasta 10 000 mensajes por turno. |

Nota: `suplia_message_feedback` ya existe (`20260707000100_suplia_message_feedback.sql`) y `MessageActions` ya tiene copiar y pulgares cableados. Falta verificar que el rating llegue efectivamente a la tabla y explotarlo como fuente de evals (Fase 6).

---

## 6. Seguridad — lo que hace viable "control absoluto"

El pedido literal es que el sistema tenga control absoluto sobre la app y acceso a todas las bases de datos. Concedido literalmente, eso significa: un modelo influenciable por texto de terceros (correos entrantes, páginas web, respuestas de prospectos) con capacidad de leer y modificar los datos de todos los clientes. Es un incidente esperando fecha.

La versión defendible del mismo objetivo:

**1. Autoridad delegada, no autoridad propia.** El agente actúa siempre con el `AuthContext` del usuario que lo invoca y su `organization_id`. Nunca con `service_role`. Lo que el usuario no puede ver en la UI, el agente tampoco. Esto ya es el patrón del repo (`requireAuth()` + filtro explícito por org) y debe sostenerse en cada herramienta nueva.

**2. Denegar por defecto.** `DEFAULT_POLICY` en `suplia-policy.ts` ya marca como `high`/`strong` toda herramienta sin política declarada. Debe existir un test que falle si una herramienta registrada no tiene entrada explícita en `POLICIES` — hoy el default silencioso protege, pero esconde el olvido.

**3. El modelo no decide su propio nivel de permiso.** La política se resuelve en servidor por nombre de herramienta. Ninguna instrucción del prompt, skill o contenido externo puede cambiarla.

**4. Contenido externo es dato, nunca instrucción.** `wrapExternalContent()` ya existe y `SUPLIA_EXTERNAL_CONTENT_GUARD` está en `true`. Con el loop agéntico, la superficie crece: los resultados de `web.fetch` y de Gmail vuelven al contexto en cada vuelta. Regla: todo resultado de herramienta con contenido de terceros se envuelve, sin excepción, y las herramientas nuevas se marcan en `isExternalContentTool()`.

**5. El sandbox no tiene credenciales ni red.** Ya desarrollado en 3.5. Es la diferencia entre "el agente ejecuta código" y "el agente ejecuta código con acceso a tu base de datos".

**6. SQL sólo sobre vistas.** Desarrollado en 3.4.

**7. Trazabilidad.** Cada tool run ya se persiste con input, output, estado y telemetría de modelo. Con el loop hay que asegurar que **cada vuelta** queda registrada, no sólo el resultado final: si algo sale mal, la pregunta "¿qué hizo exactamente?" tiene que tener respuesta exacta.

**8. Presupuesto por turno.** Máximo de iteraciones, de herramientas auto-ejecutadas, de tokens y de segundos de sandbox. Un loop sin techo es una factura sin techo.

**9. Privacidad.** Toda herramienta que toque datos personales pasa por `privacy.contactability.check` y el registro de tratamiento. Si se adopta un sandbox de terceros, se agrega a `docs/privacy-vendors-and-transfers.md` antes de producción, no después.

---

## 7. Plan de ejecución por fases

Cada fase es desplegable, tiene flag y deja el sistema funcionando. Validación en todas: `npm run typecheck` + `npm run test` en verde, comportamiento legacy intacto con el flag apagado.

### Fase 0 — Preparación (1 semana)

- Instrumentar la línea base: tiempo hasta primer token, tokens por turno, turnos que requieren repregunta. Sin métricas previas no hay forma de demostrar la mejora.
- Test que falle si una herramienta registrada no tiene política explícita.
- Índice `(conversation_id, created_at)` en `suplia_messages`. La carga de contexto ya está acotada (`PROMPT_MESSAGES_HARD_LIMIT = 400` tras la primera compactación), pero **la primera compactación aún escanea hasta 10 páginas de 1 000 mensajes**; con el índice ese escaneo deja de ser un problema.
- Prueba de concepto de sandbox: E2B y Vercel Sandbox, misma tarea (generar un xlsx desde un CSV de 5 000 filas y un gráfico png), medir cold start, costo y facilidad de bloquear red. Decidir.

**Entregable:** dashboard de línea base + decisión de sandbox documentada.

### Fase 1 — Loop agéntico y streaming real (2-3 semanas) ← el 70 % del valor

Archivos: `src/lib/server/suplia-agent-loop.ts` (nuevo), `src/lib/server/suplia-native-tools.ts` (nuevo, genera el catálogo JSON Schema desde el registro actual), `src/ai/openai-stream.ts` (nuevo, cliente con `stream: true` y acumulación de `tool_calls`), `src/app/api/suplia/chat/route.ts`, `src/lib/server/suplia-orchestrator.ts`.

- `SUPLIA_BRAIN_MODE=legacy|agentic`, default `legacy`.
- Catálogo dinámico (~20-25 herramientas por turno) + `tools.discover`.
- `artifact.create`, `artifact.update`, `ask.user` como herramientas.
- SSE con el protocolo de eventos de 3.2.
- Cliente: eliminar `animateAssistantMessage` y `activityPhases`; render incremental.
- Migración `suplia_turns` + `suplia_turn_events`; reconexión por `turnId`.
- Continuación post-aprobación: al aprobar, el resultado vuelve al loop en vez de responder con `successMessage()` hardcodeado. Es el momento de mayor valor del flujo y hoy es el más pobre.
- Retirar `repairSupliaNoOpOperationalOutput()` en modo agéntico (deja de tener sentido cuando el modelo puede realmente ejecutar).

**Criterios de aceptación:** primer token visible en < 2 s; "busca leads de constructoras en Santiago, revisa cuáles ya están en el CRM y arma una lista" se resuelve en un turno encadenando ≥ 3 herramientas; aprobar una acción produce análisis del resultado, no una plantilla; cortar el navegador a mitad de turno y volver recupera el hilo completo.

### Fase 2 — Código, archivos y exportación (2 semanas)

Archivos: `src/lib/server/suplia-sandbox.ts`, `src/lib/server/suplia-files.ts`, `src/lib/server/suplia-export.ts`, migraciones `suplia_files` y `suplia_sandbox_sessions`.

- Herramientas `export.xlsx` / `export.pdf` / `export.csv` en servidor con `xlsx` y `jspdf` (ya en `package.json`).
- `code.run` en sandbox con red denegada, sin credenciales, límites de tiempo y cuota por org.
- `files.*` sobre Supabase Storage, URLs firmadas de vida corta.
- Adjuntos multimodales: imágenes y PDF como partes del mensaje, no concatenados al texto (hoy: máximo 5 archivos, sólo texto, truncados a 8 KB, inyectados dentro del contenido del mensaje, contaminando el historial y la compactación).
- Tarjeta de archivo en el hilo con previsualización y descarga.

**Criterios de aceptación:** "dame estos 200 leads en un Excel con una hoja por industria" produce un archivo descargable correcto; "hazme un gráfico de respuestas por semana" produce un png; el sandbox no puede resolver DNS ni alcanzar `supabase.co` (probado explícitamente en el test).

### Fase 3 — Artefactos vivos y workspace (2 semanas)

Archivos: partir `SupliaWorkspace.tsx` (125 KB) en `SupliaShell`, `SupliaSidebar`, `SupliaTranscript`, `MessageBubble`, `ApprovalCard`, `AskCard`, `JobProgress`, `SupliaComposer`, `ArtifactCanvas`, `useSupliaChat`, `useSupliaRealtime`.

- Renderers tipados por tipo de artefacto con acciones reales.
- Tipo `custom_ui` en iframe aislado con CSP.
- Exportación csv/xlsx/pdf desde el canvas.
- react-markdown + remark-gfm + shiki.
- Supabase Realtime; eliminar polling.
- Persistir el feedback de mensajes en `suplia_message_feedback`: la UI ya tiene los botones cableados con `onFeedback`, la tabla existe desde `20260707000100`, falta cerrar el circuito hacia la base y usarlo como fuente de casos de eval.
- Canvas como hoja inferior en móvil.

**Criterios de aceptación:** un `lead_list` se exporta a xlsx en un clic; el canvas sobrevive a recarga; no hay scroll horizontal en 375 px; light y dark mantienen jerarquía (checklist de `docs/ui-ux/release-audit-checklist.md`).

### Fase 4 — Skills, subagentes y datos (2 semanas)

- Migración `suplia_skills` + UI de gestión + divulgación progresiva.
- Seis skills iniciales.
- `agent.run` exponiendo los 15 subagentes al loop.
- Esquema `suplia_analytics` con vistas RLS + `data.query` de sólo lectura.
- `web.search` / `web.fetch` sobre Serper (ya configurado).

**Criterios de aceptación:** crear una skill desde la UI cambia el comportamiento sin desplegar; el system prompt no crece más de ~1 KB con 20 skills activas; `data.query` con una consulta que intente leer otra organización devuelve vacío, no error (RLS, no validación en aplicación).

### Fase 5 — Trabajo largo y programación (1-2 semanas)

- Promoción automática de turno a job al superar el presupuesto inline.
- `schedule.create` sobre `suplia_jobs` + el cron existente (`/api/cron/suplia`).
- Rutinas iniciales: revisión diaria de respuestas, leads sin respuesta, cuentas nuevas para investigar, reporte semanal.
- Notificación al terminar un job largo.
- Retirar o implementar el quick action "Programado" (hoy es un placeholder con un toast).

### Fase 6 — Aprendizaje y calidad (continuo)

- Ampliar `src/lib/suplia/suplia-evals.ts` con casos golden por intent, incluido encadenamiento de herramientas; correrlos en CI.
- Feedback de mensajes como fuente de casos.
- A/B de asuntos y ángulos; biblioteca de objeciones.
- Panel de memoria editable.

**Total estimado:** 10-13 semanas para las fases 0-5 con un desarrollador dedicado. La Fase 1 sola ya cambia la percepción del producto.

---

## 8. Riesgos

| Riesgo | Probabilidad | Mitigación |
|---|---|---|
| El loop entra en bucles caros o repetitivos | Alta | Techo de iteraciones y de tools auto-ejecutadas; detección de llamada repetida idéntica; presupuesto de tokens por turno con corte |
| Degradación de precisión con 77 herramientas declaradas | Alta | Catálogo dinámico por fase + `tools.discover` |
| Regresión de la capa de aprobaciones al migrar | Media | Flag; políticas y guards intocados; suite de tests de aprobación como gate obligatorio |
| Prompt injection desde correos y web con más superficie | Media | `wrapExternalContent` obligatorio; sandbox sin red; aprobación humana para toda acción con efecto |
| Costo por conversación se dispara | Media | Cache de prefijo; `reasoning_effort` por tier; métricas de costo por conversación desde Fase 0 |
| Timeout de Cloud Run corta turnos largos | Media | Turno persistido + promoción a job (3.3) |
| El sandbox se convierte en un costo fijo | Baja | Un sandbox por conversación con TTL corto; exportación de plantillas en servidor, no en sandbox |
| Migración a Responses API se cuela por la puerta de atrás con Code Interpreter | Baja | Decisión explícita en Fase 0: sandbox propio |

---

## 9. Métricas de éxito

| Métrica | Hoy | Objetivo |
|---|---|---|
| Tiempo hasta el primer token visible | 10-30 s | < 2 s |
| Herramientas encadenadas por turno | 1 (techo duro) | 3-6 cuando la tarea lo requiere |
| Tokens por turno con herramientas | 2 generaciones completas del JSON grande | −40 % |
| Aprobaciones seguidas de análisis útil | 0 % | 100 % |
| Turnos que terminan con archivo entregable | 0 % | > 25 % de los turnos operativos |
| Turnos perdidos por desconexión | desconocido | 0 |
| Skills activas por organización | 0 | ≥ 5 a los 60 días |

---

## 10. Lo que este plan deliberadamente no hace

- **No crea una sección paralela.** Migra SUPL.IA por flag.
- **No da al agente acceso al repositorio ni capacidad de desplegar.** "Como OpenCode" se refiere a ejecutar código en un espacio aislado, no a editar la plataforma que lo hospeda.
- **No entrega SQL arbitrario ni `service_role`.** Vistas RLS de sólo lectura.
- **No adopta un framework de agentes en la Fase 1.** El loop son ~200 líneas y el repo ya tiene su propia capa de tool runs, políticas y telemetría que habría que mapear igual.
- **No toca `suplia-policy.ts` ni `approval-guards.ts`** salvo para agregar políticas de herramientas nuevas.
- **No reescribe las 77 herramientas.** Se declaran en formato nativo; los handlers quedan igual.

---

## Fuentes

- [OpenAI Agents SDK — Human-in-the-loop](https://openai.github.io/openai-agents-js/guides/human-in-the-loop/) · [repo](https://github.com/openai/openai-agents-js)
- [AI SDK 6 — ToolLoopAgent, needsApproval, MCP](https://vercel.com/blog/ai-sdk-6)
- [OpenAI — Code Interpreter en Responses API](https://developers.openai.com/api/docs/guides/tools-code-interpreter) · [ChatKit](https://developers.openai.com/api/docs/guides/chatkit)
- [MarkTechPost — Best Agent Sandboxes 2026: cold start, pricing, network policy](https://www.marktechpost.com/2026/08/27/best-agent-sandboxes-2026-cold-start-pricing-network-policy/)
- [Comparación de sandboxes para agentes (LogRocket)](https://blog.logrocket.com/comparing-ai-agent-sandbox-platforms-e2b-modal-daytona-and-more/)
- [e2b-dev/fragments](https://github.com/e2b-dev/fragments) · [kortix-ai/suna](https://github.com/kortix-ai/suna) · [sst/opencode](https://github.com/sst/opencode) · [ComposioHQ/open-claude-cowork](https://github.com/ComposioHQ/open-claude-cowork) · [eigent-ai/eigent](https://github.com/eigent-ai/eigent)
- [AG-UI Protocol (CopilotKit)](https://docs.copilotkit.ai/agentic-protocols/ag-ui)
- [Agent Skills — estándar SKILL.md y adopción](https://agentman.ai/blog/agent-skills-ecosystem-report-2026)
- [Cloud Run — request timeout](https://docs.cloud.google.com/run/docs/configuring/request-timeout)
- Código y documentación del repositorio: `src/lib/server/suplia-*.ts`, `src/ai/openai-json.ts`, `src/app/api/suplia/chat/route.ts`, `supabase/migrations/*_suplia_*.sql`, `docs/informe-auditoria-suplia-2026-07.md`, `docs/suplia-cowork-implementation-plan.md`, `docs/database.md`, `docs/deployment.md`, `AGENTS.md`
