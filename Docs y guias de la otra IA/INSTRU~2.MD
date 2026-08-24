# Instructivo para OpenCode — implementar las mejoras de SUPL.IA sin romper nada

Eres la IA que programa SUPL.IA (repo `insigne123/ANTON.IA-supabase`, rama base `suplia/github-upload`). Este documento es tu **punto de entrada**: te dice qué agregar, qué editar, en qué orden, y **qué NO tocar**. El objetivo es que SUPL.IA quede **fiel a Claude** (visual + UX) y más capaz para prospección/investigación/contacto/seguimiento, **manteniendo intacto lo que ya funciona**.

---

## 0. Reglas de oro (no romper lo existente)

1. **GLM‑5.2 es la única IA.** No agregues Anthropic ni otro proveedor. El cliente ya es OpenAI‑compatible; GLM se selecciona por `model-router` + `OPENAI_BASE_URL`.
2. **No reconstruyas lo que ya está hecho.** Ya existen y funcionan (NO los reescribas, solo complementa):
   - Jobs en background: `suplia_jobs` / `suplia_job_steps` / `suplia_agent_runs`.
   - `bulkSend` con **dry-run por defecto** + confirmación fuerte `ENVIAR` + ventana horaria.
   - `preflightCampaign` (bloquea si hay `blocked`, persiste `risk_summary`).
   - Memoria: tabla `suplia_memories` + tools `memory.search/propose/save/forget`.
   - Aprobaciones, `tool-leases`, `tool-limits`, observabilidad/telemetría.
   - Privacidad/compliance (contactabilidad DT, etc.).
3. **Guardrails intactos.** Toda acción que **gaste créditos o envíe correos** sigue requiriendo aprobación. Las tools nuevas con costo (`research.brand`, `research.brand_mentions`, `research.serp_*`) van **detrás de aprobación** (patrón `lead.enrich_batch`); las gratis (`research.similarweb/whois`) pueden correr libres.
4. **No cambies firmas ni formatos de retorno** de las funciones que edites. Los reemplazos de `personalizeForLead`, `scoreCompanies`, `scorePeople`, `buildSupliaContext` **mantienen el mismo objeto de retorno** (solo agregan campos). Verifica que quien las llama siga funcionando.
5. **No borres el `SupliaWorkspace` actual.** El chat nuevo (`SupliaChat`) se monta como **"Vista simple"** con un toggle. El usuario puede volver a la vista avanzada.
6. **Aplica por fases, en ramas separadas, y valida después de cada una** (`npm run typecheck && npm test`). Si algo falla, no sigas a la fase siguiente.
7. **Fallbacks obligatorios.** Donde se agregó una llamada al modelo (ej. copy con GLM), debe quedar el **fallback** al comportamiento anterior si el modelo falla (ya está en el código entregado — no lo quites).

---

## 1. Qué vas a recibir (bundle)

**Archivos de código NUEVOS** (cópialos tal cual a su ruta):

| Archivo | Ruta destino |
|---|---|
| `SupliaChat.tsx` | `src/components/suplia/SupliaChat.tsx` |
| `suplia-artifact-doc.ts` | `src/lib/suplia/suplia-artifact-doc.ts` |
| `suplia-research-tools.ts` | `src/lib/server/suplia-research-tools.ts` |
| `suplia-intent-llm.ts` | `src/lib/server/suplia-intent-llm.ts` |
| `suplia-evals.ts` | `src/lib/suplia/suplia-evals.ts` |
| `SupliaMemoryPanel.tsx` | `src/components/suplia/SupliaMemoryPanel.tsx` |
| `suplia-skills-faltantes.ts` | `src/lib/server/suplia-skills-faltantes.ts` (o intégralo en `suplia-tools.ts`) |
| `suplia-skill-registry.ts` | `src/lib/server/suplia-skill-registry.ts` |

**Guías con los EDITS exactos** (find/replace fundamentados en el código real):
`FASE-0-SUPLIA-GLM.md`, `FASE-1-SUPLIA-GLM.md`, `FASE-2-SUPLIA-GLM.md`, `FASE-3-SUPLIA-GLM.md`, `FASE-4-SUPLIA-GLM.md`
**Apoyo:** `README-SUPLIA.md` (runbook), `API-INVESTIGACION.md` (cómo funcionan las APIs), `PLAN-MEJORA-SUPLIA.md` (diagnóstico).

> Las guías de fase traen el **bloque exacto a buscar y el bloque a reemplazar**. Síguelas al pie de la letra; este instructivo es el mapa que las ordena.

---

## 2. Inventario de EDITS sobre archivos existentes

Aplica cada cambio usando el bloque exacto de la guía indicada. **No improvises los reemplazos.**

