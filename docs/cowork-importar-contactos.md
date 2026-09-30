# Cowork · Importa a tus contactos las personas de un archivo (29 sep 2026)

Tercer PR de la Ola F del plan 2 de Cowork (punto F4, con la migración M3). Desde F1, Cowork lee los CSV y Excel que sube el usuario, pero las personas de esos archivos no podían quedar guardadas desde Cowork: el modelo mandaba al usuario a «Importar Leads». Esa página guarda en `enriched_leads`, así que lo importado ahí no lo ven ni la búsqueda de Cowork ni las campañas, que usan `leads`. Ahora **Cowork propone la importación con una tarjeta de aprobación** y, al aprobarla, guarda en `leads` a las personas nuevas del archivo.

Va detrás de `COWORK_CONTACTS_IMPORT_ENABLED`, apagado por defecto, y necesita la migración M3 aplicada (`cowork_contacts_import_proposals` y el tipo de efecto `contacts_import`).

## Qué cambia para el usuario

- **Pedidos como estos** llevan a la propuesta:
  - «importa a mis contactos a los de la lista de la feria»;
  - «guarda en mis contactos a los prospectos del excel que subí»;
  - «ármame una campaña para los de la feria que todavía no tengo guardados». Una campaña solo va a contactos guardados, así que primero se propone importarlos.

  Cowork lee el archivo (si no lo había leído) y propone la importación.
- **La tarjeta muestra exactamente lo que se va a guardar:**
  - cuántos contactos nuevos y de qué archivo (y hoja, en un Excel): «6 contactos nuevos de asistentes-feria-rrhh.csv»;
  - quiénes quedan fuera y por qué: «Quedan fuera: 2 ya estaban en tus contactos · 1 fila sin nombre»;
  - de qué columna sale cada dato, como chips: «Nombre ← Nombre», «Correo ← Mail», «Empresa ← Dónde trabaja»;
  - una tabla con los primeros 8 (nombre con su cargo, empresa y correo, o «Sin correo») y, si hay más, «y 492 contactos más»;
  - lo que conviene saber:
    - «2 contactos no traen correo: se guardan igual, y para escribirles hay que buscar su correo primero»;
    - «Se importan los primeros 500; quedan 20 para otra importación».
- **Arriba, como en toda aprobación:**
  - **Qué va a pasar:** se guardan en tus contactos las personas nuevas del archivo.
  - **Qué no pasa:** no se les escribe, no se buscan correos y no cambian los contactos que ya tenías.
- **Aprobar:**
  - el botón dice cuántos («Importar 6 contactos») y la tarjeta sigue la acción hasta el resultado;
  - la respuesta dice cuántos quedaron («Importé 6 contactos de asistentes-feria-rrhh.csv a tus contactos») y enlaza a «Ver tus contactos» (`/saved/leads`).

  **Descartar** pliega la tarjeta en una línea y no guarda nada.
- **Si algo cambió** entre la propuesta y la revisión, la tarjeta lo dice («La importación cambió desde la propuesta. Descártala y pide una nueva.») y no deja aprobar.
- **Siempre pide aprobación,** también en modo autónomo.
- **Si no se puede importar,** Cowork dice por qué y qué hacer. Por ejemplo:
  - el archivo no está entre las subidas;
  - es un PDF o un Word, que no traen una tabla;
  - es un `.xls` antiguo, o un Excel dañado, protegido o demasiado grande;
  - no tiene filas;
  - una columna que el modelo nombró no existe (se listan las del archivo);
  - no hay una columna con el nombre;
  - todos ya estaban guardados.
- **Con el flag apagado no cambia nada:**
  - el modelo no ve la acción;
  - si igual la intenta, se rechaza y se le pide explicar que se importa con «Importar Leads»;
  - el juez lee exactamente las mismas reglas que en `main`.

## Cómo funciona

