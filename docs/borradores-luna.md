# Borradores de cuentas prioridad A con luna (8 oct 2026)

## Antes

Los borradores de cuentas bien investigadas (prioridad A, puntaje de investigación ≥ 72) se escribían con `OPENAI_REASONING_MODEL`,
`gpt-6-sol` en `apphosting.yaml`. Cada uno costaba unas 15 veces más que con luna (~$0,03 contra ~$0,002). El dueño pidió usar luna
para todo y subir el esfuerzo de razonamiento donde haga falta.

## Ahora

- `apphosting.yaml`: `OPENAI_REASONING_MODEL=gpt-6-luna`. En el código, el valor por defecto también pasa a luna.
- `draftReasoningEffort` (`src/ai/flows/generate-outreach-from-report.ts`): en cuentas prioridad A, la escritura y la revisión editorial
  usan esfuerzo **medio**. Las reescrituras y las demás cuentas siguen con el esfuerzo por defecto (bajo).
- `OPENAI_DRAFT_PRIORITY_EFFORT` y `OPENAI_DRAFT_PRIORITY_EDIT_EFFORT` (`low`, `medium` o `high`) lo cambian sin redeploy de código.

## Medición

ServiPro (25 correos por corrida, todas cuentas prioridad A), 2 corridas por opción. Las calificaron a ciegas otras sesiones de Claude,
sin saber qué modelo ni qué esfuerzo produjo cada correo.

Primera ronda, 8 versiones por caso (34 correos por opción):

| | Posición media (1 = mejor de 8) | Veracidad | Lo enviaría / no |
|---|---|---|---|
| sol | 3,97 | 4,79 | 9 / 13 |
| luna, esfuerzo bajo | 5,26 | 4,97 | 7 / 13 |
| luna, esfuerzo alto | 4,00 | 4,97 | 11 / 11 |
| luna, dos versiones y una tercera llamada que elige | 4,76 | 4,97 | 9 / 12 |

Segunda ronda, para bajar la espera:

| | Posición media (1 = mejor de 8) | Veracidad | Con un hecho sin respaldo | Lo enviaría / no | Segundos por correo | Costo cada 25 correos |
|---|---|---|---|---|---|---|
| sol | 4,50 | 4,71 | 5 de 34 | 15 / 8 | ~14 | ~$0,75 |
| luna, esfuerzo alto | 4,38 | 4,97 | 1 de 34 | 14 / 6 | ~74 | $0,11 |
| **luna, esfuerzo medio** | **4,35** | 4,88 | 3 de 34 | 12 / 6 | **~34** | **$0,07** |
| luna, alto solo al escribir | 4,76 | 4,97 | 1 de 34 | 11 / 6 | ~49 | $0,08 |

Con esfuerzo medio, luna escribe tan bien como sol, con menos hechos sin respaldo. Cuesta unas 11 veces menos. A cambio, cada
borrador de estas cuentas tarda unos 34 s en vez de 14 s.

## Rollback

`OPENAI_REASONING_MODEL=gpt-6-sol` en `apphosting.yaml` vuelve a sol: el esfuerzo medio aplica igual. Para volver al esfuerzo bajo:
`OPENAI_DRAFT_PRIORITY_EFFORT=low` y `OPENAI_DRAFT_PRIORITY_EDIT_EFFORT=low`.

Sin migraciones.
