# SUPL.IA Multiagent Master Plan

## Objetivo

Convertir SUPL.IA en un sistema multiagente operativo, con progreso visible para el usuario, jobs en background, memoria persistente, herramientas reales, aprobaciones humanas y capacidad end-to-end para prospeccion, campanas, seguimiento, respuestas en hilo y CRM.

El resultado final debe permitir que un usuario diga algo como: "Quiero promocionar este software a empresas constructoras", y SUPL.IA pueda planificar, razonar segmentos y puestos, buscar leads en Apollo/PDL con aprobacion, puntuar relevancia, enriquecer, redactar mensajes personalizados, crear y lanzar campanas con guardrails, analizar respuestas, responder en el mismo hilo y actualizar CRM.

## Principios No Negociables

- Toda busqueda que consuma creditos requiere aprobacion.
- Todo enrichment que consuma creditos requiere aprobacion.
- Todo envio real requiere aprobacion.
- Todo bulk send requiere aprobacion fuerte.
- Todo lanzamiento de campana requiere aprobacion fuerte.
- Guardar una campana crea primero un borrador pausado.
- Crear una mision ANTONIA crea primero una mision pausada.
- Responder en un hilo requiere aprobacion.
- Acciones masivas requieren dry-run, muestra y resumen de riesgo.
- La IA no debe inventar datos de leads, empresas, replies o metricas.
- La memoria debe ser visible, editable y borrable.
- Los jobs deben poder correr en background aunque el usuario cierre la pestana.
- El usuario debe ver el progreso de agentes, pasos, tools, aprobaciones y errores.

## Estado Actual Del Sistema

Ya existe:

- SUPL.IA como seccion principal.
- Chat conversacional persistente.
- Tool registry inicial.
- Tool runner trazable.
- Tabla `suplia_tool_runs` planificada/implementada en migracion.
- Acciones aprobables y cancelables.
- Lectura de contexto, CRM, contactados, campanas, ANTONIA, metricas y contactabilidad.
- Busquedas Apollo/PDL aprobables para empresas y personas.
- Artifacts de shortlist de empresas y personas.
- Generacion de secuencias de campana como borrador editable.
- Guardado de campanas como borrador pausado con aprobacion.
- Envio individual de email real con aprobacion.
- Updates CRM aprobables.
- Creacion de misiones ANTONIA pausadas con aprobacion.
- UI con acciones pendientes, artifacts y tool runs.

Falta:

- Jobs persistentes en background.
- Subagentes reales con ejecucion visible.
- Scheduler/worker para continuar jobs sin pestana abierta.
- Memoria persistente y controlable.
- Razonamiento ICP estructurado.
- Scoring persistente de empresas y leads.
- Enrichment conectado a SUPL.IA.
- Personalizacion por lead con contexto real.
- Preflight compliance de campanas.
- Lanzamiento de campanas.
- Bulk send con dry-run.
- Analisis de replies.
- Respuesta en el mismo hilo.
- CRM loop completo.
- Observabilidad, evals y QA de agente.

## Arquitectura Objetivo

SUPL.IA sera el agente principal y orquestador.

Responsabilidades del agente principal:

- Entender objetivo del usuario.
- Crear un job persistente.
- Dividir el trabajo en pasos.
- Elegir subagentes.
- Ejecutar pasos en paralelo cuando sea seguro.
- Consolidar resultados.
- Pedir aprobaciones.
- Ejecutar tools solo bajo policy.
- Mantener progreso visible.
- Registrar memoria util.
- Producir artifacts editables.
- Dejar trazabilidad completa.

Responsabilidades de los subagentes:

- Resolver tareas especializadas.
- Usar solo herramientas permitidas.
- Respetar input/output schema.
- Devolver resultados verificables.
- No ejecutar acciones sensibles sin aprobacion.
- Registrar evidencias y razones.

## Subagentes Objetivo

