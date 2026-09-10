# Estado del despliegue de campañas — 2026-09-09

## Publicado

- App Hosting `studio` en `leadflowai-3yjcy`: el rollout de la etapa anterior terminó correctamente. Se publicó el subconjunto de campañas desde la copia aislada `bulk-deploy`, con `BULK_CAMPAIGNS_ENABLED=true` y `BULK_CAMPAIGNS_AUTOMATION_ENABLED=false`.
- Comprobación HTTP posterior: `/api/campaigns/bulk` y `/api/cron/bulk-campaigns` responden `401 Unauthorized` sin credenciales. Esto acredita rutas publicadas y protección de acceso; no acredita el flujo autenticado.
- `campaignProcessingTick` desplegada desde el workspace `main`, únicamente con `--only functions:campaignProcessingTick`. Build explícito de Functions aprobado. Revisión Cloud Run `campaignprocessingtick-00007-cox`, operación terminada a las 21:15:38 UTC.
- Se conservó el schedule existente cada cinco minutos, con invocación OIDC privada.
- Los dos primeros intentos fallaron durante la subida a Storage. El intento con resolución DNS IPv4 terminó correctamente.

## Pendiente antes de automatizar

- Ejecución confirmada en logs a las 21:20:13 UTC: `bulk-campaign-delivery completed with 200`. Esto comprueba el puente con automatización apagada, no la entrega de correos.
- Corrección aplicada en producción (`bulk_revision_binding`, 2026-09-09): `revise_bulk_campaign_pending_v1` actualiza la audiencia revisada antes de crear los borradores, dentro de la misma transacción; trigger `bulk_campaign_frozen_messages` protege identidades/contenido enviados. Verificado: parche presente en el cuerpo de la función y trigger creado.
- El servicio de revisión consulta los miembros existentes sin volver a aplicar el filtro de primer contacto. El contenido bloqueado se compara usando el contexto original y sus overrides.
- La reaprobación reconoce el primer envío confirmado (incluido su marcador conservado por retención), pero sigue bloqueando respuestas y destinatarios no elegibles para primer contacto.
- Pruebas ejecutadas: SQL PostgreSQL/WASM de vinculación y mensajes bloqueados; cinco pruebas de flujos, incluida reaprobación; typecheck aprobado. Pendiente la prueba autenticada con el esquema completo.
- Bloqueo operativo resuelto: el MCP `supabase-production` volvió a estar disponible y la corrección ya quedó aplicada y verificada en `yfdelflsheurzaicwayi`.
- La copia aislada utilizada para el rollout anterior quedó detached y sin integrar un commit en `main`. No volver a desplegar desde ella. Alinear el conjunto publicado con `main` sin incluir el trabajo concurrente ajeno a campañas.

La automatización sigue apagada. No se enviaron correos de prueba a destinatarios reales.

## Rediseño de audiencia — 2026-09-10

- La IA ya no devuelve criterios: recibe un CSV construido en el servidor con los leads enriquecidos guardados (campos Apollo) y devuelve un ranking con puntaje y razón por lead.
- Solo se aceptan correos presentes en el CSV; la elegibilidad (contacto previo, bloqueos, respuestas) sigue siendo determinística en el servidor.
- La búsqueda manual convive como alternativa y ahora respeta `enrichedOnly` (nueva migración `20260910180000_bulk_audience_enriched_only.sql`, aplicada en producción).
- La UI del paso 0 tiene modos «Describir lead ideal con IA» y «Filtros manuales», con seleccionar todos/ninguno sobre los resultados.
- Verificación: typecheck, pruebas unitarias/SQL/navegador en árbol aislado solo-campañas; despliegue App Hosting solo con estos archivos; `/api/campaigns/bulk/audience/rank` responde `401` sin sesión (ruta viva y protegida).

## Incidente de pantalla anterior — 2026-09-10

