# Cowork: «¿cómo voy?» con a quién se le escribió y una acción concreta (8 oct 2026)

## Problema

Un evaluador independiente (otra sesión de Claude) leyó a ciegas 26 respuestas de Cowork con luna. Dos de las tres malas eran
preguntas de resultados («¿Cómo me ha ido esta semana?»). Cowork leía `metrics.rates` y `campaigns.list`, daba las cifras y cerraba
con un consejo genérico («Conviene medir las respuestas antes de ajustar la estrategia»). No decía a quién se le escribió ni si
respondió. A veces dejaba de botón algo que podía consultar en el mismo turno («primero hay que comprobar quiénes ya recibieron un
mensaje»).

## Cambio

Receta de «¿Cómo voy? / números de la semana» (`src/lib/cowork/agent-instructions.ts`):

- en un solo `reads.parallel`: `metrics.rates` y `contacted.search` (a quiénes se les escribió, cuándo y si respondieron), más
  `campaigns.list` si pregunta por campañas;
- `reply` abre con la conclusión en números y nombra a quiénes se les escribió y hace cuánto;
- con pocos envíos no concluye sobre la estrategia. Cierra con la acción concreta que más mueve las cifras y que puede hacer ahora,
  nombrando a las personas o la campaña: el seguimiento a quien no respondió, escribir a los contactos con correo que nunca recibieron
  nada o activar la campaña en borrador. Esa acción es el primer botón;
- no ofrece en botones revisar lo que ya consultó.

## Medición

6 casos de resultados (`ur-como-me-ha-ido`, `inicio-como-voy`, `mkt-resultado-campana`, `metricas-semana`, `informe-jefe`,
`ur-tablero-mes`), 2 veces cada uno, con `gpt-6-luna`. El evaluador independiente leyó las 24 respuestas mezcladas, sin saber cuál era
cuál:

| | Antes | Con la receta |
|---|---|---|
| Buenas / mejorables / malas | 3 / 7 / 2 | 8 / 3 / 1 |
| Utilidad (1 a 5) | 3,33 | 3,83 |
| Fricción (5 = ninguna) | 3,75 | 4,42 |
| Veracidad | 4,58 | 4,58 |
| Claridad | 4,00 | 3,92 |
| Posición media (1 = mejor de 4) | 3,08 | 1,92 |
| Mejor respuesta del caso | 1 de 6 | 5 de 6 |
| Checks automáticos | 105 de 106 | 104 de 106 |

Los dos checks que fallan son de `ur-como-me-ha-ido`: una vez faltó la tarjeta de cifras y otra la frase de la recomendación no calzó
con el patrón del check. Aun así, el evaluador puso esas dos respuestas como las mejores del caso.

Queda pendiente, según el evaluador:

- informes y tableros para el jefe con nombres enmascarados («Carlos Ah***a»);
- no decir que el informe se baja con «Descargar»;
- no notar que hay 19 campañas sin envíos en 30 días.

Sin migraciones ni flags.
