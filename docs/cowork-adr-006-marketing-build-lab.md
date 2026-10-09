# ADR 006 · Laboratorio de marketing y miniapps

Fecha: 9 oct 2026. Estado: base implementada; conformidad remota y activación del mantenedor pendientes.

## Decisión

Mantener ANTON.IA/Supabase como control plane y endurecer el executor existente, con interfaz `BuildProvider` neutral. El primer piloto no necesita contratar Daytona/E2B: los exportadores deterministas resuelven el informe y una calculadora estática autocontenida. Un proveedor managed podrá sustituir la ejecución cuando haya asignación y conformance medido.

El código recibe datos/archivos autorizados, nunca credenciales de app/correo/Storage. La propuesta fija código, nombres y un manifest de bytes SHA-256 antes de revisión. Los outputs completos pasan a Storage privado mediante cierre confirmado. Las salidas fallidas quedan sin publicar.

## Ejecución

Supervisor v2: admisión durable → job/generación → estado consultable → resultado/manifiesto. Concurrencia inicial 1, límite actual 120 s/1 CPU/2 GB, red desactivada. `/out` tmpfs acotado y recolector confiable; watchdog dentro del contenedor independiente del supervisor. Cancelación solicitada no se presenta como stop confirmado. Un reinicio reconcilia el contenedor registrado y nunca repite código automáticamente.

El adapter de Studio usa requests cortos y consulta la misma identidad en los wakes siguientes. El hash de request y el estado del resultado deben coincidir; se revalida sesión/grant/run antes de promover y el RPC de cierre publica el conjunto. La recuperación automática de una propuesta atascada se limita a código aislado/idempotente, no a envíos u otros efectos externos.

## Workspace y preview

El workspace lógico inicial usa assets del usuario/organización y versiones por run, independientes de la vida del contenedor. Outputs publicados pueden observarse y volver a ser inputs con hash comprobado, detrás de `COWORK_BUILD_WORKSPACES_ENABLED`. La receta y fuentes siguen ligadas al código aprobado. Esto no restaura memoria de procesos ni equivale a una VM personal persistente.

La preview inicial reutiliza iframe de origen opaco, CSP/sandbox y route autenticada de la app. La calculadora es autocontenida. El incremento siguiente ensambla HTML, CSS, JavaScript clásico e imágenes locales del manifiesto de **un mismo build confirmado**, comprobando tamaño y SHA-256 de cada recurso. La lectura no ejecuta código en el servidor ni descarga URLs; el archivo original descargable conserva sus bytes. Rutas fuera del conjunto, recursos externos y módulos no compilados se rechazan con un error recuperable.

La vista permite eventos de formularios locales (`allow-forms`) y bloquea las solicitudes de formulario con `form-action 'none'`: sin eso la calculadora parecía renderizada, pero no ejecutaba su handler. La prueba en Chrome comprueba ambas consecuencias, además del origen opaco y ausencia de requests externos. Un origen externo privado con TTL, dev server persistente, toolchain/browser remotos y storage por proyecto siguen necesitando validación/infraestructura adicional. El contenido generado no autoriza publicación pública.

## Piloto concreto

`marketing-deliverables.ts` construye PDF, Word, Markdown, Excel y calculadora HTML sobre contactos observados. El ZIP contiene el manifest de scope/datos/hashes. Los tiempos de cálculo los define el usuario: no incorpora benchmarks de ahorro ni claims del negocio. Los datos permanecen consistentes entre formatos y se pueden editar.

## Activación y costo

- `COWORK_EXECUTOR_ASYNC_ENABLED`: solo después de actualizar supervisor, comprobar `/v2/capabilities` y conformidad Docker real.
- `COWORK_CODE_FENCING_ENABLED`: antes del modo asíncrono, tras verificar las funciones de cierre/requeue/dispatch de la migración pequeña candidata.
- `COWORK_BUILD_WORKSPACES_ENABLED`: después de verificar reutilización/scope/retención de assets.
- No se asignaron nuevos gastos cloud ni se provisionó proveedor durante esta ejecución. Los US$10 autorizados corresponden a modelos de evaluación.
- El despliegue/activación corresponde al mantenedor. Los checks de adapters no sustituyen un build con contenedor real, pausa/recuperación ni aceptación autenticada.
