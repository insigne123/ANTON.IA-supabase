# Fase 2 de SUPL.IA — cambios listos (100% GLM)

> **Antes de empezar, lo más importante:** al investigar la rama encontré que **gran parte de la Fase 2 ya está implementada.** No tiene sentido reconstruirla. Esto es lo que **ya existe y funciona** (no se toca):
>
> - ✅ **Bulk send con dry-run**: `bulkSend` corre en dry-run por defecto, valida ventana horaria y exige confirmación fuerte `ENVIAR`.
> - ✅ **Preflight de compliance**: `preflightCampaign` evalúa una muestra, marca `pass/review/blocked`, **bloquea** el lanzamiento si hay `blocked`, y persiste `risk_summary` + `sample_messages` en `suplia_campaign_previews`.
> - ✅ **Memoria persistente con aprobación**: tabla `suplia_memories` + tools `memory.search / memory.propose / memory.save / memory.forget`.
>
> Entonces la Fase 2 real son **3 piezas que sí faltan y agregan valor**, todo en GLM:

| # | Pieza | Qué agrega |
|---|---|---|
| 1 | **Research con key** | `research.brand / brand_mentions / serp_*` como tools (con aprobación) |
| 2 | **Memoria controlable (UI)** | Panel + ruta API para ver/aprobar/olvidar memorias sin un turno de chat |
| 3 | **Evals propios de SUPL.IA** | Harness offline para medir calidad de copy e intención |

---

## Cambio 1 — Research con key (tools que consumen créditos)

La Fase 0 dejó `research.similarweb` y `research.whois` (gratis). Ahora sumamos las **con key**, usando el archivo actualizado **`suplia-research-tools.ts`**.

1. Copia/integra las funciones `researchBrand`, `researchBrandMentions`, `researchSerpCompanyNews`, `researchSerpCompetitors` y `researchSerpJobsSignals` en `src/lib/server/suplia-tools.ts` (o impórtalas).
2. Regístralas en `SUPLIA_TOOLS` (ver el bloque al pie del archivo `.ts`).
3. **Importante (guardrail):** consumen créditos → trátalas como las búsquedas/enrichment: el agente (`company-scorer` / `enricher`) debe **prepararlas como `pendingAction`** (patrón `lead.enrich_batch`) y **no** incluirlas en la allow-list de tools auto-ejecutables. Las gratis (similarweb/whois) sí pueden correr libres.
4. Envs necesarias: `BRANDDEV_API_KEY` (marca) y `SERPAPI_API_KEY`/`SERP_API_KEY`/`SERPAPI_KEY` (búsquedas). Si una falta, la tool lanza un error claro.

Con esto el scoring y la personalización pueden usar **info de marca, menciones, noticias, competidores y señales de contratación** además del tráfico, mejorando el `breakdown.intent` de la Fase 1.

---

## Cambio 2 — Memoria controlable (UI + API)

Lo que faltaba no era guardar memoria (ya existe), sino que **el usuario la controle** fuera del chat. Dos archivos:

### 2a. Ruta API — `src/app/api/suplia/memory/route.ts` (nuevo)
```ts
import { NextRequest, NextResponse } from 'next/server';

import { handleAuthError, requireAuth } from '@/lib/server/auth-utils';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth();
    const status = req.nextUrl.searchParams.get('status') || 'approved';
    const admin = getSupabaseAdminClient();
    const { data, error } = await admin
      .from('suplia_memories')
      .select('*')
      .eq('organization_id', auth.organizationId)
      .eq('status', status)
      .order('updated_at', { ascending: false })
      .limit(100);
    if (error) throw error;
    return NextResponse.json({ items: data || [] });
  } catch (error: any) {
    if (error?.name === 'AuthError') return handleAuthError(error);
    return NextResponse.json({ error: error?.message || 'No se pudo leer memoria' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth();
    const body = await req.json();
    const action = String(body?.action || '');
    const memoryId = String(body?.memoryId || '');
    if (!memoryId || !['approve', 'forget'].includes(action)) {
      return NextResponse.json({ error: 'Accion invalida' }, { status: 400 });
    }
    const admin = getSupabaseAdminClient();
    const patch = action === 'approve'
      ? { status: 'approved', approved_by: auth.user.id, approved_at: new Date().toISOString(), updated_at: new Date().toISOString() }
      : { status: 'archived', updated_at: new Date().toISOString() };
    const { data, error } = await admin
      .from('suplia_memories')
      .update(patch)
      .eq('id', memoryId)
      .eq('organization_id', auth.organizationId)
      .select('*')
      .maybeSingle();
    if (error) throw error;
    return NextResponse.json({ memory: data });
  } catch (error: any) {
    if (error?.name === 'AuthError') return handleAuthError(error);
    return NextResponse.json({ error: error?.message || 'No se pudo actualizar memoria' }, { status: 500 });
  }
}
```

