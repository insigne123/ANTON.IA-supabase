# Cowork dice bien cuánto cuesta una búsqueda (8 oct 2026)

## Problema

Al proponer una búsqueda de prospectos, Cowork decía «la búsqueda consume aproximadamente 1 crédito del proveedor». Una búsqueda
gasta una búsqueda del cupo diario y ningún crédito: los créditos se gastan después, al buscar el correo de cada persona
(`processCoworkSearchQueue` → `checkAndConsumeDailyQuota`, recurso `search`). La tarjeta de la búsqueda lo dice bien («usa 1 búsqueda
de tu cupo diario»), así que la respuesta contradecía la tarjeta.

La frase venía de la receta para buscar un perfil de LinkedIn por su URL, y el modelo la repetía en búsquedas normales. Lo marcó el
evaluador independiente en 2 de las 3 propuestas de búsqueda de una muestra de 26 casos.

## Cambio

`src/lib/cowork/agent-instructions.ts`:

- la búsqueda por perfil explica que usa una búsqueda del cupo diario, como cualquier búsqueda;
- la regla general de `prospecting.propose_search` agrega que no gasta créditos (se gastan después, al buscar el correo) y que se
  diga así, sin hablar de créditos del proveedor.

## Medición

`ur-retail-alto-cargo`, `inicio-prospectos` y `ur-oferta-app` con `gpt-6-luna`:

| | Dice «1 crédito del proveedor» | Dice que usa el cupo diario | Checks del caso |
|---|---|---|---|
| Antes (1 vez cada uno) | 2 de 3 | 1 de 3 | 3 de 3 casos |
| Después (3 veces cada uno) | 0 de 9 | 9 de 9 | 9 de 9 casos |

Sin migraciones ni flags.
