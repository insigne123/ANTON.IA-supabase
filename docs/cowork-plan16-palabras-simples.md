# Plan 16: reintentos, dominio, descargas y cifras en palabras simples (8 oct)

## Problema

El juez marcaba como jerga o como dato falso cosas que Cowork repetía de sus propias lecturas o de la guía:

- **Reintentos.** `campaigns.retry_review` decía «terminal», «conciliar en Contactados» y «la clave bulk:campaign:draft protege
  el despacho». Cowork lo repetía tal cual.
- **Dominio.** Las respuestas usaban MX, DKIM, «softfail» o «p=none» sin explicarlos, y no aclaraban que el DNS no basta para
  saber si los correos llegan a spam.
- **Descargas.** La guía «¿Qué puedes hacer?» (`capabilities-guide.ts`) decía que las cifras y los gráficos se bajan en «Excel, Word
  o PDF». En realidad las tarjetas de cifras y gráficos se bajan en Excel o CSV; los informes, en Word o PDF.
- **Cifras.** Las métricas son de toda la organización y Cowork las presentaba como resultados personales.

## Qué cambia

- La lectura de reintentos (`batch-reads.ts`) y su descripción (`read-capabilities.ts`) lo dicen en palabras simples: cuáles no se
  pueden reintentar y por qué, y que de los envíos sin confirmar hay que ver en Contactados si salieron, para no mandarlos dos veces.
- Instrucciones de reintentos: decirlo así, sin «terminal», «conciliar» ni «idempotencia», y revisar Cowork mismo en Contactados
  (`contacted.search`) si un envío salió.
- Instrucciones de dominio:
  - leer `deliverability.check` y `deliverability.bounces` en la misma consulta;
  - explicar cada registro en una frase;
  - decir qué corregir primero, que el DNS no basta y cómo van los rebotes.
- La guía dice «cifras y gráficos en Excel o CSV, e informes en Word o PDF».
- La receta de «¿Cómo voy?» dice que las cifras son de la organización.
- El banco usa los mismos textos de la lectura. Los checks de reintentos aceptan las palabras simples («sin confirmar», «no está
  confirmado», «revisar si salió»).

## Medición

Se corrieron 9 casos (dominio, reintentos, «¿Cómo voy?», «¿Qué puedes hacer?», AXIS D4), 2 veces cada uno, con `gpt-6-luna`. Se
juzgaron con `gpt-6.1-sol`.

| | main | este PR |
|---|---|---|
| Respuestas con «conciliar» o «terminal» | 7 | 0 |
| Respuestas que dicen que los gráficos se bajan en Word o PDF | 4 | 0 |
| Quejas del juez por jerga | 6 | 1 |
| Quejas por Word o PDF | 2 | 0 |
| Juez: claridad | 4,00 | 4,83 |
| Juez: veracidad | 4,00 | 4,44 |
| Juez: buenas | 2 de 18 | 5 de 18 |

Dominio, 3 corridas más con la lectura de rebotes: 3 de 3 leen el dominio y los rebotes juntos, y ninguna ofrece revisar los rebotes
como siguiente paso (antes era la queja del juez).

Sin migraciones ni flags.
