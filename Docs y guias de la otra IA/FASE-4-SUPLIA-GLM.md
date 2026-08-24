# Fase 4 de SUPL.IA — fidelidad visual de Claude + 4 skills + registro extensible (100% GLM)

> Tres entregas: (A) SUPL.IA **se ve como Claude** hasta el detalle, (B) las **4 skills** que faltaban, (C) un **registro de skills** para que SUPL.IA sea extensible como Cowork.

Detalles de Claude confirmados (investigados): acento **terracota `#da7756`**, fondo crema, serif **Tiempos** (uso *Source Serif 4* como sustituto libre), sans **Styrene** (≈ *Inter*), y los artifacts se renderizan como **iframe con HTML inline** (canvas a la derecha, pestañas). Todo eso está aplicado.

---

## A. Visual fiel a Claude

### Archivos
- **`SupliaChat.tsx`** → `src/components/suplia/SupliaChat.tsx`
- **`suplia-artifact-doc.ts`** → `src/lib/suplia/suplia-artifact-doc.ts`

### Qué replica de Claude (al detalle)
- **Tokens exactos**: terracota `#da7756`, crema `#faf9f5`/`#f0eee6`, bordes `#e7e4d8`, texto `#1f1e1d`.
- **Tipografía**: respuestas en **serif** (`Source Serif 4` ≈ Tiempos), UI en **sans** (`Inter` ≈ Styrene).
- **Streaming de letras**: cada respuesta aparece **palabra por palabra con caret** (reveal client-side, porque el SSE manda el mensaje completo — así se ve igual que Claude aunque el backend no envíe token a token).
- **Bloque de pensamiento**: mientras genera muestra la **fase real del SSE** ("Validando permisos…") con estrella pulsante + shimmer; al terminar colapsa a **"Pensó durante Xs"** expandible con las fases.
- **Panel de artifacts estilo Claude**: se abre a la derecha (el chat se angosta), **iframe con HTML inline**, pestañas **Vista previa / Datos**, **navegación de versiones** `‹ i/n ›`, botones Copiar / Guardar en CRM.
- **Micro-animaciones**: `rise` (mensajes entran), `slide-in` (panel), `shimmer` (pensando), `pulse` (estrella), `blink` (caret), barras que crecen en los artifacts.
- **Render rico por tipo** (`suplia-artifact-doc.ts`): `lead_list`, `icp_strategy`, `email_draft`, `campaign_draft`, `report`/`pipeline_summary`… cada uno con su layout (tablas con score, fichas, secuencias, KPIs/barras).

### Montaje (bajo riesgo)
1. Carga las fuentes (en el layout):
```html
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Source+Serif+4:opsz,wght@8..60,400;8..60,500;8..60,600&display=swap" rel="stylesheet">
```
2. Ofrece `SupliaChat` como **"Vista simple"** junto al workspace avanzado (no borres nada):
```tsx
import { SupliaChat } from '@/components/suplia/SupliaChat';
const [simple, setSimple] = useState(true);
return simple ? <SupliaChat /> : <SupliaWorkspace /* ...props... */ />;
```
> Las fuentes reales de Claude (Styrene/Tiempos/Copernicus) son propietarias; estas son sustitutas libres muy cercanas. Si licencias las originales, solo cambias 2 variables de fuente.

---

## B. Las 4 skills que faltaban

Archivo **`suplia-skills-faltantes.ts`**. Intégralas en `suplia-tools.ts` (o impórtalas) y regístralas en `SUPLIA_TOOLS` (ver bloque al pie del `.ts`):

| Tool | Skill OpenClaudia | Modelo / costo |
|---|---|---|
| `research.brand_mentions` | brand-monitor | Brand.dev (créditos → **aprobación**) |
| `email.subject_variants` | email-subject-lines | GLM (genera + puntúa asuntos) |
| `marketing.demand_gen_plan` | demand-gen | GLM (plan multicanal → artifact `report`) |
| `research.competitor_analysis` | competitor-analysis | orquesta `research.similarweb` + `research.serp_competitors` |

- Las 3 con GLM corren en tu proveedor único; `research.brand_mentions` consume créditos → **gatear por aprobación** (patrón `lead.enrich_batch`).
- Todas devuelven artifacts tipo `report`/`subjects` que el panel de la Parte A ya renderiza.