| Subagente | Rol | Puede consumir creditos | Puede modificar datos | Puede enviar emails |
|---|---|---:|---:|---:|
| `planner` | Divide el objetivo en plan operativo | no | no | no |
| `icp-strategist` | Define segmentos, industrias, senales y roles | no | no | no |
| `prospector` | Prepara y ejecuta busquedas Apollo/PDL aprobadas | si, con aprobacion | no | no |
| `company-scorer` | Puntua empresas contra ICP | no | si, solo scores | no |
| `lead-scorer` | Puntua personas/leads contra ICP | no | si, solo scores | no |
| `enricher` | Enriquece leads/personas | si, con aprobacion | si | no |
| `copywriter` | Genera emails, variantes y secuencias | no | si, artifacts | no |
| `compliance` | Revisa privacy, cuotas, claims y dominios | no | si, preflight logs | no |
| `campaign-operator` | Guarda, lanza, pausa y monitorea campanas | no | si, con aprobacion | si, solo por campana aprobada |
| `reply-analyst` | Clasifica respuestas y sugiere siguientes pasos | no | si, classifications | no |
| `thread-responder` | Redacta y envia respuestas en hilo | no | si, con aprobacion | si, con aprobacion |
| `crm-operator` | Actualiza stage, notas, owner y proximas acciones | no | si, con aprobacion | no |
| `memory-agent` | Propone, guarda y olvida memorias | no | si, con control usuario | no |
| `reporter` | Resume performance, decisiones y resultados | no | no | no |

## Background Jobs

Los jobs deben correr en background aunque el usuario cierre la pestana.

Requisitos:

- Persistir job, steps, agent runs y events en base de datos.
- Usar worker server-side o cron/queue para continuar pasos pendientes.
- Soportar reanudacion idempotente.
- Soportar locks por job y por step.
- Soportar cancelacion cooperativa.
- Soportar pausa y resume.
- Soportar retry con backoff.
- Soportar timeouts por agente/tool.
- No depender del estado React del cliente.
- UI debe hacer polling o realtime contra estado persistido.

Estados de job:

- `draft`
- `planning`
- `waiting_approval`
- `queued`
- `running`
- `paused`
- `completed`
- `failed`
- `cancelled`

Estados de step:

- `queued`
- `running`
- `waiting_approval`
- `completed`
- `failed`
- `skipped`
- `cancelled`

Estados de agent run:

- `queued`
- `running`
- `completed`
- `failed`
- `cancelled`

## Modelo De Datos Objetivo

### `suplia_jobs`

Campos:

- `id`
- `conversation_id`
- `organization_id`
- `user_id`
- `title`
- `goal`
- `job_type`
- `status`
- `priority`
- `current_step_id`
- `progress_current`
- `progress_total`
- `progress_label`
- `input_payload`
- `output_payload`
- `error_message`
- `created_at`
- `updated_at`
- `started_at`
- `finished_at`
- `cancelled_at`
- `paused_at`

### `suplia_job_steps`

Campos:

- `id`
- `job_id`
- `conversation_id`
- `organization_id`
- `step_order`
- `step_key`
- `step_type`
- `agent_name`
- `title`
- `description`
- `status`
- `depends_on_step_ids`
- `can_run_in_parallel`
- `requires_approval`
- `approval_action_id`
- `tool_run_id`
- `input_payload`
- `output_payload`
- `error_message`
- `progress_current`
- `progress_total`
- `started_at`
- `finished_at`
- `created_at`
- `updated_at`

### `suplia_agent_runs`

Campos:

- `id`
- `job_id`
- `step_id`
- `conversation_id`
- `organization_id`
- `user_id`
- `agent_name`
- `status`
- `model_tier`
- `model_name`
- `input_payload`
- `output_payload`
- `reasoning_summary`
- `error_message`
- `token_usage`
- `estimated_cost`
- `started_at`
- `finished_at`
- `created_at`

### `suplia_job_events`

Campos:

