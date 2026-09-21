# Candidato LinkedIn Workspace 4.0.6

## Despliegue confirmado

Backend publicado con autorización del usuario: `studio-build-2026-09-13-003`, 100% del tráfico, 13 de septiembre de 2026. ZIP público verificado byte por byte contra el candidato: 4.0.6, 1.916.630 bytes, SHA-256 `b9f58da26c82fa68cef71883460b0867e30d06a3e3c4cf8857029caa4b6d7bd5`. API sin sesión devuelve 401, conexión redirige a login y privacidad pública responde 200. Sin entradas ERROR en la consulta de logs de la nueva revisión inmediatamente posterior al despliegue; esto no certifica operaciones autenticadas.

PDF mejorado con cabecera editorial, persona/empresa, estado destacado, fuentes enlazadas, distinción de hipótesis, limitaciones y pie numerado. Ejemplos sintéticos completo (3 páginas) e insuficiente (1 página) generados y revisados como PDF e imágenes. Prueba de descarga Chrome aprobada tras regenerar el bundle. No se realizaron envíos ni investigaciones facturables.

## Cambios

- Sigue por defecto el perfil abierto. Detecta navegación SPA con eventos de pestaña y sondeo de 1,5 segundos. La URL sigue funcionando aunque el contenido de LinkedIn aún no responda. Puede pausarse el seguimiento y la URL manual lo pausa automáticamente.
- Antes de cambiar, conserva el formulario y el borrador por usuario/organización/perfil en sesión. No sustituye el destinatario durante una operación en curso.
- Muestra campos existentes del resultado Apollo en «Más información profesional»: ubicación, titular, nivel de responsabilidad, departamentos, industria y tamaño de empresa; estado del correo visible por separado. Guarda esos datos en `enriched_leads.data.extensionDetails`. No requiere migración nueva.
- PDF generado localmente desde el resultado persistido de investigación: contexto, hechos/señales/hipótesis, fuentes, límites y referencia al snapshot en Supabase. No se sube un archivo PDF a Storage: los datos originales permanecen en Supabase y permiten regenerarlo y continuar el contacto.
- Descarga automática al obtener un resultado terminal, una vez por snapshot/cuenta/navegador; opción para desactivarla y botón manual. Requiere panel abierto o volver al contacto, y respeta la configuración de descargas de Chrome. No es un servicio de descarga en segundo plano con el panel cerrado.
- Resultado insuficiente explicado sin atribuir al usuario la falta de datos. Reintentar investigación parcial/insuficiente/fallida solicita `refresh: true`; no se ejecutó una nueva consulta facturable desde esta sesión.

## Diagnóstico de la captura

Consulta de solo lectura: la investigación del perfil mostrado sí existe en Supabase, con estado `insufficient_data`, score 24 y evidencia 0. Advertencias: sitio oficial no consultable, contratación no disponible, perfil/noticias empresariales no disponibles, ausencia de evidencia pública de persona y contexto empresarial. El PDF no convierte ese resultado en evidencia suficiente para contactar ni elimina las condiciones de calidad de los borradores.

## Validación

- 30 pruebas existentes de extensión aprobadas y prueba adicional de contrato/PDF aprobada.
- Chrome con API simulada, claro/oscuro y 320/380/520 px: enriquecimiento con ubicación, descarga PDF real capturada como evento, investigación, envío revisado, cambio de URL y pausa de seguimiento.
- No se enviaron mensajes ni se generaron investigaciones facturables en producción.
- Build completo de Next.js aprobado. ZIP local verificado: 4.0.6, 1.915.636 bytes, SHA-256 `30a6fe98eb9085a650b9f7abacfe903edec383b45f3cc8e3035ae61cfe83312b`.

## Publicación

Backend y ZIP desplegados. Instalar o recargar la extensión 4.0.6 para usar los nuevos campos y PDF. La investigación insuficiente existente puede descargarse al volver al contacto. Validar de nuevo con LinkedIn autenticado tras instalar 4.0.6. No se afirma que las fuentes externas previamente fallidas ya respondan.
