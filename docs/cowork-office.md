# Cowork · Lee Excel, PDF y Word sin ejecutar código (29 sep 2026)

Primer PR de la Ola F del plan 2 de Cowork (puntos F1 y F2). Hasta hoy, Cowork leía los CSV, JSON, Markdown y texto que el usuario subía; un Excel había que analizarlo con código (con aprobación) o exportarlo a CSV. Ahora `files.read` abre también **Excel (.xlsx)**, **PDF con texto** y **Word (.docx)**, sin ejecutar nada: lo que sale tiene la misma forma que un CSV o un texto, recortado a lo que el modelo lee en una decisión.

## Qué cambia para el usuario

- **Adjunta un Excel, un PDF o un Word** con el clip (o arrastrándolo al cuadro) y Cowork lo lee, igual que un CSV: «Cowork lee CSV, Excel, PDF, Word, JSON, MD y TXT de hasta 20 MB».
- **Un Excel** se lee como tabla:
  - la primera hoja con datos (o la que el usuario nombra), con sus columnas y hasta 50 filas, y cuántas filas tienen cada columna llena («6 de 8 tienen correo»), contadas sobre las filas leídas del archivo;
  - si sobre las columnas hay un título o una nota («Resumen de septiembre»), se muestra aparte y no se toma por encabezado;
  - Cowork ve el nombre y las filas de cada hoja, y pide otra con `archivo.xlsx#Hoja` cuando el usuario la nombra;
  - las fechas salen como año-mes-día (con la hora solo si la celda la muestra), sea cual sea el formato o el idioma del archivo, para que `03/04/2026` no se lea como marzo o como abril;
  - las fórmulas dan el valor que el archivo guardó (nunca se ejecutan), y una celda con error de fórmula muestra su texto (`#DIV/0!`) en vez de quedar vacía.
- **Un PDF o un Word** se leen como texto (hasta 12 000 caracteres):
  - del PDF se sabe cuántas páginas se leyeron de cuántas tiene;
  - en un Word, los títulos y los párrafos quedan como párrafos, cada elemento de una lista (también los anidados) en su línea, y cada fila de una tabla en una línea, con las celdas separadas por « | » (`Piloto | 30 días | $450.000`).
- **Lo que no se abre, lo dice y da el camino:**
  - un `.xls` antiguo: al adjuntarlo, la subida ya lo rechaza (solo acepta `.xlsx`); si estuviera subido de antes, Cowork dice «guárdalo como .xlsx (o exporta la hoja a CSV) y súbelo de nuevo»;
  - un PDF que es solo imagen (un escaneo): «pide el contenido pegado en el chat, o un PDF con texto»;
  - un archivo dañado o protegido con clave: «pide subirlo de nuevo, o el contenido en CSV o texto»;
  - un archivo que al abrirse ocupa demasiado (un Excel de más de un millón de celdas, un Word de mil páginas o un ZIP que se expande sin medida): «pide subir solo la hoja o las páginas que importan, o su contenido en CSV o texto».
- **No cambia:** el análisis pesado (cruces y cálculos sobre miles de filas) sigue siendo `code.execute`, con su tarjeta de aprobación.

## Cómo funciona

| Pieza | Dónde |
|---|---|
| Excel, PDF y Word como tabla o texto, y por qué un archivo no se abre | `coworkBinaryPreview` en `src/lib/server/cowork/file-binary.ts` |
| Revisión previa de los ZIP (Excel y Word) | `coworkZipGuard` en `src/lib/cowork/zip-guard.ts` |
| Formas de lo leído (`sheet`, `sheets`, `above`, `capped`, `pages`), tipos de archivo y dónde empieza el encabezado | `file-read.ts` (`coworkFileKind`, `coworkTablePreview`, `coworkTextPreview`, `coworkHeaderRow`) |
| `files.read` con hoja | `readCoworkFileContent` en `extended-reads.ts` y `read-capabilities.ts` |
| Extensiones subidas | `ALLOWED_EXTENSIONS` en `upload-files.ts` y el clip en `CoworkAttachments.tsx` |
| Instrucciones | `files.read` en `agent-instructions.ts` y las reglas del producto del juez (`judge.ts`) |

