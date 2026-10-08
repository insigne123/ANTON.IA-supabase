# Plan 16: sin botones secundarios que ofrecen otra consulta

## Problema

La queja más frecuente del juez en las respuestas mejorables: después de consultar datos, un botón que no es el primero ofrece otra
consulta gratuita que podía ir en la respuesta («Revisa mis contactos y dime cuáles están listos para escribirles»). En los 13 casos
medidos del Plan 16, eso pasó en 9 de 26 respuestas en `main`.

## Cambio propuesto

`coworkWithoutSecondaryReadChips` (`src/lib/cowork/agent-loop.ts`), al cerrar un turno que consultó datos:

- quita los botones que no son el primero y piden otra consulta;
- mantiene el primero, que responde la pregunta final, y los que piden otra cosa (redactar, proponer, buscar prospectos nuevos).

Un turno sin consultas (una respuesta de chat) queda igual.

## Medición

El cambio solo quita botones de la respuesta final, así que se midió sobre las mismas respuestas. Se tomaron las 15 respuestas guardadas
de los 13 casos de `docs/cowork-plan16-consultas.md` que tienen un botón así, 9 de `main` antes de #261 y 6 después. Cada una se juzgó
con y sin esos botones, dos veces, con `gpt-6.1-sol` y el juez de #259:

| | con botones secundarios | sin ellos |
|---|---|---|
| Quejas por ofrecer una consulta que podía hacer | 8 y 6 de 15 | 1 y 2 de 15 |
| Fricción | 3,33 y 3,33 | 4,33 y 4,27 |
| Utilidad | 4,00 y 4,07 | 4,33 y 4,27 |
| Buenas / malas | 2/3 y 3/5 | 5/2 y 5/3 |

La utilidad no baja: el botón quitado pedía algo que la respuesta ya debía traer, y queda el primero, que responde la pregunta final.

Sin migraciones ni flags.
