# Cowork: «¿cómo voy?» ve a quién le escribiste aunque pida un período (8 oct 2026)

## Problema

Ante «¿cómo voy?», Cowork consulta los envíos con `contacted.search`. Esa consulta busca su texto en el nombre, el correo, la
empresa y el asunto de cada envío. En 3 de cada 5 corridas Cowork le pasaba un período («últimos 7 días», «last_7_days»). Ningún
envío tiene ese texto, así que volvía vacía.

Cowork daba bien las cifras, que salen de otra consulta («1 envío y 0 respuestas»), pero no sabía a quién le había escrito el
usuario. Entonces proponía «una campaña con un primer correo» para todos los contactos con correo, incluida la persona que ya lo
había recibido hace 6 días, en vez de proponer su seguimiento.

## Cambio

- **`src/lib/cowork/sent-period.ts`** (nuevo): reconoce un período en la consulta:
  - «últimos N días»;
  - «last_N_days»;
  - «esta semana» o «la última semana» (7 días);
  - «este mes» o «el último mes» (30 días);
  - «hoy».

  Quita del texto lo que sobra («en los», «envíos de»). Lo demás de la consulta sigue buscando como antes («Sodexo esta semana»).
- **`src/lib/server/cowork/extended-reads.ts`**: `contacted.search` filtra por fecha de envío cuando la consulta trae un período y
  devuelve `period {days, since}`. Sin período, la consulta no cambia.
- **`read-capabilities.ts`**: la descripción de `contacted.search` dice que acepta un período.
- **Bancos** (`cowork-marketing-corpus.ts`, `cowork-artifact-corpus.ts`): responden al período como el servidor.
- **Pruebas unitarias nuevas**: `sent-period.test.ts` y un caso en `extended-reads.test.ts`.

## Medición

«¿Cómo voy?» en la cuenta de 5 contactos con un envío, 5 veces con y 5 sin el cambio, con `gpt-6-luna`:

| | Antes | Ahora |
|---|---|---|
| Sabe a quién le escribió (Marcela, 19 sep) | 2 de 5 | 5 de 5 |
| Propone un primer correo que incluye a Marcela | 4 de 5 | 0 de 5 |
| Propone el seguimiento a Marcela | 1 de 5 | 5 de 5 |
| Consultas con un período escrito | 3 de 5 | 3 de 5 |
| De esas, sabe a quién le escribió | 0 de 3 | 3 de 3 |

Otra sesión de Claude leyó a ciegas las 10 respuestas mezcladas:

| | Antes | Ahora |
|---|---|---|
| Buenas / mejorables / malas | 1 / 3 / 1 | 2 / 3 / 0 |
| Veracidad (1 a 5) | 3,40 | 4,80 |
| Fricción (5 = ninguna) | 4,40 | 4,80 |
| Claridad | 3,80 | 4,00 |
| Posición media (1 = mejor de 10) | 7,00 | 4,00 |

Queda pendiente, según el evaluador: ninguna respuesta junta las dos mejoras, el seguimiento a quien ya recibió un correo y el
primer correo a los que aún no reciben nada.

Sin migraciones ni flags.
