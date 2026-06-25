# SUPL.IA Master Plan

## Objetivo

Convertir `SUPL.IA` en el copiloto operativo universal de `ANTON.IA`: una interfaz conversacional tipo cloud agent que pueda entender objetivos, leer contexto real de la app, orquestar herramientas, pedir aprobaciones cuando corresponda y ejecutar trabajo comercial de punta a punta con trazabilidad completa.

`SUPL.IA` no debe ser un modulo de prospeccion aislado. Debe ser la capa conversacional que envuelve y coordina CRM, leads, campanas, ANTONIA, Gmail, Outlook, Apollo, PDL, research, metricas y guardrails.

## Estado actual

### Ya implementado

- Ruta principal: `/suplia`
- Entrada en sidebar
- Workspace con:
  - lista de conversaciones
  - chat principal
  - panel de acciones pendientes
  - panel de artefactos
- Persistencia en Supabase para:
  - `suplia_conversations`
  - `suplia_messages`
  - `suplia_artifacts`
  - `suplia_pending_actions`
- Router OpenAI por complejidad para SUPL.IA
- Soporte para redactar emails
- Accion aprobable `email.send`
- Envio real de email por Gmail/Outlook tras aprobacion
- Guardrails de envio:
  - conexion activa
  - email valido
  - asunto y cuerpo requeridos
  - unsubscribe / privacy suppression
  - dominios bloqueados
  - cuota diaria
  - registro en `contacted_leads` y `email_events`

### Todavia faltante

- Tool registry real con ejecucion multi-step
- Tools de lectura de CRM, campanas, ANTONIA y contactados
- Tools de Apollo/PDL desde el chat
- Creacion real de campanas desde artifacts
- Updates reales de CRM
- Creacion y disparo de misiones ANTONIA
- Jobs largos y subagentes
- Streaming de respuesta
- Memoria larga y preferencias persistentes
- Observabilidad, evals y hardening de produccion

## Decisiones cerradas

Estas decisiones ya quedaron definidas y deben respetarse en toda implementacion futura.

1. Toda busqueda que consuma creditos debe requerir confirmacion.
2. El bulk send debe existir, pero siempre con aprobacion.
3. Las campanas deben crearse primero como artifacts editables y solo despues guardarse/lanzarse con aprobacion explicita.

## Vision de producto

El flujo esperado es:

1. El usuario describe un objetivo en lenguaje natural.
2. SUPL.IA entiende intencion, contexto y restricciones.
3. SUPL.IA propone un plan de trabajo.
4. SUPL.IA ejecuta lecturas sin friccion.
5. SUPL.IA convierte acciones sensibles en acciones pendientes aprobables.
6. El usuario aprueba o corrige.
7. SUPL.IA ejecuta, registra y deja evidencia.
8. El sistema recuerda decisiones, playbooks y preferencias validas.

El usuario nunca deberia tener que pensar en endpoints, tablas, proveedores o pasos tecnicos. Debe pedir un resultado y revisar acciones claras.

## Resultado esperado al final del roadmap

SUPL.IA deberia poder manejar escenarios como:

- buscar sectores y empresas potenciales para un nuevo producto
- encontrar decisores por empresa con Apollo o PDL
- recomendar a quien contactar primero y por que
- redactar uno o varios emails personalizados
- guardar una secuencia como campana editable
- lanzar una campana con aprobacion
- revisar replies y actividad de contactados
- actualizar CRM y proximas acciones
- crear una mision en ANTONIA para trabajo largo
- resumir performance comercial del equipo
- detectar oportunidades estancadas o riesgos operativos

## Arquitectura objetivo

### Capas

1. `UI`
2. `Conversation State`
3. `Agent Runtime`
4. `Tool Registry`
5. `Approval + Policy Engine`
6. `Execution Layer`
7. `Observability + Memory`

### Responsabilidad por capa

#### UI

- chat
- historial
- artifacts
- acciones pendientes
- progreso de jobs
- tool runs visibles
- diff antes/despues para acciones sensibles

#### Conversation State

- conversaciones
- mensajes
- artifacts
- pending actions
- jobs
- preferencias del usuario y de la organizacion

#### Agent Runtime