### 2b. Panel — `src/components/suplia/SupliaMemoryPanel.tsx` (incluido)
Componente listo (solo Tailwind). Móntalo en el `SupliaWorkspace` (en un tab/sección "Memoria") o en ajustes:
```tsx
import { SupliaMemoryPanel } from '@/components/suplia/SupliaMemoryPanel';
// ...
<SupliaMemoryPanel />
```
Lista Activas / Propuestas / Olvidadas, y permite **Aprobar** y **Olvidar** (que mapea a `status: archived`). Respeta organización y auth.

---

## Cambio 3 — Evals propios de SUPL.IA

Archivo **`src/lib/suplia/suplia-evals.ts`** (incluido). Deterministas, sin costo, ideales para CI. Cubre:

- **`assertCopyQuality(subject, body)`** y **`evalCopySamples(samples)`** — reglas de un buen correo (asunto 3-9 palabras, cuerpo 15-130, CTA presente, sin frases prohibidas ni mayúsculas gritonas). Aliméntalo con la salida real de `email.bulk_variant_preview` / `campaign.generate_sequence`.
- **`evalIntentRegex()`** con un set dorado (`INTENT_GOLDEN`) — mide accuracy del clasificador. Amplíalo con casos reales que veas fallar.
- **`evalScoringMonotonic(...)`** — sanity: una empresa mejor-fit debe puntuar más que una peor.

Úsalo en un test (`suplia-evals.test.ts`):
```ts
import { evalCopySamples, evalIntentRegex } from '@/lib/suplia/suplia-evals';

it('intent accuracy no baja del 85%', () => {
  expect(evalIntentRegex().accuracy).toBeGreaterThanOrEqual(85);
});

it('los borradores cumplen reglas de copy', () => {
  const previews = [/* salida real de email.bulk_variant_preview */];
  expect(evalCopySamples(previews).passRate).toBeGreaterThanOrEqual(80);
});
```
Así detectas regresiones de calidad cuando cambies prompts o el modelo.

---

## Aplicar y validar
1. Rama nueva sobre `suplia/github-upload` (ej. `suplia/fase-2-marketing`).
2. `npm run typecheck` y `npm test`.
3. Memoria: abre el panel, aprueba/olvida y confirma que persiste.
4. Research con key: configura una env (ej. `BRANDDEV_API_KEY`) y prueba la tool detrás de una aprobación.
5. Evals: corre `evalIntentRegex()` y `evalCopySamples()` con datos reales.

> No puedo pushear por ti; queda listo para aplicar y abrir el PR.

## Estado del roadmap (lo que queda de verdad)
La mayor parte del master-plan ya está. Quedan, a futuro:
- A/B real de asuntos/secuencias con feedback automático al copywriter (medir apertura/respuesta y reentrenar el prompt con lo que gana).
- Memoria **usada** activamente en los prompts de los agentes (hoy se guarda; falta inyectarla curada en el context brief).
- Dashboard de calidad (evals + costo por job, que ya tienes en telemetría) para vigilar que GLM mantenga el estándar.
