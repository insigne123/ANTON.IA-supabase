# Cowork · experiencia tipo Claude (24 sep 2026)

## Qué cambia para el usuario

- **Una conversación continua.** Tras aprobar una acción o terminar una búsqueda, el worker abre un turno de continuación. La pantalla ahora lo sigue sola y lo muestra como «Continuó automáticamente con el resultado», sin exponer el mensaje sintético («Continúa a partir del efecto…») como si lo hubiera escrito el usuario.
- **Historial por hilos.** La barra lateral agrupa los turnos de una misma conversación (raíz → continuaciones y seguimientos) por fecha: Hoy, Ayer, Últimos 7 días…
- **Arranque inmediato.** Al enviar o aprobar, el navegador llama a `POST /api/cowork/wake` y el worker toma el siguiente paso sin esperar el cron de un minuto. El cron sigue siendo el responsable de la recuperación.
- **Composer siempre disponible.** Enter envía y Shift+Enter agrega una línea. Si el trabajo está en curso, el mensaje queda en espera y se envía al terminar ese paso. Si hay una propuesta pendiente, escribir equivale a «no, haz esto otro»: descarta la propuesta y envía la instrucción. Mientras trabaja, el botón cambia a **Detener**.
- **Reintentar sin perder el hilo.** Un turno fallido o detenido ofrece «Reintentar» con el mismo mensaje y el mismo padre.
- **Artefactos junto al chat.** Documentos, tablas de contactos, archivos y fuentes aparecen como tarjetas y se abren en un panel lateral que se puede ampliar. Si un turno termina mientras miras, su resultado principal se abre solo (en escritorio).
- **Documentos legibles.** Hay un parser Markdown propio y seguro (`src/lib/cowork/markdown.ts`) que cubre títulos, tablas GFM, listas anidadas y de tareas, citas, código y enlaces, sin interpretar HTML. El PDF descargable usa el mismo árbol y ya no imprime `**`, `#` ni `|`. Los archivos se nombran según el título del documento.
- **Panel Resumen.** Progreso real del turno (recibido → consultas → tu aprobación → ejecución → resultado), resultados del hilo y contexto (datos consultados, modo, pasos automáticos, cuota).
- **Aprobaciones con el mismo formato.** Todas las revisiones usan `ReviewParts` (campos, nota de verificación, acciones). Descartar va antes que aprobar, la deriva bloquea la aprobación y los identificadores internos ya no se muestran.

## Cambios de servidor (mínimos)

| Archivo | Cambio |
|---|---|
| `src/lib/server/cowork/runs.ts` | La lista incluye `parent_run_id` y `automatic` (se calcula con el `request_id` determinista de las continuaciones; el `request_id` no sale del servidor). Nuevo `getCoworkContinuation`. |
| `src/app/api/cowork/runs/[id]/route.ts` | Devuelve `continuation` (turno hijo más reciente) cuando el turno terminó. |
| `src/app/api/cowork/wake/route.ts` | Nuevo. Solo propietario, un wake a la vez por instancia y hasta 3 pasos o 60 s. Se desactiva con `COWORK_INLINE_WAKE=false`. |
| `src/lib/server/cowork/file-exports.ts` | PDF con formato Markdown real y nombre de archivo según el título. |
| `src/lib/cowork/agent-instructions.ts` | Guía de salida: `reply` breve y primero la conclusión, `document` solo para resultados que se conservan, con resumen, secciones, tablas, próximos pasos y alcance. |

No hay migraciones ni cambios de RLS.

## Estilo (actualizado el 25 sep 2026: colorimetría de ANTON.IA)

- Los tokens `--cw-*` de `src/styles/design-tokens.css` son alias del tema de la app: fondo blanco y slate, azul primario (`--primary`), navy en modo oscuro, bordes y textos del tema. Se exponen en Tailwind como `cw-*`.
- Tipografía de la app: PT Sans (`--font-body`) para todo, incluidos los títulos, igual que `PageHeader`. Poppins queda solo para el logo. `.cw-shell` resuelve la variable de fuente dentro del `body`, donde la define `next/font`.
- `src/styles/cowork.css`: superficies de lectura, tablas y animaciones con `prefers-reduced-motion`. Sin fuentes propias ni serif.
- Los estados (listo, atención, error) usan verde, ámbar y el `--destructive` del tema. No se usan logos, assets ni tipografías de Claude.

## Verificación

- `npm run typecheck`, `npm run test:unit` (1644/1644) y `next build` OK.
- `node scripts/verify-cowork.mjs`: todo OK salvo `test-cowork-start-research.mjs`, que ya fallaba antes de estos cambios (su mock no implementa `.filter` y la prueba aún espera que no se exija correo).
- Pruebas nuevas: `test-cowork-conversation-flow.mjs` (continuaciones, cola, escribir en vez de aprobar, wake) y `test-cowork-wake.mjs`. Además, `markdown.test.ts` y `presentation.test.ts`.
- Pruebas renderizadas `test-cowork-reviews-browser.mjs` y `test-cowork-profile-browser.mjs` OK en claro y oscuro, a 360, 768 y 1440 px.
- Capturas en Chromium a 1440, 1280 y 390 px, en claro y oscuro, sin errores de página ni scroll horizontal.
