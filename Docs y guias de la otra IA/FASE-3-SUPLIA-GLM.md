# Fase 3 de SUPL.IA — UX clara + cierre (100% GLM)

> Foco de esta fase: que **usar SUPL.IA se sienta como chatear con Claude** — limpio, conversación-first, sin ruido. Además cierra dos pendientes reales: **usar la memoria aprobada** en los prompts y un **loop A/B** que alimente al copywriter con lo que funciona.

---

## A. UX — chat claro y simple, estilo Claude  ⭐

### El problema hoy
`SupliaWorkspace.tsx` (≈2.000 líneas) muestra mucha maquinaria a la vez (jobs, steps, tool-runs, artifacts, aprobaciones, paneles). Es potente, pero **abruma**. Claude se siente simple porque el **hilo de conversación es el héroe** y todo lo demás aparece solo cuando hace falta.

### La solución: `SupliaChat.tsx` (incluido)
Un componente nuevo, **conversación-first**, conectado al **contrato real** (`GET/POST /api/suplia/chat` con SSE). Principios aplicados:

- **El hilo manda.** Tipografía serif para las respuestas (como Claude), mucho aire, ancho de lectura ~720px.
- **La maquinaria se vuelve discreta.** `tool-call` y `job-progress` se muestran como **chips pequeños** ("Buscando empresas", "Trabajo en curso"), no como paneles.
- **Artifacts en panel lateral** (como Claude): la tarjeta abre el artifact a la derecha; el chat se angosta. Cerrar = vuelve a pantalla completa.
- **Aprobaciones claras.** `approval-request` es una tarjeta simple con **Aprobar / Cancelar** (llama a `/api/suplia/actions/[id]/approve|cancel`). El guardrail sigue intacto, pero se ve y se entiende.
- **Preguntas como en Claude.** `ask` se renderiza como tarjeta con opciones + "Otra respuesta…", y la respuesta vuelve por `answerToAsk`.
- **Progreso honesto mientras piensa.** Mientras llega el `final`, muestra la fase actual del SSE ("Analizando pedido…", "Validando permisos…") con la estrella pulsante. Sin spinners genéricos.

### Cómo montarlo (bajo riesgo)
No borres el workspace actual. Ofrécelo como **"Modo simple"** (toggle) para no perder nada:
```tsx
// en src/app/(app)/suplia/page.tsx (o donde montas el workspace)
import { SupliaChat } from '@/components/suplia/SupliaChat';
import { SupliaWorkspace } from '@/components/suplia/SupliaWorkspace';

const [simple, setSimple] = useState(true); // arranca en modo simple
return simple ? <SupliaChat /> : <SupliaWorkspace /* ...props... */ />;
```
Pon un switch "Vista simple / avanzada" en el header. Empieza con la vista simple por defecto: para el 90% de los usos (pedir → ver respuesta → aprobar → abrir artifact) es justo lo que necesitan.

> `SupliaChat.tsx` es autocontenido (solo Tailwind). Renderiza `text, table, code, ask, artifact-card, approval-request, tool-call, job-progress`. Para artifacts con render rico (leads/ICP/report) puedes reusar los renderers que ya tienes; aquí el panel muestra `title + content` y queda listo para enchufar el render que prefieras.

---

## B. Usar la memoria aprobada en los prompts

Hoy la memoria se guarda y se aprueba, pero **no se inyecta** en el razonamiento. Esto la activa. Sobre el `buildSupliaContext` / `formatContextBrief` de la Fase 1:

### B1. Agrega memorias al contexto
En `buildSupliaContext`, suma una lectura y al `return`:
```ts
// dentro del Promise.all, agrega:
admin.from('suplia_memories').select('memory_type, key, value')
  .eq('organization_id', organizationId).eq('status', 'approved')
  .order('updated_at', { ascending: false }).limit(8),
// (recibe el resultado como `memoriesRes` al final del destructuring)

// en el tipo SupliaAppContext agrega:
memories: { type: string; key: string; text: string }[];

// en el return agrega:
memories: (memoriesRes.data || []).map((m: any) => ({
  type: String(m.memory_type || 'preference'),
  key: String(m.key || ''),
  text: typeof m.value === 'object' && m.value ? String((m.value as any).text ?? JSON.stringify(m.value)) : String(m.value ?? ''),
})),
```

