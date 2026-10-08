# Cowork: «¿a quién le escribo hoy?» mira a todos los que tienen correo (8 oct 2026)

## Problema

La receta leía `leads.search` con query vacía: los 20 contactos más recientes. En una cuenta de 256 contactos, el banco devuelve 4, y
solo uno tiene correo. Cowork concluía sobre esa muestra y la presentaba como el total: «es el único de tus cuatro contactos que
tiene correo». La cuenta tenía 21 con correo.

## Cambio

- `src/lib/cowork/agent-instructions.ts`: la receta «¿A quién le escribo hoy?» lee `leads.search` con «con correo» (Plan 15). Ese
  filtro trae a los que tienen correo en toda la cuenta, hasta 25, junto con `contacted.search`.
- `scripts/fixtures/cowork-uso-real-corpus.ts`: caso nuevo `ur-a-quien-hoy`, «¿a quién le escribo hoy?» en la cuenta de 256
  contactos.

## Medición

3 casos («¿a quién le escribo hoy?» en la cuenta grande y en la de 5 contactos), 3 veces cada uno, con `gpt-6-luna`. Otra sesión de
Claude leyó a ciegas las 18 respuestas mezcladas:

| | Antes | Ahora |
|---|---|---|
| Buenas / mejorables / malas | 2 / 3 / 4 | 1 / 7 / 1 |
| Utilidad (1 a 5) | 3,22 | 3,89 |
| Elección | 2,89 | 3,11 |
| Veracidad | 4,22 | 4,89 |
| Claridad | 3,56 | 3,89 |
| Posición media (1 = mejor de 6) | 4,11 | 2,89 |
| Checks automáticos | 72 de 72 | 72 de 72 |

En la cuenta grande, las 3 respuestas nuevas quedaron por encima de las 3 actuales.

Queda pendiente, según el evaluador:

- entre muchos contactos iguales (20 jefes de RR. HH.), elige sin un criterio que lo diferencie;
- en las dos versiones, a veces descarta el seguimiento a quien lleva 6 días sin responder porque «podría haber contestado por
  fuera», aunque el usuario pidió priorizar seguimientos.

Sin migraciones ni flags.
