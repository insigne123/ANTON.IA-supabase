# Oportunidades: qué documentos se leen y qué dice el ZIP de lo que deja fuera

**Fecha:** 20 de octubre de 2026.

## Por qué

GrupoExpro subió el ZIP de «Descargar todos» de la licitación 4620-4-LP26 (guardias, DRT Valparaíso):
- **Lo que pasó:** entraron 9 documentos y la pantalla dijo «1 archivo no es PDF, Word, Excel ni texto», sin decir cuál.
- **El archivo:** era «5-Captura_CM.png», una captura de la tienda de Convenio Marco que el comprador adjunta para mostrar que no hay convenio para el servicio.
- **El problema:** no se perdió información de las bases, pero la persona no podía saber qué faltaba ni si importaba.

## Qué cambia

1. **El aviso nombra lo que quedó fuera y dice por qué:**
   - **Imágenes** (.jpg, .png…): «la IA lee texto, ábrela en Mercado Público».
   - **Otros comprimidos** (RAR, 7z): «descomprímelo y sube lo que trae».
   - **Formatos que no se leen:** por ejemplo, planos .dwg.
   - **Tamaño:** archivos de más de 20 MB.
   - **Límite:** lo que pasa del máximo de 40 archivos por ZIP.

   Muestra hasta tres nombres y cuántos más hay.

   Con el ZIP real: «Del ZIP tomamos 9 documentos. «5-Captura_CM.png» es una imagen: la IA lee texto, ábrela en Mercado Público.»
2. **Un ZIP dentro del ZIP se abre** (un nivel), por ejemplo cuando el comprador agrupa sus anexos.
3. **Más formatos se leen.** El almacenamiento guarda PDF, Word, Excel y texto. Los demás formatos se guardan como el texto que contienen, en un .txt que dice qué eran («Anexo N°4 (texto del Excel).txt»), igual que ya pasaba con Word y Excel 97-2003:

   | Formato | Extensiones |
   |---|---|
   | Word con macros o plantilla | .docm, .dotx |
   | Excel con macros, plantilla o binario | .xlsm, .xltx, .xlsb |
   | LibreOffice | .odt, .ods, .odp |
   | PowerPoint | .pptx (texto de cada diapositiva) |
   | Texto enriquecido | .rtf |
   | Páginas web | .htm (además de .html) |

   Sirve para el ZIP, para «Subir documentos» del expediente y para «Cargar oportunidad» desde un documento.

## Cómo funciona

- **`src/lib/commercial-opportunities/zip-uploads.ts`** (navegador): abre el ZIP y el que venga dentro, y arma el aviso con `leftOut`.
- **`src/lib/server/commercial-opportunities/document-files.ts`** (`opportunityLegacyAsText`):
  - revisa cada formato con base ZIP con `coworkZipGuard` (contra archivos que se inflan) antes de abrirlo;
  - lee las planillas con SheetJS, los Word con mammoth y LibreOffice y PowerPoint con JSZip;
  - lee RTF con un lector propio (`rtfText`), sin tablas de fuentes, imágenes ni grupos ocultos.

## Límites

Las imágenes y los PDF escaneados siguen sin leerse: no tienen texto. Leerlos con la IA (visión) es el paso siguiente posible.

## Pruebas

- **`src/lib/commercial-opportunities/zip-uploads.test.ts`:** aviso con nombres, ZIP dentro de ZIP, imágenes y RAR.
- **`src/lib/server/commercial-opportunities/document-files.test.ts`:** .xlsm, .ods, .odt, .pptx, .rtf y .docm reales, y un .pptx roto.
- **ZIP real de la licitación 4620-4-LP26:** 9 documentos y el aviso que nombra «5-Captura_CM.png».
