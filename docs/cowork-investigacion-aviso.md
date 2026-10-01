# Cowork: aviso al terminar la investigación (1 oct)

**Problema (prueba del 1 oct, `Pruebas_de_app.docx`):**
- Las investigaciones lanzadas desde Cowork terminaban sin que nadie lo supiera.
- Cowork decía «Cuando esté lista, pídeme el resumen»: la persona tenía que acordarse de volver y preguntar.

## Qué cambia

1. **Cowork avisa en la misma conversación.** Cuando terminan las investigaciones que se pidieron, la conversación sigue sola con un turno nuevo, que se ve como «Terminaron las investigaciones que pediste».
   - Por persona, Cowork dice lo más útil para escribirle (qué hace su empresa, una señal reciente con su fuente) y qué faltó.
   - Después propone el siguiente paso, por ejemplo los borradores.
2. **Cuándo avisa:**
   - Espera a todas las investigaciones de un mismo pedido.
   - Si a los 10 minutos alguna sigue en curso, avisa de las listas y de la que falta cuando termine.
   - Con varias investigaciones en una conversación, es un solo aviso con todas.
3. **Dónde va el aviso:**
   - Después del último turno de la conversación cuando ese turno terminó.
   - Si un turno está trabajando o espera una aprobación, el aviso espera al minuto siguiente.
   - Si el último turno falló, va después del último que terminó.
4. **Nunca dos veces.** El aviso se marca en el turno que inició la investigación (evento `research.notified`) antes de crear el turno nuevo.
   - Si la creación falla, se reintenta un minuto después, solo mientras siga siendo el final de la conversación.
5. **Tarjeta en vivo:** sobre el cuadro de mensaje se ve «Investigando 2 · 1 lista · Te aviso aquí cuando terminen».
   - Al abrirla aparece cada persona con su estado.
   - Desaparece cuando ya no queda nada en curso.
6. **Sin «pídeme el resumen»:** al iniciar una investigación, Cowork dice que avisará en la conversación.

## Cómo funciona

- **Origen:** Cowork guarda en la clave de cada investigación el turno que la pidió: `cowork:<turno>:lead:<contacto>:research-v1`. No hace falta migración.
- **Revisión:** el worker de Cowork, que corre cada minuto y al despertar desde la app, revisa las investigaciones de Cowork del último día (`processCoworkResearchNotices`).
  - Lo hace a lo sumo cada 20 segundos.
  - Es de mejor esfuerzo: nunca rompe la vuelta del worker.
- **El turno nuevo:**
  - Usa `cowork_admit_followup` con un id derivado del turno anterior. Por ese id la app lo muestra como turno automático.
  - Empieza de cero los pasos automáticos (`p_reset_depth`), como un mensaje nuevo.
- **Investigaciones de otro origen:** las que se iniciaron fuera de Cowork no generan avisos.

## Piezas

- **Reglas puras:** `src/lib/cowork/research-notice.ts` (clave, cuándo avisar, mensaje y etiqueta en vivo).
- **Servidor:**
  - `src/lib/server/cowork/research-notice.ts` (avisos, marca, recuperación y avance);
  - `worker.ts` (lo llama en cada vuelta);
  - `runs.ts` (reconoce el turno de aviso);
  - `effects.ts` (el texto al iniciar).
- **Ruta:** `GET /api/cowork/runs/[id]/research-progress`, solo lectura.
- **Pantallas:**
  - `ResearchProgress.tsx`: tarjeta en vivo;
  - `CoworkTurn.tsx`: etiqueta del turno de aviso.

## Pruebas

- `src/lib/cowork/research-notice.test.ts`: clave, cuándo avisar, mensaje y etiqueta.
- `src/lib/server/cowork/runs.test.ts`: el aviso se ve como turno automático con su motivo, y el id no sale del servidor.
- `scripts/test-cowork-research-notice.mjs`: el flujo completo con una base en memoria:
  - espera;
  - aviso después del último turno;
  - turno trabajando;
  - 10 minutos;
  - último turno fallido;
  - recuperación;
  - marca fallida;
  - investigaciones de otro origen;
  - límite de frecuencia.
- `scripts/test-cowork-research-progress-ui.mjs`: DOM de la tarjeta en vivo.
