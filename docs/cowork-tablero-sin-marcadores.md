# Cowork: el texto de un tablero no muestra marcadores internos (8 oct 2026)

## Problema

En una prueba del tablero del mes para el jefe, la Diseñadora escribió en el chat: «En septiembre se crearon {{dato calculado por el
tablero}} campañas». El marcador era para la página, pero llegó tal cual al usuario. La regla ya dice que el texto use solo cifras
de los datos; ningún chequeo lo impedía.

## Cambio

`src/lib/server/cowork/designer.ts`: `coworkDesignerReply` quita del texto del chat la oración que tenga un marcador `{{…}}` y
conserva el resto. Si no queda nada, dice «El tablero está listo al lado del chat.». El texto de la Diseñadora no se transmite en
vivo, así que el usuario nunca ve la versión con el marcador. Prueba unitaria en `designer.test.ts`.

## Lo que se probó y no quedó

Una regla para que el texto no presente totales de la cuenta como cifras del período («este mes se crearon 19 campañas» cuando 19
es el total). Tableros del mes y del pipeline, 4 veces cada uno, con lectura ciega de otra sesión de Claude (16 respuestas). El
resultado fue mixto: la regla sacó la mejor respuesta de los dos casos, pero la posición media fue peor (4,75 contra 4,25) y una
corrida siguió atribuyendo las 19 campañas al mes. No se integra.

Sin migraciones ni flags.
