# M5 — Adjuntos multimodales (imágenes y PDF) con GLM-5V-Turbo

**Fase:** 2 · **Depende de:** M1 · **Flag:** `SUPLIA_ATTACHMENTS_VISION` (default `false`)
**Resuelve:** H6 (adjuntos solo texto de 8 KB concatenados al mensaje; imágenes/PDF "no soportados").

---

## 1. Contexto actual

- Frontend: `handleFilesSelected` (SupliaWorkspace, ~línea 1585) lee solo extensiones de `readableAttachmentExtensions`, trunca a 8.000 chars y marca el resto `unsupported`.
- `buildComposerMessage` (~línea 1607) concatena el contenido de los adjuntos AL TEXTO del mensaje → contamina historial y compactación.
- El body del POST a `/api/suplia/chat` no incluye adjuntos como campo estructurado.

## 2. Diseño

1. Los adjuntos viajan como campo estructurado `attachments[]` en el POST (ya no concatenados al texto).
2. Servidor: texto → se registra como parte del contexto del turno (part `attachment`); imágenes → análisis con GLM-5V-Turbo; PDF → extracción de texto server-side con `unpdf` (sin binarios nativos, apto para serverless); opcionalmente páginas-imagen a visión en una iteración futura.
3. El resultado del análisis entra al loop agéntico como un **tool message inicial** (`attachment_context`), no como texto del usuario: el historial queda limpio.

Límites: máx 5 adjuntos por mensaje; imagen ≤ 4 MB (png/jpeg/webp/gif); PDF ≤ 8 MB / 50 páginas; texto ≤ 64 KB (subir el límite actual). Payload total del POST ≤ 20 MB.

## 3. Dependencias

```bash
npm install unpdf@^0.11
```

(`unpdf` expone `extractText`; funciona en Node runtime de Next sin worker files.)

## 4. Cambios

### 4.1 Frontend — `handleFilesSelected` y envío

```ts
type ComposerAttachment = {
  id: string; name: string; type: string; size: number;
  kind: 'text' | 'image' | 'pdf' | 'unsupported';
  content?: string;        // texto plano (kind text)
  dataUrl?: string;        // data:<mime>;base64,... (kind image | pdf)
};
```

- Clasificar por MIME/extensión: `image/(png|jpeg|webp|gif)` → `image` (leer con `FileReader.readAsDataURL`); `application/pdf` → `pdf` (dataURL); extensiones de texto actuales → `text` (mantener lectura como hoy, límite 64 KB); resto → `unsupported`.
- Validar tamaños al seleccionar; si excede, toast destructivo y no agregar.
- `buildComposerMessage`: **eliminar** la concatenación de adjuntos; el mensaje queda solo con el texto del usuario (+ prefijo de modo). El chip visual de adjuntos se mantiene.
- `sendMessage`: incluir en el body `attachments: attachments.filter(a => a.kind !== 'unsupported').map(({ id, name, type, size, kind, content, dataUrl }) => ({ id, name, mime: type, size, kind, content, dataUrl }))`.
- Persistencia visual: agregar el part nuevo al mensaje optimista: `{ type: 'attachment', name, mime, kind }` por cada adjunto (agregar la variante al union `SupliaMessagePart` en `src/lib/suplia/types.ts`: `| { type: 'attachment'; name: string; mime: string; kind: string; summary?: string | null }`) y renderizarlo como chip en `MessageBubble`.

### 4.2 Route `/api/suplia/chat` (POST)

- Parsear `body.attachments` con validación estricta (array ≤ 5; por ítem: `name` string ≤ 200, `kind` en enum, tamaños según límites — decodificar base64 length ≈ `size`). Rechazar 400 si excede.
- Pasar `attachments` a `processSupliaMessageAgentic` (agregar al tipo del input). En modo legacy: comportamiento anterior (si llegan adjuntos, degradar concatenando el texto de los `kind:'text'` al mensaje, para no romper).

### 4.3 Servidor — `src/lib/server/suplia-attachments.ts` (NUEVO)