### B2. Muéstralas en el brief
En `formatContextBrief`, añade al final:
```ts
  if (ctx.memories && ctx.memories.length) {
    lines.push('Memoria aprobada por el usuario (respétala):');
    for (const m of ctx.memories) lines.push(`- ${m.key}: ${m.text}`);
  }
```
Como los prompts de Fase 1 ya usan `formatContextBrief(context)`, los agentes empiezan a **respetar lo que el usuario aprobó recordar** (tono, exclusiones, foco) sin más cambios.

---

## C. Loop A/B — alimentar al copywriter con lo que funciona

Mide qué asuntos generan respuesta y pásaselos al copywriter como referencia de estilo.

### C1. Helper (en `suplia-context.ts` o un helper)
```ts
export async function getWinningSubjects(auth: AuthContext, limit = 5) {
  const admin = getSupabaseAdminClient();
  const { data } = await admin
    .from('contacted_leads')
    .select('subject, replied_at')
    .eq('organization_id', auth.organizationId)
    .not('subject', 'is', null)
    .order('sent_at', { ascending: false })
    .limit(500);
  const map = new Map<string, { sent: number; replied: number }>();
  for (const row of (data || []) as any[]) {
    const subject = String(row.subject || '').trim();
    if (!subject) continue;
    const m = map.get(subject) || { sent: 0, replied: 0 };
    m.sent += 1; if (row.replied_at) m.replied += 1;
    map.set(subject, m);
  }
  return [...map.entries()]
    .map(([subject, m]) => ({ subject, sent: m.sent, replied: m.replied, replyRate: m.sent ? Math.round((m.replied / m.sent) * 100) : 0 }))
    .filter((x) => x.sent >= 3)
    .sort((a, b) => b.replyRate - a.replyRate || b.sent - a.sent)
    .slice(0, limit);
}
```

### C2. Inyéctalo en el copy
En el `runCopywriter` (agente), calcula los ganadores **una vez** y pásalos al preview:
```ts
const winners = await getWinningSubjects(execution.auth, 5);
const previews = await runInternalTool(execution, 'email.bulk_variant_preview', {
  leads: leads.slice(0, 8), offerSummary: goal, cta: '...', limit: 8,
  winningSubjects: winners.map((w) => w.subject),   // <-- NUEVO
}, 'balanced');
```
Y en el prompt de `personalizeForLead` (Fase 0), si llega `input.winningSubjects`, añade:
```ts
${Array.isArray((input as any).winningSubjects) && (input as any).winningSubjects.length
  ? `\nAsuntos que ya generaron respuesta (replica el ESTILO, no el texto):\n- ${(input as any).winningSubjects.slice(0,5).join('\n- ')}`
  : ''}
```
Así el copy mejora solo a medida que acumulas datos reales — sin reentrenar nada y sin salir de GLM.

---

## Validar
1. Rama nueva sobre `suplia/github-upload` (ej. `suplia/fase-3-ux`).
2. Monta `SupliaChat` como "Vista simple" y pruébalo de punta a punta: pedir → ver fases → respuesta → abrir artifact → aprobar una acción → responder un `ask`.
3. `npm run typecheck` y `npm test`.
4. Aprueba una memoria (panel de Fase 2) y confirma que aparece en el brief de los agentes.
5. Con datos de `contacted_leads`, corre `getWinningSubjects` y revisa que el copy referencie esos estilos.

> No puedo pushear por ti; queda listo para aplicar y abrir el PR.

---

## Cierre del roadmap (Fases 0→3)
Con todo aplicado, SUPL.IA queda como un **consultor de marketing en GLM**:

- **Escribe mejor**: copy 1:1 y secuencias con criterio (Fase 0/1), y que aprende de lo que funciona (Fase 3).
- **Decide con datos**: scoring transparente + research real, gratis y con key (Fase 1/2).
- **Entiende y recuerda**: contexto curado, intent híbrido y memoria que sí usa (Fase 1/3).
- **Es seguro**: aprobaciones, preflight, dry-run y evals (ya existentes + Fase 2).
- **Se siente simple**: chat claro estilo Claude, con la maquinaria escondida (Fase 3).

Lo único verdaderamente "a futuro": un dashboard de calidad/costo (ya tienes la telemetría por `suplia_agent_runs` para alimentarlo) y A/B formal multivariante. Todo lo demás está cubierto.