- Causa comprobada en el ZIP fuente de `build-2026-09-10-001`: `src/app/(app)/campaigns/page.tsx` no contenía `export const dynamic = 'force-dynamic'`. El archivo local sí lo contenía; comprobar el archivo local no acreditaba el despliegue.
- Comprobación directa de la imagen publicada: `/workspace/.next/standalone/.next/prerender-manifest.json` incluye `/campaigns` con `initialRevalidateSeconds: false`. La pantalla se había preconstruido sin el flag, disponible únicamente en RUNTIME.
- Las respuestas 401 de las API y el flag activo no prueban qué componente sirve la página. La atribución anterior a caché del navegador fue incorrecta.
- Corrección preparada desde `main`: paquete verificado con una sola diferencia respecto al ZIP publicado, `campaigns/page.tsx`. `scripts/package-campaigns-runtime-fix.py` verifica procedencia y rechaza divergencias ajenas a campañas; `scripts/inspect-campaigns-image.py` inspecciona el manifiesto real de la imagen sin modificar el servicio.
- Build correctivo: `campaigns-runtime-fix-20260910`, estado `READY`; Cloud Build `2317013b-5864-4c3a-82cf-70d9aee9f17d` completó la compilación Next, lint y validación de tipos.
- Imagen corregida inspeccionada directamente: `/campaigns` ausente del manifiesto de prerender; `campaigns/page.js` contiene `force-dynamic`, `BULK_CAMPAIGNS_ENABLED` y `BulkCampaignWorkspace`.
- Rollout `campaigns-runtime-fix-20260910`: `SUCCEEDED`. Tráfico verificado al 100% en `studio-campaigns-runtime-fix-20260910` tras activación a las 01:41 UTC. Flags de esa revisión: campañas `true`, automatización `false`.
- Smoke HTTP posterior: `/login` 200; `/campaigns` 307 a login sin sesión, como corresponde. Sin entradas ERROR en la revisión nueva al consultar. No se dispone de la sesión del usuario para comprobar visualmente su pantalla autenticada; la verificación realizada acredita el artefacto corregido y su publicación efectiva.

## Objetivo y generación de correos — 2026-09-10

- Problema de flujo/formulario: el objetivo solo actualizaba estado; la acción IA estaba separada al final del editor y los errores globales podían quedar fuera del viewport. No se comprobó un fallo concreto del proveedor asociado a la captura del usuario.
- Referencia funcional: editor y revisión de propuestas existentes en `BulkCampaignWorkspace`, con las reglas locales de `form-ux-patterns`, `empty-states-microcopy` y `wcag-remediator`. Consulta a Figcomponents intentada, sin respuesta del sitio. Se reutilizan tokens y componentes propios, agrupando objetivo y acción para reducir ambigüedad.
- Acción única junto al objetivo: «Generar correo con IA» para un correo vacío; completa asunto y cuerpo editables. Con contenido existente, «Proponer cambios con IA» conserva el original hasta aplicar la propuesta. Los ajustes adicionales son opcionales y están en el mismo bloque.
- Carga, error y resultado cerca de la acción; foco al resultado; timeout de 90 segundos y validación de propuesta. Límites de objetivo/instrucción alineados con la API (2000 caracteres).
- Prueba Chrome aprobada con API simulada: objetivo enviado, generación inicial, error visible, reintento, preservación de texto y aplicación explícita. Flujo existente de revisión/aprobación también aprobado. Responsive a 320/380/1280 px y capturas claro/oscuro revisadas con los tokens reales cargados.
- Paquete desde `main` comparado contra la versión publicada: solo cambia `src/components/campaigns/BulkCampaignWorkspace.tsx`; mantiene la ruta dinámica. Build `campaigns-ai-20260910` aprobado (Cloud Build `3b03ae6b-5fe9-4f4b-9874-6caba6918d05`, compilación, lint y tipos).
- Rollout `SUCCEEDED`; tráfico 100% en `studio-campaigns-ai-20260910`. Imagen inspeccionada: `/campaigns` sigue dinámica y bundle contiene la acción y el feedback nuevos. El asset `page-a293da5ccff0422c.js` responde 200 desde el dominio público y contiene ambos textos. Sin errores de revisión al consultar logs tras el rollout. La generación real con la sesión del usuario sigue sin comprobarse; la prueba funcional usa respuestas simuladas.