- `id`
- `job_id`
- `step_id`
- `agent_run_id`
- `tool_run_id`
- `organization_id`
- `event_type`
- `title`
- `message`
- `severity`
- `metadata`
- `created_at`

### `suplia_memories`

Campos:

- `id`
- `organization_id`
- `user_id`
- `scope`
- `memory_type`
- `key`
- `value`
- `confidence`
- `status`
- `source_conversation_id`
- `source_job_id`
- `approved_by`
- `approved_at`
- `expires_at`
- `created_at`
- `updated_at`

Estados de memoria:

- `inferred`
- `proposed`
- `approved`
- `rejected`
- `archived`

### `suplia_playbooks`

Campos:

- `id`
- `organization_id`
- `user_id`
- `name`
- `description`
- `playbook_type`
- `input_schema`
- `steps`
- `guardrails`
- `performance_summary`
- `status`
- `created_at`
- `updated_at`

### `suplia_company_scores`

Campos:

- `id`
- `organization_id`
- `job_id`
- `company_key`
- `company_name`
- `domain`
- `score`
- `score_label`
- `reasons`
- `risks`
- `matched_segments`
- `source_payload`
- `created_at`

### `suplia_lead_scores`

Campos:

- `id`
- `organization_id`
- `job_id`
- `lead_key`
- `lead_id`
- `email`
- `full_name`
- `company_name`
- `score`
- `score_label`
- `reasons`
- `risks`
- `recommended_action`
- `source_payload`
- `created_at`

### `suplia_campaign_previews`

Campos:

- `id`
- `organization_id`
- `job_id`
- `campaign_id`
- `preview_type`
- `audience_count`
- `sample_count`
- `excluded_count`
- `risk_summary`
- `sample_messages`
- `preflight_result`
- `created_at`

### `suplia_reply_drafts`

Campos:

- `id`
- `organization_id`
- `job_id`
- `conversation_id`
- `contacted_id`
- `thread_key`
- `to_email`
- `subject`
- `html_body`
- `text_body`
- `classification`
- `reasoning_summary`
- `status`
- `approval_action_id`
- `created_at`
- `updated_at`

## Tool Registry Objetivo

### Contexto Y Lectura

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
- `privacy.batch_contactability.check`

### Planificacion E ICP

- `prospecting.suggest_segments`
- `prospecting.build_search_plan`
- `prospecting.validate_icp`
- `memory.search`
- `memory.propose`

### Prospeccion

- `prospecting.search_companies`
- `prospecting.search_people`
- `prospecting.dedupe_against_crm`
- `prospecting.create_shortlist`
- `prospecting.score_companies`
- `prospecting.score_people`

### Enrichment

- `lead.enrich`
- `lead.enrich_batch`
- `lead.save_enriched`
- `lead.merge_duplicate`

### Contenido

- `email.draft`
- `email.rewrite`
- `email.translate`
- `email.personalize_for_lead`
- `email.bulk_variant_preview`
- `campaign.generate_sequence`
- `campaign.preview_for_lead`

### Compliance

- `compliance.preflight_email`
- `compliance.preflight_campaign`
- `compliance.check_claims`
- `compliance.check_quota`
- `compliance.check_suppression`

### Ejecucion

- `email.send`
- `email.bulk_send`
- `campaign.create_draft`
- `campaign.update`
- `campaign.launch`
- `campaign.pause`
- `campaign.resume`
- `crm.update_stage`
- `crm.set_next_action`
- `crm.add_note`
- `crm.assign_owner`
- `antonia.create_mission`
- `antonia.trigger_mission`
- `antonia.pause_mission`
- `antonia.resume_mission`

### Replies Y Seguimiento

- `replies.sync`
- `replies.summarize`
- `replies.classify_batch`
- `thread.reply_draft`
- `thread.reply_send`
- `followup.suggest`
- `followup.create_tasks`
- `pipeline.detect_stalled`

### Memoria