---

## C. Registro de skills extensible (como Cowork)

Archivo **`suplia-skill-registry.ts`** + esta migración. Permite **agregar capacidades sin redeploy**: una fila en `suplia_skills` y SUPL.IA la "aprende".

### C1. Migración — `supabase/migrations/2026XXXX_suplia_skills.sql`
```sql
create table if not exists public.suplia_skills (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  slug text not null,
  name text not null,
  description text not null default '',
  triggers text[] not null default '{}',
  kind text not null default 'prompt' check (kind in ('prompt','tool','agent')),
  config jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, slug)
);
alter table public.suplia_skills enable row level security;
create policy "org members read skills" on public.suplia_skills
  for select using (organization_id = (auth.jwt() ->> 'organization_id')::uuid);
```

### C2. Cablear en el orchestrator (antes del brain)
En `processSupliaMessage`, justo antes de `runSupliaBrain`:
```ts
import { resolveSkillsForTurn } from '@/lib/server/suplia-skill-registry';
// ...
const skills = await resolveSkillsForTurn(auth, message);
// inyecta en el prompt del brain:
//   skills.catalog               -> catálogo de skills disponibles
//   skills.activatedInstructions -> conocimiento de las skills 'prompt' que matchean
//   skills.suggestedTools / .suggestedAgents -> pistas de qué usar
```
Pásalos a `runSupliaBrain` (concaténalos al `conversationContext`/system) para que SUPL.IA sepa qué sabe hacer y use la skill correcta.

### C3. Sembrar skills (ejemplos)
```sql
-- Skill de conocimiento (estilo OpenClaudia): playbook de copy en frío
insert into public.suplia_skills (organization_id, slug, name, description, triggers, kind, config) values
('<ORG_ID>', 'copy-frio-chile', 'Copy en frío (Chile)',
 'Cómo escribir correos en frío que convierten en Chile.',
 array['correo en frio','cold email','asunto','redacta correo'], 'prompt',
 '{"instructions":"Una idea por correo. Apertura con una señal real del prospecto. CTA único de baja fricción (15 min). Español de Chile, cercano. Sin promesas no respaldadas."}'::jsonb);

-- Skill que ata triggers a una tool existente
insert into public.suplia_skills (organization_id, slug, name, description, triggers, kind, config) values
('<ORG_ID>', 'trafico-web', 'Tráfico web', 'Mira el tráfico estimado de un dominio.',
 array['trafico','similarweb','visitas','cuanto trafico'], 'tool', '{"tool":"research.similarweb"}'::jsonb);
```
Así, las **skills de OpenClaudia** (icp-builder, email-sequence, etc.) se pueden cargar como filas `kind:'prompt'` con su técnica, y las nuevas tools como `kind:'tool'` — sin tocar el código.

---

## Validar
1. Rama nueva sobre `suplia/github-upload` (ej. `suplia/fase-4-claude-ux`).
2. Monta `SupliaChat`, carga las fuentes y revisa: streaming de letras, "Pensó durante Xs", panel de artifacts (pestañas + versiones).
3. `npm run typecheck` y `npm test`.
4. Registra las 4 tools; prueba `email.subject_variants` y `research.competitor_analysis` (esta última sin key, con SimilarWeb).
5. Aplica la migración, siembra 1-2 skills y confirma que el brain las menciona/usa.

> No puedo pushear por ti; queda listo para aplicar y abrir el PR.

---

## ¿Quedó "como Claude / como Cowork"?
- **Como Claude (visual)**: ✅ tokens, tipografía serif, streaming de letras, pensamiento, panel de artifacts en iframe con pestañas/versiones y todas las animaciones.
- **Como Cowork (paradigma)**: ✅ chat claro + ejecución autónoma + tools/conectores + artifacts + memoria + aprobaciones + tareas programadas, y ahora **extensible por skills** (registro) — la pieza que faltaba para igualar el modelo de Cowork.

Con Fases 0→4, SUPL.IA es un **Cowork vertical de marketing en GLM**: escribe como experto, decide con datos, recuerda, es seguro, **se ve y se siente como Claude**, y se extiende sin redeploy.
