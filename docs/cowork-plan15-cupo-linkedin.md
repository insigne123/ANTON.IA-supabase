# Cowork: el cupo de LinkedIn dice cuántas quedan (Plan 15, 8 oct)

## Problema

`classifyInviteQuota` (`src/lib/cowork/linkedin-bridge.ts`) explicaba el cupo como «Cupo disponible (22/100)»: 22 **usadas** (4
pendientes y 18 enviadas en 7 días) de 100. Cowork lo leía como 22 **disponibles**: en el caso `lectura-cupo-pendientes`, dos de tres
respuestas decían «puedes enviar 22 invitaciones más» cuando quedaban 78. Además, la lectura invita a preguntar cuántas pendientes ve
el usuario en LinkedIn, y Cowork lo convertía en su pregunta final en vez de dar el dato que sí tenía: al menos 61 invitaciones
enviadas desde ANTON.IA siguen sin aceptar (lo que más arriesga la cuenta).

## Qué cambia

- `classifyInviteQuota` trae `remaining` y lo dice en palabras: «Cupo disponible: quedan 78 de 100 esta semana (22 usadas entre
  pendientes y enviadas de 7 días)». Las lecturas de prueba del banco (`cowork-batch-corpus`, `cowork-lecturas-corpus`,
  `evaluate-cowork-linkedin`) reflejan la misma lectura.
- Instrucciones (`agent-instructions.ts`): lo que queda es `remaining`; al responder por el cupo se dice siempre cuántas siguen sin
  aceptar desde ANTON.IA, y lo enviado directo en LinkedIn va en una frase, no como la pregunta final.
- Checks del banco al día con el producto:
  - `lectura-cupo-pendientes` exige «78» y acepta «sin aceptación» o «no aparecen aceptadas»;
  - `mkt-busqueda-y-campana` acepta la tarea de varios pasos aprobada una vez (con `COWORK_TASKS_ENABLED`, encendido en producción),
    siempre que empiece por la búsqueda de 10;
  - `lote-sin-perfil` rechaza una invitación sin perfil, no la propuesta de buscar sus datos que pide la regla 10.

## Medición (`gpt-6-luna`, flags de producción, 3 corridas)

| | main (3 corridas) | este PR (3 corridas) |
|---|---|---|
| Dice «al menos 61 sin aceptar» | 0 | 3 |
| Dice cuántas quedan sin confundirlas con las usadas | 1 (otra mezcla «78» y «22», otra dice «22») | 3 («te quedan 78») |
| Termina preguntando cuántas ve en LinkedIn | 3 | 0 |

Con solo el cambio de instrucciones (sin `remaining`), 3 de 3 nombraron las 61, pero 2 de 3 siguieron diciendo «22 más»: el número
ambiguo de la lectura era la causa.

Queda un detalle: Cowork agrega una lectura de contactos para proponer a quién invitar (el check pide una sola lectura). Es gratis y
útil, pero no es lo pedido; no se cambia aquí.

Sin migraciones ni flags.