| Pieza | Dónde |
|---|---|
| Reglas sin servidor:<br>- qué columna trae cada dato;<br>- cómo una fila pasa a contacto;<br>- cuándo dos contactos son la misma persona;<br>- la etiqueta de la propuesta;<br>- los textos de la tarjeta (`coworkImportSummary`, que usan la tarjeta y el corpus). | `src/lib/cowork/contacts-import.ts` |
| Preparar, vista previa y guardar | `src/lib/server/cowork/contacts-import.ts` |
| Leer el archivo completo:<br>- `coworkExcelTable` y `coworkFileTable`;<br>- `findCoworkUpload` y `downloadCoworkUpload`, que ahora comparte con `files.read`. | `file-binary.ts`, `file-read.ts` y `extended-reads.ts` |
| Decisión `contacts.import` → efecto `contacts_import` | `src/lib/cowork/agent-loop.ts` |
| Preparación al proponer (`contactsimport:<hash>`) | `src/lib/server/cowork/worker.ts` |
| Ejecución aprobada | `src/lib/server/cowork/effects.ts` |
| Tarjeta y vista previa | `ContactsImportReview.tsx` y `CoworkApproval.tsx`; `GET /api/cowork/runs/[id]/contactsimport-preview` |
| Instrucciones (solo con el flag) | `contactsImportCapability` en `agent-instructions.ts` y `decision-context.ts` |
| Juez, offline y en el turno | `coworkJudgeInstructions({ contactsImport, inTurn })` en `judge.ts`; `judge-run.ts` |
| Qué va a pasar y enlace al resultado | `presentation.ts` |

- **Columnas.** Si el modelo no dice cuál es cuál, se leen los encabezados, de lo más específico a lo más general:
  - **correo:** «Correo», «Email», «Mail»;
  - **LinkedIn:** «LinkedIn», «Perfil»;
  - **empresa:** «Empresa», «Compañía», «Company», «Cuenta», «Razón social»;
  - **cargo:** «Cargo», «Puesto», «Title», «Rol»;
  - **ubicación:** «Ciudad», «País», «Región», «Comuna»;
  - **apellido:** «Apellido»;
  - **nombre:** «Nombre», «Name», «Contacto», «Persona».

  Así, «Nombre de la empresa» es empresa y «Correo de contacto» es correo. Teléfono, RUT y DNI se ignoran: un contacto no guarda teléfono. El modelo puede indicar las columnas cuando los encabezados no lo dicen, y si nombra una que no existe se le responde con las del archivo.
- **Filas:**
  - el nombre es obligatorio (nombre y apellido se juntan);
  - del correo se toma la primera dirección válida (quita `mailto:` y separa por `;` o `,`); si no hay ninguna, el contacto se guarda sin correo;
  - LinkedIn solo vale si es una dirección de linkedin.com, y se completa con `https://`.
- **Duplicados:** se descartan los repetidos dentro del archivo y los que ya están en los contactos propios del usuario. Dos contactos son la misma persona si tienen el mismo correo, o el mismo nombre y la misma empresa, sin distinguir tildes ni mayúsculas. Los contactos guardados se leen en páginas de 1000 ordenadas por `id`, hasta 20 000.
- **Tope:** 500 contactos por importación; el resto se cuenta y queda para otra.
- **Preparación** (en el worker, al proponer):
  - el servidor lee el archivo completo desde Storage, no las 50 filas que ve el modelo;
  - guarda el resultado en `cowork_contacts_import_proposals` (una por trabajo);
  - la propuesta queda fijada por `contactsimport:<sha256>` sobre trabajo, archivo, hoja y contactos;
  - la tarjeta lee esa fila, y solo viajan a la página los 8 contactos que muestra.
- **Ejecución** (al aprobar):
  - comprueba el hash; si cambió, responde «La importación cambió desde tu revisión»;
  - vuelve a quitar a los que se hayan guardado entretanto;
  - inserta en `leads` en tandas de 100, con un `id` determinista por contacto y `ON CONFLICT DO NOTHING`, así que aprobar dos veces no guarda a nadie dos veces;
  - guarda `status: 'saved'` y `source_provider: 'cowork_import'`, y cargo y empresa como `''` cuando faltan (esas columnas no admiten nulos).
- **El flag también detiene lo ya aprobado:** si `COWORK_CONTACTS_IMPORT_ENABLED` se apaga, una importación aprobada responde que está desactivada y no guarda nada.
- **Nada del archivo se ejecuta:** es solo datos. Tampoco busca correos, no envía nada y no gasta créditos.
- **El juez sabe si la importación estaba encendida en ese turno:**
  - encendida, lee que Cowork importa las personas de un archivo con su tarjeta, y que mandar al usuario a hacerlo a mano es el error;
  - apagada, lee las reglas de siempre (idénticas byte a byte a las de `main`, offline y en el turno).