- `memory.search`
- `memory.propose`
- `memory.save`
- `memory.forget`
- `playbook.create`
- `playbook.update`
- `playbook.apply`

## UX De Progreso Visible

La pantalla de SUPL.IA debe mostrar:

- Job actual.
- Estado general del job.
- Timeline de pasos.
- Subagente activo.
- Tool activa.
- Progreso por lote.
- Creditos estimados y consumidos.
- Aprobaciones pendientes.
- Artifacts generados.
- Riesgos y bloqueos.
- Errores recuperables.
- Botones pausar, continuar, cancelar y reintentar.

Ejemplo de timeline visible:

- `Planner`: creando plan operativo.
- `ICP Strategist`: proponiendo segmentos y roles.
- `Prospector`: esperando aprobacion para Apollo.
- `Prospector`: buscando empresas.
- `Company Scorer`: puntuando empresas.
- `Prospector`: esperando aprobacion para buscar personas.
- `Lead Scorer`: priorizando contactos.
- `Enricher`: enriqueciendo leads aprobados.
- `Copywriter`: generando emails personalizados.
- `Compliance`: validando bloqueos y cuotas.
- `Campaign Operator`: esperando aprobacion para lanzar.
- `Reply Analyst`: monitoreando respuestas.

## Flujo End-To-End Objetivo

Caso: promocionar un software B2B.

1. Usuario describe producto, mercado y objetivo.
2. SUPL.IA crea job en background.
3. `planner` genera plan operativo.
4. `icp-strategist` propone segmentos, roles, senales y exclusiones.
5. SUPL.IA muestra estrategia y pide aprobacion para busquedas con creditos.
6. `prospector` busca empresas en Apollo/PDL.
7. `company-scorer` puntua empresas.
8. SUPL.IA muestra shortlist y pide aprobacion para buscar personas.
9. `prospector` busca personas por empresa, dominio, rol y ubicacion.
10. `lead-scorer` puntua leads.
11. `prospecting.dedupe_against_crm` elimina duplicados o contactados recientes.
12. SUPL.IA pide aprobacion para enrichment.
13. `enricher` completa datos aprobados.
14. `copywriter` genera secuencia y personalizaciones.
15. `compliance` ejecuta preflight.
16. SUPL.IA muestra dry-run, muestra de emails, exclusiones y riesgo.
17. Usuario aprueba guardar campana.
18. `campaign-operator` guarda campana pausada.
19. Usuario aprueba lanzamiento.
20. `campaign-operator` lanza campana con limites y ventanas.
21. `reply-analyst` analiza respuestas entrantes.
22. `thread-responder` genera respuesta en hilo.
23. Usuario aprueba o edita respuesta.
24. `thread-responder` envia en el mismo hilo.
25. `crm-operator` actualiza stage, notas y next actions.
26. `memory-agent` propone aprendizajes.
27. Usuario aprueba memorias utiles.
28. `reporter` genera resumen final y metricas.

## Fase 1 - Jobs Background Y Scheduler

Meta:

Crear la infraestructura que permita ejecutar jobs persistentes en background y mostrar progreso visible.

Entregables:

- Migracion `suplia_jobs`.
- Migracion `suplia_job_steps`.
- Migracion `suplia_agent_runs`.
- Migracion `suplia_job_events`.
- `src/lib/server/suplia-job-runner.ts`.
- `src/lib/server/suplia-job-scheduler.ts`.
- `src/lib/server/suplia-agent-registry.ts`.
- Endpoint para crear job desde chat.
- Endpoint para listar estado de jobs.
- Endpoint para pausar, continuar, cancelar y reintentar.
- Worker/cron que tome jobs pendientes.
- UI de progreso visible.

Evaluacion de calidad:

- Un job continua si el usuario cierra la pestana.
- El mismo job no se ejecuta dos veces por condiciones de carrera.
- Cada step emite eventos visibles.
- Se puede pausar y continuar sin perder contexto.
- Se puede cancelar sin dejar acciones sensibles en ejecucion.
- Los errores quedan registrados y son entendibles para usuario.
- `npm run typecheck`, `npm run lint` y `npm run build` pasan.

