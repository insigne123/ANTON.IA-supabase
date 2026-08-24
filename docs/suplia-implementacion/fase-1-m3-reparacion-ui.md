# M3 — Reparación de superficie muerta de la UI + feedback persistente

**Fase:** 1 · **Independiente** (no requiere M1) · **Riesgo:** bajo
**Resuelve:** H4 (botones muertos, ícono incorrecto), H13 (dictado es-ES), H16 (quick action "Programado" placeholder).

Todo el trabajo es en `src/components/suplia/SupliaWorkspace.tsx` + 1 endpoint nuevo + 1 migración SQL. Respetar `AGENTS.md` (estilo Apple-like) y **no** renombrar clases CSS `suplia-*`.

---

## 1. Botón Copiar (funcional)

Ubicación actual: función `MessageActions` (~línea 1144), botón `title="Copiar"` sin `onClick`.

1. Cambiar la firma: `function MessageActions({ message, onRetry, onFeedback, feedback }: { message: SupliaMessage; onRetry: () => void; onFeedback: (rating: 'up' | 'down') => void; feedback?: 'up' | 'down' | null })`.
2. Copiar debe copiar el **texto plano** del mensaje: `message.content` (no las parts). Implementación con estado local:

```tsx
const [copied, setCopied] = useState(false);
async function copyMessage() {
  try {
    await navigator.clipboard.writeText(message.content || '');
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  } catch {
    // clipboard puede fallar sin https; no romper
  }
}
// render: {copied ? <CheckCircle2 className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
```

3. Actualizar el call-site (en el render del transcript donde se usa `<MessageActions onRetry={...} />`) para pasar `message`, `feedback` y `onFeedback` (ver sección 2.4).

## 2. Feedback persistente (ThumbsUp / ThumbsDown)

### 2.1 Migración `supabase/migrations/20260707T0001_suplia_message_feedback.sql`

```sql
create table if not exists public.suplia_message_feedback (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  conversation_id uuid not null,
  message_id uuid not null,
  user_id uuid not null,
  rating text not null check (rating in ('up', 'down')),
  comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (message_id, user_id)
);

create index if not exists idx_suplia_message_feedback_org
  on public.suplia_message_feedback (organization_id, created_at desc);

alter table public.suplia_message_feedback enable row level security;
-- El acceso es solo via API server-side con service role (bypassa RLS).
-- No se crean policies de anon/authenticated a proposito.
```

### 2.2 Endpoint `src/app/api/suplia/messages/[messageId]/feedback/route.ts`

Seguir el patrón exacto de los routes existentes (`requireAuth`, `handleAuthError`, `getSupabaseAdminClient`, `dynamic = 'force-dynamic'`, `runtime = 'nodejs'`):

```ts
export async function POST(req: NextRequest, { params }: { params: Promise<{ messageId: string }> }) {
  try {
    const auth = await requireAuth();
    const { messageId } = await params;
    const body = await req.json().catch(() => ({}));
    const rating = body?.rating === 'up' || body?.rating === 'down' ? body.rating : null;
    if (!rating) return NextResponse.json({ error: 'rating invalido' }, { status: 400 });

    const admin = getSupabaseAdminClient();
    // Validar pertenencia: el mensaje debe existir y ser de la organizacion del usuario
    const { data: message, error: messageError } = await admin
      .from('suplia_messages')
      .select('id, conversation_id, organization_id')
      .eq('id', messageId)
      .eq('organization_id', auth.organizationId)
      .maybeSingle();
    if (messageError) throw messageError;
    if (!message) return NextResponse.json({ error: 'Mensaje no encontrado' }, { status: 404 });

    const now = new Date().toISOString();
    const { error } = await admin.from('suplia_message_feedback').upsert({
      organization_id: auth.organizationId,
      conversation_id: message.conversation_id,
      message_id: messageId,
      user_id: auth.user.id,
      rating,
      comment: typeof body?.comment === 'string' ? body.comment.slice(0, 2000) : null,
      updated_at: now,
    }, { onConflict: 'message_id,user_id' });
    if (error) throw error;
    return NextResponse.json({ ok: true, rating });
  } catch (error: any) {
    if (error?.name === 'AuthError') return handleAuthError(error);
    console.error('[SUPLIA/feedback] error:', error);
    return NextResponse.json({ error: error?.message || 'No se pudo guardar el feedback' }, { status: 500 });
  }
}
```