- **Evaluación:**
  - el corpus prepara la importación como el servidor, con los archivos y los contactos guardados del caso: el modelo recibe las mismas negativas, y el juez ve la tarjeta completa (quiénes entran, quiénes quedan fuera, las columnas y las notas), no solo el nombre del archivo;
  - `evaluate-cowork-conversations.ts --contacts-import` enciende la importación en todos los casos, como el flag.

## Cómo activarlo

1. Aplicar la migración M3 (`20260929010000_cowork_contacts_import.sql`, PR aparte) y verificarla con las consultas de su PR.
2. Poner `COWORK_CONTACTS_IMPORT_ENABLED=true` en el entorno y volver a desplegar.
3. **En la app:**
   1. En `/cowork`, subir un CSV con nombre, empresa y correo.
   2. Pedir «importa a mis contactos a los de este archivo».
   3. Revisar la tarjeta (cuántos, quiénes quedan fuera, columnas) y aprobar.
   4. En «Ver tus contactos» aparecen, y una búsqueda de Cowork ya los encuentra.

## Validación

**Pruebas sin modelo:** `npm run test:unit` da 1833 de 1833 (`main`: 1825), y `verify-cowork` da 413 de 413 más 38 guiones (`main`: 404 y 37).
- `contacts-import.test.ts` (5): columnas por encabezado, de lo más específico a lo más general (y teléfono, RUT o DNI fuera); columnas que pide el modelo y las que no existen; filas sin nombre, correos inválidos o varios en una celda, LinkedIn que no es de linkedin.com, repetidos en el archivo y ya guardados; el tope de 500; la etiqueta; y los textos de la tarjeta, palabra por palabra.
- `scripts/test-cowork-contacts-import.mjs` (nuevo, en `verify-cowork`), con Storage y la base simulados en memoria:
  - preparación con el archivo completo;
  - los guardados leídos en orden estable;
  - la vista previa fijada a la propuesta, con solo las filas que muestra la tarjeta;
  - la ejecución exacta y sin duplicar al aprobar dos veces;
  - el flag que detiene lo aprobado;
  - una preparación cambiada que se rechaza;
  - negativas con su motivo;
  - un Excel con su hoja y el tope.
- `agent-loop.test.ts` (+1): sin el flag no se propone nada; con él, se propone `contacts_import` sobre un archivo visto en el hilo, con su hoja y sus columnas, y si el modelo no lo había listado, el loop lista las subidas una vez.
- `decision-context.test.ts` (+1): la capacidad solo aparece con el flag, y dice qué queda fuera, que siempre espera aprobación, que la respuesta no lleva cifras y cuándo no proponerla.
- `presentation.test.ts` (aserciones en las pruebas que ya había): qué va a pasar, qué no, y el enlace a los contactos.
- `judge.test.ts` (+1): con el flag apagado, las reglas son idénticas a las de `main`; encendido, solo cambia la regla de importar. `test-cowork-judge.mjs` suma que el juez del turno lee el flag.
- **Corpus sin modelo:**
  - tres casos nuevos: `importar-feria` (CSV con dos personas ya guardadas), `importar-excel` y `importar-para-escribir` (una campaña para personas que aún no están guardadas);
  - una prueba de la preparación del corpus: la tarjeta que ve el juez y las negativas que recibe el modelo.

**Navegador:** Playwright contra el build de producción local, con un Supabase simulado solo en local (`fake-supabase-f4.mjs`). Tres trabajos esperan aprobación:
- la lista de la feria: 6 nuevos, 2 ya guardados y una fila sin nombre;
- un Excel grande: 500 de 520, con 100 sin correo;
- una preparación que ya no coincide con su propuesta.

Se probó en claro y oscuro a 1440 px, en claro a 390 px y con `reducedMotion: 'reduce'`. En las cuatro variantes:
- **La tarjeta de la feria:**
  - dice «6 contactos nuevos de asistentes-feria-rrhh.csv» y «Quedan fuera: 2 ya estaban en tus contactos · 1 fila sin nombre.»;
  - muestra las cuatro columnas como chips y las 6 filas, con su correo o «Sin correo» a la vista;
  - trae la nota de los 2 sin correo y, arriba, «Qué va a pasar» y «Qué no pasa».
- **El teclado:** desde «Descartar», Tab llega a «Importar 6 contactos» con el anillo de foco visible.
- **Aprobar y descartar:**
  - al aprobar, la tarjeta sigue la acción hasta «Aprobaste: Importar contactos», con la línea de tiempo completa y «Ver tus contactos» (`/saved/leads`);
  - al descartar, se pliega en una línea.
