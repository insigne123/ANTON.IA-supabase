# Cowork · adjuntar archivos en cualquier momento (27 sep 2026)

Tercer PR de la Ola C del plan de Cowork (punto 3.1: subir archivos desde la caja de texto, no solo al terminar un turno).

## Qué cambia

Hasta ahora el clip «Adjuntar archivos» solo aparecía dentro de un hilo y después de que un turno terminaba. En la pantalla de inicio no había cómo subir nada, y mientras Cowork trabajaba tampoco.

- **El clip está siempre,** en la caja de inicio y en la del hilo, también mientras Cowork trabaja.
- **Arrastrar y soltar sobre la caja** adjunta el archivo; no hace falta abrir antes el área de archivos.
- **Chips en la caja:** cada archivo adjunto muestra su nombre y tamaño, con un botón para quitarlo del mensaje. Quitarlo no lo borra: Cowork puede seguir leyéndolo si se lo piden.
- **El mensaje lleva sus archivos** en sus últimas líneas (`src/lib/cowork/attachments.ts`):

  ```
  ¿A quién le escribo primero?

  Adjuntos:
  - asistentes-feria.csv
  ```

  - El chat muestra el texto en la burbuja y los archivos como chips debajo. El título del hilo usa solo el texto.
  - Se puede enviar solo con archivos, sin texto: Cowork dice qué traen y propone el siguiente paso.
  - Si el envío falla, el texto y los archivos vuelven a la caja. Si el mensaje queda en espera y se edita, también vuelven.
- **Regla para el modelo:** si el mensaje termina con «Adjuntos:», Cowork lee esos archivos con `files.read` por su nombre exacto, sin preguntar cuál es.
- **Dónde quedan:** en una carpeta propia del usuario, `organización/usuario/adjuntos/`, con la nueva ruta `POST /api/cowork/files`. `files.read` (#16) y el análisis con código (#17) ya buscan en todas las subidas del usuario, así que los encuentran sin cambios.
- **Una sola validación de subidas** (`src/lib/server/cowork/upload-files.ts`) para la ruta nueva y la del turno: mismos formatos (CSV, JSON, MD, TXT, XLSX), 8 archivos por vez y 20 MB cada uno. Además rechaza nombres con caracteres de control.
- **Sin migraciones ni dependencias nuevas.**

## Cómo se usa

1. En la pantalla de inicio de Cowork, toca el clip «Adjuntar archivos» o arrastra un CSV a la caja.
2. Escribe, por ejemplo, «¿a quién le escribo primero?», o envía solo el archivo.

## Verificación en el navegador

Build de producción local con un Supabase simulado. El envío del mensaje se intercepta; las subidas llegan solo al simulado. En claro y oscuro a 1440 px, y en claro a 390 px:

- en inicio, el clip abre el área y un CSV elegido queda como chip; el botón de enviar se habilita sin texto;
- soltar un archivo sobre la caja lo adjunta, y el botón «Quitar» lo saca del mensaje;
- el mensaje enviado sin texto es «Adjuntos: - asistentes-feria.csv», y con texto lleva el texto arriba;
- si el envío falla, el chip vuelve; si se guarda, la caja queda vacía;
- en un hilo, la burbuja muestra el texto y el archivo como chip, sin la línea «Adjuntos:»;
- con teclado, el clip abre el área y el siguiente foco es el selector de archivos, con su anillo de foco visible;
- sin desborde horizontal a 390 px.

## Mediciones

El mismo día, con el corpus y el modelo real (gpt-6-luna, 3 repeticiones), contra C2 (#17). El juez es gpt-6-sol.

| | C2 (#17) | Este PR |
|---|---|---|
| Casos de antes que pasan (de 102) | 100 | 99 |
| Llamadas al modelo por caso, casos de antes | 2,18 | 2,16 |
| Segundos por caso, casos de antes (promedio · p90) | 9,6 · 15,0 | 8,4 · 13,0 |
| Juez, casos de antes: buenas · mejorables · malas | 48 · 29 · 25 | 46 · 27 · 29 |
| Casos de archivos que pasan | 12 de 12 (4 casos) | 18 de 18 (6 casos) |
| Juez, casos de archivos | 6 · 5 · 1 | 10 · 3 · 5 |

- **Los dos casos nuevos pasan 3 de 3:**
  - `adjunto-solo` (solo el archivo, sin texto);
  - `adjunto-con-pedido` («¿a quiénes les escribo primero?» con el archivo adjunto).
  - En los dos, Cowork lee el archivo por su nombre exacto en la primera decisión, sin preguntar cuál es.
- **Juez en archivos:**
  - las 5 malas cierran pidiendo permiso para algo que ya podía hacer, el mismo patrón que en el resto del corpus;
  - una dice «otros cinco» por importar cuando la tabla muestra bien los cuatro.
- **Lo que corrigió la medición:**
  - en una corrida, la tabla de personas copió mal un correo (`.com` en vez de `.cl`). La regla ahora pide marcar si tiene correo, sin copiar la dirección, y en la corrida final ninguna tabla trae direcciones;
  - la verificación «dice qué pasa con los que no están guardados» leía solo el texto y no la tabla, que decía «Por importar». Ahora lee la respuesta completa, como las demás.
- **Fallas en los casos de antes:** `editar-usar`, 3 de 3.
  - Es el caso inestable de «Usar esta versión», donde el modelo propone la campaña en vez de solo fijar el texto.
  - Falló 2 de 6 en #15 y 10 de 15 en #16 y #17.
  - Lo corrige el PR siguiente, con una guarda en el bucle.
- **Orden de las corridas:** los casos de antes se midieron antes de la última aclaración de la regla (no copiar direcciones), que solo toca respuestas con archivos. Los de archivos son de la corrida final.

## Límites

- **La ruta del turno** (`/api/cowork/runs/[id]/files`) queda para clientes que ya la usan; la interfaz ya no la llama.
- **Los adjuntos no se limpian:** quedan en la carpeta del usuario como el resto de sus subidas. Una limpieza periódica sería un cambio aparte.
- **Un archivo con el mismo nombre reemplaza al anterior** en la carpeta de adjuntos. Las copias que ya tomó una propuesta de código (#17) no cambian.