| Archivo existente | Qué cambia | Guía |
|---|---|---|
| `src/ai/model-router.ts` | GLM como proveedor por defecto (único) | FASE-0 · Cambio 1 |
| `src/lib/server/suplia-agent-registry.ts` | Prompt experto del `icp-strategist`; usar `formatContextBrief(context)` en los prompts | FASE-0 · C2 / FASE-1 · C3 |
| `src/lib/server/suplia-tools.ts` | `personalizeForLead` → copy con GLM (con fallback); `scoreCompanies`/`scorePeople` con rúbrica; **registrar** tools de research y las 4 skills nuevas | FASE-0 · C3 / FASE-1 · C2 / FASE-2 / FASE-4 · B |
| `src/ai/flows/generate-campaign.ts` | Prompt experto de la secuencia + `temperature` 0.6 | FASE-1 · C1 |
| `src/lib/server/suplia-context.ts` | `buildSupliaContext` enriquecido (oferta, desempeño, **memorias aprobadas**) + `formatContextBrief` + `getWinningSubjects` | FASE-1 · C3 / FASE-3 · B y C |
| `src/lib/server/suplia-orchestrator.ts` | Intent híbrido (`classifySupliaIntentHybrid`) + `resolveSkillsForTurn` antes del brain | FASE-1 · C4 / FASE-4 · C2 |
| `src/app/(app)/suplia/page.tsx` | Montar `SupliaChat` como "Vista simple" (toggle, sin borrar el workspace) | FASE-3 · A / FASE-4 · A |

**Rutas/migraciones NUEVAS:**
- `src/app/api/suplia/memory/route.ts` — bloque completo en FASE-2 · §2a.
- Migración `suplia_skills` — SQL en FASE-4 · §C1.
- Cargar fuentes (Inter + Source Serif 4) en el layout — FASE-4 · §A.

---

## 3. Orden de implementación (una rama por fase)

Para cada fase: crea rama → aplica edits de la guía → agrega archivos nuevos → migra/env → `typecheck` + `test` → PR.

1. **Fase 0** (`suplia/fase-0`): GLM único + copy con GLM + prompt ICP + `suplia-research-tools.ts` (registra `research.similarweb`, `research.whois`).
2. **Fase 1** (`suplia/fase-1`): secuencias, scoring con rúbrica, context brief, intent híbrido (`suplia-intent-llm.ts`).
3. **Fase 2** (`suplia/fase-2`): research con key (registrar), `route.ts` de memoria, `SupliaMemoryPanel.tsx`, `suplia-evals.ts`.
4. **Fase 3** (`suplia/fase-3`): inyectar memorias en el brief, A/B (`getWinningSubjects`).
5. **Fase 4** (`suplia/fase-4`): `SupliaChat.tsx` + `suplia-artifact-doc.ts` (visual Claude), `suplia-skills-faltantes.ts` (registrar), `suplia-skill-registry.ts` + migración `suplia_skills` + cablear `resolveSkillsForTurn`.

> Si prefieres un solo PR, usa `suplia/mejoras-glm` y aplica las 5 guías en este orden.

---

## 4. Variables de entorno
```bash
SUPLIA_AI_PROVIDER=glm
OPENAI_API_KEY=<api_key_de_GLM>
OPENAI_BASE_URL=<endpoint_OpenAI-compatible_de_GLM>
SUPLIA_GLM_MODEL=glm-5.2
# Research con key (opcionales; similarweb/whois NO requieren key):
BRANDDEV_API_KEY=...                            # brand
SERPAPI_API_KEY=...                             # brand_mentions / serp_company_news / serp_competitors / serp_jobs_signals
```

---

## 5. Checklist "NO rompí nada" (regresión)

Después de cada fase, confirma:
- [ ] `npm run typecheck` y `npm test` pasan (los tests existentes incluidos).
- [ ] La telemetría (`suplia_agent_runs`) muestra `modelName` de GLM en todo (nada cayó a OpenAI).
- [ ] **Flujos existentes siguen funcionando:** búsqueda de leads, generación/guardado de campaña, **bulk send sigue en dry-run por defecto** y exige `ENVIAR`, el **preflight sigue bloqueando** lo riesgoso, la memoria se guarda/aprueba.
- [ ] Las funciones editadas devuelven el **mismo shape** + campos nuevos (no rompiste a quien las llama).
- [ ] Las tools con costo **no** corren sin aprobación.
- [ ] El `SupliaWorkspace` avanzado sigue accesible (toggle).

## 6. Checklist "fiel a Claude" (lo que se busca)
- [ ] Respuestas en **serif**, interfaz en **sans**, color terracota **#da7756**, fondo crema.
- [ ] **Streaming de letras** con cursor; **"Pensó durante Xs"** desde las fases del SSE.
- [ ] **Panel de artifacts** a la derecha (iframe), pestañas Vista previa/Datos, navegación de versiones.
- [ ] Tarjetas de **aprobación** y **preguntas (`ask`)** claras; chips discretos para tools/jobs.
- [ ] Animaciones: entrada de mensajes, panel deslizante, barras, estrella pulsante.

---

## 7. Notas finales
- Las fuentes reales de Claude (Styrene/Tiempos/Copernicus) son propietarias; el código usa sustitutas libres (Inter + Source Serif 4). No hace falta licenciarlas.
- SimilarWeb y WHOIS usan endpoints públicos no oficiales: cachea resultados y respeta rate limits.
- El **registro de skills** (`suplia_skills` + `suplia-skill-registry.ts`) permite agregar capacidades nuevas (incluidas las skills de OpenClaudia, como filas `kind:'prompt'`) **sin redeploy**. Cablea `resolveSkillsForTurn` en el orchestrator para que el brain las conozca.
- Ante cualquier duda de un bloque de código, la **guía de la fase correspondiente tiene el find/replace exacto**. Síguela; no reescribas de memoria.

**Meta:** terminar con un SUPL.IA que se ve y se siente como Claude, decide con datos, escribe como experto, recuerda, es seguro, y se extiende por skills — todo en GLM‑5.2, sin romper nada de lo que ya tienes.
