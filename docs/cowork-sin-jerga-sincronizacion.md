# Cowork sin jerga de sincronización del correo (8 oct 2026)

## Problema

Una lectura ciega de 26 casos de uso real encontró que el problema más frecuente era la jerga técnica sobre el correo. Apareció en
10 de 26 respuestas:

- «la sincronización del buzón no está confirmada, así que no puedo asegurar que siga pendiente»;
- «el correo no está confirmado como sincronizado, así que esto refleja lo registrado en ANTON.IA»;
- «registra o sincroniza los envíos en ANTON.IA».

Esas advertencias no cambiaban la decisión y a veces la empeoraban: una respuesta descartó un seguimiento que el usuario pidió.

Vienen de los datos que lee Cowork: `mailboxCoverageComplete: false`, `mailbox_coverage_unverified` y `needs_verification` en los
registros de contactos. La regla general («una limitación solo si cambia la conclusión») no bastaba.

## Cambio

En `src/lib/cowork/agent-instructions.ts`, regla 3:

- la sincronización del correo es un detalle técnico y no se nombra;
- Cowork recomienda igual con lo registrado;
- solo si una respuesta recibida fuera de ANTON.IA cambiaría lo que recomienda (un seguimiento, por ejemplo), lo dice una vez y en
  simple: «si te respondió por fuera de ANTON.IA, avísame y lo ajusto».

La sincronización de LinkedIn no cambia: su receta ya dice cómo resolverla («abre LinkedIn con la extensión»).

## Medición

8 casos donde aparecía (¿cómo voy?, ¿a quién le escribo?, correos a contactos sin contactar, seguimiento, LinkedIn), 2 veces cada
uno, con `gpt-6-luna`.

| | Antes | Ahora |
|---|---|---|
| Respuestas con jerga de sincronización del correo | 5 de 16 | 0 de 16 |
| Checks automáticos | 142 de 146 | 144 de 146 |

Otra sesión de Claude leyó a ciegas las 32 respuestas mezcladas:

| | Antes | Ahora |
|---|---|---|
| Buenas / mejorables / malas | 10 / 5 / 1 | 12 / 4 / 0 |
| Utilidad (1 a 5) | 3,94 | 4,19 |
| Fricción (5 = ninguna) | 4,06 | 4,38 |
| Veracidad | 4,56 | 4,75 |
| Claridad | 3,81 | 3,75 |
| Posición media (1 = mejor de 4) | 2,81 | 2,19 |
| Mejor respuesta del caso | 3 de 8 | 5 de 8 |

Queda pendiente, según el evaluador:

- otras palabras internas: «proveedor», «enriquecer», «punto de prueba», «lo que cargaste en tu Perfil»;
- concluir sobre los primeros contactos que devuelve una búsqueda («los 4 contactos guardados») cuando la cuenta tiene 256.

Sin migraciones ni flags.
