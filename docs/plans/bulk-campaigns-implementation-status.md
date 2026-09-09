# Campañas colectivas: estado de implementación

## Decisión aprobada

El usuario revisa la plantilla y todos sus ejemplos personalizados y aprueba o rechaza el conjunto. La aprobación fija audiencia, proveedor y mensajes exactos. No hay generación IA posterior a aprobar. Las campañas aprobadas son inmutables; pueden pausarse y reanudarse. Los mensajes pendientes (sin envío confirmado, en curso, fallido o desconocido) pueden editarse mediante una revisión versionada que congela lo ya enviado y exige una nueva aprobación.

## Implementado en código

- Workspace con campañas masivas y bandeja existente de seguimientos individuales.
- Audiencia propia de la organización a partir de leads guardados, enriquecidos y contactados, con historial de envíos agregado por email.
- Interpretación IA en filtros editables; requisitos no representables se muestran al usuario.
- Selección positiva de hasta 100 personas, persistida con cada revisión.
- Editor manual, propuesta IA aplicable/descartable, hasta cuatro seguimientos, preview completo por persona.
- RPC transaccional de aprobación y creación de borradores canónicos; control optimista de revisión y hash.
- Procesamiento manual y trabajador en segundo plano con un emisor común, cuota, tokens cifrados e idempotencia estable.
- Puente del scheduler Firebase cada cinco minutos, condicionado por `BULK_CAMPAIGNS_ENABLED` y `BULK_CAMPAIGNS_AUTOMATION_ENABLED`.
- Edición por destinatario manual o con propuestas IA. Aprobar queda bloqueado durante una edición individual.
- Reutilización del perfil y mensajes de campañas existentes con nueva selección explícita de audiencia.
- Guard SQL en inserción y claim de dispatch: aprobación, remitente, clave canónica, versión exacta, pausa, cadencia, respuesta, baja y contacto previo.
- Procedencia persistente en borradores: borrar una campaña no permite enviar sus borradores como correos independientes.
- Limpieza de campañas al borrar borradores o contactos de origen, incluidas campañas aún no aprobadas. Se elimina el lote completo para no alterar una aprobación silenciosamente.
- Cadencia desde envío confirmado, sin reintento automático de resultado desconocido.
- Incidencias por borrador persistidas fuera de la revisión: próximo intento, motivos en lenguaje de producto y límite de cinco fallos temporales. Un éxito confirmado no puede ser sobrescrito por un intento fallido tardío.
- Envío manual y worker comparten seguimiento de intentos. «Volver a comprobar» permite recuperar fallos temporales; SQL impide reintentar dispatches en curso, desconocidos, fallidos o enviados y bloqueos permanentes.
- Estado por destinatario con cantidad de envíos confirmados, próximo correo e incidencias. Los fallos individuales no detienen el lote manual.
- Consulta/exportación de privacidad incorpora únicamente el destinatario solicitado, sin el resto de la audiencia ni el brief compartido. Consulta paginada e independiente del flag de activación.
- Búsqueda de audiencia paginada en SQL (`search_bulk_audience_v1`): agrega leads, enriquecidos, contactados, dispatches, bajas y dominios por email; filtra relación, términos (cargo, industria, país, tamaño, antigüedad, insensible a acentos), antigüedad mínima, respuestas y texto libre; devuelve total y página. Las razones visibles se recalculan en TS con `matchAudience`.
- Perfiles de audiencia guardados (`bulk_audience_profiles`, RLS por propietario, máximo 20): guardar, aplicar y eliminar criterios reutilizables.
- Presupuesto diario de ayuda IA (`bulk_ai_assist_usage` + `consume_bulk_ai_assist_v1`, 50/día por usuario configurable con `BULK_AI_ASSIST_DAILY_LIMIT`): el endpoint de asistencia responde 429 al agotarse.
- Edición versionada de pendientes (`revise_bulk_campaign_pending_v1` + `POST /bulk/[id]/revise` + UI «Editar mensajes pendientes»): conserva audiencia y estructura, congela mensajes enviados/en curso/fallidos/desconocidos, genera borradores nuevos solo para editables, limpia intentos obsoletos, vuelve a `draft` con nueva revisión y exige re-aprobar. La re-aprobación reutiliza borradores ya creados sin duplicarlos.
- Historial unificado por destinatario (`GET /bulk/[id]/history` + «Ver historial unificado»): correos de campaña, entregas, incidencias y contactos/respuestas históricas en una sola línea de tiempo.

## Pendiente antes de activar

Las 7 migraciones (`20260910100000` … `20260910160000_bulk_campaign_guard_retention.sql`) fueron aplicadas en producción `yfdelflsheurzaicwayi` el 2026-09-09, una por vez y con verificación inmediata (tablas, RLS, policies, funciones, grants, triggers y filas). Verificación post-retención: un envío confirmado es terminal aunque la retención borre su dispatch (`BULK_CAMPAIGN_ALREADY_SENT` en el guard + `withSentAttemptsAsDeliveries` en worker, ruta manual e interfaz). La experiencia permanece detrás de `BULK_CAMPAIGNS_ENABLED=true` y conserva la pantalla previa como entrada por defecto porque el código aún no está desplegado.