## Fase 2 - Planner E ICP Strategist

Meta:

SUPL.IA debe razonar a quien apuntar antes de buscar leads.

Entregables:

- Subagente `planner`.
- Subagente `icp-strategist`.
- Tool `prospecting.suggest_segments`.
- Tool `prospecting.build_search_plan`.
- Artifact `icp_strategy`.
- Artifact `search_plan`.
- UI para aprobar o editar ICP/search plan.

Output esperado:

- Segmentos objetivo.
- Industrias.
- Tamanos de empresa.
- Geografias.
- Senales de compra.
- Roles decisores.
- Roles influenciadores.
- Mensaje por segmento.
- Exclusiones.
- Riesgos.
- Volumen estimado de busqueda.

Evaluacion de calidad:

- El sistema puede explicar por que eligio cada segmento.
- El sistema propone roles especificos, no genericos.
- El usuario puede editar el ICP antes de consumir creditos.
- No se ejecuta ninguna busqueda externa en esta fase sin aprobacion.
- La estrategia generada se puede reutilizar en memoria/playbook.

## Fase 3 - Prospeccion Completa Apollo/PDL

Meta:

Convertir el search plan aprobado en busquedas reales de empresas y personas.

Entregables:

- Mejorar `prospecting.search_companies` para multiples segmentos.
- Mejorar `prospecting.search_people` para multiples roles y dominios.
- Tool `prospecting.dedupe_against_crm`.
- Tool `prospecting.create_shortlist`.
- Aprobacion por lote con estimacion de creditos.
- Registro de consumo estimado y real.

Evaluacion de calidad:

- Toda busqueda externa queda como approval action.
- El usuario ve proveedor, criterio, volumen y costo estimado.
- Los resultados se deduplican contra CRM y contactados.
- Los resultados quedan como artifacts navegables.
- No se pierden resultados si el job sigue en background.

## Fase 4 - Scoring De Empresas Y Leads

Meta:

Priorizar empresas y leads segun relevancia real contra ICP.

Entregables:

- Subagente `company-scorer`.
- Subagente `lead-scorer`.
- Tabla `suplia_company_scores`.
- Tabla `suplia_lead_scores`.
- Tool `prospecting.score_companies`.
- Tool `prospecting.score_people`.
- UI para filtrar por score.

Criterios de scoring:

- Fit con ICP.
- Industria.
- Tamano de empresa.
- Rol.
- Seniority.
- Senales de compra.
- Dolor probable.
- Contactabilidad.
- Historial previo.
- Riesgo de baja calidad.
- Riesgo de compliance.

Evaluacion de calidad:

- Cada score incluye razones claras.
- Cada descarte incluye razon.
- Leads con datos insuficientes quedan marcados como inciertos.
- El usuario puede aprobar solo leads sobre cierto score.
- El sistema no inventa senales no presentes.

## Fase 5 - Enrichment

Meta:

Completar datos de leads aprobados para mejorar personalizacion y deliverability.

Entregables:

- Subagente `enricher`.
- Tool `lead.enrich`.
- Tool `lead.enrich_batch`.
- Integracion con Apollo/PDL enrichment existente.
- Persistencia de enriquecimiento.
- Registro por lead de exito, fallo y costo.

Evaluacion de calidad:

- Todo enrichment con costo requiere aprobacion.
- El sistema registra fuente y timestamp.
- El sistema no sobreescribe datos mejores sin razon.
- Errores por lead no bloquean todo el lote.
- El usuario ve cuantos leads fueron enriquecidos, fallaron o quedaron igual.

## Fase 6 - Personalizacion De Emails

Meta:

Generar emails personalizados y secuencias por lead usando contexto real.

Entregables:

