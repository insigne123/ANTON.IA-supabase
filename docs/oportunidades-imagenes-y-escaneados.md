# Oportunidades: la IA lee fotos, capturas y PDF escaneados

**Fecha:** 20 de octubre de 2026.

## Por qué

En el ZIP de la licitación 4620-4-LP26 venía «5-Captura_CM.png», una captura de la tienda de Convenio Marco. Hasta ahora quedaba fuera: la IA solo leía documentos con texto digital. Lo mismo pasaba con un PDF escaneado (una resolución firmada, un anexo impreso y vuelto a escanear) y con la foto de una invitación.

## Qué cambia

1. **Se pueden subir fotos y capturas** (.jpg, .png, .webp, .gif) en «Subir documentos», en «Cargar oportunidad» y dentro del ZIP de Mercado Público.
2. **La IA transcribe lo que no tiene texto.** Claude Haiku 5.5 lee la imagen o las páginas escaneadas (visión) y escribe su texto en el expediente:
   - el texto, tal como aparece y sin resumir;
   - las tablas, fila por fila;
   - lo que no es texto, entre corchetes: [Firma y timbre…], [Plano de la planta…];
   - lo dudoso, como […].

   Cada página queda como «Página N · leída por la IA», y el informe y el chat la citan como cualquier otro fragmento.
3. **En un PDF leído en parte, solo las páginas sin texto.** Si un PDF trae páginas escaneadas entre páginas con texto (un anexo firmado, por ejemplo), la IA lee solo esas páginas.
4. **El expediente muestra «La IA lo está leyendo…»** mientras trabaja y se actualiza solo. Una vez leído, el documento pasa a «Leído completo», o a «Leído en parte» si alguna página no se pudo leer.
5. **El informe espera la lectura**, hasta 10 minutos. Si pasa ese tiempo, sigue sin ese documento y lo avisa.
6. **«Cargar oportunidad» desde una foto o un escaneo.** La IA lee el archivo directamente y completa el formulario igual que con un PDF con texto.

## Límites

| Qué | Límite | Por qué |
|---|---|---|
| PDF escaneado | Hasta 25 páginas | Claude lee el PDF completo en cada llamada, y así cada llamada queda bajo el umbral de 100.000 tokens de Haiku. |
| Foto o captura | Hasta 3,7 MB | Claude acepta imágenes de hasta 5 MB en base64. |
| TIFF, BMP y HEIC | No se leen | Claude no los acepta. El aviso del ZIP pide guardarlos como JPG o PNG. |

Si un documento pasa el límite, queda como «Escaneado, sin leer». El informe sugiere subirlo como PDF con texto o en partes de hasta 25 páginas.

Costo aproximado con Haiku 5.5: un PDF escaneado de 20 páginas cuesta unos US$0,03, y una captura menos de US$0,005. Se carga a la categoría «research» del presupuesto del workspace.

## Cómo funciona

- **`src/lib/commercial-opportunities/document-scans.ts`** (sin dependencias del servidor):
  - qué páginas leer (`scanPages`) y en grupos de 8 (`scanGroups`);
  - la instrucción de transcripción (`scanPrompt`) y la forma de la respuesta (`scanAnswerSchema`);
  - cómo se guarda lo que vuelve (`scanSections`).
- **`src/lib/server/commercial-opportunities/workspace-documents.ts`:** al guardar un documento sin texto, `saveOpportunityDocument` encola un trabajo `evaluate` con `payload.scan` (clave `scan:<documento>`).
- **`src/lib/server/commercial-opportunities/workspace-scans.ts`:**
  - **`runDocumentScan`:**
    - descarga el archivo y llama a la IA por grupo de páginas;
    - guarda el texto después de los fragmentos que el documento ya tenía y actualiza su estado;
    - si se acaba el tiempo del tick, retoma en el siguiente; los grupos ya pagados vuelven de su resultado guardado.
  - **`activeDocumentScans`:** permite que el informe (`workspace-research.ts`) espere las lecturas en curso antes de fijar su inventario de documentos.
- **`src/ai/anthropic-json.ts`:** `claudeContent` envía las imágenes (`image`) y los PDF (`document`) antes de la instrucción. El último lleva `cache_control`, para que una corrección del JSON no pague el archivo dos veces.
- **`src/lib/server/commercial-opportunities/workspace-ai.ts`:**
  - `opportunityGenerate` reserva las páginas al precio de escritura en caché;
  - rechaza adjuntos con un modelo que no sea Claude.
- **«Cargar oportunidad»** (`workspace/prefill/route.ts`): el archivo va con la llamada solo en la memoria de esa solicitud y nunca se guarda en el trabajo.
- **Base de datos** (`supabase/migrations/20261020150000_opportunity_documents_images.sql`): el bucket privado `opportunity-documents` acepta `image/png`, `image/jpeg`, `image/webp` e `image/gif`. Se aplicó en producción el 20 de octubre de 2026 y el bucket sigue privado.

## Pruebas

- `src/lib/commercial-opportunities/document-scans.test.ts`: páginas que se leen y límites, grupos, respuesta incompleta e instrucción.
- `src/lib/server/commercial-opportunities/workspace-scans.test.ts`:
  - un PDF de 10 páginas en dos grupos;
  - un trabajo que retoma;
  - una captura;
  - un documento ya leído o borrado;
  - la espera del informe.
- `src/lib/server/commercial-opportunities/workspace-report-generation.test.ts`: reserva con adjuntos, umbral de Haiku y modelo sin visión.
- `src/ai/anthropic-json.test.ts`: forma de los bloques `image` y `document`, y la caché.
- `src/lib/commercial-opportunities/zip-uploads.test.ts`: las fotos del ZIP suben; un .tif queda fuera y el aviso lo explica.
- **Con archivos reales:** «5-Captura_CM.png» del ZIP de 4620-4-LP26 y un PDF escaneado de 2 páginas se detectan como «scan» y se encolan.

## Prueba real en producción (20 de octubre de 2026)

Se hizo con la cuenta QA y archivos de prueba:

- **«Cargar oportunidad» desde una foto de unas bases (7 s):**
  - completó el nombre, el cierre (14-11-2026 15:00), el monto (48.600.000) y la descripción;
  - dejó vacío el cliente, que la foto no nombra.
- **Lectura del expediente (30 s en total):**

  | Archivo | Resultado |
  |---|---|
  | La foto | Texto completo. |
  | PDF escaneado de 2 páginas | Texto exacto, con plazos, montos, porcentajes y la tabla de turnos fila por fila. |
  | «5-Captura_CM.png» (la captura de Convenio Marco) | Una línea que dice qué muestra y la lista de convenios con sus ID. |

  Los tres quedaron «Leído completo».
- **Costo:** US$0,0035 por las cuatro llamadas (Haiku 5.5).
- **Corrección:** en la página 1 del PDF, una línea de firma vacía se escribió como «[Firma]». La instrucción ahora pide copiar vacío lo que está vacío y escribir [Firma] o [Timbre] solo cuando se ven, porque que un documento esté firmado es un dato que importa.
