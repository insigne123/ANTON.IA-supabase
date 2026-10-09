# Cowork: «¿cómo voy?» dice que ninguna campaña está enviando (9 oct 2026)

## Problema

Con 0 envíos y 19 campañas (14 en borrador y 5 pausadas), Cowork daba las cifras y proponía «probar un mensaje», pero no decía la
razón: ninguna campaña estaba activa. Una lectura ciega lo marcó como lo más importante que faltaba.

## Cambio

`src/lib/cowork/agent-instructions.ts`, receta «¿Cómo voy?»: si `campaigns.list` trae campañas pero ninguna activa, Cowork lo dice
con las cifras de `byStatus` («19 campañas, 14 en borrador y 5 pausadas: ninguna está enviando»), porque explica los 0 envíos.

## Medición

«¿Cómo me ha ido esta semana?» en la cuenta de 19 campañas, 5 veces por lado, con `gpt-6-luna`:

| | Antes | Ahora |
|---|---|---|
| Dice que ninguna campaña está enviando | 0 de 5 | 4 de 5 |
| Recomienda un siguiente paso | 5 de 5 | 5 de 5 |

El check automático «recomienda algo concreto» busca palabras como «conviene» o «propongo» y falla en 3 de las respuestas nuevas, que
recomiendan con otras palabras («partiría revisando… y decidir si activarla»). Muestra pequeña; sin lectura ciega.

Sin migraciones ni flags.