- interpreta intencion
- decide plan
- selecciona modelo
- decide tool a ejecutar
- resume resultados
- convierte resultados en siguientes pasos

#### Tool Registry

- expone herramientas tipadas
- valida parametros
- controla permisos
- normaliza resultados
- registra tool runs

#### Approval + Policy Engine

- define riesgo por accion
- decide si requiere aprobacion
- agrega razon de aprobacion
- bloquea acciones prohibidas

#### Execution Layer

- wrappers reutilizables de Apollo/PDL
- wrappers de CRM
- wrappers de campanas
- wrappers de ANTONIA
- wrappers de Gmail/Outlook

#### Observability + Memory

- logs de decisiones
- tool runs
- costo/modelo/token usage
- jobs y pasos
- memorias utiles

## Modelo de datos

### Tablas ya creadas

- `suplia_conversations`
- `suplia_messages`
- `suplia_artifacts`
- `suplia_pending_actions`

### Tablas por crear

#### `suplia_tool_runs`

Campos sugeridos:

- `id`
- `conversation_id`
- `organization_id`
- `user_id`
- `message_id`
- `tool_name`
- `status`
- `input_payload`
- `output_payload`
- `error_message`
- `risk_level`
- `requires_approval`
- `approved_by`
- `approved_at`
- `started_at`
- `finished_at`
- `duration_ms`
- `model_tier`
- `model_name`
- `estimated_cost`
- `created_at`

#### `suplia_jobs`

Campos sugeridos:

- `id`
- `conversation_id`
- `organization_id`
- `user_id`
- `job_type`
- `title`
- `status`
- `goal`
- `context`
- `current_step`
- `created_at`
- `updated_at`

#### `suplia_job_steps`

Campos sugeridos:

- `id`
- `job_id`
- `step_order`
- `step_type`
- `title`
- `status`
- `input_payload`
- `output_payload`
- `error_message`
- `tool_run_id`
- `created_at`
- `updated_at`

#### `suplia_memories`

Campos sugeridos:

- `id`
- `organization_id`
- `user_id`
- `scope`
- `memory_type`
- `key`
- `value`
- `confidence`
- `source_conversation_id`
- `created_at`
- `updated_at`

#### `suplia_saved_views` o `suplia_playbooks`

Para guardar configuraciones, preferencias y recetas reutilizables.

## Tipos de artifacts

Artifacts actuales y futuros:

- `plan`
- `email_draft`
- `lead_list`
- `crm_summary`
- `note`
- `company_shortlist`
- `person_shortlist`
- `campaign_draft`
- `campaign_preview`
- `pipeline_summary`
- `reply_brief`
- `mission_draft`
- `risk_report`

Cada artifact deberia poder ser versionado, editado y aprobado si deriva en una accion real.

## Politica de aprobaciones

### Lecturas

- no requieren aprobacion
- no consumen creditos externos salvo explicitamente configurado

### Busquedas con costo o credito

- SI requieren aprobacion
- deben indicar:
  - herramienta
  - criterio de busqueda
  - volumen esperado
  - costo o consumo estimado si es posible

### Redaccion

- no requiere aprobacion
- produce artifacts editables

### Guardar campana

- requiere aprobacion
- parte desde artifact editable
- debe mostrar secuencia, destinatarios esperados y reglas

### Lanzar campana

- requiere aprobacion fuerte
- debe mostrar volumen, exclusiones, ventanas horarias y riesgo

### Envio individual

- requiere aprobacion

### Bulk send

- existe
- requiere aprobacion fuerte siempre
- requiere resumen antes de ejecutar
- requiere dry-run o preview de muestra

### Updates de CRM

- individual simple: aprobacion simple
- masivos: aprobacion fuerte

### Crear o disparar mision ANTONIA

- requiere aprobacion

## Matriz de riesgo sugerida

| Accion | Riesgo | Aprobacion |
|---|---|---|
| leer CRM, leads, campanas, contactados | bajo | no |
| redactar email o campana | bajo | no |
| buscar en Apollo/PDL | medio | si |
| guardar campana | medio | si |
| enviar email individual | medio | si |
| actualizar CRM en lote | alto | si |
| lanzar campana | alto | si |
| bulk send | critico | si |
| crear mision ANTONIA | medio | si |
| disparar mision ANTONIA | alto | si |

