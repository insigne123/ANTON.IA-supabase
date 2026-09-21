# Candidato 4.0.8 · conversación LinkedIn

## Inserción

La captura mostraba un fallo de detección de cabecera anterior a la apertura del chat. Se sustituyó la dependencia de `h1.closest(section,.artdeco-card)` por un buscador de cabecera que reconoce main/role-main, encabezados nativos o accesibles, nombre recibido del panel y título de página. Asciende contenedores acotados y rechaza entrar en recomendaciones o secciones ajenas. Reconoce texto/aria-label del botón y espera el renderizado del perfil.

Preparar y enviar usan ese mismo buscador. Preparar admite textbox contenteditable y textarea, comprueba el texto completo y revalida perfil/destinatario después de la inserción. Se retiró el fallback de identidad basado solamente en coincidencia de nombre. Un chat sin enlace de destinatario verificable bloquea la acción. Envío automático sigue requiriendo confirmación, reserva durable y nuevo evento saliente; no se relajaron sus condiciones de éxito.

## Redacción específica

`linkedin-message-writer.ts` establece un canal separado de email: primer contacto conversacional, objetivo 35–75 palabras y 2–3 párrafos, máximo comprobado 600 caracteres, una pregunta y un detalle relevante. Prioriza respuesta antes que reunión salvo objetivo explícito. No inventa historial: el borrador anterior no es una conversación.

Filtra etiquetas genéricas del vendedor. Las capacidades y pruebas comerciales proceden del perfil, no se inventan. Valida longitud, placeholders, preguntas múltiples, enlaces y formato email. Permite un único intento editorial adicional; devuelve 422 con mensaje accionable si no cumple. El panel informa si faltan empresa/propuesta de valor. Los objetivos de palabras, párrafos y veracidad contextual son instrucciones de redacción, no una garantía de calidad semántica automática.

## Validación

- 46/46 pruebas aprobadas: cabecera moderna sin section/artdeco/h1, cabecera clásica, editor textarea, recomendaciones ajenas, preparación sin enviar, envío explícito con evento nuevo, conservación de borradores y estados del worker; controles editoriales con respuestas de IA simuladas.
- Panel Chrome: light/dark y 320/380/520 px, aprobado con API Chrome simulada.
- Build completo Next.js aprobado; ZIP 4.0.8 verificado: 1.919.015 bytes, SHA-256 `091d07a523fc50ba18032b7298110b42e07eac1e4ad534d5bb1e1f9b4b00050e`.

No se ejecutó un envío real ni una generación pagada en producción. La captura no contiene el DOM; hay que confirmar el comportamiento con la sesión real tras instalar la versión. No afirmar que LinkedIn aceptó un mensaje solo porque pasó el test sintético.

## Estado

Desplegado con autorización del usuario el 14 de septiembre de 2026. Revisión `studio-build-2026-09-14-002`, 100% del tráfico. ZIP público 4.0.8 comprobado byte por byte contra el paquete local (hash y tamaño indicados arriba). Privacidad HTTP 200; conexión HTTP 307 a login con retorno; API sin sesión HTTP 401. Sin entradas ERROR en la consulta de logs de la revisión inmediatamente después de desplegar (ventana 15 minutos). No equivale a validar inserción o entrega en una sesión real de LinkedIn.

Actualizar/recargar extensión y pestaña de LinkedIn para utilizar los nuevos helpers de DOM. Generar otra versión del borrador para usar el nuevo redactor. Sin nueva migración ni envíos reales realizados.
