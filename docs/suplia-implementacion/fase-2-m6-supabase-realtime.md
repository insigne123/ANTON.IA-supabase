# M6 — Supabase Realtime en vez de polling

**Fase:** 2 · **Independiente** · **Flag:** `NEXT_PUBLIC_SUPLIA_REALTIME` (default `false`)
**Resuelve:** H7 (polling del estado completo cada 4 s mientras hay jobs vivos; refetch total tras cada acción).

---

## 1. Contexto actual

En `SupliaWorkspace.tsx` (~línea 1810) hay un `useEffect` que, cuando `jobIsLive`, ejecuta `loadWorkspace(conversationId, { silent: true })` cada 4000 ms — eso re-consulta TODO el estado (6 queries server-side) aunque no haya cambios. Además `approveAction`/`cancelAction` refetchean el estado completo.

El cliente Supabase browser ya está disponible vía `@supabase/auth-helpers-nextjs` (`createClientComponentClient`) — verificar cómo lo instancian otros componentes del repo (buscar `createClientComponentClient` en `src/`) y reutilizar el mismo patrón/singleton si existe.

## 2. Diseño

Suscripción Realtime (postgres_changes) a las tablas que mutan durante un job/aprobación, filtrada por conversación, con **refetch selectivo con debounce** como estrategia de reconciliación (más simple y robusto que aplicar deltas fila a fila):

```
canal suplia:conversation:<id>
  ├─ suplia_jobs            (filter: conversation_id=eq.<id>)  → refetch estado (debounced)
  ├─ suplia_job_steps       (filter: conversation_id=eq.<id>)  → refetch estado (debounced)
  ├─ suplia_pending_actions (filter: conversation_id=eq.<id>)  → refetch estado (debounced)
  ├─ suplia_artifacts       (filter: conversation_id=eq.<id>)  → refetch estado (debounced)
  └─ suplia_messages        (filter: conversation_id=eq.<id>)  → refetch estado (debounced)
```

Debounce de 800 ms agrupando ráfagas. El polling actual queda como **fallback** cuando el flag está apagado o el canal falla.

## 3. Migración `supabase/migrations/20260707T0003_suplia_realtime.sql`

Realtime postgres_changes respeta RLS: el usuario autenticado necesita policy de SELECT sobre esas tablas (hoy el acceso es solo vía service role y probablemente no existan policies). La membresía se resuelve contra `organization_members` (misma tabla que usa `requireAuth`).

```sql
-- Función helper de membresía (idempotente)
create or replace function public.is_org_member(org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = org and m.user_id = auth.uid()
  );
$$;

-- Policies de solo lectura para realtime (una por tabla; repetir patrón)
alter table public.suplia_jobs enable row level security;
drop policy if exists suplia_jobs_select_members on public.suplia_jobs;
create policy suplia_jobs_select_members on public.suplia_jobs
  for select to authenticated using (public.is_org_member(organization_id));

-- Repetir exactamente igual para: suplia_job_steps, suplia_pending_actions,
-- suplia_artifacts, suplia_messages, suplia_conversations, suplia_tool_runs.

-- Publicación realtime (si las tablas no están ya en supabase_realtime)
alter publication supabase_realtime add table public.suplia_jobs;
alter publication supabase_realtime add table public.suplia_job_steps;
alter publication supabase_realtime add table public.suplia_pending_actions;
alter publication supabase_realtime add table public.suplia_artifacts;
alter publication supabase_realtime add table public.suplia_messages;
```

Precauciones: (1) `alter publication ... add table` falla si la tabla ya está en la publicación — comprobar antes con `select * from pg_publication_tables where pubname = 'supabase_realtime'` y añadir solo las que falten (o envolver cada una en un bloque `do $$ begin ... exception when duplicate_object then null; end $$;`). (2) Habilitar RLS en tablas que hoy quizá no lo tienen NO afecta al server (service role bypassa RLS), pero verificar que **ningún** código cliente actual consulte esas tablas directamente con el anon key (buscar `from('suplia_` fuera de `src/lib/server` y `src/app/api`); si existiera alguno, estas policies precisamente lo legalizan para lectura de la propia org.

