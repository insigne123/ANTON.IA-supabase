# Plan 16 (pendiente de medir): sin botones secundarios que ofrecen otra consulta

## Problema

La queja más frecuente del juez en las respuestas mejorables: después de consultar datos, un botón que no es el primero ofrece otra
consulta gratuita que podía ir en la respuesta («Revisa mis contactos y dime cuáles están listos para escribirles»). En los 13 casos
medidos del Plan 16, eso pasó en 9 de 26 respuestas en `main`.

## Cambio propuesto

`coworkWithoutSecondaryReadChips` (`src/lib/cowork/agent-loop.ts`), al cerrar un turno que consultó datos:

- quita los botones que no son el primero y piden otra consulta;
- mantiene el primero, que responde la pregunta final, y los que piden otra cosa (redactar, proponer, buscar prospectos nuevos).

Un turno sin consultas (una respuesta de chat) queda igual.

## Estado

**Sin medir.** La cuenta de OpenAI de las pruebas está sin créditos. Para medirlo: los mismos 13 casos de
`docs/cowork-plan16-consultas.md`, 2 o más veces, en `main` y en esta rama, con el juez de #259. Se integra solo si bajan las quejas
por consultas ofrecidas sin bajar la utilidad (un botón menos es también un camino menos).
