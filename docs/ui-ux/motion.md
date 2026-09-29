# Movimiento en Cowork

Cada animación le responde al usuario una de cuatro preguntas. Si no responde ninguna, sobra.

| Pregunta | Ejemplo | Transición |
|---|---|---|
| ¿Qué apareció? | Una respuesta, una tarjeta, un chip de archivo | Entrada: sube 6 px y aparece |
| ¿Qué cambió? | Un paso del plan terminó, una propuesta se aprobó | Cambio de estado: fundido cruzado rápido |
| ¿De dónde salió? | Abrir una tarjeta en el panel | Panel que se desliza desde su borde |
| ¿Terminó? | Se creó el archivo, se guardó la campaña | Confirmación breve, sin bucle |

## Reglas

- **Rápido:**
  - 120 a 200 ms para cambios de estado;
  - 240 a 320 ms para lo que entra;
  - lo que sale va más rápido que lo que entra.
- **Una sola cosa en bucle por pantalla:** el indicador de que Cowork está trabajando. Nada más gira ni late para llamar la atención.
- **Nada salta:** lo que entra o sale del flujo abre y cierra su espacio (`CwCollapse`).
- **El historial no se anima:** un turno que ya estaba hecho aparece quieto. Solo se anima lo que termina mientras miras (`live`).
- **Reducir movimiento:**
  - si el sistema lo pide, desplazamientos y cambios de tamaño pasan de inmediato y solo quedan fundidos;
  - lo hacen `MotionConfig reducedMotion="user"` y el bloque `prefers-reduced-motion` de `cowork.css`.
- **El foco no se mueve** por una animación, y el texto que aparece no se anuncia por partes: `aria-live` solo anuncia estados.
- **Solo la paleta actual:** los tokens `cw-*`, en claro y oscuro.

## Dónde vive

| Pieza | Archivo |
|---|---|
| Tiempos, curvas y transiciones (`cwFadeRise`, `cwCollapse`, `cwPop`, `cwPanel`, `cwSwap`) | `src/components/cowork/motion.tsx` |
| Contexto del workspace: `LazyMotion` estricto y `MotionConfig` | `CoworkMotion` en el mismo archivo |
| Funciones de animación, cargadas después de que la página responde | `src/components/cowork/motion-features.ts` |
| Efectos de solo entrada, en CSS (`cw-rise`, `cw-fade`, `cw-shimmer`, `cw-orbit`, `cw-breathe`) | `src/styles/cowork.css` |

- **CSS o `framer-motion`:**
  - lo que solo entra y nunca sale sigue en CSS, porque es más barato;
  - `framer-motion` es para lo que CSS no hace: salidas y cambios de estado.
- **`LazyMotion` estricto:**
  - carga solo las animaciones del DOM, y las carga después de que la página responde;
  - la carga inicial de `/cowork` sube unos 20 KB comprimidos (de 221 a 241 KB); las funciones de animación (unos 16 KB más) llegan aparte, después;
  - usa siempre `m.div`; `motion.div` falla a propósito;
  - no hay animaciones de layout (`layout`): costarían otros 14 KB.

## Qué se anima hoy

| Qué | Cómo |
|---|---|
| Panel del resultado | Entra y sale deslizándose desde la derecha; en teléfono, sobre la conversación |
| Cambiar de resultado abierto | El contenido nuevo aparece con un fundido; el anterior sale al instante, así el título y el contenido siempre coinciden |
| Resumen lateral | Cede su lugar al panel del resultado y vuelve deslizándose cuando ese panel se cierra |
| Lista de trabajos en teléfono | Entra desde la izquierda, sobre un fondo que aparece |
| Aviso de error | Abre y cierra su espacio |
| Botón «Ir al final» | Aparece y desaparece con escala |
| Respuestas sugeridas | Entran con la respuesta y se desvanecen al usar una |
| Mensaje en espera | Abre y cierra su espacio sobre la caja |
| Archivos adjuntos | Cada chip aparece y sale |
| Plan en curso | «Ahora» cambia con un fundido cruzado; el check de cada paso se dibuja; su hallazgo aparece como chip; la barra avanza; al terminar, la tarjeta se pliega en una línea |
| Íconos de «Progreso» | Cambian con una transición corta |
| Números de un hallazgo o una cifra | Cuentan hasta su valor al aparecer (solo los mayores que 9; `CwCount`) |
| Respuesta mientras se escribe | Cada párrafo nuevo entra con un fundido; el cursor está quieto; las tarjetas en camino muestran un esqueleto |
| Estado de una tarjeta | «Borrador», «Editado por ti», «Campaña propuesta»… cambia con un fundido cruzado |
| Filas de una tabla | Entran escalonadas cuando la tarjeta aparece |
| Palabras editadas | Al tocar «Listo» se marcan y se apagan en unos 3 s |

## Cómo se revisa

- Playwright con `page.emulateMedia({ reducedMotion: 'reduce' })`: nada se desplaza y todo queda en su lugar final.
- Claro, oscuro y 390 px: sin scroll horizontal durante ni después de una transición.
- Teclado: el foco sigue donde estaba al abrir o cerrar un panel, salvo cuando la acción lo mueve a propósito (abrir un resultado enfoca su título).
- `scripts/test-cowork-workspace.mjs` (jsdom) abre y cierra paneles varias veces seguidas: una salida que nunca termina deja el panel en el DOM y la prueba lo detecta.
