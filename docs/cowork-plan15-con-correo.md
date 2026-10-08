# Cowork: «una campaña para mis contactos con correo» llega a todos (Plan 15, 8 oct)

## Problema

`leads.search` devuelve los 20 contactos más recientes (o los que calzan con las palabras buscadas) y no podía filtrar por correo.
Con 256 contactos y 21 con correo, la búsqueda sin palabras traía 20 contactos de los que solo uno tenía correo; como una campaña de
Cowork solo puede ir a personas que vio (`campaign.create`, hasta 25 correos observados), «escribe un correo para mis contactos que
tienen correo y arma la campaña pausada» terminaba en una campaña para una persona. Es justo lo primero que Cowork recomienda
(«parte por los que ya tienen correo»).

`campaigns.list`, por su parte, lista las 20 campañas más recientes sin decir si hay más: con 34, Cowork diría «tienes 20 campañas».

## Qué cambia

- `src/lib/server/cowork/lead-tools.ts`: «con correo» en la búsqueda (sola o con otras palabras, «con correo recursos humanos») deja
  solo a quienes tienen correo, hasta 25 (lo que admite una campaña), y lo marca con `withEmailOnly`. Las demás búsquedas no cambian.
- `src/lib/server/cowork/extended-reads.ts`: `campaigns.list` trae `returned`, `total` (conteo exacto) y `truncated`.
- Instrucciones: la descripción de `leads.search` y la receta «Mándale un correo a [persona o grupo]» nombran «con correo».
- Banco de conversaciones, más fiel a producción:
  - sin palabras, `leads.search` dice que hay más (`truncated`) cuando la cuenta tiene 256;
  - `campaigns.list` dice que son 19 en total, como el estado de la cuenta;
  - «con correo» devuelve los 21 contactos con correo, también en los mundos de marketing y artefactos;
  - una campaña puede ir a cualquiera de los 21 (`CORPUS_SAVED_EMAILS`), y `cmp-correo-y-campana` pide que vaya a ellos, no a uno.

## Medición (`gpt-6-luna`, flags de producción, mismo banco en las dos versiones)

| | main | este PR |
|---|---|---|
| `cmp-correo-y-campana`: destinatarios de la campaña (2 corridas) | 1 · 1 | 21 · 21 |
| Casos `mkt-*`, `inicio-*`, `cmp-*` (20) | 18/20 · 189/191 checks | 20/20 · 191/191 checks |

Se probó también una regla en el estado de la cuenta para no confundir el largo de una lista con el total: con el juez no cambió
nada (veracidad 3,75 en las dos versiones sobre 8 casos), así que no se incluye. Lo que sí resolvió el caso de la campaña fue poder
pedir los contactos con correo.

Sin migraciones ni flags.
