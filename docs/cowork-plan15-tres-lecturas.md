# Cowork: tres respuestas, tres conversaciones leídas (Plan 15, 8 oct)

## Problema

Desde «¿Qué toca hoy?», «Sí, prepáralas» debe leer la conversación de las tres personas que esperan respuesta y dejar un borrador
para cada una. La receta dice «hasta 3 conversaciones por turno, en un reads.parallel», y el esquema lo permite (`reads` admite
hasta 3), pero la descripción de `reads.parallel` decía «hasta 2 simultáneas». El modelo lo leía como un tope de 2 por pedido: leía
dos conversaciones, redactaba, y la tercera persona quedaba sin borrador. En las corridas de esta sesión, `hilo-varias-desde-la-agenda`
falló así 3 de 8 veces con las instrucciones de `main`.

## Qué cambia

`agent-instructions.ts`: un `reads.parallel` puede llevar todas las lecturas del turno (la app las corre de a 2 a la vez); para tres
personas o tres conversaciones, las tres van en el mismo `reads.parallel`.

## Medición (`gpt-6-luna`, flags de producción, 3 corridas)

| | main | este PR |
|---|---|---|
| `hilo-varias-desde-la-agenda`: lee las 3 | 3 de 3 (falló 3 de 5 en corridas anteriores) | 3 de 3 |
| `hilo-enviar-varias-desde-la-agenda`: lee las 3 | 2 de 3 | 3 de 3 |

Sin migraciones ni flags.