`DELETE` opcional para quitar feedback (mismo patrón, `delete().eq('message_id').eq('user_id')`). Implementarlo: el toggle de UI lo usa al despulsar.

### 2.3 Estado y handler en `SupliaWorkspace`

En el componente principal:

```tsx
const [messageFeedback, setMessageFeedback] = useState<Record<string, 'up' | 'down'>>({});

async function submitFeedback(message: SupliaMessage, rating: 'up' | 'down') {
  const current = messageFeedback[message.id];
  const next = current === rating ? null : rating;             // toggle
  setMessageFeedback((prev) => {
    const copy = { ...prev };
    if (next) copy[message.id] = next; else delete copy[message.id];
    return copy;
  });                                                           // optimista
  try {
    if (next) {
      const res = await fetch(`/api/suplia/messages/${message.id}/feedback`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating: next }),
      });
      if (!res.ok) throw new Error('feedback failed');
    } else {
      await fetch(`/api/suplia/messages/${message.id}/feedback`, { method: 'DELETE' });
    }
  } catch {
    setMessageFeedback((prev) => ({ ...prev, ...(current ? { [message.id]: current } : {}) })); // revertir
    toast({ variant: 'destructive', title: 'No se pudo guardar el feedback' });
  }
}
```

### 2.4 Render en `MessageActions`

ThumbsUp/Down con estado activo (usar el accent existente):

```tsx
<button type="button" className={cn('suplia-act', feedback === 'up' && 'text-[var(--suplia-accent)]')}
  title="Buena respuesta" aria-pressed={feedback === 'up'} onClick={() => onFeedback('up')}>
  <ThumbsUp className="h-4 w-4" />
</button>
```

No hay que hidratar feedback histórico en M3 (el estado es por sesión); dejarlo anotado como TODO si se quiere hidratar después vía `getSupliaState`.

## 3. Ícono del menú "Herramientas"

En el composer (~línea 2402) el trigger del dropdown "Herramientas" usa `<Mic .../>` — incorrecto y duplicado con el botón de dictado real (~línea 2426).

1. Importar `SlidersHorizontal` de `lucide-react` (agregarlo al import existente).
2. Reemplazar en el trigger: `<SlidersHorizontal className="h-4 w-4" /><span>Herramientas</span>`.
3. El botón de dictado real conserva `Mic`.

## 4. Dictado: idioma correcto

En `toggleDictation` (~línea 1673), reemplazar `recognition.lang = 'es-ES';` por:

```ts
const preferred = typeof navigator !== 'undefined' ? navigator.language : '';
recognition.lang = preferred && preferred.toLowerCase().startsWith('es') ? preferred : 'es-CL';
```

## 5. Quick action "Programado"

En `startQuickAction` (~línea 1633) el caso `'scheduled'` muestra un toast placeholder. Cambiar a flag:

1. `const scheduledEnabled = process.env.NEXT_PUBLIC_SUPLIA_SCHEDULED_ENABLED === 'true';`
2. Ocultar el botón/entrada del sidebar que dispara `startQuickAction('scheduled')` cuando `!scheduledEnabled` (localizar el call-site buscando `'scheduled'` en el archivo).
3. `.env.example`: `NEXT_PUBLIC_SUPLIA_SCHEDULED_ENABLED="false"`.

## 6. QA manual

1. Copiar un mensaje del assistant → aparece check 1,4 s y el portapapeles tiene el texto.
2. Pulsar ThumbsUp → ícono acentuado; fila en `suplia_message_feedback` con rating `up`; volver a pulsar → se elimina la fila.
3. Pulsar ThumbsDown tras ThumbsUp → la fila cambia a `down` (upsert, no duplica).
4. Menú "Herramientas" muestra ícono de sliders; dictado sigue funcionando con su propio Mic.
5. Con el flag apagado no aparece "Programado" en el sidebar.
6. `npm run typecheck` y `npm run test` en verde.

## 7. Rollback

Cambios de UI son locales al componente. La tabla de feedback es aditiva (no romper nada si se ignora).