## 4. Hook cliente: `src/hooks/use-suplia-realtime.ts`

```ts
'use client';

import { useEffect, useRef } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';

const WATCHED_TABLES = ['suplia_jobs', 'suplia_job_steps', 'suplia_pending_actions', 'suplia_artifacts', 'suplia_messages'] as const;

export function useSupliaRealtime(params: {
  conversationId: string | null;
  enabled: boolean;
  onChange: () => void;              // callback ya debounced por el caller o aquí
  onStatus?: (status: 'connected' | 'error' | 'closed') => void;
}) {
  const onChangeRef = useRef(params.onChange);
  onChangeRef.current = params.onChange;

  useEffect(() => {
    if (!params.enabled || !params.conversationId) return;
    const supabase = createClientComponentClient();
    let debounceTimer: number | null = null;
    const fire = () => {
      if (debounceTimer) window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(() => onChangeRef.current(), 800);
    };

    let channel = supabase.channel(`suplia:conversation:${params.conversationId}`);
    for (const table of WATCHED_TABLES) {
      channel = channel.on('postgres_changes',
        { event: '*', schema: 'public', table, filter: `conversation_id=eq.${params.conversationId}` },
        fire);
    }
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') params.onStatus?.('connected');
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') params.onStatus?.('error');
    });

    return () => {
      if (debounceTimer) window.clearTimeout(debounceTimer);
      supabase.removeChannel(channel);
    };
  }, [params.conversationId, params.enabled]);
}
```

## 5. Integración en `SupliaWorkspace.tsx`

1. `const realtimeEnabled = process.env.NEXT_PUBLIC_SUPLIA_REALTIME === 'true';`
2. Estado `const [realtimeHealthy, setRealtimeHealthy] = useState(false);`
3. Montar el hook:
   ```ts
   useSupliaRealtime({
     conversationId: state.conversation?.id || null,
     enabled: realtimeEnabled,
     onChange: () => loadWorkspace(state.conversation?.id, { silent: true }),
     onStatus: (s) => setRealtimeHealthy(s === 'connected'),
   });
   ```
4. Condicionar el polling existente: en el `useEffect` del intervalo de 4 s, agregar guard `if (realtimeEnabled && realtimeHealthy) return;` — así el polling solo corre como fallback (flag apagado o canal caído).
5. `approveAction`/`cancelAction`: cuando realtime está sano se puede omitir el `loadWorkspace(...)` posterior (la mutación dispara el canal); mantenerlo si `!realtimeHealthy`. Nota: la respuesta del approve ya trae el estado (`applyResponse(data)`), así que este refetch era doble de todos modos.
6. `.env.example`: `NEXT_PUBLIC_SUPLIA_REALTIME="false"`.

## 6. QA manual

1. Flag apagado → comportamiento idéntico al actual (polling 4 s con job vivo).
2. Flag prendido: lanzar un job (plan aprobable → aprobar) y verificar en la pestaña Network que **no** hay GETs periódicos a `/api/suplia/chat`, y que los pasos del job se actualizan solos (< 2 s tras cada transición).
3. Abrir la misma conversación en 2 pestañas: aprobar en una → la tarjeta cambia de estado en la otra sin recargar.
4. Matar la conexión (DevTools offline 10 s): al volver, el canal se reconecta o el polling fallback retoma; la UI no queda congelada.
5. Seguridad: con un usuario de OTRA organización, suscribirse manualmente al canal de una conversación ajena (consola) → no recibe eventos (RLS).

## 7. Rollback

`NEXT_PUBLIC_SUPLIA_REALTIME=false`. Las policies de SELECT y la publicación pueden quedarse (solo lectura de la propia org); revertirlas requiere migración inversa explícita si se desea.