- Subagente `copywriter`.
- Tool `email.personalize_for_lead`.
- Tool `email.bulk_variant_preview`.
- Tool `campaign.preview_for_lead`.
- Artifact `personalized_email_draft`.
- Artifact `campaign_preview`.
- Integracion con perfil de empresa y memoria aprobada.

Evaluacion de calidad:

- Emails usan datos reales del lead o placeholders claros.
- No inventan clientes, resultados, cargos ni eventos.
- Cada email tiene CTA claro.
- El tono respeta memoria/preferencias aprobadas.
- El usuario puede ver muestras antes de aprobar.

## Fase 7 - Compliance Y Preflight

Meta:

Evitar envios riesgosos antes de guardar, lanzar o hacer bulk send.

Entregables:

- Subagente `compliance`.
- Tool `compliance.preflight_email`.
- Tool `compliance.preflight_campaign`.
- Tool `privacy.batch_contactability.check`.
- Validacion de cuotas.
- Validacion de dominios bloqueados.
- Validacion de unsubscribes.
- Validacion de duplicados.
- Validacion de claims sensibles.
- Resumen de riesgo antes de launch.

Evaluacion de calidad:

- Ninguna campana se lanza sin preflight.
- Bloqueos criticos impiden launch.
- Exclusiones son visibles y explicables.
- La UI muestra volumen final contactable.
- El sistema diferencia warning de bloqueo.

## Fase 8 - Campanas Completas

Meta:

Pasar de borrador a campana lanzada con aprobacion fuerte y trazabilidad.

Entregables:

- Tool `campaign.update`.
- Tool `campaign.launch`.
- Tool `campaign.pause`.
- Tool `campaign.resume`.
- Tool `campaign.get_status`.
- Dry-run obligatorio.
- Preview por lead.
- Aprobacion fuerte para launch.
- Logs por destinatario.

Evaluacion de calidad:

- Guardar campana no lanza envios.
- Launch siempre requiere aprobacion fuerte.
- El usuario ve volumen, muestra, exclusiones y riesgo.
- El sistema puede pausar una campana.
- El sistema registra cada envio o intento.

## Fase 9 - Bulk Send Controlado

Meta:

Permitir bulk send sin perder seguridad ni trazabilidad.

Entregables:

- Tool `email.bulk_send`.
- Dry-run.
- Muestra de emails.
- Resumen de destinatarios.
- Exclusiones.
- Ventanas horarias.
- Limites por lote.
- Rate limits.
- Pausa y cancelacion.
- Registro por destinatario.

Evaluacion de calidad:

- Bulk send nunca corre sin aprobacion fuerte.
- El usuario ve muestra suficiente antes de aprobar.
- El sistema respeta cuotas y rate limits.
- Fallos individuales no rompen todo el lote.
- Se puede auditar cada destinatario.

## Fase 10 - Replies Y Respuesta En Hilo

Meta:

Analizar respuestas entrantes y responder en el mismo hilo con aprobacion.

Entregables:

- Subagente `reply-analyst`.
- Subagente `thread-responder`.
- Tool `replies.sync`.
- Tool `replies.summarize`.
- Tool `replies.classify_batch`.
- Tool `thread.reply_draft`.
- Tool `thread.reply_send`.
- Artifact `reply_brief`.
- Artifact `thread_reply_draft`.

Clasificaciones:

- `interested`
- `meeting_request`
- `objection`
- `not_interested`
- `unsubscribe`
- `out_of_office`
- `bounce`
- `referral`
- `technical_question`
- `needs_human`

Evaluacion de calidad:

- Replies se clasifican con razon.
- Unsubscribe bloquea follow-ups.
- Respuestas en hilo conservan thread id/conversation id.
- Envio de respuesta requiere aprobacion.
- CRM se actualiza con siguiente paso correcto.

## Fase 11 - CRM Loop Completo

Meta:

Cerrar el loop entre prospeccion, email, reply y pipeline.

Entregables:

