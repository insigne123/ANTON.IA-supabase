# Extensión 4.0.7 · conexión con informe comercial V2

## Cierre de recuperación

Se corrigieron los pendientes de `linkedin-extension-review-4.0.7.md`: la caché solo recupera ediciones marcadas como pendientes, detecta cambios de versión del servidor y permite elegir explícitamente recuperarlas; la selección se bloquea antes de esperar al almacenamiento. La consulta diferida de teléfono se conserva localmente y lee `people_search_leads` con usuario/organización/perfil acotados, sin repetir enriquecimiento. Al llegar un teléfono se informa para guardarlo y no se sobrescribe un teléfono escrito por el usuario. El reintento de síntesis delega al endpoint autenticado existente y tiene botón propio. Ausencia y fallo de síntesis se distinguen de espera.

PDF: los payloads estructurados adicionales se convierten en entradas etiquetadas, incluyendo cronologías, filas como objetos y valores cero/falso; las referencias se resuelven contra el grafo. No se vuelca JSON. Las pruebas de regresión están en `extension-recovery.test.ts`; las pruebas API de lectura de teléfono/reintento y Chrome de teléfono diferido aprobaron. El build completo Next.js también aprobó.

Artefacto actualizado: ZIP 4.0.7, 1.917.886 bytes; SHA-256 `199ea24a57ee4d2c415f321c60ca93fc9edb93c89cd505152625486d11116576`. Sustituye al hash previo de este documento. Sigue siendo candidato local, sin despliegue en esta etapa. No se ejecutaron nuevas investigaciones ni envíos externos.

Validación operativa pendiente: comparar el informe real de Bianca después de desplegar con la cuenta autenticada. No se afirma cobertura tipográfica universal: la fuente PDF estándar cubre el texto latino habitual, no todos los alfabetos. La configuración comercial «Mi empresa» sigue requiriendo el catálogo real del propietario.

## Causa confirmada

La captura de Bianca correspondía a la recopilación inicial (`lead_research_jobs.result_payload`). La extensión 4.0.6 convertía esos resultados en PDF y dejaba de consultar al terminar esa etapa, sin consultar la síntesis comercial. Una lectura de producción confirmó que el snapshot del caso ya tenía un documento V2 visible y completado, con 15 secciones, en `research_report_documents`. No se inició otra investigación ni se modificaron datos de producción.

## Correcciones locales

- `research-status` incorpora la síntesis V2 y su documento validado/visible mediante los mismos loaders del workspace. El estado de recopilación parcial no sustituye al estado del informe final.
- Continúa consultando mientras la síntesis esté queued/running/retry_scheduled. Si falla o no existe, lo explica y no inventa un PDF final.
- Descarga automática únicamente con documento V2 listo. Clave por cuenta, snapshot, documento y revisión, independiente de la descarga preliminar de 4.0.6.
- PDF con secciones narrativas V2, recomendaciones, referencias del análisis, fuentes, pendientes y entregables. El panel presenta resumen/decisión y ángulo comercial; las citas preliminares ya no se presentan como informe.
- Redacción LinkedIn utiliza hechos y análisis del documento V2 cuando existe, sin utilizar los snippets crudos como hechos del informe comercial.
- «Más información profesional» solo existe si hay valores; eliminado el texto sobre Apollo.
- Con email existente, ofrece Buscar teléfono y pide `revealEmail:false`, `revealPhone:true`; conserva el estado de verificación del correo. Con ambos datos disponibles, desaparece el bloque. No borra detalles anteriores si la consulta de teléfono no los devuelve.

## Límites

No se vuelve a generar el informe de Bianca: se recupera el existente. La calidad de su propuesta depende también del perfil comercial configurado: el documento revisado contenía «Mi empresa» como producto, un problema de configuración distinto de la exportación. No se reemplazó por un catálogo inventado.

No se modifica el motor V2 ni se cambia su configuración global. El PDF mantiene la necesidad de validar hipótesis y estimaciones. Los bloques de tabla solo se muestran cuando tienen estructura de filas/columnas reconocible; el texto narrativo de todas las secciones siempre se incluye.

## Validaciones

Pruebas de API (8), estado/PDF/loaders (3) y navegador Chrome en light/dark a 320/380/520 px aprobadas. Prueba de navegador verifica ausencia de PDF durante síntesis, descarga al llegar V2, ocultación del bloque vacío y petición exclusiva de teléfono. PDF sintético de 15 secciones generado y revisado visualmente.

## Despliegue confirmado

Backend publicado con autorización del usuario: `studio-build-2026-09-14-001`, 100% del tráfico, 14 de septiembre de 2026. ZIP público verificado byte por byte contra el candidato: 4.0.7, 1.917.886 bytes, SHA-256 `199ea24a57ee4d2c415f321c60ca93fc9edb93c89cd505152625486d11116576`. API sin sesión devuelve 401, conexión redirige a login y privacidad pública responde 200. Sin entradas ERROR en la consulta de logs de la nueva revisión inmediatamente posterior al despliegue; esto no certifica operaciones autenticadas. Sin migración nueva ni investigación facturable.

Build completo de Next.js aprobado. ZIP 4.0.7 verificado, 1.916.760 bytes, SHA-256 `f35d49e625b1b52dc26f800a80e753ff1b52a9634597ed218428d6be1b7b0d8f`.
