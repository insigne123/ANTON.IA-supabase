# Oportunidades: configuración de producción

## Acceso y worker

`OPPORTUNITIES_ALLOWED_EMAILS` tiene hoy 28 correos: los miembros de GrupoExpro
verificados el 4 oct 2026 y nicolas.yarur.g@yago.cl. Solo entran cuentas con el
correo confirmado. La página y las rutas lo leen en el servidor. El worker de
Cowork se ejecuta dentro del mismo App Hosting (`POST /api/cron/cowork`); recibe
el mismo entorno. `coworkTick` de Firebase solo despierta ese worker por HTTP,
no necesita copiar los secretos de proveedores ni la lista de correos.

## Proveedores

- `APIFY_TOKEN`: Secret Manager, cuenta de producción autorizada `nicogun123@gmail.com`.
- `JSEARCH_API_KEY`: clave propia de RapidAPI suscrita a JSearch.
- `MERCADO_PUBLICO_TICKET`: ticket de la cuenta de Mercado Público. Desde el Plan 10 solo
  lo usan las cuentas de `MERCADO_PUBLICO_SHARED_TICKET_EMAILS` (hoy
  nicolas.yarur.g@yago.cl). Las demás conectan su propio ticket en Oportunidades;
  se guarda cifrado en `commercial_opportunity_tickets` (`docs/oportunidades-licitaciones.md`).
- Recomendado: `TOKEN_ENCRYPTION_SECRET` propio en App Hosting. Hoy el cifrado de
  tickets y tokens usa la service key, y rotarla los dejaría ilegibles. El
  descifrado prueba las claves anteriores, así que agregarla no rompe nada.

Se agregan referencias RUNTIME a App Hosting solo cuando sus versiones existen y
el backend `studio` tiene permiso de lectura. No guardar valores en el repositorio.
Sin las dos claves nuevas, esas fuentes se muestran como pendientes.

El 2 oct 2026 el usuario creó JSEARCH_API_KEY y MERCADO_PUBLICO_TICKET, versión 1
ENABLED de cada uno. El mantenedor verificó sus nombres y estado, concedió acceso
a studio y agregó las referencias runtime en apphosting.yaml. La existencia de la
versión no sustituye la comprobación de suscripción/ticket contra el proveedor.

La validación real confirmó el ticket: API v1 de licitaciones y API v2 de Compra
Ágil devolvieron listas válidas. JSearch retiró `/search`: responde 404 incluso con
clave válida. La ruta actual `/search-v2` sí respondió 200 con `data.jobs` y
`data.cursor`; el cliente se actualiza a esa ruta, country=cl, language=es y Chile
en la consulta. La paginación pide hasta el número de páginas permitido, por cursor,
y cuenta las llamadas reales. Un resultado inesperado ya no se trata como vacío.
Fuente: https://www.openwebninja.com/api/jsearch (consultada el 2 oct 2026).

## Fantastic Jobs: límites

Tarifa Free verificada el 2 oct: US$0,005 por aviso y US$0,01 por arranque.
En otros planes, consultar la tarifa vigente y ajustar ambas variables.

- `APIFY_FANTASTIC_MAX_RUN_USD=1`: máximo enviado a Apify por corrida.
- `APIFY_FANTASTIC_USD_PER_JOB=0.005`.
- `APIFY_FANTASTIC_START_USD=0.01`.
- `OPPORTUNITIES_MONTHLY_USD_CAP=10`: control de gasto estimado por organización.

En Free, el límite de US$1 permite **198 avisos** más el arranque. La tarjeta de
«Buscar ahora» y el cliente usan el mismo cálculo. El actor corre con permisos
limitados y sin reinicio automático. Ante un resultado incierto (por ejemplo un
timeout), el registro mensual reserva el tope completo, en vez de asumir costo
cero. Los importes son estimaciones, no sustituyen el recibo de Apify.

`commercialOpportunitiesTick` solo consulta JSearch y Mercado Público a diario.
Corre sin reintentos (`retryCount: 0`): un reintento repetiría las consultas
pagadas de JSearch, y la mañana siguiente vuelve a buscar. La ruta deja de empezar
organizaciones a los 240 s y nombra las pendientes en su respuesta. Si JSearch
agotó el cupo del mes, la búsqueda diaria lo omite, sin costo, hasta el mes siguiente.
Fantastic Jobs se ejecuta únicamente con «Buscar ahora» y su revisión de costo.
La tarea está programada a las 11:15 UTC; en horario de verano de Santiago son
las 08:15 y en invierno las 07:15.

## Despliegue y verificación

Desde main aprobado y limpio:

1. Desplegar App Hosting.
2. Compilar Functions y desplegar `functions:commercialOpportunitiesTick`.
3. Comprobar lista de función, estado y programación; no iniciar una búsqueda
   paga como smoke.
4. APIs de oportunidades y cron sin sesión/secreto: 401.
5. Verificar el runtime: lista de acceso, dos tarifas, hard cap y secretos presentes.
6. Con sesión de la cuenta piloto, revisar las fuentes habilitadas y la estimación
   antes de pulsar «Buscar ahora».