- **Nada se ejecuta:** un Excel se lee con `xlsx` sin fórmulas ni estilos; un PDF, con `unpdf` (pdf.js solo extrae el texto: no ejecuta el JavaScript del PDF ni evalúa código); un Word, con `mammoth` (su texto, sin imágenes ni macros; las imágenes ni siquiera se leen). El contenido es dato, nunca instrucciones: `files.read` lo marca como tal, igual que con un CSV.
- **Encabezado de un Excel:** una hoja suele empezar con un título. Se saltan hasta tres filas de arriba si tienen una o dos celdas llenas y la tabla es más ancha (al menos tres columnas y el doble de celdas); si no está claro, la primera fila es el encabezado, como en un CSV.
- **Revisión de los ZIP** (`.xlsx` y `.docx` son ZIP): antes de abrirlos se lee su directorio central, sin desempacar, y se rechaza el que declara más de 150 MB al abrirse, más de 200 veces su tamaño, más de 2 000 partes o formato ZIP64. Es una primera barrera contra un «zip bomb»: lee lo que el archivo declara, así que frena accidentes y ataques burdos, no a un archivo que mienta; los límites de subida (20 MB) y los de lectura hacen el resto. También informa cuánto de lo que se expande es XML, que es lo que pesa en memoria.
- **Límites de lectura,** medidos porque la app corre con 768 MB para todas las solicitudes a la vez:
  - **Excel:** hasta 30 MB de XML al abrirse (unas 850 000 celdas; más se rechaza como «demasiado grande») y hasta 20 000 filas contadas por hoja, con 300 000 celdas como tope: una hoja ancha cuenta menos filas (3 000 con 100 columnas) y, si trae más, se marca `capped`: el total es un mínimo. Un Excel gasta entre cinco y diez veces su XML en memoria. Hasta 12 hojas listadas;
  - **PDF:** hasta 40 páginas y 12 s, y se detiene cuando ya hay texto de sobra;
  - **Word:** hasta 6 MB de XML (más de mil páginas de texto): se lee entero y gasta entre 15 y 30 veces su tamaño en memoria;
  - **`.xls`:** no se descarga para decirlo.
- **Dependencias:**
  - `xlsx` pasa de 0.18.5 a **0.20.3** desde `cdn.sheetjs.com` (la versión 0.18.5 tiene CVE-2023-30533 y CVE-2024-22363, y la corregida solo se publica ahí). El lock guarda el tarball con su `integrity`. Si el build de App Hosting no alcanza esa URL, la alternativa es `exceljs` para leer;
  - `unpdf` 1.8 y `mammoth` 1.13, cargados en el servidor (`serverExternalPackages` en `next.config.js`) y solo al abrir un archivo de ese tipo;
  - `jszip` (solo desarrollo), para fabricar Word en las pruebas.
- **Sin migraciones ni flags:** el comportamiento nuevo no cambia lo que ya leía.

## Validación

**Pruebas sin modelo** (`npm run test:unit`: 1805 de 1805; la rama base tenía 1785):
- `zip-guard.test.ts` (5): un Excel y un Word reales pasan; cuánto de lo que se expande es XML; lo que no es ZIP o está cortado; expansión desmedida, demasiadas partes y ZIP64.
- `file-binary.test.ts` (12):
  - Excel: la primera hoja con datos, sus columnas, sus filas sin vacías y cuántas tienen cada columna llena, y la lista de hojas; otra hoja por su nombre, en cualquier caso o por su inicio; hojas largas recortadas al límite de un CSV y fórmulas con su valor; fechas de cualquier formato como año-mes-día; un error de fórmula visible; un título sobre el encabezado; una hoja con más filas de las que se cuentan (`capped`) y una ancha con menos filas;
  - lo que no se abre: un archivo roto, un `.xls`, un ZIP que se expande sin medida y uno con más XML del que se lee;
  - PDF: su texto y las páginas leídas de las que tiene, un escaneo, uno dañado y uno largo;
  - Word: su texto, una tabla por filas con el texto que trae tal como estaba escrito, y un archivo dañado o «bomba».
- `file-read.test.ts` (+2): dónde empieza el encabezado y el texto de una fila.
- `extended-reads.test.ts`: Excel, PDF y Word por `files.read`, con `archivo.xlsx#Hoja` y sus mensajes.
- Corpus sin modelo (`cowork-conversation-corpus.test.ts`): `archivo-excel` reescrito (lee el Excel, nombra a las personas, no dice que no puede leerlo, no propone código) y `archivo-pdf` nuevo.
- `typecheck`, `verify-cowork`, `lint` y `build`: verdes.

**Con archivos que esta rama no fabrica.** Las pruebas de arriba abren archivos hechos con las mismas librerías que los leen; por eso se repitieron con archivos escritos por otros programas:
- LibreOffice 24.2: un Excel de dos hojas con fechas `dd/mm/yyyy`, porcentajes, montos y fórmulas, y un Word y un PDF de una misma propuesta, con lista y tabla;
- Chromium: un PDF con texto y otro de solo imagen;
- un Excel y un Word armados como los escribe Office: cadenas compartidas, estilos con formatos propios, celdas combinadas, fórmulas con valor guardado, booleanos y errores; tabla, lista, vínculo, tabulación y salto de línea.

Lo que salió:
- **Se corrigió aquí** (cada punto tiene su prueba):
  - las fechas con formato propio salían como `03/04/2026`, ambiguas y distintas de las demás de la columna: ahora, año-mes-día;
  - una celda con error de fórmula salía vacía: ahora dice `#DIV/0!`;
  - una hoja con un título sobre las columnas lo tomaba por encabezado, y las columnas reales quedaban como la primera fila: ahora el título va aparte;
  - las tablas de un Word salían con cada celda en su párrafo, sin filas: ahora, una fila por línea;
  - las listas anidadas de un Word salían pegadas («Segundo• Anidado uno»), lo que se vio al leer de vuelta un Word con listas hecho por la rama siguiente: ahora, un elemento por línea.
