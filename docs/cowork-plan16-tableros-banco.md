# Plan 16: los tableros del banco leen la cuenta completa, como producción (8 oct)

## Problema

En producción, la diseñadora de tableros recibe todos los contactos guardados (hasta 2.000) y todas las campañas (hasta 200)
desde la base (`src/lib/server/cowork/artifact-data.ts`). En el banco, `corpusArtifactData` le daba solo lo que los mundos detallan:
4 contactos de una cuenta de 256 y 1 campaña de 19. Los tableros decían «4 contactos» y «1 campaña», y el juez lo contaba como dato
falso (`art-prospectos-filtro`, `art-tablero-campanas`, `art-segmentos`, `ur-tablero-mes` en el banco completo del Plan 15). Así no
se podía medir la calidad de los tableros.

## Qué cambia

`corpusAccountRows` (`scripts/fixtures/cowork-conversation-runner.ts`) completa la cuenta antes de armar las tablas:

- **Contactos:** los que el mundo detalla van primero y tal cual. El resto, hasta `app.context` (`counts.leads`), es «Contacto N» de
  «Empresa N», con tantos correos como dice `audience.analyze` y sus rubros.
- **Campañas:** las de `campaigns.list` y el resto hasta su `total`, con estados y destinatarios variados.

Los datos de relleno son inventados, pero salen iguales en cada corrida. El juez los recibe como datos consultados
(`artifact.data`), igual que antes.

Solo cambia el banco de pruebas: la app no cambia.

## Verificación

- `scripts/cowork-conversation-corpus.test.ts`: 256 contactos (21 con correo, 37 de retail), 19 campañas, pipeline de 256 e iguales
  en cada corrida.
- No se volvió a correr el juez: la cuenta de OpenAI de las pruebas está sin créditos. Lo siguiente, con saldo, es correr los casos
  `art-*` y `ur-tablero-mes` y ver si desaparece la queja «4 de 256».

Sin migraciones ni flags.