```ts
export type IncomingAttachment = { id: string; name: string; mime: string; size: number; kind: 'text' | 'image' | 'pdf'; content?: string; dataUrl?: string };
export type AttachmentDigest = { name: string; kind: string; summary: string };   // lo que ve el modelo

export function isAttachmentsVisionEnabled() {
  return String(process.env.SUPLIA_ATTACHMENTS_VISION || 'false').toLowerCase() === 'true';
}

export async function digestAttachments(atts: IncomingAttachment[], signal?: AbortSignal): Promise<AttachmentDigest[]>
```

Por tipo:

- `text` → `summary = content.slice(0, 32000)` con nota de truncado.
- `pdf` → `const { text } = await extractText(base64ToUint8(dataUrl), { mergePages: true })`; `summary = text.slice(0, 32000)`. Si `extractText` falla o devuelve < 40 chars y `isAttachmentsVisionEnabled()` → intentar visión (siguiente punto) como fallback; si no, `summary = '[PDF sin texto extraible]'`.
- `image` → si `!isAttachmentsVisionEnabled()` → `summary = '[Imagen adjunta: analisis desactivado]'`. Si está activo, llamada multimodal:

```ts
// en glm-chat.ts: ampliar GlmChatMessage.user para aceptar content como array de partes
// { role: 'user', content: [ { type: 'text', text }, { type: 'image_url', image_url: { url: dataUrl } } ] }
const res = await streamGlmChat({
  model: process.env.GLM_VISION_MODEL || 'glm-5v-turbo',
  tier: 'balanced',
  messages: [
    { role: 'system', content: 'Describe el contenido util del adjunto para un asistente de prospeccion B2B. Extrae texto visible, tablas y datos de contacto si existen. Se factual y compacto.' },
    { role: 'user', content: [ { type: 'text', text: `Archivo: ${att.name}` }, { type: 'image_url', image_url: { url: att.dataUrl } } ] },
  ],
  maxTokens: 1500,
  signal,
});
summary = res.content.slice(0, 12000);
```

Nota de implementación: el campo `thinking`/`reasoning_effort` NO debe enviarse al modelo de visión salvo que la doc de GLM-5V lo soporte — en `glm-chat.ts` condicionar esos campos a modelos `glm-5.*` no-visión o parametrizarlo (`opts.disableThinking: true`).

### 4.4 Inyección en el turno agéntico

En `processSupliaMessageAgentic`, si hay adjuntos:

1. `const digests = await digestAttachments(attachments)` con timeout total de 30 s (Promise.race; si expira, digests parciales + nota).
2. Persistir el mensaje del usuario con parts `attachment` incluyendo `summary` truncado a 500 chars (para preview) — el digest completo NO se guarda en el mensaje.
3. Agregar al `history` (después del mensaje del usuario) un mensaje `user` etiquetado:
   `[ADJUNTOS DEL USUARIO - contenido extraido por el sistema]\n` + `digests.map(d => `--- ${d.name} (${d.kind}) ---\n${d.summary}`).join('\n\n')`. En M13 este bloque se envuelve con los delimitadores de contenido externo.
4. Emitir eventos SSE `attachment.processing` / `attachment.ready` (label para la barra de actividad).

## 5. Tests

`src/lib/server/suplia-attachments.test.ts`:
1. `digestAttachments` con text → resumen = contenido truncado.
2. PDF inválido (base64 corrupto) → no lanza; summary de error.
3. Imagen con flag apagado → summary de desactivado, sin llamadas de red (inyectar `chat` fake y asegurar 0 llamadas).
4. Imagen con flag prendido → usa `GLM_VISION_MODEL` y devuelve el content del fake.
5. Validador del route: 6 adjuntos → 400; imagen de 5 MB → 400.

## 6. QA manual

1. Adjuntar screenshot de un perfil de LinkedIn + "extrae nombre, cargo y empresa" → el modelo responde con los datos visibles.
2. Adjuntar PDF con texto + "resume este documento" → resumen correcto; el mensaje del usuario en el transcript muestra chips, no el texto pegado.
3. Adjuntar .csv (texto) → sigue funcionando como antes pero sin contaminar el mensaje.
4. Flag apagado → imágenes muestran "[analisis desactivado]" y el resto funciona.
5. `.env.example` actualizado con `SUPLIA_ATTACHMENTS_VISION="false"` y `GLM_VISION_MODEL="glm-5v-turbo"`.

## 7. Rollback

Flag apagado desactiva visión; revertir el commit restaura la concatenación legacy.