- Subagente `crm-operator`.
- Mejorar `crm.update_stage`.
- Mejorar `crm.set_next_action`.
- Mejorar `crm.add_note`.
- Tool `crm.assign_owner`.
- Tool `pipeline.detect_stalled`.
- Tool `followup.suggest`.
- Tool `followup.create_tasks`.

Evaluacion de calidad:

- Cada reply importante genera siguiente accion sugerida.
- El usuario puede aprobar cambios CRM.
- El pipeline no se actualiza sin evidencia.
- Leads estancados se detectan con criterio claro.
- Las notas no duplican contenido innecesario.

## Fase 12 - Memoria Persistente

Meta:

Hacer que SUPL.IA mejore con uso sin perder control del usuario.

Entregables:

- Subagente `memory-agent`.
- Tabla `suplia_memories`.
- Tabla `suplia_playbooks`.
- Tool `memory.search`.
- Tool `memory.propose`.
- Tool `memory.save`.
- Tool `memory.forget`.
- UI de memoria.
- Memorias citadas cuando influyen en una decision.

Tipos de memoria:

- Tono preferido.
- Idioma preferido.
- CTA favorito.
- ICPs aprobados.
- Segmentos exitosos.
- Segmentos descartados.
- Objeciones frecuentes.
- Claims permitidos.
- Claims prohibidos.
- Casos de uso.
- Campanas exitosas.
- Reglas comerciales.
- Limites de automatizacion.

Evaluacion de calidad:

- El usuario puede aprobar, editar o rechazar memorias.
- Memorias inferidas tienen confidence.
- Memoria sensible no se usa para acciones sensibles sin confirmacion.
- El usuario puede borrar memorias.
- El sistema cita memorias relevantes.

## Fase 13 - Paralelismo Real

Meta:

Ejecutar subtrabajos simultaneos de forma segura y eficiente.

Entregables:

- Scheduler de steps independientes.
- Cola de steps pendientes.
- Limites de concurrencia por organizacion.
- Limites de concurrencia por proveedor.
- Locks por job/step/tool.
- Retry con backoff.
- Timeouts.
- Cancelacion cooperativa.

Paralelismo permitido:

| Proceso | Paralelo | Limite inicial |
|---|---:|---:|
| Scoring de empresas | si | 10 |
| Scoring de leads | si | 20 |
| Enrichment | si, con aprobacion | 5 |
| Personalizacion | si | 10 |
| Compliance batch | si | 20 |
| Envio real | si, rate-limited | 1-3 |
| CRM updates | si | 10 |
| Reply analysis | si | 20 |

Evaluacion de calidad:

- No hay duplicacion de steps.
- Cancelar job detiene steps no iniciados.
- Fallo de un lote parcial no pierde resultados exitosos.
- El usuario ve progreso por lote.
- El sistema respeta cuotas y rate limits.

## Fase 14 - Observabilidad Y Evals

Meta:

Poder auditar decisiones, detectar regresiones y medir calidad.

Entregables:

- Logs por job, step, agent y tool.
- Costos estimados y reales.
- Token usage.
- Model tier usado.
- Dashboard interno de errores.
- Evals de no alucinacion.
- Evals de aprobacion correcta.
- Evals de compliance.
- Tests unitarios de tools.
- Tests de integracion por flujo.

Evaluaciones automaticas minimas:

- No ejecutar busqueda externa sin aprobacion.
- No enviar email sin aprobacion.
- No lanzar campana sin aprobacion fuerte.
- No usar datos inventados en emails.
- No contactar dominios bloqueados.
- No contactar unsubscribes.
- No duplicar leads ya contactados recientemente.
- No guardar memoria sensible sin aprobacion.
- No perder job al cerrar pestana.

Metricas:

- Jobs creados.
- Jobs completados.
- Jobs fallidos.
- Tiempo promedio por job.
- Creditos estimados/consumidos.
- Leads encontrados.
- Leads descartados.
- Score promedio.
- Emails generados.
- Emails enviados.
- Opens/replies/bounces.
- Campanas lanzadas.
- Errores por tool.
- Costo por job.

