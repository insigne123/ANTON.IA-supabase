# Extensión 4.0.1 — estado de despliegue

## Consolidación final — 10 de septiembre de 2026

Por petición del usuario, se publicó el árbol completo actual de `main`, incluyendo extensión, campañas, perfil/firma, correos e investigación. Revisión `studio-build-2026-09-10-003`, 100% del tráfico confirmado en Cloud Run. Ya no se utilizó la exportación parcial histórica.

- Suite completa: 1198 pruebas aprobadas, cero fallos; entorno del runner aislado de credenciales.
- Build conjunto completo, lint y tipos aprobados. Next muestra el diagnóstico de prerender de `/settings/organization` y la sirve como dinámica.
- ZIP generado por `extension:release` en `public/downloads` y excluido de la regla de ignore: HTTP 200, application/zip, 1687728 bytes.
- API de extensión con JSON correcto y origen permitido: HTTP 401 sin sesión. Los anteriores 400 de curl con JSON inline en PowerShell no probaban un error del servidor; la comprobación usa `Invoke-WebRequest` con serialización JSON.
- API de campañas y Email Studio: HTTP 401 sin sesión. Sin entradas ERROR en la revisión al consultar después del rollout.
- No se ejecutaron envíos ni migraciones en esta consolidación. Sigue pendiente la comprobación autenticada de la extensión con el navegador del usuario y DOM real de LinkedIn.

Para próximos despliegues usar el árbol completo de main: `npm run extension:release`, validaciones pertinentes y `firebase deploy --only apphosting:studio --project leadflowai-3yjcy --non-interactive`. Los exportadores parciales anteriores quedan como históricos; no usarlos para reemplazar el conjunto.

9 de septiembre de 2026.

- Paquete: `chrome-extension/antonia-linkedin-workspace-4.0.1.zip`.
- Artefacto acotado: `.release-extension-20260909190401364`, exportado de main con overlay explícito de extensión. Los cambios concurrentes de campañas, investigación y correos no se incluyeron.
- TypeScript y 16 pruebas aprobados sobre ese artefacto.
- Compilación local completa finalizó; el conflicto de lint por configuración del directorio padre se corrigió con `root: true` en el artefacto. Lint ejecutado por separado: cero errores y advertencias.
- Chrome con frontera API simulada: conectar, guardar, redactar, preparar y añadir a campaña; light/dark y 320/380/520 px.

## Despliegue completado

La sesión de gcloud se renovó. El log del build 018 mostró salida 137 durante Webpack. Se redujo el paralelismo (`cpus: 1`) y se activaron `webpackBuildWorker` y `webpackMemoryOptimizations`; build local completo y rollout remoto posteriores exitosos.

Se corrigió además la validación de origen tras el proxy de Firebase usando una lista explícita de orígenes (sin confiar en cabeceras forwarded arbitrarias), y la exclusión del ZIP en el `.gitignore` del artefacto.

Verificación pública final del 9 de septiembre de 2026:
- `/api/extension/workspace`: 401 con origen válido, JSON válido y sin sesión.
- `/downloads/antonia-linkedin-extension.zip`: 200, `application/zip`, 1687732 bytes.
- 17 pruebas de extensión aprobadas, incluida regresión de origen detrás de proxy.

Descarga: https://studio--leadflowai-3yjcy.us-central1.hosted.app/downloads/antonia-linkedin-extension.zip

Pendiente: instalar la extensión en el navegador del usuario y comprobar conexión, guardado e inserción del mensaje con sesiones reales. El selector de campañas colectivas continúa dependiendo del despliegue y habilitación de ese módulo independiente.

## 10 de septiembre de 2026 — despliegues concurrentes en `studio`

- Los despliegues de campañas (`build-2026-09-10-001`, `campaigns-runtime-fix`, `campaigns-ai`, `campaigns-seq`) sobrescribieron la versión con extensión: `/extension/connect`, `/api/extension/workspace` y `/downloads/antonia-linkedin-extension.zip` pasaron a 404.
- Se republicó el árbol completo actual (extensión 4.0.1 + campañas + resto del trabajo en curso) como `build-2026-09-10-002` (SUCCEEDED ~03:07 UTC). Verificado en vivo: `/extension/connect` existe, API de extensión responde con autenticación, ZIP 200, y `/api/campaigns/bulk` presente. Build local completo del árbol también verificado (incluye ambas superficies).
- Un minuto después, otro rollout `profile-sig-20260910` (SUCCEEDED ~03:08 UTC, desde una fuente sin los archivos de la extensión) volvió a tomar el tráfico: las rutas de la extensión devuelven 404 de nuevo.
- Conclusión: hay dos o más fuentes publicando al mismo backend y se pisan (last-writer-wins). No republicar en bucle: hay que consolidar todo en el árbol canónico de `main`, verificar el build una vez y desplegar una sola vez, pausando los demás despliegues mientras tanto.

## Historial de incidencias resueltas

El rollout `build-2026-09-09-016` falló por dos nombres de variable `module` en tests; corregidos en main y en el artefacto.

El intento corregido `build-2026-09-09-018` falló en Cloud Build con código 13, sin mensaje ni log crudo en la respuesta de App Hosting. No confundir el texto final del CLI «Deploy complete» con publicación: el estado del build es **FAILED**.

Log a revisar:
https://console.cloud.google.com/cloud-build/builds;region=us-central1/c8e3d517-4aa9-460d-9388-d57b720b6402?project=1083965020353

La reautenticación y el diagnóstico se completaron. No se aplicaron migraciones ni se activaron flags de campañas.

Después de un rollout exitoso, comprobar `/api/extension/workspace` (403 sin origen/401 sin sesión válida), descarga del ZIP y conexión de una cuenta real. Sigue pendiente la prueba del DOM de LinkedIn con sesión real.
