# README — Mejoras de SUPL.IA (Fases 0→4, 100% GLM)

Runbook para aplicar todo el paquete sobre la rama **`suplia/github-upload`** del repo `insigne123/ANTON.IA-supabase`. Convierte a SUPL.IA en un **"Claude experto en marketing" sobre GLM-5.2**: mejor copy y scoring, investigación real, memoria que se usa, **UX fiel a Claude**, las skills que faltaban y un **registro de skills** extensible.

## Principios (no negociables)
- **GLM-5.2 como proveedor único.** No se agrega Anthropic. La "inteligencia" viene de prompts + método + datos.
- **Guardrails intactos:** nada que gaste créditos o envíe correos corre sin aprobación.
- **No reconstruir lo ya hecho:** dry-run, preflight de compliance y almacenamiento de memoria **ya existen** en la rama; solo se complementan.
- **No puedo pushear por ti.** Esto queda listo para que tú u OpenCode lo apliquen y abran los PRs.

---

## 1. Archivos entregados

**Archivos NUEVOS** (cópialos al repo en la ruta indicada):

| Archivo | Destino | Fase | Qué hace |
|---|---|---|---|
| `suplia-research-tools.ts` | `src/lib/server/` | 0 + 2 | Tools de research: `similarweb`/`whois` (sin key) + `brand`/`brand_mentions`/`serp_*` (con key) |
| `suplia-intent-llm.ts` | `src/lib/server/` | 1 | Intent híbrido (regex + GLM `fast` con extracción de slots) |
| `suplia-evals.ts` | `src/lib/suplia/` | 2 | Harness de evals (calidad de copy, intent, scoring) |
| `SupliaMemoryPanel.tsx` | `src/components/suplia/` | 2 | UI para ver/aprobar/olvidar memorias |
| `suplia-artifact-doc.ts` | `src/lib/suplia/` | 4 | Render fiel a Claude de los artifacts (iframe + HTML) |
| `SupliaChat.tsx` | `src/components/suplia/` | 3→4 | **Chat estilo Claude** (usa la versión de Fase 4) |
| `suplia-skills-faltantes.ts` | `src/lib/server/` | 4 | 4 skills: brand_mentions, subject_variants, demand_gen_plan, competitor_analysis |
| `suplia-skill-registry.ts` | `src/lib/server/` | 4 | Registro de skills extensible (loader) |

**Guías con los EDITS** (find/replace sobre archivos existentes; aplícalas en orden):
`FASE-0-SUPLIA-GLM.md` · `FASE-1-SUPLIA-GLM.md` · `FASE-2-SUPLIA-GLM.md` · `FASE-3-SUPLIA-GLM.md` · `FASE-4-SUPLIA-GLM.md`
**Contexto/diagnóstico:** `PLAN-MEJORA-SUPLIA.md` · `API-INVESTIGACION.md`

> Nota: el `/api/suplia/memory/route.ts` (Fase 2) y la migración `suplia_skills` (Fase 4) están como bloques de código dentro de sus guías.

---

## 2. Orden de aplicación

Recomendado: **una rama por fase** (revisión incremental) o una sola `suplia/mejoras-glm`. Aplica 0→4.

### Fase 0 — base GLM + copy/ICP + research gratis  *(bajo riesgo, alto impacto)*
- Edits (`FASE-0`): GLM único en `model-router.ts`; prompt experto `icp-strategist`; `personalizeForLead` → copy con GLM.
- Nuevo: `suplia-research-tools.ts` (registra `research.similarweb`, `research.whois`).

### Fase 1 — secuencias, scoring, contexto, intent
- Edits (`FASE-1`): prompt de `generate-campaign.ts`; `scoreCompanies`/`scorePeople` con rúbrica; `buildSupliaContext`+`formatContextBrief`; usar `formatContextBrief` en los prompts.
- Nuevo: `suplia-intent-llm.ts` + cableado en `suplia-orchestrator.ts`.

### Fase 2 — research con key + memoria UI + evals
- Edits (`FASE-2`): registrar `research.brand`, `research.brand_mentions` y `research.serp_*` (gateadas por aprobación).
- Nuevo: `/api/suplia/memory/route.ts`, `SupliaMemoryPanel.tsx`, `suplia-evals.ts`.

