# Colaboración: cerrar la conversación y liberar contactos (Plan 5, PR-9a)

## Problema (prueba del 1 oct, `Pruebas_de_app.docx`)

La colaboración ya bloqueaba a otros miembros mientras un hilo de contacto estaba activo (`claim_outbound_dispatch_sending_v2`). Pero:

- **Nada liberaba un contacto que no respondió:** solo un owner o admin podía reabrirlo, y solo después de 90 días.
- **«Marcar resuelto» no liberaba a nadie:** solo ocultaba la conversación a quien la envió.

## Reglas (decisión del usuario del 1 oct)

- **Respondió:** sigue siendo de quien lo contactó hasta que cierre la conversación.
- **No respondió:** queda libre 30 días después del último envío, si no hay un envío en curso.
- **Cerrar la conversación** tiene 4 resultados:

| Resultado | Hilo del equipo (con colaboración) | Pipeline | Seguimientos |
|---|---|---|---|
| Sin acuerdo | `available`: libre para el equipo | Perdido | Sin cambio |
| Ganado | `closed`: nadie lo vuelve a prospectar (un admin puede reabrirlo) | Ganado | Sin cambio |
| No interesado | `suppressed`: nadie del equipo vuelve a contactarlo | Perdido | Se detienen los de esa cuenta (`do_not_contact`) |
| Lo retomo yo | Sigue `active` y del dueño | Sin cambio | Sin cambio |

- **Sin colaboración:** solo cambian la conversación, el pipeline y los seguimientos.
- **Siempre:** la conversación sale de «Por responder» y el historial se conserva.

## Cómo funciona

### Migraciones (aplicadas en producción el 1 oct, una a una)

1. **`release_idle_organization_contact_threads_v1(p_now, p_limit)`** (`20261002010000`)
   - **Qué libera:** hilos de correo activos, sin envío en curso, con el último envío hace 30 días o más, y sin respuesta del destinatario en la organización desde que empezó el ciclo.
   - **Cómo queda el hilo:** `available` y sin dueño. `reopened_at` marca dónde empieza el ciclo siguiente: una respuesta antigua no vuelve a retenerlo.
   - **Registro:** el evento `contact.released`.
   - **Quién la ejecuta:** solo `service_role`, en lotes de hasta 1000.
2. **`close_organization_contact_thread_v1(p_thread, p_outcome)`** (`20261002011000`)
   - **Quién:** el dueño del hilo, o un owner o admin.
   - **Cuándo:** solo con el hilo activo y sin envío en curso.
   - **Registro:** el evento `contact.closed`, con el resultado y el dueño anterior.

### Job

La ruta `/api/cron/outbound-reconciliation` llama a la liberación después de reconciliar y devuelve `contactThreadsReleased`.
- **Frecuencia:** la ruta ya está programada cada 5 minutos en `functions/index.ts`, así que no hace falta otro deploy de Firebase.
- **Si la liberación falla:** la reconciliación sigue igual, y el resultado lo dice.

### API

`POST /api/contacted/[contactedId]/conversation/close` con `{ outcome, observedAt }`, en este orden:
1. Solo acepta una conversación propia.
2. Cierra el hilo del equipo, si está activo. La base rechaza lo que la persona no puede hacer, y el rechazo se explica en palabras claras.
3. Marca la conversación como resuelta.
4. Con «No interesado», detiene los seguimientos.
5. Guarda la etapa. Si no se puede guardar, el cierre no se deshace y el resultado lo dice.

`GET /api/contacted/[contactedId]/conversation` devuelve además `team`: si hay colaboración, el estado del hilo y si es tuyo.

### Pantalla

- **Conversaciones:** «Cerrar conversación» reemplaza «Marcar resuelto».
- **El diálogo:** muestra los 4 resultados con su consecuencia en una línea. Las líneas son las del equipo si hay un hilo activo, y las de una persona sola si no.
- **«Volver a pendiente»** sigue disponible para una conversación ya cerrada.

## Pruebas

- **pgTAP** (`organization_contact_thread_lifecycle.test.sql`, 24 casos), sobre:
  - permisos;
  - los 30 días;
  - una respuesta de este ciclo y una de un ciclo anterior;
  - una organización sin colaboración;
  - cada resultado;
  - los eventos.
- **PGlite**, con el mismo archivo más 5 verificaciones:
  - envío en curso, en la liberación y en el cierre;
  - topes del lote;
  - permisos de ejecución.
- **Unitarias:** opciones y mensajes (`conversation-close.test.ts`), el cierre con un cliente falso (`server/conversation-close.test.ts`) y la liberación (`contact-thread-release.test.ts`).
- **DOM:** `scripts/test-conversation-close-ui.mjs`.

## Pendiente (PR-9b)

- **Avisos** en Buscar, Por escribir y Cowork: «En conversación con Ana» y «Libre desde el 3 nov».
- **Que Cowork no proponga envíos a contactos bloqueados.**