- **Ya funcionaba:**
  - los PDF de LibreOffice y de Chromium, con viñetas y filas de tabla;
  - un PDF de solo imagen se declara escaneo, y uno con clave se declara dañado o protegido;
  - un Word con una imagen de 5,4 MB se lee en 52 ms, sin traer la imagen;
  - un PDF de 48 páginas lee 6 y lo dice; un Word de 224 000 caracteres queda en 12 000.
- **Dentro del servidor de producción de Next:** todo eso se abrió también en un build local (con una ruta temporal, ya borrada), con los mismos resultados.

**Peso y velocidad** (Node 22, con esos archivos; el servidor de Next parte en unos 320 MB):
- Excel de 30 000 filas × 6 columnas (14 MB de XML): 2,1 s y +104 MB dentro del servidor;
- Excel de 20 000 × 100 (123 MB de XML): se rechaza en milisegundos como «demasiado grande». Sin ese límite, en una prueba aparte leerlo tardaba 14 s y llegaba a +1,0 GB, más que los 768 MB de la app;
- Word: con 10 MB de XML, 2 s y unos 130 MB; con 20 MB, 4 s y hasta 600 MB (de ahí el tope de 6 MB);
- PDF de 48 páginas: 0,1 s; Word de 300 KB de XML: 0,09 s.

**Con el modelo real** (`gpt-6-luna` para Cowork, juez `gpt-6-sol`; `evaluate-cowork-conversations.ts --live --writer`; la rama base y esta, el mismo día):
- **Excel y PDF** (`archivo-excel` y `archivo-pdf`, 3 corridas cada uno, dos veces: 12 respuestas):
  - todas las verificaciones pasan (132 de 132): lee el archivo por su nombre, nombra a las personas o lo que trae, no dice que no puede leerlo y no inventa;
  - juez: 9 buenas, 2 mejorables y 1 mala; veracidad media, 4,9;
  - Excel: 5 buenas y 1 mala (ofrecía importar los prospectos, algo que Cowork aún no hace: es F4); PDF: 4 buenas y 2 mejorables (un resumen sin uno de los mensajes del brief).
- **Sin efecto en los casos de CSV que ya había** (`archivo-que-trae`, `archivo-a-quien`, `archivo-no-esta`, `adjunto-solo` y `adjunto-con-pedido`, contra la rama base), en la tabla siguiente.

| | Respuestas | Buenas / mejorables / malas | Fricción | Veracidad |
|---|---|---|---|---|
| Base, 3 corridas | 15 | 4 / 7 / 4 | 3,87 | 4,67 |
| Base, 5 corridas | 25 | 14 / 5 / 6 | 4,00 | 4,92 |
| Esta rama, primeras instrucciones, 3 corridas | 15 | 5 / 6 / 4 | 3,80 | 4,80 |
| Esta rama, instrucciones finales, 3 corridas | 15 | 4 / 4 / 7 | 3,27 | 4,07 |
| Esta rama, instrucciones finales, 5 corridas | 25 | 14 / 6 / 5 | 4,04 | 4,92 |

- Las dos últimas filas son el mismo código y las mismas instrucciones, una corrida tras otra: 3,27 y 4,04 de fricción. Ese es el ruido del modelo y del juez con 15 a 25 respuestas; no hay diferencia con la base que se pueda atribuir a este PR.
- Lo que sigue apareciendo, en la base y aquí por igual, es lo que ataca la jueza del turno: dejar para después una consulta gratuita.
- **Latencia:** sin diferencia que atribuir (mediana de 13,7 s en la base y de 15,8 s aquí en las corridas de 25; las dos corrieron a la vez, con otras tareas en la máquina).

**Navegador:** el único cambio visible es el texto del clip («Cowork lee CSV, Excel, PDF, Word, JSON, MD y TXT de hasta 20 MB.») y su lista de extensiones. El texto es más corto que el anterior, así que la caja no cambia; no se hizo revisión en navegador.

**Peso de la carga inicial:** `/cowork` queda en 239 KB; la rama base, construida con las mismas dependencias, en 240 KB. La cifra de 250 KB de los PR anteriores se midió con otra instalación de dependencias (sin el binario nativo de SWC).

**Lo que no cubre:**
- **Un archivo hecho para dañar.** La revisión del ZIP lee lo que el archivo declara, y `pdf.js` no se puede cortar a mitad de una página: un PDF armado a propósito puede gastar CPU. Los límites de memoria son para un archivo a la vez, con la app compartida. Hoy el piloto es de un solo usuario; antes de abrir Cowork a más gente convendría leer los archivos en un proceso aparte, con límite de memoria y de tiempo.
- **Otros formatos:** un Excel con macros (`.xlsm`), uno binario (`.xlsb`) o antiguo (`.xls`) y un Word antiguo (`.doc`) no se aceptan al adjuntar.
- **`xlsx` desde `cdn.sheetjs.com`:** si el `npm ci` de la CI o el build de App Hosting no alcanza esa URL, la alternativa es `exceljs` para leer.