Evaluacion de calidad:

- Se puede explicar cada accion.
- Se puede reproducir cada decision importante.
- Hay tests para guardrails criticos.
- Hay alertas para fallos recurrentes.

## Fase 15 - UI Producto Final

Meta:

Convertir el sistema en una experiencia clara, premium y confiable.

Entregables:

- Vista de job detail.
- Timeline de subagentes.
- Panel de aprobaciones.
- Panel de artifacts editables.
- Panel de memoria.
- Preview de campana por lead.
- Diff antes/despues para acciones sensibles.
- Empty states claros.
- Loading granular.
- Error recovery.
- Mobile responsive.
- Dark mode completo.

Evaluacion de calidad:

- El usuario entiende que esta pasando en menos de 3 segundos.
- Cada paso tiene estado y responsable claro.
- Las aprobaciones explican impacto y riesgo.
- La UI no muestra ruido tecnico innecesario.
- El sistema se siente como producto, no como consola interna.

## Definition Of Done Global

El objetivo final se considera cumplido cuando SUPL.IA puede hacer este flujo completo:

1. Recibe un producto o campana a promocionar.
2. Razona segmentos, industrias, empresas y puestos objetivo.
3. Pide aprobacion para consumir creditos.
4. Busca empresas y leads en Apollo/PDL.
5. Entrega shortlist de empresas y leads.
6. Puntua relevancia con razones.
7. Deduplica contra CRM/contactados.
8. Enriquece leads aprobados.
9. Genera borradores personalizados por lead.
10. Ejecuta compliance preflight.
11. Muestra dry-run y muestra de emails.
12. Guarda campana como borrador pausado.
13. Lanza campana solo con aprobacion fuerte.
14. Monitorea respuestas.
15. Clasifica replies.
16. Redacta respuestas en el mismo hilo.
17. Envia respuestas solo con aprobacion.
18. Actualiza CRM y proximas acciones.
19. Propone memorias utiles.
20. Guarda memorias solo con control del usuario.
21. Corre jobs en background.
22. Muestra progreso visible de cada subagente.
23. Permite pausar, cancelar y reintentar.
24. Deja trazabilidad completa.

## Checklist De Calidad Por Release

- Typecheck pasa.
- Lint pasa.
- Build pasa.
- Migraciones aplican en base limpia.
- Migraciones aplican en base existente.
- No hay acciones sensibles sin approval.
- No hay consumo de creditos sin approval.
- No hay envios reales en tests sin mocks.
- Los jobs background sobreviven cierre de pestana.
- La UI muestra progreso y errores.
- Dark mode mantiene contraste.
- Mobile no tiene overflow horizontal.
- Artifacts principales son editables o revisables.
- Logs permiten auditar decision y ejecucion.

## Primer Sprint Recomendado

No empezar desarrollo sin confirmar alcance del sprint.

Sprint inicial sugerido:

1. Crear tablas de jobs, steps, agent runs y events.
2. Crear job runner y scheduler background.
3. Crear agent registry base.
4. Crear agentes `planner`, `icp-strategist` y `prospector` como workers tipados.
5. Crear UI de progreso visible.
6. Permitir crear job desde chat.
7. Permitir pausar, cancelar y reintentar.
8. Mantener todas las acciones sensibles como pending actions.

Meta del sprint inicial:

SUPL.IA debe poder tomar una solicitud de campana, crear un job en background, mostrar planificacion visible, proponer ICP/search plan y dejar lista una aprobacion para busquedas Apollo/PDL sin consumir creditos aun.

Evaluacion del sprint inicial:

- Job corre en background.
- El usuario ve cada step.
- `planner` produce plan.
- `icp-strategist` produce ICP/search plan.
- `prospector` no busca sin approval.
- Cancelar job detiene steps pendientes.
- Reintentar step fallido funciona.
- Typecheck, lint y build pasan.