## Secuencia elegida por el usuario y editor lateral — 2026-09-10

- Petición: elegir antes de generar cuántos seguimientos se necesitan y disponer de edición IA contextual a la derecha.
- Referencia funcional consultada: https://www.apollo.io/product/sales-engagement. Se rescatan secuencias y asistencia contextual, con componentes/tokens propios y sin copiar identidad o assets. Composición: objetivo y cantidad arriba, editor izquierdo y asistente derecho; una columna en móvil.
- `CampaignSequenceEditor`: elección explícita sin cantidad preseleccionada para secuencias nuevas (0–4 seguimientos); generación conjunta de inicial y seguimientos; espera editable de 1–90 días desde envío anterior. Reducir correos escritos pide confirmación. Regenerar muestra propuesta completa para aplicar o descartar.
- Panel lateral: edición del mensaje seleccionado con contexto de toda la secuencia. Aplicación explícita, preservación de otros correos y de tiempos; mensajes enviados/en curso bloqueados. Loading, error y resultado con foco local.
- API `assist` admite `sequence`: autentica y consume presupuesto una vez; valida cantidad exacta y aplica tiempos solicitados en servidor. Una secuencia incompleta se rechaza sin modificar el editor.
- Tests aprobados: contrato de 0–4 seguimientos y tiempos, rechazo de secuencias incompletas; endpoint con auth/budget y petición inválida; Chrome con selección previa, generación de tres correos, reintento, edición de seguimiento sin alterar inicial, descarte de regeneración y flujo de revisión. API/IA simuladas, sin envíos reales. Layout derecho/colapsado y overflow verificados; capturas light/dark revisadas.
- Build `campaigns-seq-20260910` aprobado desde paquete validado contra el último publicado, con cuatro archivos runtime de campañas de `main`. Cloud Build `091b47f7-dc37-4766-b5ff-b23aea8df1a7` completó compilación, lint y tipos.
- Rollout `SUCCEEDED`; tráfico al 100% en `studio-campaigns-seq-20260910`. Imagen inspeccionada: página dinámica, elección explícita, generación de secuencia y asistente lateral presentes. Asset público `page-fea4cba11914ba51.js` respondió 200 con los tres marcadores. Sin errores de la revisión al consultar tras activar. No se verificó una generación real con la sesión del usuario.

## Contrase�a y firma simple � 2026-09-10

- El cambio de contrase�a exist�a solo en el �rbol local sin publicar; por eso no aparec�a en producci�n. Se publica ahora en `/profile` (crear o cambiar contrase�a, con verificaci�n cuando corresponde).
- Email Studio: la firma queda primera, siempre visible, sin secci�n colapsada. Flujo �subir y listo�: arrastrar o elegir imagen PNG/JPG, guardado autom�tico y vista previa con aspecto de correo real. Ancho, alt, datos de texto y separador quedan en �Opciones avanzadas�. Se mantiene una firma por cuenta (Gmail/Outlook).
- Verificaci�n: test de validaci�n de contrase�a, `tsc --noEmit` limpio, imagen inspeccionada (contrase�a y firma en bundles de servidor y cliente), build `profile-sig-20260910` aprobado, rollout `SUCCEEDED` con 100% del tr�fico y sin errores en la revisi�n. Durante la activaci�n apareci� la revisi�n `studio-build-2026-09-10-002` de otra subida concurrente del �rbol completo; el tr�fico final qued� en la revisi�n limpia con solo los 5 archivos previstos.
