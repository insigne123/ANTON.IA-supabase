# Plan 16: una consulta ya hecha no vuelve como botón (8 oct)

## Problema

Lo que más marcaba el juez en las respuestas mejorables o malas era que Cowork ofrecía, como siguiente paso, una consulta gratuita
que podía hacer antes de responder. Cowork ya corregía la pregunta final cuando ofrecía una consulta («¿Reviso tus contactos?»): hace
la consulta y edita su respuesta. Pero al juntar la respuesta editada con la primera, `completeFrom` (`src/lib/cowork/agent-loop.ts`)
recuperaba la pregunta y los botones de la primera si la edición no traía los suyos. La consulta ya estaba hecha y el botón
«Sí, revisa…» volvía igual. Pasó en 2 de 6 correcciones medidas.

Además, ante «¿me alcanzan los créditos para 120 correos?», Cowork ofrecía revisar cuántos contactos no tienen correo, aunque ese
dato ya viene con cada turno (`workspace`: contactos guardados menos los que tienen correo).

## Qué cambia

- `completeFrom` recibe la consulta que se corrigió. No recupera la pregunta que la ofrecía ni los botones que respondían que sí o
  pedían una consulta; los demás botones de la primera respuesta quedan.
- La receta de créditos: si pregunta por correos, Cowork dice también cuántos de sus contactos guardados no tienen correo y si el
  saldo alcanza para todos, sin ofrecer revisarlo.

## Medición

Se corrieron 13 casos donde el juez marcaba consultas ofrecidas, 2 veces cada uno, con `gpt-6-luna` y los flags de producción. Se
juzgaron con `gpt-6.1-sol`, con el juez que lee las tarjetas como el usuario (#259).

| | main | este PR |
|---|---|---|
| Correcciones en que volvía el botón de una consulta ya hecha | 2 de 6 (en la corrida sin el arreglo) | 0 de 7 |
| Créditos: dice cuántos contactos no tienen correo | 0 de 2 | 3 de 4 |
| Checks del banco | 19 de 26 | 24 de 26 |

El juez no mostró una mejora general: varía mucho de una corrida a otra (el mismo caso sale bueno-bueno y malo-malo con el mismo
código). La mayoría de sus quejas son por un botón secundario que ofrece revisar contactos, y eso este PR no lo toca. Se probaron otras
dos cosas que no movieron la cifra y quedaron fuera:

- una regla en las instrucciones para no ofrecer consultas en los botones (quejas 11 → 9 de 26, ruido);
- forzar la consulta cuando el primer botón la ofrecía sin pregunta (respuestas así: 6 → 5 de 26).

Sin migraciones ni flags.
