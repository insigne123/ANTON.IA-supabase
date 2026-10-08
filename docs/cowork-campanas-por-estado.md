# Cowork: campañas contadas por estado (8 oct 2026)

## Problema

Una lectura ciega de 21 casos de uso real calificó como mala la respuesta a «¿Cómo me ha ido esta semana con mis correos y
campañas?». Hay 19 campañas y ningún envío, y Cowork no lo dijo: «aparecen 19 campañas en total, pero solo una está incluida en lo
consultado».

Ese «solo una» venía del banco de pruebas. `campaigns.list` del banco devolvía 1 de 19 campañas, mientras que producción lista hasta
20, es decir, las 19.

Con el banco corregido apareció el problema real: para decir cuántas hay en borrador y cuántas pausadas, Cowork las contaba a mano.
En una de dos respuestas contó mal: «15 están en borrador y 4 pausadas», cuando eran 14 y 5.

## Cambio

- **`src/lib/server/cowork/extended-reads.ts`**: `campaigns.list` devuelve `byStatus`, las campañas listadas contadas por estado
  (`{ draft: 14, paused: 5 }`).
- **`read-capabilities.ts`**: la descripción de la consulta lo dice.
- **Banco** (`cowork-conversation-corpus.ts`):
  - lista las 19 campañas de la cuenta, como producción: 14 en borrador y 5 pausadas, ninguna con envíos, y la más reciente es
    «Campaña de prueba»;
  - devuelve `byStatus` como el servidor.
- **Prueba unitaria nueva** en `extended-reads.test.ts`.

## Medición

«¿Cómo me ha ido?» y el informe del mes para el jefe, con el banco corregido, con `gpt-6-luna`. Sin `byStatus` hubo 14 respuestas;
con `byStatus`, 10:

| | Sin `byStatus` | Con `byStatus` |
|---|---|---|
| Dice cuántas campañas hay por estado | 4 de 14 | 8 de 10 |
| De esas, con un conteo equivocado | 1 de 4 | 0 de 8 |

Otra sesión de Claude leyó a ciegas las 10 respuestas de «¿cómo me ha ido?» mezcladas:

| | Sin `byStatus` | Con `byStatus` |
|---|---|---|
| Buenas / mejorables / malas | 3 / 1 / 1 | 2 / 3 / 0 |
| Veracidad (1 a 5) | 4,80 | 5,00 |
| Comprensión | 3,80 | 4,60 |
| Utilidad | 3,20 | 3,40 |
| Posición media (1 = mejor de 10) | 5,80 | 5,20 |

Queda pendiente, según el evaluador:

- casi ninguna dice que en 30 días tampoco hubo envíos y que ninguna de las 19 campañas está activa;
- la tarjeta para activar la campaña muestra su ID en vez de su nombre (se corrige aparte).

Sin migraciones ni flags.
