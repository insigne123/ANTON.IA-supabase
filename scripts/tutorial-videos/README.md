# Videos del tutorial

Graba un video por módulo sobre la app real, con datos de demostración y sin red. Cada video:

- muestra la app dentro de un escenario de 1280 × 720;
- acerca la cámara al control del que habla;
- mueve el cursor lento, grande y con un halo en cada clic;
- deja una nota y un post-it al costado, una flecha y un recuadro sobre el control, y subtítulos en español;
- abre con una tarjeta («Vas a aprender») y cierra con un resumen;
- lleva música original de fondo, hecha aquí mismo, sin licencias de terceros.

Sale un MP4 H.264 con su póster (`.jpg`) y los subtítulos en WebVTT (`.vtt`).

```bash
npm run tutorial:videos                                  # los 12 videos, en public/tutorial-videos/
npm run tutorial:videos -- --videos=buscar,pipeline      # solo esos
npm run tutorial:videos -- --skip-build --out=/tmp/videos --keep-frames
```

Requisitos:

- Node 22 y Playwright con Chromium, como la auditoría visual (`scripts/visual-audit/README.md`).
- Un ffmpeg con H.264. El de Playwright no sirve. El script lo busca en este orden:
  1. `FFMPEG_PATH`;
  2. el de `imageio-ffmpeg` (`pip install imageio-ffmpeg`);
  3. `ffmpeg` en el `PATH`.

No corre en CI ni agrega dependencias.

## Cómo se graba

- **El banco:** el mismo de la auditoría visual, con su compilación en `.next-audit`, el Supabase simulado y el bloqueo de red. Los datos son de demostración (`scripts/visual-audit/fixtures/`).
  - Las llamadas que el banco bloquea (búsqueda, envío, IA) las responde el navegador con la forma real (`mocks` de cada guion).
  - Nada sale de la máquina y no se envía ningún correo.
- **El escenario:** `stage.html` carga la app en un iframe del mismo origen.
  - La cámara es una transformación CSS sobre ese iframe.
  - Notas, post-it, flecha, recuadro, cursor y subtítulos son HTML y SVG del escenario, con la tipografía de la app.
- **Cuadro a cuadro, a 30 fps:** cada cuadro es una captura y el reloj es del guion. Así el cursor y el zoom se mueven suaves aunque la app tarde.
  - Mientras la app trabaja se filman hasta 1,5 s; lo demás se corta.
- **Ritmo:**
  - el texto de cada paso se queda en pantalla según lo que hay que leer (entre 2,2 y 6,5 s);
  - el cursor tarda entre 0,9 y 2 s en llegar;
  - la cámara, 1,1 s.
- **Música:** `music.mjs` arma una progresión suave a 88 BPM (pad, bajo, arpegio, bombo y shaker), distinta para cada video según su id. Va baja, con entrada y salida suaves.
- **Salida:** H.264 CRF 30, AAC 80 kbps y `faststart`. Cada video queda entre 1 y 3,5 MB.

## Los guiones

Hay uno por módulo en `storyboards/`, y `storyboards/index.mjs` define el orden. Cada guion define:

| Campo | Qué es |
|---|---|
| `id`, `title` | Nombre del archivo y título del video |
| `persona`, `dataset`, `start` | Quién inicia sesión (`owner` o `member`), los datos (`full` o `empty`) y la página de inicio |
| `intro`, `learn`, `outro` | Las tarjetas de apertura y cierre |
| `mocks` | Respuestas del navegador a llamadas que el banco bloquea: `{ url, method, respond }`. `respond` puede ser una función del cuerpo |
| `scenes` | Los pasos |

Cada paso (`scene`):

| Campo | Qué es |
|---|---|
| `title`, `text` | La nota al costado |
| `say` | El subtítulo (y la línea del `.vtt`) |
| `postit` | Un consejo en el post-it, opcional |
| `target` | El control, por lo que la persona lee en él: `{ role, name }`, `{ label }`, `{ text }` o `{ css }`, con `within` para buscarlo dentro de otro elemento y `exact: false` para coincidencias parciales |
| `action` | Clic por defecto; `hover` o `none` (solo señalar) |
| `type`, `choose`, `upload` | En vez del clic: escribe ese texto letra a letra, elige ese valor en un `<select>` o sube ese archivo |
| `zoom`, `zoomOn` | Cuánto acercar (1 es la ventana entera) y, si no es el control, a qué zona |
| `arrow`, `highlight` | La flecha desde la nota y el recuadro (este último va por defecto) |
| `waitFor` | Qué tiene que aparecer después de la acción |
| `before`, `after` | Funciones con el iframe y la página, para lo que el guion no cubre (por ejemplo, cerrar con Esc) |
| `hold`, `pause` | Segundos de lectura al final y de espera antes de la acción |

Si un paso falla, el script dice cuál y deja una captura `<id>-fallo.png` en la carpeta de salida.

## Al cambiar una pantalla

Si un texto o un control de un guion cambia, el video de ese módulo falla con el paso y la captura. Hay que ajustar el guion y volver a grabar ese video con `--videos=<id>`.
