# Cowork · leer archivos subidos (27 sep 2026)

Primer PR de la Ola C del plan de Cowork (punto 3.2: leer archivos sin ejecutar código).

## Qué cambia

Hasta ahora Cowork solo veía el nombre y el tamaño de los archivos subidos. Su contenido solo podía usarse ejecutando código, con aprobación, y al medir este PR apareció que desde la interfaz eso tampoco funcionaba (ver Límites).

- **Nueva consulta `files.read`:** con el nombre de un archivo que el usuario subió, devuelve su contenido acotado:
  - CSV y listas JSON: columnas y hasta 50 filas, con el total de filas, si se recortó y cuántas filas traen dato en cada columna (así Cowork dice «6 de 8 tienen correo» sin contar a mano);
  - Markdown y texto: hasta 12 000 caracteres;
  - cada lectura queda bajo 15 000 caracteres, para que quepa en una decisión.
- **Busca entre las subidas del usuario, por nombre o por una palabra del nombre** («la lista de la feria» encuentra `asistentes-feria-rrhh.csv`):
  - si el nombre se repite, toma la subida más reciente;
  - si varias subidas coinciden, pregunta cuál;
  - si no hay ninguna, dice qué archivos hay y pide subirlo con el clip «Adjuntar archivos».
- **CSV como vienen en la práctica:**
  - detecta el separador («,» o «;»);
  - quita filas vacías y nombra las columnas sin encabezado;
  - lee con sus tildes las exportaciones de Excel en Windows-1252.
- **Excel, todavía no:** la versión instalada de `xlsx` (0.18.5) tiene una vulnerabilidad conocida al *leer* archivos manipulados (CVE-2023-30533, corregida en 0.19.3). Cowork pide exportar la hoja a CSV y subirla. Leer Excel directo requiere actualizar esa dependencia.
  - **Actualización (29 sep):** `xlsx` pasó a 0.20.3 y Cowork ya lee Excel, PDF y Word sin ejecutar código; ver `docs/cowork-office.md`.
  - Tampoco ofrece analizarlo con código: hoy el ejecutor solo toma archivos subidos en el mismo turno, y la subida siempre queda en el turno anterior (ver Límites).
- **Seguridad:**
  - solo lee archivos bajo el prefijo del propio usuario, con el nombre tal como aparece en sus subidas;
  - no ejecuta nada;
  - el contenido va marcado como datos, nunca instrucciones, y las reglas lo repiten.
- **Reglas:** Cowork lee el archivo cuando el usuario habla de «el archivo» o «la lista que subí» o nombra uno. En la misma respuesta:
  - dice qué trae y, si son personas, muestra hasta 10 en una tabla (empresa, si tienen correo y si ya están guardadas);
  - lo cruza con los contactos guardados;
  - para «¿a quién le escribo primero?», entrega el orden completo en una tabla con el motivo de cada uno (guardada, ya contactada o por importar), no solo a la primera;
  - recuerda que los nuevos se importan antes de una campaña.
