# SUPL.IA Claude Cowork Implementation Plan

> Historical planning note. GLM and SerpAPI portions of this proposal are retired from production configuration; use the current OpenAI and Serper runtime direction instead.

## Objetivo

Convertir SUPL.IA en un asistente personal comercial unificado para prospeccion, investigacion, redaccion, contacto y seguimiento de leads. La experiencia debe sentirse como un chat premium con canvas lateral y trabajo autonomo tipo Cowork, manteniendo identidad propia, guardrails fuertes y el criterio visual Apple-like del proyecto.

## Principios

- Chat primero: la conversacion es la superficie principal.
- Canvas de artifacts: cada resultado importante debe quedar como artifact accionable.
- Human-in-the-loop real: toda accion sensible pide aprobacion clara.
- Memoria visible: el usuario controla que recuerda SUPL.IA y donde se usa.
- Datos antes que fantasia: research y scoring deben separar hechos, supuestos y riesgos.
- Una accion primaria por superficie.
- No copiar branding, assets ni tokens propietarios de Claude; adaptar sensacion de claridad, calma y foco.

## Arquitectura Deseada

### Loop Principal

1. Usuario pide un objetivo comercial.
2. SUPL.IA clasifica intent y extrae slots.
3. Construye un context brief con perfil, memoria, performance y restricciones.
4. Decide si debe responder, preguntar, crear artifact, preparar job o pedir aprobacion.
5. Ejecuta tools seguras automaticamente y deja tools sensibles como pending actions.
6. Produce respuesta breve y artifact usable.
7. Aprende de aprobaciones, edits, respuestas y resultados.

### Eventos UI Tipo AG-UI Interno

Estandarizar el stream con eventos semanticos:

- `message.delta`
- `thought.status`
- `tool.started`
- `tool.completed`
- `artifact.created`
- `artifact.updated`
- `approval.requested`
- `approval.resolved`
- `workflow.paused`
- `workflow.resumed`

Esto permite que el frontend renderice actividad, approvals y artifacts sin acoplarse a detalles internos del backend.

## Fase 1 - Inteligencia Base

### 1. Context Brief Curado

Archivos:

- `src/lib/server/suplia-context.ts`
- `src/lib/server/suplia-agent-registry.ts`

Implementar:

- `offer` desde perfil de empresa.
- `performance` historica con contactados, respondidos y reply rate.
- `memories` aprobadas.
- `formatContextBrief(ctx)` para prompts.
- `getWinningSubjects(auth)` para alimentar copywriting.

Criterios:

- Los agentes no reciben JSON crudo salvo que sea necesario.
- Las memorias aprobadas aparecen en el brief.
- Si no hay datos, el brief lo dice de forma compacta.

### 2. Intent Hibrido

Archivos:

- `src/lib/server/suplia-intent-llm.ts`
- `src/lib/server/suplia-orchestrator.ts`

Implementar:

- Regex como prefiltro barato.
- GLM/OpenAI-compatible tier `fast` si hay baja confianza.
- Slots: objetivo, sector, ciudad, tamano, rol.
- Guardar `intentSlots` en metadata para depuracion y futuros workflows.

### 3. Copy 1:1 Con Modelo Y Fallback

Archivo:

- `src/lib/server/suplia-tools.ts`

Implementar:

- `personalizeForLead` con modelo estructurado.
- Fallback estatico si el modelo falla.
- Soporte para `signal` y `winningSubjects`.
- Misma forma de retorno existente.

### 4. Scoring Explicable

Archivo:

- `src/lib/server/suplia-tools.ts`

Implementar breakdown:

- Empresas: `fit`, `intent`, `reach`.
- Personas: `fit`, `reach`, `intent`.
- Persistir breakdown dentro de `source_payload` sin migracion.

### 5. Evals Deterministas

Archivo:

- `src/lib/suplia/suplia-evals.ts`

Implementar:

- `assertCopyQuality`.
- `evalCopySamples`.
- `evalIntentRegex`.
- `evalScoringMonotonic`.

## Fase 2 - Research Y Datos

### 1. Tools Free

Archivos:

- `src/lib/server/suplia-research-tools.ts`
- `src/lib/server/suplia-tools.ts`
- `src/lib/server/suplia-policy.ts`

Tools:

- `research.similarweb`
- `research.whois`

Reglas:

- Sin aprobacion si no consumen creditos.
- Timeout corto.
- Fallback amable si no hay datos.
- Cache en fase posterior.

### 2. Tools Pagadas

Tools:

- `research.brand`
- `research.brand_mentions`
- `research.serp_company_news`
- `research.serp_competitors`
- `research.serp_jobs_signals`

Reglas:

- Siempre con aprobacion.
- Mostrar costo/riesgo antes de ejecutar.
- Nunca exponer API keys al modelo.

### 3. Context.dev / Brand.dev

Tools propuestas:

- `research.company_profile`
- `research.company_website_markdown`
- `research.company_styleguide`
- `research.company_socials`
- `research.company_screenshot`
- `research.company_logo`

Uso:

