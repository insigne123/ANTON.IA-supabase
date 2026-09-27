# Cowork · techo del turno (27 sep 2026)

Tercer PR de la Ola B del plan de Cowork (punto 2.0: el orquestador decide cuántas llamadas hacer, dentro de un techo).

## Qué cambia

Hasta ahora cada turno tenía un tope fijo en el código: 4 decisiones del modelo y 3 consultas. Ahora ese tope es un **techo configurable** y el coordinador ve cuánto le queda:

- **Techo** (`src/lib/cowork/turn-budget.ts`), con tres variables de entorno:

| Variable | Rango | Por defecto |
|---|---|---|
| `COWORK_MAX_DECISIONS_PER_TURN` | 2 a 5 | 4 |
| `COWORK_MAX_READS_PER_TURN` | 1 a 9 | 3 |
| `COWORK_TURN_SOFT_DEADLINE_SECONDS` | 20 a 75 | 50 |

  - Un valor fuera de rango se acota; uno que no es número deja el valor por defecto.
  - Las decisiones llegan hasta 5 porque la base admite 5 llamadas del coordinador por turno (`cowork_reserve_model_call`). Más requiere una migración.
- **Plazo blando:** pasados 50 s, la siguiente decisión responde con lo que tiene y ya no se empieza otra consulta ni la corrección del cierre. Deja margen antes del corte de 105 s del worker, que hoy termina el turno con error.
- **Mismos números en todas partes:** el bucle le pasa al coordinador lo que queda del techo en cada decisión, y el contexto (`readBudget`) y las reglas nombran los mismos números que aplica el bucle, no un 3 escrito a mano.
- **Especialistas:** su revisión cita hasta 3 consultas (índices 0 a 2). Si una revisión pedía más, antes el turno fallaba con un error; ahora el bucle la rechaza con una corrección y el turno sigue.

**Con los valores por defecto, Cowork se comporta como antes.** Las instrucciones y el contexto que recibe el modelo quedan idénticos byte a byte a los de la base (lo comprobé renderizando ambos con las mismas entradas). Solo cambian el plazo blando, que corta turnos de más de 50 s, y el rechazo corregible de la revisión de especialistas.

## Por qué los valores por defecto no suben

El juez (#14) mostró que el problema más común es dejar para otro turno lo que Cowork podía hacer en este. Casi siempre ofrece una consulta gratuita como siguiente paso («¿Reviso tus contactos con correo?»). En 11 de las 24 respuestas con fricción de 2 o menos ya se habían gastado las 3 consultas, así que probé dos cosas antes de fijar el techo, el mismo día y con el mismo corpus (34 casos, 3 repeticiones, gpt-6-luna).

**Prueba 1: más techo y reglas.** 5 decisiones y 6 consultas, más tres reglas nuevas:
- no ofrecer como siguiente paso una consulta que se puede hacer ahora;
- entregar lo más cercano a lo que no se puede hacer (la invitación redactada, no «¿la redacto?»);
- en «¿qué tengo pendiente?», consultar también los contactos.

**Prueba 2: la prueba 1 más una corrección forzada.** Si la pregunta final ofrecía una consulta gratuita y quedaba presupuesto, el bucle pedía hacerla y responder de nuevo.

| | Base | Prueba 1 | Prueba 2 |
|---|---|---|---|
| Casos que pasan las verificaciones | 100/102 | 98/102 | 96/102 |
| Llamadas al modelo por caso | 2,13 | 2,51 | 2,87 |
| Consultas por caso | 1,72 | 2,39 | 2,53 |
| Segundos por caso (promedio · p90) | 7,9 · 11,3 | 9,9 · 17,6 | 11,5 · 19,0 |
| Respuestas cuya pregunta final ofrece revisar algo (por su texto) | 25 | 21 | 11 |
| Juez: fricción media (1 a 5) | 4,10 | 4,16 | 4,04 |
| Juez: buenas · mejorables · malas | 51 · 27 · 24 | 47 · 30 · 25 | 43 · 30 · 29 |

- **La prueba 1 no mejora la calidad:** cuesta 18 % más llamadas y 25 % más tiempo.
  - Por caso hay cambios en los dos sentidos: mejoran «necesito clientes», «agéndame una reunión» y «¿qué tengo pendiente?», pero empeoran otros tantos que ni siquiera usaron más consultas.
  - Lo simple sí siguió rápido: los pedidos de una consulta usaron lo mismo que antes.
- **La prueba 2 empeora:**
  - Baja a la mitad las respuestas que terminan ofreciendo una consulta, pero la respuesta rehecha pierde piezas: la tarjeta de cifras, el dominio revisado, el «no puedo agendar».
  - También empuja a hacer lo que nadie pidió: al pedir solo mejorar un correo, Cowork busca contactos y lo adapta a Marcela.
  - El juez la califica peor que la base.
- **Lo que aprendimos:** lo que el juez llama fricción no es falta de consultas. Es preguntar antes de entregar el siguiente paso: el borrador, la invitación o la tarjeta. Eso corresponde a la Redactora (punto 2.1), que usará este techo para redactar, revisar y corregir dentro del mismo turno.

## Límites

- **Presupuesto por conversación en la base:** hasta 25 llamadas y 100 000 tokens reservados por conversación, a 6000 por llamada del coordinador; en la práctica, unas 16 llamadas.
  - Con más llamadas por turno, una conversación larga llega antes al aviso «Este hilo alcanzó su límite de uso del asistente».
  - Por eso conviene subir el techo solo junto con una migración que ajuste ese presupuesto. No la incluí: requiere autorización.
- **El plazo blando no garantiza el corte de 105 s:** una decisión que empieza justo antes de los 50 s puede tardar hasta 30 s, y la siguiente otros tantos. Es el mismo peor caso de antes, ahora mucho menos probable.

## Mediciones de este PR

El código final se midió igual que las pruebas, el mismo día:

| | Base | Este PR |
|---|---|---|
| Casos que pasan las verificaciones | 100/102 | 99/102 |
| Llamadas al modelo por caso | 2,13 | 2,14 |
| Consultas por caso | 1,72 | 1,67 |
| Segundos por caso (promedio · p90) | 7,9 · 11,3 | 8,1 · 11,6 |

- **Fallas:**
  - `editar-usar`, 1 de 3, igual que la base.
  - `linkedin-seguimiento`, 2 de 3: es el caso inestable conocido; en otras corridas del mismo código base falló 0 o 1 de 3.
- **Un dato que quité después de medir:** esa corrida todavía le mostraba al modelo cuántas decisiones le quedaban.
  - Con ese dato, el juez contó menos respuestas buenas que en la base: 41 contra 51. Entre dos corridas de la misma base varió de 48 a 51.
  - Puede ser ruido, pero no había beneficio que justificara el riesgo, así que lo quité.
  - Con eso, las instrucciones y el contexto quedan idénticos a los de la base, y no queda un cambio de comportamiento que medir con el corpus.

## Cómo se configura

- Sin variables nuevas en `apphosting.yaml` rige el comportamiento de siempre.
- Para dar más margen a un pedido complejo, por ejemplo 5 decisiones y 6 consultas, basta con definir las dos variables. Conviene medirlo antes con `scripts/evaluate-cowork-conversations.ts` y el juez (`docs/cowork-juez.md`).

## Pendientes

- **Redactora y Revisora (2.1):** entregar el borrador en el turno en vez de preguntar si se prepara, con la revisión dentro del techo.
- **Migración del presupuesto por conversación**, si se sube el techo por defecto. Requiere autorización.
