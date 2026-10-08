# Cowork: un envío sin respuesta de 5 días o más es un seguimiento (8 oct 2026)

## Problema

Con un envío sin respuesta de hace 6 días, Cowork a veces descartaba el seguimiento aunque el usuario pidiera priorizarlo:

- «no la pondría en seguimiento todavía»;
- «no puedo confirmar que siga pendiente»;
- «verificaría si respondió por fuera antes de insistir».

Otras veces la metía en una campaña con «un primer correo» junto a los contactos que nunca habían recibido nada: le habría llegado
de nuevo el primer mensaje.

La receta «¿A quién le escribo hoy?» ya ponía primero a quienes nunca recibieron nada y después los seguimientos de 5 días o más. La
duda sobre si respondió por fuera de ANTON.IA terminaba pesando más que esa receta.

## Cambio

En `src/lib/cowork/agent-instructions.ts`, regla 3, después de «si te respondió por fuera de ANTON.IA, avísame y lo ajusto»:

> Un envío sin respuesta registrada hace 5 días o más es un seguimiento pendiente: propónlo con su paso concreto (redactarle el
> seguimiento) y aparte de los primeros correos, porque a esa persona no le corresponde otro primer correo; no lo descartes ni lo
> dejes para cuando se confirme.

## Medición

4 casos (¿a quién le escribo hoy?, en dos versiones; el seguimiento a quien no respondió; ¿cómo voy?), 3 veces cada uno, con
`gpt-6-luna`. Las dos versiones incluyen #290, que corrige la consulta de envíos por período.

| | Antes | Ahora |
|---|---|---|
| Descarta o posterga el seguimiento | 4 de 12 | 0 de 12 |
| Propone el seguimiento a Marcela | 8 de 12 | 12 de 12 |
| Propone un primer correo que incluye a Marcela | 3 de 12 | 0 de 12 |
| Checks automáticos | 105 de 105 | 104 de 105 |

Otra sesión de Claude leyó a ciegas las 24 respuestas mezcladas:

| | Antes | Ahora |
|---|---|---|
| Buenas / mejorables / malas | 8 / 4 / 0 | 9 / 2 / 1 |
| Utilidad (1 a 5) | 3,92 | 4,33 |
| Fricción (5 = ninguna) | 4,42 | 4,67 |
| Veracidad | 4,83 | 4,67 |
| Posición media (1 = mejor de 6) | 4,08 | 2,92 |
| Mejor respuesta del caso | 1 de 4 | 3 de 4 |

Una primera versión de la regla, sin «aparte de los primeros correos», ya había mejorado la posición media (4,00 → 3,00), pero en 2
de 12 respuestas le proponía a Marcela un primer correo.

Queda pendiente, según el evaluador:

- en las dos versiones, un borrador dice «te escribí hace unas semanas» cuando fueron 6 días;
- con poco tiempo, una respuesta propone solo el seguimiento y deja fuera a los que nunca recibieron nada.

Sin migraciones ni flags.