## Estrategia de modelos OpenAI

SUPL.IA ya usa router de modelos por tier.

### Defaults vigentes

- `fast`: `gpt-5.4-nano`
- `balanced`: `gpt-5.4-mini`
- `orchestrator`: `gpt-5.4-mini`
- `reasoning`: `gpt-5.4`
- `critical`: `gpt-5.5`
- fallback legacy: `gpt-4o-mini`

### Recomendacion tecnica

Migrar SUPL.IA a `Responses API` para tool calling real y dejar `chat/completions` como compatibilidad para flows heredados.

### Regla de uso

- tareas simples: `fast`
- drafting y resumenes: `balanced`
- tool planning y orquestacion diaria: `orchestrator`
- decisiones comerciales complejas: `reasoning`
- acciones sensibles, bulk y compliance: `critical`

## Tool registry objetivo

### Grupo 1: contexto y lectura

- `app.context.get`
- `profile.get_company_profile`
- `crm.search`
- `crm.get_lead_detail`
- `contacted.search`
- `contacted.get_timeline`
- `campaigns.list`
- `campaigns.get`
- `antonia.missions.list`
- `antonia.exceptions.list`
- `metrics.overview`
- `privacy.contactability.check`

### Grupo 2: prospeccion

- `prospecting.suggest_segments`
- `prospecting.search_companies`
- `prospecting.score_companies`
- `prospecting.search_people`
- `prospecting.score_people`
- `prospecting.dedupe_against_crm`
- `prospecting.create_shortlist`
- `prospecting.save_leads`

### Grupo 3: contenido

- `email.draft`
- `email.rewrite`
- `email.translate`
- `email.bulk_variant_preview`
- `campaign.generate_sequence`
- `campaign.preview_for_lead`

### Grupo 4: ejecucion

- `email.send`
- `email.bulk_send`
- `campaign.create_draft`
- `campaign.update`
- `campaign.launch`
- `campaign.pause`
- `crm.update_stage`
- `crm.set_next_action`
- `crm.add_note`
- `crm.assign_owner`
- `antonia.create_mission`
- `antonia.trigger_mission`
- `antonia.pause_mission`
- `antonia.resume_mission`

### Grupo 5: seguimiento y cierre de loop

- `replies.summarize`
- `replies.classify_batch`
- `followup.suggest`
- `followup.create_tasks`
- `pipeline.detect_stalled`
- `pipeline.summarize`
- `report.generate_executive`

## Reutilizacion de codigo existente

### Endpoints y modulos ya existentes a envolver

- `/api/opportunities/orgs-apollo`
- `/api/opportunities/leads-apollo`
- `/api/ai/generate-campaign`
- `/api/antonia/trigger`
- `src/lib/server/crm-autopilot.ts`
- `src/lib/services/antonia-service.ts`
- `src/app/api/contact/send/route.ts`
- `src/lib/server-email-sender.ts`
- `src/lib/server/daily-quota-store.ts`
- `src/lib/server/privacy-subject-data.ts`

### Regla tecnica importante

Siempre que sea posible, extraer la logica de negocio a helpers server-side reutilizables y dejar los endpoints HTTP como wrappers. SUPL.IA no deberia depender de llamar a endpoints internos si puede importar funciones.

## Roadmap por fases

## Fase 0 - Hardening de la V1

Objetivo: estabilizar la base antes de agregar nuevas herramientas.

Entregables:

- `suplia_tool_runs`
- cancelacion de pending actions
- mostrar tool runs en UI
- mejor manejo de errores en el chat
- estados vacios y loading mas especificos
- soporte a rename de conversaciones

Definition of done:

- cada accion y cada tool run queda visible y trazable
- la UI explica por que una accion esta pendiente o fallo

## Fase 1 - Tool Registry real

Objetivo: pasar de respuesta JSON simple a runtime con herramientas.

Trabajo:

- crear `src/lib/server/suplia-tools.ts`
- crear `src/lib/server/suplia-tool-runner.ts`
- crear `src/lib/server/suplia-policy.ts`
- crear schema comun para tool input/output
- migrar SUPL.IA a Responses API con tool calling real

Artifacts esperados:

- `tool_result`
- `plan`
- `note`