- Brief de cuenta.
- Personalizacion de emails.
- Research artifact.
- Onboarding de perfil de empresa.

## Fase 3 - Experiencia Claude Cowork

### 1. Workspace Conversacion-First

Archivo:

- `src/components/suplia/SupliaWorkspace.tsx`

Implementar:

- Reducir ruido tecnico por defecto.
- Tools/jobs como chips discretos.
- Thinking summary tipo "Penso durante Xs".
- Canvas lateral para artifacts.
- Aprobaciones con impacto claro.
- Mobile: canvas como sheet o pantalla secundaria.

### 2. Artifacts Controlados

Renderers:

- `LeadListArtifact`
- `CompanyResearchArtifact`
- `CampaignDraftArtifact`
- `EmailDraftArtifact`
- `RiskReportArtifact`
- `PipelineSummaryArtifact`
- `CompetitorAnalysisArtifact`
- `FollowUpPlanArtifact`

Reglas:

- Preferir React components sobre HTML libre.
- Si se usa iframe, siempre `sandbox` y contenido sanitizado.
- Artifacts tienen acciones: copiar, guardar, crear campana, aprobar, editar.

### 3. Streams Resumibles

Implementar:

- Persistencia de eventos de stream o recuperacion por job/message.
- Reconexion por conversationId.
- Estado visual de reconexion.
- No perder artifacts si se corta el stream.

## Fase 4 - Contacto Seguro

Mantener y reforzar:

- Dry-run por defecto.
- Confirmacion fuerte `ENVIAR`.
- Preflight de compliance.
- Ventana horaria.
- Contactabilidad y privacy guardrails.

Mejorar UX:

- Tarjetas de aprobacion con destinatarios, modo, riesgo y costo.
- Editar antes de aprobar.
- Diff si cambia payload.
- Expiracion de aprobaciones.
- Revalidacion de policy al aprobar.

## Fase 5 - Seguimiento Y Aprendizaje

Implementar:

- Sync y clasificacion de replies.
- Follow-up suggestions.
- CRM next actions.
- Deteccion de oportunidades estancadas.
- Reporte semanal.
- Objection library.
- A/B loop de asuntos y angulos.

Artifacts:

- Respuestas nuevas.
- Oportunidades para seguir.
- Objeciones frecuentes.
- Proximas acciones.
- Pipeline sin respuesta.

## Fase 6 - Skills, Playbooks Y Scheduling

### Skills Registry

Tabla propuesta: `suplia_skills`.

Tipos:

- `prompt`
- `tool`
- `agent`

Reglas:

- RLS por `organization_members`.
- Limite de longitud en instrucciones.
- Auditoria de activacion.
- Feature flag antes de UI publica.

### Playbooks Iniciales

- Copy frio Chile.
- ICP constructoras.
- Investigacion cuenta objetivo.
- Follow-up sin respuesta.
- Competitor brief.
- Demand-gen plan.

### Scheduling

- Revision diaria de replies.
- Leads sin respuesta.
- Cuentas nuevas para investigar.
- Reporte semanal de performance.

## Dependencias Externas

### No Agregar Todavia

- CopilotKit: usar patrones, no dependencia inicial.
- Mastra/LangGraph: usar conceptos, no reescribir jobs actuales.
- E2B: reservar para sandbox avanzado.

### Evaluar En Fase Posterior

- AI SDK 7 para agent runtime, tool approvals, telemetry y MCP Apps.
- Context.dev SDK si se adopta como proveedor principal de web/brand context.
- SerpAPI con tool propia y aprobacion.

## Validacion Por Fase

Comandos:

```bash
npm run typecheck
npm test
```

Checklist funcional:

- Los flujos existentes siguen funcionando.
- Bulk send sigue en dry-run por defecto.
- Preflight bloquea riesgos.
- Tools con costo piden aprobacion.
- Metadata conserva intent, slots y telemetria.
- Copy conserva shape de retorno.
- Scoring conserva shape y agrega breakdown.

Checklist visual:

- Light y dark mantienen jerarquia.
- No hay scroll horizontal mobile.
- CTA principal claro.
- Aprobaciones tienen foco visible.
- Artifacts se entienden sin explicar internals.

## Orden De PRs Recomendado

1. `suplia/context-copy-intent`: context brief, copy GLM, intent hibrido, evals.
2. `suplia/scoring-research-free`: scoring breakdown, SimilarWeb/WHOIS, policies.
3. `suplia/research-premium`: Context.dev/Brand.dev/SerpAPI con approvals.
4. `suplia/workspace-cowork`: polish de workspace, artifact canvas y thinking summary.
5. `suplia/follow-up-learning`: replies, follow-ups, A/B loop y dashboard.
6. `suplia/skills-scheduling`: skills registry, playbooks y jobs programados.

## Estado De Esta Iteracion

Se implementa primero el bloque seguro de Fase 1:

- Plan documentado.
- Context brief curado.
- Memoria aprobada en prompts.
- Winning subjects para copy.
- Intent hibrido.
- Copy GLM con fallback.
- Scoring explicable.
- Evals deterministas.
