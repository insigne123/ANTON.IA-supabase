# Cowork · referencias externas y hoja de ruta (26 sep 2026)

## Objetivo

Que Cowork sea tan fácil de usar como Claude, orientado a ANTON.IA: prospección, correo y LinkedIn. Una persona que no conoce la app debe poder:
- pedir algo con sus palabras;
- entender la respuesta de un vistazo;
- seguir con un toque.

Para eso se revisaron seis proyectos de código abierto. Se leyó el código, no solo los README.

## Qué se revisó

| Proyecto | Qué es | Qué sirve para Cowork | Estado |
|---|---|---|---|
| **LobeHub** (`lobehub/lobehub`) | Chat de agentes con herramientas | **Follow-up chips:** 0 a 4 respuestas rápidas con etiqueta de hasta 40 caracteres y mensaje de hasta 200. Se sanean una por una y se descartan las de relleno («déjame pensar»). **AskUserQuestion:** cuando falta un dato, una tarjeta con opciones en vez de una pregunta en texto | Chips aplicadas en insigne123/ANTON.IA-supabase#3. Preguntas con opciones: pendiente |
| **Open WebUI** (`open-webui/open-webui`) | Chat para modelos propios | **Follow up:** 3 a 5 preguntas sugeridas en una llamada aparte. **Comandos del composer:** `/` plantillas, `#` documentos, `@` modelos. **Sugerencias de inicio** por modelo | En Cowork las sugerencias salen en la misma respuesta, sin llamada extra. Comandos: pendiente |
| **LibreChat** (`LibreChat-AI/LibreChat`) | Chat multi-proveedor | **Plantillas con `/`** y variables `{{variable}}`: al elegir una, un formulario pide los valores y se envía. **Conversation starters.** Botones por mensaje: copiar, editar, regenerar, bifurcar. **Artefactos** en panel lateral | Cowork ya tiene copiar, reintentar y artefactos. Plantillas: pendiente |
| **LeadAce** (`aitit-inc/leadace`) | Agente de ventas B2B por chat («Ace»), el más parecido a Cowork | Ver el detalle bajo la tabla | Recetas y regla aplicadas en insigne123/ANTON.IA-supabase#5. Acciones rápidas: pendiente |
| **OpenLeads** (`Samyrrrrrr990/openleads`) | Prospección y envío local | **Una frase → acción estructurada:** quién, cuántos, qué ofrecer y cuándo, con vista previa antes de enviar | Idea para «campaña en una frase» |
| **FormHarvester** (`dariomory/formharvester`) | Busca sitios, extrae correos y llena formularios de contacto con un navegador que evita detección y resuelve captchas | Nada. Choca con la política de contacto y privacidad de ANTON.IA (Ley 19.628 y Ley 21.719) y con el modelo de aprobaciones | Descartado |

**LeadAce en detalle.**
- **Prompt corto, por intenciones:** estado, conseguir prospectos, envíos, resultados, estrategia, mantención y automatización. Cada intención lleva a su herramienta.
- **Regla clave:** «si la persona pide una acción, no preguntes "¿lo hago?": hazlo; la aprobación es la confirmación». Un paso que nadie pidió se ofrece en una línea.
- **Acciones rápidas cortas y siempre visibles:** «Find 10 prospects», «Draft 5», «Results?».
- **Onboarding:** pegar la web de la empresa → propuesta de a quién apuntar → primeros prospectos.
- **Trabajos largos en segundo plano,** con aviso en el chat al terminar.

## Qué ya se aplicó

1. **Respuestas sugeridas** (insigne123/ANTON.IA-supabase#3): hasta tres botones bajo la última respuesta.
   - El primero responde «sí» a la pregunta final.
   - Se sanean de forma determinista.
   - Si faltan la pregunta final o las sugerencias, el bucle pide una corrección.
   - Resultado con gpt-6-luna: 41/42 casos y 30/30 respuestas con pregunta y sugerencias.
2. **Corpus de marketing y recetas por intención** (insigne123/ANTON.IA-supabase#5): 11 casos nuevos de correo y LinkedIn escritos como los pide un usuario nuevo, más recetas cortas al estilo LeadAce:
   - «¿qué puedes hacer?»;
   - «mándale un correo a…»;
   - «¿a quién le escribo hoy?»;
   - «mejora este correo»;
   - «no me respondió»;
   - «¿cómo le fue a mi campaña?».

   También la regla «si pide redactar, entrégalo sin preguntar». Resultado: marketing pasa de 15/22 a 33/33 y producción queda en 40/42, con 3 repeticiones.
3. **La pregunta final no queda dentro de la lista** (insigne123/ANTON.IA-supabase#4): arreglo del parser de Markdown. Afecta cerca del 5 % de las respuestas, justo las que cierran con una pregunta bajo una lista.

## Hoja de ruta propuesta

En orden de impacto por esfuerzo. Cada punto es un PR chico.

| # | Qué | Por qué | Esfuerzo |
|---|---|---|---|
| 1 | **Acciones rápidas persistentes** bajo el composer: «Escribir a mis contactos», «Buscar prospectos», «¿Cómo voy?», «Seguimientos» | En LeadAce son la entrada principal. Hoy las sugerencias de inicio de Cowork desaparecen después del primer mensaje | Bajo, solo UI |
| 2 | **Contexto base del usuario** (nombre, empresa y oferta) en cada turno | En el corpus de marketing, la firma y la oferta cuestan dos de las tres consultas por turno. Sin ellas, algunos correos salen firmados «Yago SpA» | Medio: worker y contexto, sin migración |
| 3 | **Mencionar contactos con `@`** en el composer | Elegir un contacto guardado evita búsquedas ambiguas y ahorra una consulta. `contactRef` ya viaja oculto con el mensaje | Medio: UI y una lectura existente |
| 4 | **Plantillas con `/` y variables** («/campaña {segmento} {oferta}») | Tareas frecuentes sin escribir el pedido completo | Medio |
| 5 | **Preguntas con opciones** cuando falta un dato (fecha, proveedor o segmento) | Una tarjeta con opciones se contesta con un toque. Hoy es texto libre | Medio |
| 6 | **Texto que aparece mientras se escribe** (streaming de `reply`) | Hoy la respuesta aparece entera al final. La salida JSON estricta lo complica: hay que evaluar el streaming del campo | Alto |
| 7 | **Onboarding conversacional** («pega la web de tu empresa») | Para cuentas nuevas sin oferta configurada | Medio |
| 8 | **Abrir Cowork a más usuarios** | Hoy solo lo usa la cuenta dueña: la restricción está en funciones SQL. Requiere una migración y una decisión de producto | Decisión del dueño |

## Cómo medir cada cambio

- **Corpus:**
  - `scripts/fixtures/cowork-conversation-corpus.ts` tiene 14 conversaciones reales de producción.
  - `scripts/fixtures/cowork-marketing-corpus.ts` tiene 11 casos de correo y LinkedIn (llega con insigne123/ANTON.IA-supabase#5).
- **Sin modelo:** `node --loader ./scripts/ts-test-loader.mjs --test scripts/cowork-conversation-corpus.test.ts`. Una respuesta ideal por caso pasa por el bucle real.
- **Con el modelo real:**

  ```
  OPENAI_API_KEY=… COWORK_MODEL=gpt-6-luna node --loader ./scripts/ts-test-loader.mjs scripts/evaluate-cowork-conversations.ts --live --max-calls=380 --repeat=3 --output=eval.json
  ```

  Lee las respuestas del JSON, no solo el PASS/FAIL. Varias mejoras salieron de leer y no de las verificaciones.
