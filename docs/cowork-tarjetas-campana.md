# Tarjetas de Cowork: la campaña por su nombre y sin «(rev 1)» (8 oct 2026)

## Problema

Una lectura ciega de «¿Cómo me ha ido?» encontró tarjetas que decían «Aprobar y activar campaña 00000000-0000-4000-8000-000000000031».
Venía del texto que arma Cowork al proponer (`agent-loop.ts`), que usaba el ID de la campaña.

En producción, el worker reemplaza ese texto al preparar la tarjeta, así que el usuario veía el nombre, pero con la revisión interna
al final:

- «Aprobar y activar campaña «Campaña de prueba» (rev 1)»;
- «Enviar «asunto» desde ventas@yago.cl (rev 2)».

«rev» es un término interno: la revisión ya va en lo que se aprueba (el `targetId`, con la revisión y el hash de la campaña o del
borrador), no hace falta mostrarla.

## Cambio

- `src/lib/cowork/agent-loop.ts`: activar y pausar una campaña se proponen con el nombre que mostró `campaigns.list` («Aprobar y
  activar campaña «Campaña de prueba»»), igual que el worker. Sin nombre, sin ID («Aprobar y activar la campaña»).
- `src/lib/server/cowork/worker.ts`: las tarjetas de activar o pausar una campaña y de enviar un correo ya no muestran «(rev N)». Una
  campaña sin nombre dice «sin nombre», no su ID.
- Prueba nueva en `agent-loop.test.ts`.

Es un cambio de presentación: no cambia lo que se aprueba ni lo que hace el modelo.

Sin migraciones ni flags.
