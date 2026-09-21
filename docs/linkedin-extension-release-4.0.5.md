# LinkedIn Workspace · candidato 4.0.5

## Estado

Implementación local de las correcciones del informe `linkedin-extension-audit-2026-09-13.md`.
Desplegado en producción el 13 de septiembre de 2026, tras autorización del propietario. Pendiente validación autenticada de LinkedIn y publicación en Chrome Web Store.

### Despliegue verificado

- Firebase App Hosting `studio`, proyecto `leadflowai-3yjcy`, revisión `studio-build-2026-09-13-002`, 100% del tráfico.
- Migración `extension_linkedin_sends` aplicada por MCP en producción con versión registrada `20260913174225` (archivo local `20260913100000_extension_linkedin_sends.sql`). No volver a aplicar el archivo por diferencia de timestamp.
- Comprobados RLS activado, sin SELECT/INSERT para clientes, permisos service role y constraints/FK; tabla vacía al verificar, sin envíos de prueba.
- ZIP público idéntico al candidato local: 4.0.5, 1.689.458 bytes y SHA-256 documentado abajo.
- `/privacy/extension`: HTTP 200 con texto actualizado; `/extension/connect`: HTTP 307 a login con retorno; API workspace sin sesión: HTTP 401.
- Verificación repetible de lectura: `node scripts/verify-extension-production.mjs`.
- Logs posteriores: un HTTP 500 en `/api/cron/native-research?limit=5`, mensaje `Gateway Timeout`. Este cron ya presentaba HTTP 500 en la revisión anterior antes del despliegue. No es una confirmación de funcionamiento de investigación autenticada; requiere seguimiento operativo. Sin envíos reales realizados.

## Correcciones

- Retirado el ejecutor histórico de `content.js`; `SEND_DM` se rechaza y `web_injector.js` ya no figura en los manifests ni en el ZIP.
- Un único envío desde el panel conectado: revalidación de usuario y organización, revisión explícita y reserva durable en servidor antes de operar sobre LinkedIn.
- Conversación identificada por enlace al perfil, sin fallback por nombre ni selector global. Verificación repetida antes de insertar y enviar. Borrador existente, navegación, adjuntos detectados, editor incompleto o identidad no verificable bloquean el clic.
- Confirmación solo por evento saliente nuevo con identificador, dentro de la conversación validada y texto completo coincidente. Un error después del clic queda incierto.
- Identidad estable por organización, usuario, URL y texto. Dos solicitudes concurrentes o un nuevo worker no obtienen una segunda autorización para el mismo mensaje. No hay reintento automático, incluso tras un resultado `not_sent`; el usuario puede resolverlo directamente en LinkedIn.
- Registro local mínimo de operaciones pendientes (sin texto del mensaje), recuperable con «Sincronizar historial de LinkedIn». Se elimina al sincronizar. El historial del contacto en la app muestra confirmado, no enviado o por comprobar.
- Revisión inline con texto completo, cuenta de LinkedIn explicada como sesión del navegador, foco inicial, Escape/Volver y límite unificado de 1200 caracteres. No se afirma conocer el nombre de la cuenta LinkedIn.
- Borrar campos de contacto desde el editor ahora puede eliminar esos datos en servidor, conservando los campos ajenos al formulario.
- El primer borrador de email recibe la instrucción visible; su clave de idempotencia incorpora esa instrucción.
- ZIP construido desde una lista cerrada; los archivos históricos que permanezcan en `dist` no se empaquetan ni se ejecutan por el manifest.
- Privacidad y justificaciones de tienda actualizadas. El manual de 4.0.4 queda como referencia histórica, con aviso de sustitución.

## Migración requerida

`supabase/migrations/20260913100000_extension_linkedin_sends.sql`

Tabla privada de intentos e historial; RLS habilitada, sin permisos para `anon` ni `authenticated`, acceso desde rutas autenticadas y acotadas mediante service role. Llave del contacto de tipo `text`, comprobado con lectura de `information_schema` en producción. Borrado en cascada al eliminar contacto, usuario u organización. DDL aplicado con autorización; no se insertaron datos de prueba.

