# Cowork · código con archivos de turnos anteriores (27 sep 2026)

Segundo PR de la Ola C del plan de Cowork. Completa la lectura de archivos (C1): el análisis con código encuentra los archivos que subió el usuario.

## El problema, previo a este PR

- «Adjuntar archivos» sube al turno que está en pantalla, que ya terminó (`FileUpload` recibe `latest.run.id`).
- Cada mensaje nuevo crea otro turno (`cowork_admit_followup`), con su propio prefijo en el bucket.
- `stageCoworkCode` exigía los archivos en el prefijo del turno que propone el código, y `executeCoworkCode` los descarga de ahí.
- Resultado: desde la interfaz, una propuesta de código con archivos siempre fallaba con «El archivo X no está subido en este trabajo».

## Qué cambia

- **Al preparar la propuesta, antes de la aprobación:** si un archivo no está en el turno actual, se copia desde la subida más reciente del usuario con ese nombre.
  - La ejecución sigue leyendo solo el prefijo del turno, como antes.
  - Lo que se aprueba y se ejecuta es esa copia: si el usuario sube otra versión después, lo revisado no cambia.
  - Si el archivo no está entre sus subidas, la propuesta falla como antes, ahora con «no está entre tus archivos subidos».
- **Origen de la propuesta:** un archivo que `files.read` encontró cuenta como observado, igual que uno de `files.list`.
  - Antes, una propuesta hecha después de `files.read` se rechazaba en cada intento y el turno terminaba con error. Pasó en una de las corridas de C1.
- **Excel:** Cowork vuelve a proponer el análisis con código, con su tarjeta de aprobación, y menciona que también puede exportarse a CSV.
  - Se alinean el texto de «Adjuntar archivos», la rúbrica del juez y el corpus.
- **Una sola lista de subidas** (`src/lib/server/cowork/uploads.ts`), para `files.read` y para el ejecutor.
- **Sin migraciones ni dependencias nuevas.** La copia usa `storage.copy` de `@supabase/supabase-js`, que ya estaba instalado.

## Seguridad

- La copia solo lee del prefijo propio del usuario (`organización/usuario/…`), con nombres validados por el esquema de la propuesta: sin rutas ni archivos ocultos.
- No ejecuta nada. La ejecución sigue esperando la aprobación humana y queda fijada por hash.
- **Alcance, a decidir por el mantenedor:** toma cualquier subida propia del usuario, también de otros hilos.
  - `files.list` ya las mostraba todas.
  - Limitarlo al hilo exige recorrer la cadena `parent_run_id` en la base.

## Cómo se verifica

- `node scripts/test-cowork-code-execution.mjs`:
  - copia desde la subida más reciente de un turno anterior;
  - rechaza un archivo que no existe;
  - no copia lo que ya está en el turno.
- `src/lib/cowork/agent-loop.test.ts`: un archivo que `files.read` encontró cuenta como observado, en este turno o en uno anterior; uno que no encontró no cuenta.
- **En la app,** con `COWORK_EXECUTOR_URL` y `COWORK_EXECUTOR_SECRET` configurados:
  1. sube un `.xlsx` con el clip;
  2. escribe «revisa el excel que subí»;
  3. aprueba la tarjeta de código.

## Mediciones

El mismo día, con el corpus y el modelo real (gpt-6-luna, 3 repeticiones), contra C1 (#16). El juez es gpt-6-sol con la rúbrica de cada PR.

| | C1 (#16) | Este PR |
|---|---|---|
| Casos de antes que pasan las verificaciones (de 102) | 96 | 100 |
| Casos de archivos que pasan (de 12) | 12 | 12 |
| Llamadas al modelo por caso | 2,18 | 2,18 |
| Segundos por caso, casos de antes (promedio · p90) | 8,2 · 13,0 | 9,6 · 15,0 |
| Juez, casos de antes: buenas · mejorables · malas | 50 · 26 · 26 | 48 · 29 · 25 |
| Juez, casos de archivos | 6 · 4 · 2 | 6 · 5 · 1 |

- **Excel:** en las 3 respuestas Cowork propone analizar `prospectos.xlsx` con código, con el archivo como entrada, y el juez las califica buenas. En C1, que pedía CSV, fueron 1 buena y 2 mejorables.
- **Tarjeta de código:** si el modelo no escribe la explicación, el bucle pone una propia con el archivo («Propongo analizar prospectos.xlsx con código…»). En una corrida previa, 2 de 3 tarjetas llegaron con el texto genérico «Revisa la propuesta antes de ejecutar el cambio».
- **Latencia:** cada llamada al modelo tardó 17 % más (4,5 contra 3,8 s), con las mismas llamadas por caso. Fue más lento en 25 de los 34 casos de antes, que este PR no toca, así que lo atribuyo a la API durante esa corrida. La base #15 midió 8,1 y 9,1 s el mismo día.
- **Fallas:** `editar-usar` y `reintento-enriquecer`, 1 de 3 cada una, sin relación con archivos. `editar-usar` también falla en la base.

## Límites

- Cada propuesta con archivos de otro turno deja una copia en el bucket, dentro del prefijo del usuario. Por eso el archivo aparece también en la lista de archivos del turno nuevo.
- ~~Leer un Excel sin código sigue pendiente: requiere actualizar `xlsx` (CVE-2023-30533).~~ Resuelto el 29 sep con `xlsx` 0.20.3: `files.read` abre Excel, PDF y Word (`docs/cowork-office.md`). El análisis pesado sigue siendo con código.
