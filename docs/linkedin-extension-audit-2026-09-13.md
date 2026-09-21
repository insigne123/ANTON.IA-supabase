# Auditoría de la extensión LinkedIn 4.0.4

> Correcciones posteriores implementadas localmente en el candidato 4.0.5: ver `linkedin-extension-release-4.0.5.md`. Este informe conserva los hallazgos de 4.0.4 como evidencia histórica.

Fecha: 13 de septiembre de 2026. Rama: `main`, con cambios locales preexistentes.

## Dictamen

**No está lista para publicarse como versión final con envío automático.** El panel y la integración base están implementados, pero el envío automático conserva fallos funcionales importantes del flujo histórico. La afirmación previa de que el destinatario estaba verificado también para el envío automático fue incorrecta: esa protección está implementada en el flujo de preparación manual.

Esta revisión no modifica la aplicación, no publica, no hace commits ni ejecuta operaciones externas con contactos o créditos. Se añade este informe. Las reproducciones se realizaron con DOM simulado fuera del repositorio.

## Verificaciones ejecutadas

| Verificación | Resultado y alcance |
|---|---|
| Node | 22.23.2 |
| `npm run extension:test` | 18/18 aprobadas; no certifican el nuevo envío automático |
| `npm run typecheck` | Aprobado |
| `scripts/test-linkedin-extension-browser.mjs` | Aprobado en Chrome headless: claro/oscuro, 320/380/520 px; conectar, guardar, generar, preparar y añadir a campaña, con API Chrome simulada |
| Dependencia de navegador | No estaba instalada en el repo; se utilizó Playwright desde el directorio temporal autorizado |
| `chrome-extension/dist` | Manifest 4.0.4 coincide con release; sin localhost; hashes de scripts, bundles e icono coinciden con sus equivalentes de distribución en la carpeta principal |
| Reproducción de selección de editor | Confirmada: el selector global devuelve un editor de otra persona |
| Reproducción de sobrescritura | Confirmada: el flujo automático reemplaza un borrador existente y llega al clic de envío simulado |
| Reproducción de falsa confirmación | Confirmada: texto antiguo + aumento del contador por otro mensaje produce confirmación |

La prueba de navegador existente no pulsa «Enviar automáticamente», no prueba su confirmación y no ejercita investigación o creación real de secuencias. No se repitió el build completo de la app: ya hay bloqueos funcionales de publicación, y compilar no los resolvería. No se certifica el DOM actual de LinkedIn autenticado, las cuentas corporativas, los proveedores, los jobs en producción ni la entrega real de mensajes.

## Bloqueos de publicación

### 1. El envío automático no verifica el destinatario de la conversación

`chrome-extension/content.js:44-88,362-380`: se verifica la URL del perfil al comienzo, pero luego `getMessageEditor()` busca el primer editor visible en todo el documento. No vincula ese editor con el destinatario solicitado. Con otra conversación abierta puede elegirla. Tampoco vuelve a comprobar la identidad inmediatamente antes de enviar después de las esperas.

Reproducción: perfil Ana, conversación abierta de Otra persona, selector global devuelve el editor de Otra persona.

**Cierre requerido:** seleccionar y mantener el contenedor de conversación identificado por el perfil; revalidar destinatario y navegación antes de insertar y antes del clic. Probar chats simultáneos, navegación y perfiles sin mensaje directo.

### 2. Sobrescribe borradores existentes

`chrome-extension/content.js:104-130`: `sendMessageInEditor()` escribe sin comprobar si el editor ya tiene texto. La protección de `prospecting-content.js:41` pertenece exclusivamente a preparación manual.

**Cierre requerido:** conservar el borrador existente y presentar una recuperación clara. Probar también preparar manualmente y luego intentar enviar automáticamente.

### 3. La confirmación de envío no demuestra que salió ese mensaje en ese hilo

`chrome-extension/content.js:151-168`: el conteo y la búsqueda del texto son globales. Se exige un aumento del conteo y que exista el texto en cualquier mensaje, pero no que ese texto pertenezca al nuevo mensaje del hilo seleccionado. La reproducción con un mensaje antiguo coincidente y otro mensaje adicional devolvió `true`.

`chrome-extension/ui/panel.tsx`, `sendAutomatically`: acepta `response.success` sin exigir `status === 'confirmed_dm'`.

**Cierre requerido:** identificar el nuevo evento del hilo correcto, verificar su contenido y distinguir confirmado de incierto. La respuesta del panel debe validar el estado explícito.

### 4. No hay prevención robusta de duplicados ni recuperación tras interrupción

`chrome-extension/background.js:5,134-170`: las solicitudes pendientes están solo en un `Map` del service worker. `content.js` inicia cada `EXECUTE_DM_FLOW` sin exclusión de ejecución ni deduplicación. El bloqueo React vive solo en la instancia abierta del panel. Reabrir el panel o un estado incierto permite repetir la operación sin reconciliación durable.