Antes de desplegar, aplicar únicamente esta migración con autorización y verificar inmediatamente tabla, constraints, permisos/RLS y logs. No aplicar automáticamente otras migraciones locales preexistentes.

Si falta la tabla o falla la reserva, **no se envía el mensaje**. Se conserva el borrador. El error puede requerir desplegar primero el backend.

## Alcance de pruebas

Pruebas DOM y worker con simulaciones: destinatario incorrecto, borrador existente, navegación, inserción truncada, texto antiguo más evento ajeno, evento sin ID, repetición, pérdida de respuesta, cambio de cuenta y backend no disponible. Pruebas del servicio: reserva concurrente, aislamiento de ámbito, token de resultado y sincronización idempotente. Pruebas de API: alcance autenticado, evidencia del resultado, instrucción del primer correo. Panel Chrome con API simulada: investigación, secuencia, revisión y confirmación, duplicado, Escape/foco, dos temas y tres anchos.

Estas pruebas no certifican el DOM actual de LinkedIn con sesión real, las políticas de LinkedIn ni la entrega real. Si LinkedIn no expone un enlace de destinatario o identificador de evento compatible, el flujo bloquea o muestra estado incierto; no inventa confirmaciones.

### Resultados ejecutados

- `npm run extension:test`: 28 pruebas aprobadas en la ejecución completa; posteriormente se añadieron y aprobaron dos casos de API (reserva/evidencia e instrucción del primer correo). Se repitieron solo las superficies modificadas: API/guardado (10/10) y DOM de envío (4/4). Total actual: 30 casos validados.
- `npm run typecheck`: aprobado, incluido el ajuste final del panel.
- Lint focalizado: sin errores; advertencias del panel por dependencias de hooks e imagen HTML (bundle de extensión, no Next Image).
- `npm run build`: compilación completa Next.js aprobada, generación de páginas y validación de tipos. El posterior ajuste visual del panel se verificó con su propio bundle y pruebas de navegador; no afecta el build Next.js.
- `scripts/test-linkedin-extension-browser.mjs`: aprobado con API Chrome simulada, light/dark, 320/380/520 px; capturas de revisión de envío examinadas en ambos temas.
- `scripts/test-extension-migration.mjs`: aprobado en PostgreSQL efímero con PGlite fuera del repo: sintaxis, FK de contacto tipo texto, RLS, denegación de acceso cliente, permisos service role, unicidad, constraint de confirmación y borrado en cascada. No sustituye la verificación inmediatamente posterior a aplicar en producción.
- `scripts/verify-linkedin-extension-package.mjs`: ZIP 4.0.5, 1.689.458 bytes, 11 archivos exactos, manifest y contenido verificados contra fuentes/bundles, sin puente histórico ni hosts de desarrollo.
- SHA-256 del ZIP: `a5eda574a56ec7c6fcf970e4f83911efef1a8de4b0eae6bb1cb602e480a37baa`.
- `git diff --check`: sin errores de whitespace.

Los scripts de navegador y migración admiten `PLAYWRIGHT_MODULE` y `PGLITE_MODULE` para utilizar dependencias temporales externas. No cargan `.env.local` ni llaman a servicios de producción. Solo el build de Next.js utilizó su configuración habitual de compilación.

## Paso siguiente de publicación

1. Autorizar y aplicar la migración pequeña; verificar esquema y controles de acceso.
2. Desplegar el árbol completo y verificado de `main` con API, historial y privacidad actualizados.
3. Cargar el candidato en un perfil Chrome controlado; conectar una cuenta real y probar guardar, investigar, redactar, secuencia y envío a un destinatario autorizado. Verificar historial y recuperación después de reiniciar el navegador.
4. Revisar la versión renderizada de privacidad y materiales de tienda; realizar las capturas del candidato validado.
5. Subir el mismo ZIP verificado como público y elegir publicación automática al aprobarse, según la decisión del propietario.

El despliegue de la app no equivale a publicación de la extensión en la tienda.
