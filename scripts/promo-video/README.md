# Videos promocionales de ANTON.IA

Tres videos para redes, YouTube y prospectos, armados con la app real y datos de demostración. No se lee ni se envía nada real.

| Video | Formato | Archivo |
| --- | --- | --- |
| 90 segundos | 16:9, 1920×1080 | `anton-90s-16x9.mp4` |
| 30 segundos | 9:16, 1080×1920 | `anton-30s-9x16.mp4` |
| 5 minutos, con capítulos | 16:9, 1920×1080 | `anton-5min-16x9.mp4` |

Los guiones de locución están en el documento «Guiones de locución ANTON.IA»: un bloque por código (`V90-01`…`V90-10`,
`V30-01`…`V30-05`, `V5-01`…`V5-13`), con su tiempo, su imagen y su texto. `timelines.mjs` sigue ese documento.

## Cómo se arman

1. **Capturas** (`capture.mjs`): recorre los guiones de los tutoriales (`scripts/tutorial-videos/storyboards`) en el banco de
   la auditoría visual, sin las notas del tutorial, y guarda una captura nítida (2880×1800) antes y después de cada paso, con
   la posición del control usado (`index.json`). La organización de prueba aparece como «Atlas Selección» y el correo del
   dueño de Cowork se reemplaza en pantalla.

   ```bash
   node scripts/promo-video/capture.mjs --out=/tmp/promo-stills            # compila .next-audit la primera vez
   node scripts/promo-video/capture.mjs --skip-build --videos=oportunidades --out=/tmp/promo-stills
   ```

2. **Montaje** (`compose.mjs` + `stage.html`): dibuja cada cuadro en `stage.html` (portada, frases, ventanas de la app con
   un movimiento de cámara lento y un anillo en el control de cada paso, mosaico y cierre), lo pasa a ffmpeg a 30 fps y
   agrega música original (`scripts/tutorial-videos/music.mjs`). Escribe el MP4, un `.srt` con el texto de la locución y,
   para el de 5 minutos, sus capítulos de YouTube (`.capitulos.txt`).

   ```bash
   node scripts/promo-video/compose.mjs --stills=/tmp/promo-stills --out=/tmp/promo-videos            # los tres
   node scripts/promo-video/compose.mjs --stills=/tmp/promo-stills --out=/tmp/promo-videos --videos=v30
   node scripts/promo-video/compose.mjs --stills=/tmp/promo-stills --out=/tmp/promo-videos --preview=1.5,-1.5   # un JPEG por bloque
   ```

## La voz

Graba en ElevenLabs un archivo por bloque, con el código como nombre (`V90-03.mp3`, `V5-11.wav`…), y pásalos con `--voice`:

```bash
node scripts/promo-video/compose.mjs --stills=/tmp/promo-stills --out=/tmp/promo-videos --voice=/ruta/a/los/audios
```

Cada audio entra al inicio de su bloque; si uno es más largo que su tiempo, el bloque se alarga y empuja a los siguientes.
La música baja sola mientras habla la voz. `--no-captions` quita los subtítulos quemados (el `.srt` se escribe igual).