Además, `DM_RESULT` se resuelve únicamente por `requestId`, sin validar la pestaña/frame que devuelve el resultado (`background.js:59-66`).

**Cierre requerido:** vincular operación, pestaña, destinatario y resultado; bloquear ejecuciones concurrentes y recuperar estados pendientes/confirmados/inciertos antes de permitir reintentos.

### 5. La confirmación del panel no es una condición del canal histórico

`background.js:48-55` acepta solicitudes desde el panel o cualquier pestaña cuyo URL pertenezca al allowlist. El puente `web_injector.js` permite a la app solicitar el envío sin pasar por la confirmación nueva del panel. No revalida allí la conexión del workspace ni la organización. La interfaz actual llama directamente a `SEND_DM`, no a `extensionService.sendLinkedinDM`.

**Cierre requerido:** definir un único contrato de autorización del envío y exigirlo en el worker; alinear o retirar el canal histórico. La política no puede afirmar que el envío ocurre «solo desde el panel» mientras ese canal siga activo.

### 6. El envío desde el panel no se registra en el historial de Anton.IA

`sendAutomatically` actualiza un aviso local; no solicita registrar el resultado al backend. `/api/extension/workspace` no tiene una acción de registro de DM enviado. El resultado de `content.js` devuelve `location.href` como `linkedinThreadUrl`, que puede seguir siendo la URL del perfil, no un enlace al hilo.

**Cierre requerido:** completar la continuidad comercial del envío con un resultado persistente vinculado a usuario, organización, lead y operación, y usar un enlace de conversación únicamente cuando sea realmente conocido. No describir el aviso local como registro en CRM.

## Otras diferencias que deben resolverse

- **Privacidad contradictoria:** `src/app/privacy/extension/page.tsx` describe proveedores de enriquecimiento/IA, pero también limita transferencias a guardar en la base propia. Afirma envío solo desde el panel y registro confirmado más fuertes que lo implementado. `STORE_JUSTIFICATIONS.md` y el manual repiten garantías de destinatario verificado que el automático no cumple.
- **Editar datos no permite vaciarlos:** `saveExtensionLead` construye campos solo para valores no vacíos. Borrar un email/teléfono del formulario y guardar conserva el dato anterior en servidor. Debe distinguir «no modificar» de «borrar» y mantener panel/servidor sincronizados.
- **Instrucción del primer email:** la API recibe `instruction`, pero no la pasa a `createNativeDraft`; sí la pasa al plan de seguimientos. El objetivo visible no se aplica explícitamente al primer correo en esta entrada.
- **Límites y URLs inconsistentes:** generación/preparación admite 1200 caracteres y perfiles Unicode; automático admite 500 y su normalización usa solo caracteres ASCII. Debe haber validación y explicación coherentes antes de la confirmación.
- **Confirmación visual incompleta:** muestra nombre, URL y contador, pero no copia del texto dentro del bloque de confirmación ni identidad comprobada de la cuenta LinkedIn que envía. No se ha comprobado la gestión del foco del nuevo `role="dialog"`.
- **Build de distribución no limpia archivos antiguos:** el script copia a `dist` y comprime todo su contenido. El contenido actual revisado es el esperado, pero falta una lista cerrada o directorio limpio para evitar incluir restos en futuros ZIP.

## Capacidades con base implementada

- Conexión explícita mediante pestaña, nonce, origen y frame; API con autenticación y comprobación de usuario/organización.
- Consulta y guardado de leads con ID estable y pruebas de concurrencia e identidad de organización.
- Enriquecimiento con `operationId` y ruta actual de Apollo.
- Encolado/consulta de investigación, generación de mensaje, creación de primer borrador y plan de seguimientos: implementados en API; requieren validación integrada autenticada.
- Campañas con revisión optimista y restricciones de edición, sin aprobación automática desde el panel.
- Preparación manual separada, con pruebas de destinatario, navegación y conservación del borrador.
- Panel probado con límites Chrome/API simulados en ambos temas y tres anchos.

## Condición para continuar hacia publicación

1. Corregir los bloqueos del envío automático y agregar pruebas específicas que fallen ante destinatario incorrecto, sobrescritura, confirmación falsa y duplicación.
2. Completar o precisar el registro comercial y corregir las diferencias del resto de los flujos y documentación.
3. Probar confirmación automática en navegador, investigación/secuencias y recuperación de conexión/interrupciones.
4. Realizar un recorrido autenticado controlado con autorización para cualquier envío o consumo de créditos.
5. Regenerar y verificar el ZIP final, y realizar las verificaciones de app correspondientes antes de desplegar con autorización del usuario.

**Estado final de esta revisión: revisión completada; extensión no aprobada para publicación final.**