- **Interfaz:** la actividad dice «Leyó un archivo que subiste», y el texto de «Adjuntar archivos» ya no dice que solo sirven para ejecutar código.
- **Juez (#14):** su rúbrica suma que Cowork lee CSV, JSON, Markdown y texto, que un Excel se pide en CSV y que ejecutar código también pasa por una tarjeta de aprobación.
- **Sin migraciones ni dependencias nuevas:** usa `papaparse`, que ya estaba instalado.

## Cómo se usa

1. En un hilo con al menos un turno, toca el clip «Adjuntar archivos» del cuadro de texto y sube un CSV.
2. Escribe, por ejemplo, «te subí la lista de asistentes de la feria, ¿a quién le escribo primero?».

## Límites

- **Antes del primer mensaje** de un hilo todavía no se puede subir nada: el botón aparece después del primer turno (punto 3.1, pendiente).
- **Alcance de la búsqueda:** revisa hasta 100 carpetas de subidas con 50 archivos cada una.
- **Sin reintento:** si la lectura se corta a mitad, no se reintenta. La bitácora de operaciones solo reintenta las consultas de su lista, y sumarla ahí sería una migración.
- **Importar contactos:** pasar las personas del archivo a ANTON.IA sigue siendo manual (Importar Leads). Hacerlo desde Cowork requiere un efecto nuevo, es decir, una migración (punto 3.3). *Actualización:* F4 lo hace con una tarjeta de aprobación, detrás de `COWORK_CONTACTS_IMPORT_ENABLED` y con la migración M3 aplicada; ver `cowork-importar-contactos.md`.
- **Código con archivos subidos (falla previa a este PR):** el ejecutor solo acepta archivos del prefijo del turno que propone el código (`stageCoworkCode`).
  - Cada mensaje crea un turno nuevo (`cowork_admit_followup`), y «Adjuntar archivos» sube al turno anterior, ya terminado.
  - Resultado: desde la interfaz, una propuesta de código con archivos nunca los encuentra.
  - Lo corrige el PR siguiente (C2), que además vuelve a ofrecer el análisis con código para Excel.

## Mediciones

El mismo día, con el corpus y el modelo real (gpt-6-luna, 3 repeticiones), contra #15 medido dos veces ese día. El juez es gpt-6-sol con la rúbrica de este PR.

**Casos de antes (34 casos, 102 respuestas):**

| | Base #15 (dos corridas) | Este PR |
|---|---|---|
| Casos que pasan las verificaciones | 99 y 97 | 96 |
| Llamadas al modelo por caso | 2,14 y 2,07 | 2,19 |
| Consultas por caso | 1,67 y 1,60 | 1,78 |
| Segundos por caso (promedio · p90) | 8,1 · 11,6 y 9,1 · 13,0 | 8,2 · 13,0 |
| Juez: buenas · mejorables · malas | 40 · 38 · 24 y 46 · 27 · 29 | 50 · 26 · 26 |

- **Ningún caso de antes lee archivos:** la regla nueva no se cuela en otros pedidos.
- **Fallas:**
  - `editar-usar` (2 de 3) y `linkedin-seguimiento` (1 de 3): también fallan en la base;
  - `recomendacion-hoy`, `editar-luego-crear` y `mkt-que-puedes-hacer` (1 de 3 cada uno), sin relación con archivos: repite una lectura del turno anterior, no toma el texto del usuario por afirmaciones sin respaldo y omite LinkedIn.
  - Dos corridas anteriores de este PR, con una versión previa de la regla de archivos, pasaron 99 y 98.

**Casos de archivos (4 casos nuevos, 12 respuestas):**

- **Verificaciones:** pasan 12 de 12, con 2,17 llamadas, 2,25 consultas y 8,8 s por caso.
- **Juez:** 6 buenas, 4 mejorables y 2 malas.
  - Las 2 malas son de «¿qué trae?»: cierra preguntando si ordena una lista que ya mostró.
  - En Excel, el juez preferiría que ofreciera analizarlo con código; hoy no funciona (ver Límites).
- **Lo que corrigieron las mediciones,** con 3 de 3 en la corrida final:
  - **Conteos:** antes Cowork contaba a mano los correos de la tabla y a veces se equivocaba. Ahora lee cuántas filas traen dato en cada columna.
  - **«¿A quién le escribo primero?»:** antes 2 de 3 respuestas solo proponían a Camila. Ahora entrega el orden completo en una tabla y consulta a quién ya se le escribió.
  - **Archivo que no está:** antes solo ofrecía leer otro. Ahora pide subirlo con el clip.
  - **Excel:** una propuesta de código hecha después de `files.read` se rechazaba en cada intento y el turno fallaba. Eso destapó la falla del ejecutor descrita en Límites, así que Excel queda en CSV.

## Pendientes

- **Código con archivos de turnos anteriores** (C2, PR siguiente): arregla el ejecutor y vuelve a ofrecer el análisis con código para Excel.
- **Subir en cualquier momento** (punto 3.1), también antes del primer mensaje del hilo.
- ~~**Excel**, después de actualizar `xlsx` a 0.19.3 o más, o con otra librería.~~ Hecho: `docs/cowork-office.md`.
- ~~**PDF y DOCX:** requieren una dependencia nueva para extraer el texto.~~ Hecho: `docs/cowork-office.md`.
- **Importar contactos desde el archivo** (punto 3.3, con migración).