Definition of done:

- el modelo puede pedir una tool
- el backend la ejecuta y registra
- el modelo puede continuar usando el resultado real

## Fase 2 - Lecturas de app

Objetivo: que SUPL.IA pueda contestar usando datos reales de la app.

Trabajo:

- CRM read tools
- contactados read tools
- campanas read tools
- ANTONIA read tools
- metricas overview
- timeline tools

Casos soportados:

- "que leads necesitan seguimiento?"
- "que oportunidades estan estancadas?"
- "que campanas estan activas?"
- "que leads respondieron positivo hoy?"

Definition of done:

- las respuestas contienen evidencia real
- no se inventan resultados
- el usuario puede navegar desde la respuesta a la accion siguiente

## Fase 3 - Prospeccion Apollo/PDL

Objetivo: habilitar busqueda real de empresas y personas con aprobacion por consumo.

Trabajo:

- extraer logica de `/api/opportunities/orgs-apollo`
- extraer logica de `/api/opportunities/leads-apollo`
- crear tools de busqueda y scoring
- crear artifacts de shortlist
- agregar resumen de consumo antes de ejecutar

Regla obligatoria:

- toda busqueda que consuma creditos requiere confirmacion

Definition of done:

- el usuario puede aprobar buscar empresas
- luego aprobar buscar personas
- SUPL.IA genera shortlist usable y deduplicada

## Fase 4 - Campanas editables

Objetivo: que SUPL.IA cree campanas como artifacts editables y luego las guarde/lance con aprobacion.

Trabajo:

- tool `campaign.generate_sequence`
- artifact `campaign_draft`
- editor de sequence en UI
- tool `campaign.create_draft`
- tool `campaign.launch`
- preview por lead
- integracion con estilo de Email Studio

Decision obligatoria:

- primero artifact editable
- luego aprobacion para guardar
- luego aprobacion para lanzar

Definition of done:

- el usuario puede pedir una campana
- SUPL.IA la genera
- el usuario la corrige
- el usuario aprueba guardar y luego lanzar

## Fase 5 - CRM y proximas acciones

Objetivo: cerrar el loop entre outreach, reply y pipeline.

Trabajo:

- tool `crm.update_stage`
- tool `crm.set_next_action`
- tool `crm.add_note`
- tool `crm.assign_owner`
- deteccion de oportunidades estancadas
- follow-up recommendations

Definition of done:

- el usuario puede decir "mueve estos leads a engaged"
- SUPL.IA propone el cambio y lo deja aprobable
- el usuario puede pedir proximas acciones y la IA las deja registradas

## Fase 6 - Bulk send controlado

Objetivo: habilitar envios masivos con fuerte control.

Trabajo:

- tool `email.bulk_send`
- dry-run con muestra
- resumen de destinatarios
- exclusiones y riesgos
- cuotas y limites visibles
- posibilidad de pausar o cancelar

Decision obligatoria:

- el bulk send debe existir
- siempre con aprobacion fuerte

Definition of done:

- el usuario puede aprobar un envio masivo sabiendo volumen, riesgo y muestra
- no se ejecuta sin confirmacion explicita

## Fase 7 - ANTONIA como worker largo

Objetivo: que SUPL.IA pueda delegar trabajos largos a ANTONIA.

Trabajo:

- tool `antonia.create_mission`
- tool `antonia.trigger_mission`
- tool `antonia.pause_mission`
- tool `antonia.resume_mission`
- tool `antonia.get_activity`
- tool `antonia.get_exceptions`

Definition of done:

- el usuario puede pasar de una conversacion a una mision ejecutable
- SUPL.IA puede seguir mostrando progreso y excepciones

## Fase 8 - Jobs y subagentes

Objetivo: que SUPL.IA resuelva flujos multi-step de manera ordenada.

Subagentes logicos:

- `planner`
- `researcher`
- `prospector`
- `copywriter`
- `compliance`
- `operator`

Trabajo:

- crear `suplia_jobs`
- crear `suplia_job_steps`
- soporte a reanudar jobs
- soporte a retries por step
- soporte a cancelar jobs

Definition of done:

- el usuario puede pedir una tarea larga
- SUPL.IA la divide, ejecuta y reporta paso a paso

