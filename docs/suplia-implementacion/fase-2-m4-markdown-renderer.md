# M4 — Renderizado de mensajes nivel Claude (react-markdown + GFM + shiki)

**Fase:** 2 · **Independiente** (mejor después de M1) · **Riesgo:** bajo
**Resuelve:** H5 (markdown casero: sin tablas GFM, sin listas anidadas, sin blockquote, sin resaltado de sintaxis).

---

## 1. Objetivo

Reemplazar `renderRichText` / `renderInlineMarkdown` (funciones caseras en `SupliaWorkspace.tsx`, ~líneas 657–766) por un componente `MessageMarkdown` basado en `react-markdown`, manteniendo la estética actual (clases `suplia-*`) y agregando: tablas GFM, listas anidadas y ordenadas, blockquotes, task lists, strikethrough, headings h1–h4, código con resaltado de sintaxis y botón copiar.

Restricciones: **sin HTML crudo** (no usar `rehype-raw`; react-markdown por defecto escapa HTML — mantenerlo así por seguridad), links con `target="_blank" rel="noopener noreferrer"` y validación de protocolo (solo http/https/mailto — replicar el criterio de `safeHref` existente).

## 2. Dependencias

```bash
npm install react-markdown@^9 remark-gfm@^4 shiki@^1
```

React 18 es compatible con react-markdown v9. No agregar rehype plugins.

## 3. Componente nuevo: `src/components/suplia/MessageMarkdown.tsx`

```tsx
'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { memo } from 'react';

export const MessageMarkdown = memo(function MessageMarkdown({ text }: { text: string }) {
  return (
    <div className="suplia-md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => {
            const safe = isSafeHref(href) ? href : undefined;
            return safe
              ? <a href={safe} target="_blank" rel="noopener noreferrer">{children}</a>
              : <span>{children}</span>;
          },
          table: ({ children }) => (
            <div className="tbl-wrap suplia-table-wrap"><table>{children}</table></div>
          ),
          code: CodeRenderer,           // ver 3.1
          h1: ({ children }) => <div className="suplia-heading">{children}</div>,
          h2: ({ children }) => <div className="suplia-heading">{children}</div>,
          h3: ({ children }) => <div className="suplia-heading">{children}</div>,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});

function isSafeHref(href?: string) {
  if (!href) return false;
  return /^(https?:\/\/|mailto:)/i.test(href.trim());
}
```

### 3.1 `CodeRenderer` con shiki (lazy, con fallback)

Shiki es pesado: cargarlo con import dinámico y highlighter singleton; mientras carga (o si falla), renderizar `<pre>` plano — nunca bloquear el render del mensaje.

```tsx
import { useEffect, useState } from 'react';

let highlighterPromise: Promise<any> | null = null;
function getHighlighter() {
  if (!highlighterPromise) {
    highlighterPromise = import('shiki').then((shiki) =>
      shiki.createHighlighter({
        themes: ['github-light', 'github-dark'],
        langs: ['typescript', 'javascript', 'json', 'html', 'css', 'sql', 'bash', 'python', 'markdown'],
      })
    ).catch(() => null);
  }
  return highlighterPromise;
}

function CodeRenderer({ inline, className, children }: any) {
  const content = String(children ?? '').replace(/\n$/, '');
  const language = /language-([\w-]+)/.exec(className || '')?.[1] || '';
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    if (inline) return;
    let alive = true;
    getHighlighter().then((hl) => {
      if (!hl || !alive) return;
      try {
        const lang = hl.getLoadedLanguages().includes(language) ? language : 'text';
        setHtml(hl.codeToHtml(content, { lang, themes: { light: 'github-light', dark: 'github-dark' } }));
      } catch { /* fallback plano */ }
    });
    return () => { alive = false; };
  }, [content, language, inline]);

  if (inline) return <code>{content}</code>;
  return (
    <div className="suplia-code-block">
      <CodeBlockHeader language={language} content={content} />   {/* botón copiar, reutilizar patrón de MessageCode */}
      {html
        ? <div className="suplia-code-shiki" dangerouslySetInnerHTML={{ __html: html }} />
        : <pre>{content}</pre>}
    </div>
  );
}
```

Nota de seguridad: el único `dangerouslySetInnerHTML` permitido es el output de shiki (HTML generado por la librería a partir de texto escapado, sin ejecutar contenido del modelo). No usarlo en ningún otro punto.

### 3.2 CSS

En `src/app/globals.css`, junto a los estilos `suplia-*` existentes, agregar reglas para `.suplia-md` que hereden la tipografía/espaciado actual de los mensajes: párrafos con el mismo margen que hoy, `ul/ol` anidados con padding-left incremental, `blockquote` con borde izquierdo sutil (`var(--suplia-border)` si existe el token; si no, usar el color de borde ya usado por `suplia-tool`), tablas reutilizando los estilos de `.suplia-table-wrap`, y `.suplia-code-shiki pre` con `background: transparent` para que mande el fondo del contenedor `.suplia-code-block`. Dark mode: shiki dual theme funciona con `color-scheme`; añadir `.dark .suplia-code-shiki span { color: var(--shiki-dark) !important; background-color: transparent !important; }` según la técnica documentada de shiki css-variables si el tema dual no aplica automático — verificar visualmente en ambos modos.

## 4. Integración

1. En `SupliaWorkspace.tsx`, localizar todos los call-sites de `renderRichText(` (mensajes del assistant, contenido de artifacts en el canvas, y el streaming en vivo si M1 ya está) y reemplazar por `<MessageMarkdown text={...} />`.
2. `renderInlineMarkdown` sigue usándose para celdas de tablas de parts (`MessageTable`) — dejarlo. `renderRichText` queda sin usos: eliminarla junto con sus helpers exclusivos (`isUnorderedListLine`, `isOrderedListLine`, `isBlockBoundary`) solo si ningún otro sitio los usa (verificar con búsqueda global).
3. El part `code` (componente `MessageCode`) puede seguir existiendo (viene de mensajes legacy persistidos); opcionalmente rediríjase a `CodeRenderer` para unificar estilo.
4. Streaming (M1): `MessageMarkdown` se re-renderiza con cada delta. Con `memo` + texto acumulado el costo es aceptable; si se percibe jank con mensajes muy largos, throttlear el `setLiveStream` a ~50 ms (ya hay throttle server-side de 40 ms).

## 5. QA manual

Enviar un mensaje que fuerce al modelo a responder con: tabla markdown, lista anidada, blockquote, código TS con fences, link a dominio externo, heading. Verificar: (1) tabla renderiza dentro del wrapper con scroll horizontal; (2) lista anidada indenta; (3) código resaltado en light y dark; (4) link abre en pestaña nueva; (5) HTML embebido como `<script>alert(1)</script>` aparece escapado como texto; (6) mensajes antiguos (persistidos con parts) se ven igual que antes; (7) typecheck + tests verdes; (8) bundle: `next build` no falla (shiki queda en chunk async).

## 6. Rollback

Revertir el commit; `renderRichText` vuelve a ser el renderer. No hay cambios de datos.