- Despliegue pendiente (bloquea la activación): el código de campañas colectivas solo existe en el árbol local, que además contiene trabajo no relacionado sin commitear. No desplegar desde este árbol. Integrar a `main` lo revisado, desplegar la app y después Functions; solo entonces probar el puente del programador Firebase contra `/api/cron/bulk-campaigns` y habilitar `BULK_CAMPAIGNS_ENABLED` (y más tarde `BULK_CAMPAIGNS_AUTOMATION_ENABLED`).
- Concurrencia multisesión real con el esquema completo de producción (pausa durante envío, aprobar/revisar en paralelo, doble claim): validar en staging tras el despliegue. Las pruebas PostgreSQL/WASM validan transacciones, permisos y triggers con tablas de soporte mínimas, no equivalencia completa de producción.
- Retención verificada a nivel de diseño y pruebas: borrar un borrador o contacto elimina el lote completo (nunca lo edita en silencio); borrar un dispatch antiguo no re-activa su envío (marcador `sent` terminal en guard, worker, ruta manual e interfaz).
- Revisión visual dentro del shell completo de la app (capturas, contraste, foco) tras el despliegue.
- Seguimientos iniciados desde contactos históricos sin borrador previo y métricas globales por campaña: fuera de este cierre, requieren diseño de procedencia adicional.

## Validación realizada

- `scripts/bulk-campaign-sql.test.mjs`: ejecución de ambas migraciones en PostgreSQL/WASM aislado, RPC real de creación de borradores, rollback de aprobación parcial, rechazo de versión/hash distintos, repetición de aprobación, RLS, prohibición de escrituras cliente, pausa en insert y claim, orden/cadencia, respuestas y borrado con bloqueo de bypass.
- `src/lib/bulk-campaigns.test.ts`: audiencia, falta de evidencia, fechas, variables, duplicados, cadencia y ediciones individuales válidas/inválidas.
- `src/lib/server/bulk-campaign-worker.test.ts`: avance, resultados desconocidos, cuotas, pausas, presupuesto y aislamiento de fallos entre campañas.
- `scripts/bulk-campaign-browser.test.mjs`: componente real y Tailwind en Chrome, API simulada sin conexiones externas; creación, propuesta IA sin sobrescritura, edición individual, rechazo/aprobación, teclado y ausencia de overflow en light/dark a 320/380/768/1440 px. Inbox y enlace Next aislados.
- Typecheck de app y Functions aprobados durante la implementación.
- `src/lib/server/bulk-campaign-sender.test.ts`: ambos proveedores simulados, contenido aprobado, cuota tras claim durable, replay/pausa/versión distinta, supresión y errores previos al proveedor.
- `src/lib/bulk-campaign-attempts.test.ts` y worker: espera persistente, límite de reintentos, intervención ante bloqueos, mensajes sin filtración de errores del proveedor.
- Prueba SQL ampliada con registro de intentos, RLS, éxito monotónico, límite de cinco, reinicio autorizado, bloqueo de reintento en envío y limpieza en cascada.
- `src/lib/server/bulk-campaign-privacy.test.ts`: exportación limitada al sujeto, paginación, compatibilidad previa a migración y fallo explícito ante errores de permisos. Suite de contratos de privacidad existente aprobada.
- `scripts/bulk-campaign-audience-sql.test.mjs`: búsqueda (filtros, acentos, paginación, reactivación, bloqueos, aislamiento), presupuesto (conteo, agotamiento, membresía), RLS de perfiles y revisión de pendientes (congelado, audiencia, versiones, re-aprobación, bypass de borradores viejos).
- `src/lib/server/bulk-campaign-flows.test.ts`: razones deterministas en búsqueda, historial por miembro, revisión con dependencias simuladas y validación/límites de perfiles.
- `scripts/bulk-campaign-browser.test.mjs`: búsqueda con texto, guardado de perfil, propuesta IA, edición individual, rechazo/aprobación, historial unificado, edición de pendientes con re-aprobación, teclado y ausencia de overflow en light/dark a 320/380/768/1440 px.
- Suite unitaria completa: 1143 pruebas aprobadas, 0 fallos. Typecheck de app y Functions aprobados.

Los scripts SQL/browser usan herramientas instaladas fuera del repo en `%LOCALAPPDATA%/Temp/opencode/`; no dependen de `.env.local`, Docker ni producción. La prueba de navegador detectó overflow a 320 px y se corrigió el wrapping de pestañas y acciones.

## Activación pendiente

Aplicar y verificar cada migración por separado con autorización explícita para producción. Desplegar app antes de Functions para que exista el endpoint nuevo. Mantener ambos flags apagados hasta las verificaciones finales; habilitar automatización solo cuando el scheduler y el emisor estén comprobados. La aprobación inicia automáticamente el envío si el flag de automatización está activo, y la interfaz lo informa antes de confirmar. Pausar bloquea claims posteriores; un envío que ya entró al proveedor puede terminar.

No habilitar el flag ni desplegar como sistema completo hasta resolver estos puntos. La aprobación de producto no se usó para ejecutar envíos reales ni migraciones remotas.

## Referencias visuales

Problema de flujo y layout. Unsection (consultado): jerarquía mínima, superficies amplias y foco en una acción. Figcomponents no estuvo accesible. Adaptación con componentes UI existentes, tokens semánticos light/dark y preview textual escapado; sin copiar assets ni layouts literalmente.