## Fase 9 - Memoria y preferencias

Objetivo: que SUPL.IA se vuelva mejor con el uso.

Trabajo:

- memoria corta ya persistente
- memoria larga por usuario y organizacion
- preferencias de tono
- ICPs frecuentes
- exclusiones y listas negras semanticas
- campanas exitosas
- objeciones frecuentes

Definition of done:

- SUPL.IA recuerda decisiones aprobadas
- reutiliza contexto validado
- no vuelve a pedir lo mismo innecesariamente

## Fase 10 - Observabilidad, evals y QA

Objetivo: dejarlo confiable para produccion.

Trabajo:

- logging de tool runs
- costo estimado por accion
- token usage
- evals de no alucinacion
- evals de aprobacion correcta
- test coverage de tools
- dashboards internos de uso y error

Definition of done:

- se puede auditar cada accion
- se puede explicar cada aprobacion
- se pueden detectar regresiones antes de release

## Orden de ejecucion recomendado

1. Fase 0
2. Fase 1
3. Fase 2
4. Fase 3
5. Fase 4
6. Fase 5
7. Fase 6
8. Fase 7
9. Fase 8
10. Fase 9
11. Fase 10

## Plan de sprints sugerido

### Sprint 1

- Fase 0 completa
- Fase 1 base

### Sprint 2

- Fase 2 completa
- primeros tools visibles en UI

### Sprint 3

- Fase 3 completa
- busqueda aprobable de empresas y personas

### Sprint 4

- Fase 4 completa
- campaign draft editable

### Sprint 5

- Fase 5 completa
- CRM updates aprobables

### Sprint 6

- Fase 6 completa
- bulk send controlado

### Sprint 7

- Fase 7 completa
- delegacion a ANTONIA

### Sprint 8

- Fase 8 y Fase 9

### Sprint 9

- Fase 10 y hardening final

## Requisitos de UI por fase

Siempre validar:

- desktop
- tablet
- mobile
- dark mode
- focus visible
- estados loading
- estados vacios
- errores y retries
- CTA principal claro

## Requisitos de test

### Tecnicos

- `npm run typecheck`
- `npm run lint`
- `npm run build`
- tests de tool registry
- tests de policy engine
- tests de email payloads
- tests de CRM payloads
- tests de campaign payloads

### Evals de comportamiento

- no inventar resultados de herramientas
- no crear `email.send` sin payload valido
- no ejecutar busquedas con costo sin aprobacion
- no ejecutar bulk send sin aprobacion fuerte
- pedir informacion faltante cuando corresponda
- usar el tier de modelo correcto segun riesgo

## Riesgos principales

### Riesgo 1: alucinacion operativa

Mitigacion:

- tool calling real
- prohibir afirmar ejecucion si no hubo tool run
- artifacts con source real

### Riesgo 2: acciones costosas sin control

Mitigacion:

- approval policy engine
- resumen antes de ejecutar
- dry-run y vista previa

### Riesgo 3: crecimiento desordenado del contexto

Mitigacion:

- compaction de mensajes
- memoria estructurada
- artifacts como estado externo

### Riesgo 4: coupling a endpoints HTTP internos

Mitigacion:

- extraer helpers server-side reusables

### Riesgo 5: UX demasiado tecnica

Mitigacion:

- priorizar actionability
- no mostrar pensamiento interno del modelo
- una accion principal por superficie

## Definition of done final

SUPL.IA estara "completo" cuando:

- pueda leer toda la app de forma confiable
- pueda buscar empresas y personas con aprobacion por costo
- pueda crear campanas editables y luego guardarlas/lanzarlas con aprobacion
- pueda enviar individual y masivo con guardrails
- pueda actualizar CRM y proximas acciones
- pueda delegar jobs largos a ANTONIA
- pueda mostrar evidencia y tool runs
- tenga audit trail completo
- tenga memoria util
- pase typecheck, lint, build, tests y evals clave

## Proximo slice recomendado

El siguiente paso de desarrollo debe ser:

1. crear `suplia_tool_runs`
2. migrar SUPL.IA a runtime con tool registry real
3. conectar las primeras tools de lectura de CRM, contactados y campanas

Ese slice es el punto de inflexion entre "chat bonito" y "agente real".
