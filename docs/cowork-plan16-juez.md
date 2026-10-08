# Plan 16: el juez de Cowork lee las tarjetas como el usuario (8 oct)

## Problema

En el banco de conversaciones de Cowork, el juez (`scripts/judge-cowork-conversations.ts`) leía la tarjeta de aprobación como datos
crudos, no como la ve el usuario:

- la búsqueda de prospectos llegaba en JSON (`rolePolicy`, `companies_first`), y el juez la marcaba como ilegible, aunque
  `CoworkApproval.tsx` la muestra en palabras;
- las tarjetas que gastan créditos llegaban sin su costo, así que «la tarjeta indica el costo» parecía falso, aunque
  `EnrichBatchReview`, `PrepareBatchReview` y `PhoneRevealReview` lo muestran;
- la campaña llegaba como objeto JSON;
- el juez no sabía que revelar un teléfono cuesta 10 créditos, ni que sin remitente elegido la campaña sale por Gmail y se cambia en
  Conexiones (la regla que siguen las instrucciones).

Cada una de esas quejas bajaba la veracidad sin que hubiera un error en la app.

## Qué cambia

- `corpusSearchText` (`scripts/fixtures/cowork-conversation-runner.ts`): la búsqueda con los mismos campos y textos de la tarjeta.
- `corpusCostText`: el costo de buscar correos, preparar contactos y revelar teléfonos, como cada tarjeta lo dice. El resultado del
  banco guarda cuántas personas lleva cada lote.
- La campaña se le pasa al juez como texto: nombre, objetivo, destinatarios y correos.
- `judge.ts`: hechos del producto nuevos (correo 1 crédito, teléfono 10; las tarjetas muestran su costo; sin remitente, Gmail y
  Conexiones). Las mismas reglas usa el juez dentro del turno, y son ciertas.

Solo cambia la medición. Lo que ve el usuario no cambia.

## Medición

Se corrieron 8 casos con `gpt-6-luna`. Las mismas respuestas se juzgaron con el juez de `main` y con este (`gpt-6.1-sol`):

| | juez de main | este juez |
|---|---|---|
| buenas | 2 | 6 |
| mejorables | 5 (Gmail sin respaldo ×3, costo no visible, teléfono a 10 sin respaldo) | 1 (ofrece una consulta que podía hacer) |
| malas | 1 (`telefono-varias-personas`) | 1 (el mismo: propone de a una persona) |

Con la tarjeta en palabras, el juez encontró un defecto real: un cargo que la búsqueda corta («… / Gerente de S»). Se arregla en otro
PR.