### Fase 3 — UX + memoria usada + A/B
- Edits (`FASE-3`): inyectar memorias aprobadas en `buildSupliaContext`/`formatContextBrief`; `getWinningSubjects` + inyección en el copy.
- Nuevo: `SupliaChat.tsx` (v1; queda reemplazado por la v2 de Fase 4).

### Fase 4 — fidelidad Claude + skills + registro
- Nuevo: `SupliaChat.tsx` (v2 final), `suplia-artifact-doc.ts`, `suplia-skills-faltantes.ts`, `suplia-skill-registry.ts`.
- Migración: `suplia_skills` (SQL en `FASE-4`). Cablear `resolveSkillsForTurn` en el orchestrator. Cargar fuentes (Inter + Source Serif 4).

---

## 3. Migraciones
- **`suplia_skills`** (Fase 4) — SQL en `FASE-4-SUPLIA-GLM.md` §C1. Aplícala con tu flujo de migraciones Supabase.
- Las demás tablas (`suplia_jobs`, `suplia_memories`, `suplia_company_scores`, etc.) **ya existen** en la rama.

## 4. Variables de entorno
```bash
# GLM como proveedor único (cliente OpenAI-compatible)
SUPLIA_AI_PROVIDER=glm
OPENAI_API_KEY=<tu_api_key_de_GLM>
OPENAI_BASE_URL=<endpoint_OpenAI-compatible_de_GLM>
SUPLIA_GLM_MODEL=glm-5.2           # (+ *_FAST/_BALANCED/_REASONING si quieres por tier)

# Research con key (opcionales; similarweb/whois NO requieren key)
BRANDDEV_API_KEY=...                              # brand
SERPAPI_API_KEY=...                               # brand_mentions / serp_company_news / serp_competitors / serp_jobs_signals
```

## 5. Checklist de validación
```bash
npm run typecheck && npm test
```
- [ ] Telemetría (`suplia_agent_runs`) muestra `modelName` GLM en todo.
- [ ] **Copy** (Fase 0/1): `email.personalize_for_lead` y `campaign.generate_sequence` generan asuntos/cuerpos de calidad (no la plantilla vieja).
- [ ] **Scoring** (Fase 1): cada item trae `breakdown` (fit/intent/reach).
- [ ] **Intent** (Fase 1): mensaje ambiguo cae a GLM y extrae slots.
- [ ] **Research** (Fase 0/2): `research.similarweb` responde sin key; las con key, detrás de aprobación.
- [ ] **Memoria** (Fase 2/3): panel aprueba/olvida; las aprobadas aparecen en el brief.
- [ ] **A/B** (Fase 3): `getWinningSubjects` alimenta el copy.
- [ ] **UX** (Fase 4): streaming de letras, "Pensó durante Xs", panel de artifacts (pestañas + versiones), animaciones.
- [ ] **Skills** (Fase 4): registras una fila en `suplia_skills` y el brain la usa.
- [ ] **Evals** (Fase 2): `evalIntentRegex()` y `evalCopySamples()` corren en CI.

## 6. Estrategia de PR
- Ideal: 5 PRs (`suplia/fase-0` … `suplia/fase-4`), cada uno revisable. Mergear 0→4.
- Rápido: una rama `suplia/mejoras-glm` con todo, aplicando las guías en orden.
- Pásale a OpenCode este README + las 5 guías de fase como contexto; tiene los find/replace exactos y los archivos nuevos.

## 7. Notas
- Las fuentes reales de Claude (Styrene/Tiempos/Copernicus) son propietarias; se usan sustitutas libres (Inter + Source Serif 4). Si las licencias, cambias 2 variables de fuente.
- SimilarWeb y WHOIS usan endpoints públicos no oficiales: cachea y respeta rate limits.
- Todo respeta la privacidad/compliance ya existente (contactabilidad DT, etc.).

---

**Resultado:** SUPL.IA queda como un **Cowork vertical de marketing en GLM** — escribe como experto, decide con datos, recuerda, es seguro, **se ve y se siente como Claude**, y se extiende sin redeploy.
