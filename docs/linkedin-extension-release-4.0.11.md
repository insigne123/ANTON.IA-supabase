# 4.0.11 · borradores persistentes y descarga manual

- PDF exclusivamente por botón Descargar PDF; volver a un perfil no inicia descargas.
- Borrador y hasta ocho opciones guardados en storage.local por usuario, organización y URL normalizada. Recuperación antes del lookup remoto para que un fallo de API no impida mostrar el borrador. Migra el borrador de session storage si todavía existe.
- Crear 3 opciones con IA es explícito y hace tres solicitudes, conservando resultados parciales. Elegir una opción guardada no llama IA. Variantes anteriores y ediciones se conservan al alternar dentro del límite de ocho opciones.
- Detector admite nombre del perfil en p/span, no solo headings. No demuestra cuál es el DOM de la sesión del usuario. La captura aún presenta texto de error de una versión anterior; actualizar extensión y recargar la pestaña es necesario para reemplazar scripts cargados.
- Tests DOM 9/9. Smoke navegador claro/oscuro 320/380/520 aprobado incluyendo ida/vuelta entre perfiles, borrador restaurado, ausencia de descarga automática, descarga manual y selección de opciones sin llamadas IA.
- Desplegado el 14 de septiembre de 2026 en studio-build-2026-09-14-005, 100% tráfico. ZIP público 4.0.11 verificado, 1.921.037 bytes, SHA256 582fa6da38a1d2a5880b20656e35e7b93378b3e23bc101799eb7abdd7def1f83. Privacidad, conexión y API sin sesión verificadas.
- El HTTP 500 del cron /api/cron/native-research?limit=5 correspondía a `Gateway Timeout` en el descubrimiento de la cola. Se corrigió con reintentos acotados solo de lectura (`research-queue-read.ts`, aplicado en `native-research.ts` y `research-report-worker.ts`; 11/11 tests, typecheck y build OK) y se desplegó en studio-build-2026-09-14-006 al 100%, con ZIP/rutas verificados y sin ERROR en la ventana de 15 minutos tras el despliegue. Al ser un timeout transitorio de la dependencia, no se puede certificar que no vuelva a ocurrir.

Sin envíos reales ni pruebas autenticadas de LinkedIn. Borradores persistentes locales no equivalen a sincronización entre dispositivos y no pueden recuperar contenido eliminado previamente por versiones anteriores.
