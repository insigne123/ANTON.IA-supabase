# Cowork: «¿A quién invito por LinkedIn?» (8 oct 2026)

## Problema

Ante «¿a quién debería invitar esta semana?» o «invita a Felipe de Securitas», Cowork leía los contactos y el cupo, pero no la red
sincronizada de LinkedIn. Recomendaba sin saber si la persona ya estaba conectada o tenía una invitación pendiente, y sin un
criterio claro para elegir. La última lectura ciega de 26 casos lo marcó como «recomendaciones de contactos incompletas».

## Cambio

Receta nueva en `src/lib/cowork/agent-instructions.ts` (capacidad `linkedin`):

- en un solo `reads.parallel`, `leads.search`, `linkedin.quota` y `linkedin.network`;
- prioriza a quien tiene perfil guardado, con cargo que decide o influye (gerente, jefe, director), y primero a quien no tiene
  correo, porque LinkedIn es su único canal;
- nombra a los que deja fuera y por qué;
- propone invitar dentro del cupo restante y no gasta créditos en buscar un perfil que ya está guardado.

## Medición

4 casos (`ur-invitar-semana`, `inicio-linkedin`, `mkt-linkedin-invitar`, `ur-invitar-nombre`), 2 veces cada uno, con
`gpt-6-luna`. Otra sesión de Claude leyó las 16 respuestas mezcladas, sin saber cuál era cuál:

| | Antes | Con la receta |
|---|---|---|
| Buenas / mejorables / malas | 4 / 2 / 2 | 4 / 4 / 0 |
| Elige bien a quién invitar (1 a 5) | 3,63 | 4,13 |
| Veracidad | 4,25 | 4,50 |
| Utilidad | 4,25 | 4,25 |
| Claridad | 4,13 | 4,13 |
| Posición media (1 = mejor de 4) | 3,00 | 2,00 |
| Mejor respuesta del caso | 0 de 4 | 4 de 4 |
| Checks automáticos | 68 de 68 | 68 de 68 |
| Segundos por turno (mediana) | 12,5 | 14 |

Ejemplo: «Te quedan 93 invitaciones esta semana: 2 están pendientes y 5 se enviaron. Partiría por Andrea Vega, de Falabella:
tiene perfil de LinkedIn guardado y no tiene correo registrado, así que LinkedIn es el único canal disponible en tus contactos.
Dejé fuera a Rodrigo Pino porque no tiene perfil guardado y a Camila Fuentes porque su cargo es de analista…».

Queda pendiente, según el evaluador:

- con 93 invitaciones disponibles propone una sola, y deja sin siguiente paso a otros contactos de jefatura con perfil;
- con 256 contactos guardados decide sobre los primeros que devuelve la búsqueda, sin revisar el resto;
- con pocos contactos responde en prosa, sin el bloque de tabla que pide la receta.

Sin migraciones ni flags.
