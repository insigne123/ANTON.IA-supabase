# Anton.IA — LinkedIn Workspace 4.0.1

## Compilar e instalar

Requiere Node 22 y las dependencias del repositorio (`npm ci`).

```sh
npm run extension:build
```

1. Abre `chrome://extensions` o `edge://extensions` y activa **Modo desarrollador**.
2. Pulsa **Cargar descomprimida** y selecciona `chrome-extension/`.
3. Fija Anton.IA en la barra de herramientas. El icono abre el panel lateral.
4. Pulsa **Conectar Anton.IA**. Inicia sesión en la app si hace falta y confirma **Conectar mi cuenta**.
5. Mantén abierta la pestaña `/extension/connect`. Vuelve a LinkedIn y abre un perfil `/in/…`.

La aplicación elegida debe incluir `/extension/connect` y `/api/extension/workspace` de esta versión. Instalar solo la extensión contra una app anterior no habilita los nuevos flujos. Para probar localmente, inicia `npm run dev` y elige **Local · puerto 9003** en «Dirección de la app».

Después de actualizar la extensión, recarga las pestañas de LinkedIn y conexión. Chrome no reemplaza los scripts ya inyectados.

## Funciones disponibles

- Panel React con Perfil, Investigación y Contactar; tema del sistema y teclado.
- Captura de URL, nombre y titular del perfil visible; URL pegada manualmente.
- Consulta de leads guardados dentro de la organización activa.
- Guardado sin email, actualización de datos, email y teléfono.
- Enriquecimiento explícito con Apollo mediante la búsqueda existente y sus cuotas.
- Investigación nativa en el servidor, consulta de estado y hallazgos con fuentes.
- Redacción LinkedIn con perfil del vendedor, hechos de investigación, tono, idioma y objetivo.
- Edición, reescritura breve/cercana, copia y preparación del mensaje en una conversación confirmada.
- Primer correo nativo y secuencia de 1–4 seguimientos para revisar en la app, sujetos a los flags y requisitos de investigación existentes.

### Límites de esta entrega

- El nuevo panel **no pulsa Enviar** ni registra un mensaje preparado como enviado. El puente histórico usado desde la app sigue siendo independiente.
- Se crean planes personalizados del motor de campañas V2. El selector de campañas existentes se integra con `/api/campaigns/bulk`: permite añadir un lead a una campaña propia en borrador o rechazada, conservando sus criterios y mensajes. Revalida la revisión, evita duplicados y no aprueba ni envía. Si el módulo colectivo no está desplegado y habilitado, explica que aún no está disponible. Activar ese módulo requiere resolver sus propios pendientes documentados en `docs/plans/bulk-campaigns-implementation-status.md`.
- No se incluyen Sales Navigator, capturas masivas ni mensajes programados LinkedIn.
- El teléfono puede llegar de forma asíncrona desde Apollo. El panel guarda el teléfono recibido en la respuesta; aún no sigue los callbacks de teléfono pendientes.
- No abre el chat de una URL pegada automáticamente: abre ese perfil en LinkedIn antes de pulsar Preparar. Se ofrece Copiar cuando no puede confirmar el destinatario.
- Conserva borradores LinkedIn en `chrome.storage.session`, separados por usuario, organización y perfil. Sobreviven al cierre del panel y reinicio del worker, pero no al cierre completo del navegador. Las investigaciones y borradores de email se guardan en el servidor.
- Chrome 116+ es la versión mínima declarada. Edge requiere validar su soporte del panel lateral en el navegador de destino; la prueba automatizada se ejecutó en Chrome.

## Autenticación y datos

El panel no almacena JWT, refresh tokens ni claves de proveedor. Una pestaña de la app autorizada explícitamente ejecuta operaciones contra un único endpoint del mismo origen usando su sesión existente.

- Consentimiento vinculado a pestaña, nonce temporal, origen permitido y frame principal.
- Solo el panel propio puede pedir operaciones al worker.
- El servidor verifica sesión, usuario y organización en cada operación; un cambio exige reconexión.
- Las consultas y escrituras de leads usan el cliente autenticado con RLS y filtro de organización.
- La URL canónica determina un UUID por organización para que guardados concurrentes de la extensión converjan. Se reutilizan también registros previos con las variantes habituales de URL (www y barra final). No sustituye una futura restricción global de URL que cubra todos los importadores de la app.
- Desconectar borra la conexión y los borradores de sesión de la extensión. Cerrar la pestaña de conexión invalida el enlace.

## Distribución

```sh
npm run extension:release
```

El resultado está en `chrome-extension/dist/`, con manifest de producción sin permisos localhost. Comprime **el contenido** de esa carpeta para que `manifest.json` esté en la raíz del ZIP. No empaquetes toda la carpeta de fuentes.

La publicación en Chrome Web Store requiere ficha, capturas, política de privacidad coherente con los datos tratados y revisión de Google. Justificar `tabs` (perfil y pestaña de conexión), `sidePanel` (interfaz) y `storage` (conexión y borradores de sesión). No se ha publicado automáticamente en ninguna tienda.

## Validaciones

```sh
npm run extension:test
npm run typecheck
```

Prueba de navegador opcional con Playwright disponible:

```sh
node scripts/test-linkedin-extension-browser.mjs
```

`PLAYWRIGHT_MODULE` permite apuntar a una instalación externa de Playwright y `EXTENSION_SCREENSHOT_DIR` a una carpeta existente para capturas. La prueba simula la frontera Chrome/API: no usa credenciales ni toca Supabase, LinkedIn o proveedores. Valida light/dark, 320/380/520 px, foco, ausencia de overflow y conectar/guardar/generar/preparar.

Antes de distribuir a usuarios, comprobar manualmente con la app actualizada:

- Cuenta real y organización correcta; cambio de organización y logout.
- Un perfil público compatible: guardar, enriquecer, recargar y confirmar persistencia.
- Investigación completada por el worker desplegado y secuencia creada sin activar envíos.
- Dos conversaciones abiertas: nunca insertar en el destinatario equivocado ni reemplazar un borrador.
- LinkedIn sin botón Mensaje: feedback y copia funcionales.
- Suspensión del worker y cierre de la pestaña de conexión.

No se ejecutan suites ni seeds contra producción. Esta entrega no requiere una migración nueva.