- **El Excel grande:** la hoja en el título, 8 filas y «y 492 contactos más», y las notas de los 100 sin correo y del tope («quedan 20 para otra importación»).
- **La preparación que cambió:** el aviso y «Importar 3 contactos» desactivado.
- **Movimiento reducido:** la tarjeta aparece sin animación.
- **En todos los casos:** sin errores de página ni scroll horizontal.
- **La primera pasada destapó un problema:** a 390 px la columna «Correo» quedaba fuera de la vista y había que desplazar la tabla hacia el lado para ver quién no tenía correo. Ahora, en el teléfono, empresa y correo van bajo el nombre, y la prueba comprueba que cada correo se ve.
- **`/cowork` pesa 240 kB de carga inicial** (`main`: 239 kB).

**Con el modelo real** (`gpt-6-luna`, con la Redactora y el juez del turno encendidos, como en producción; juez offline `gpt-6-sol`). Todo el mismo día, con este PR rebasado sobre `main` (`54b9985`, con F3).

| | Casos que pasan | Verificaciones | Juez: buenas / mejorables / malas | Fricción | Utilidad | Veracidad | Llamadas por caso | Mediana |
|---|---|---|---|---|---|---|---|---|
| Casos nuevos × 5, `main` (sin la acción) | 0 de 15 | 120 de 150 | — | — | — | — | 4,2 | 22,2 s |
| Casos nuevos × 5, este PR | **15 de 15** | 150 de 150 | **15 / 0 / 0** | 5,0 | 4,87 | 5,0 | 2,5 | 7,6 s |
| Casos de archivos × 3, `main` | 9 de 12 | 113 de 117 | 4 / 4 / 4 | 4,08 | 3,58 | 4,50 | 4,8 | 27,6 s |
| Casos de archivos × 3, este PR con el flag | 11 de 12 | 116 de 117 | 8 / 4 / 0 | 4,67 | 4,08 | 5,0 | 4,3 | 20,3 s |
| Casos de archivos × 3, este PR sin el flag | 11 de 12 | 116 de 117 | 4 / 5 / 3 | 3,83 | 3,33 | 4,83 | 4,5 | 25,0 s |

- **Casos de archivos:** `archivo-a-quien`, `adjunto-con-pedido`, `archivo-que-trae` y `archivo-excel` (a quién escribir, qué trae, un Excel).
  - Con el flag apagado, las instrucciones y el juez son idénticos a los de `main`: la diferencia es ruido (±0,4 de fricción con 15 a 25 respuestas).
  - Con el flag encendido, esos casos no empeoran.
- **`main` en los casos nuevos** no tiene la acción: manda al usuario a «Importar Leads» o le pide importarlos a mano. No se muestran sus notas de juez porque se juzgaron con reglas que no le corresponden.
- **Cómo se llegó a esto:** tres rondas antes de la final, y cada una dejó un arreglo.
  1. **Con la tarjeta real ante el juez.** La primera medición solo le mostraba el nombre del archivo; con la tarjeta que prepara el corpus, el juez encontró que en 3 de 15 respuestas el modelo decía «importaré las 8 personas» mientras la tarjeta mostraba 6 (2 ya estaban). Ahora la respuesta no pone cifras de personas: las da la tarjeta.
  2. **Preguntar no es pedir.** Con «¿a quién le escribo primero?» o «¿qué trae el archivo?», a veces proponía importar en vez de responder. Ahora responde y deja la importación como siguiente paso.
  3. **Las cifras de la tarjeta son del servidor.** El juez dudaba de ellas porque no veía la comparación con los contactos guardados; su regla ahora dice que las calcula el servidor.
- **Resultados y guiones:** en el scratchpad de la sesión (`eval/run-f4*.sh`, `f4-check.mjs`), no en el repositorio.

## Límites

- **Hasta 500 contactos por importación,** comparados con hasta 20 000 contactos guardados.
- **Sin teléfono:** los contactos de ANTON.IA no lo guardan.
- **La tarjeta muestra 8 filas** y cuenta el resto. El archivo es del propio usuario, que ya conoce su contenido; la tarjeta lo que agrega es cuántos entran y quiénes quedan fuera.
- **Una importación por trabajo:** para otra hoja u otro archivo, otro pedido.
- **Excel `.xls` antiguo:** no se lee (igual que en F1); se pide guardarlo como `.xlsx` o CSV.
