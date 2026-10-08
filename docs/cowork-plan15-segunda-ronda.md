# Cowork, Plan 15, segunda ronda: tablas como tarjeta, recomendados que se pueden preparar (8 oct)

Después de integrar la primera ronda (#253), se corrió el banco completo de conversaciones (134 casos fuera del paquete AXIS) con
`gpt-6-luna` y los flags de producción: 115 pasaron. Tres fallas tenían una causa en el código, no en el modelo.

## 1. «¿A quiénes les ofrezco AXIS?» terminaba en error

`leads.recommend` entrega los contactos guardados que mejor calzan (`top`, con su `leadId`). Cuando Cowork proponía prepararlos o
investigarlos, el ciclo rechazaba la propuesta: para `contacts.prepare_batch`, `lead.enrich_batch` y las invitaciones o mensajes de
LinkedIn solo contaban como «vistos» los contactos de `leads.search`, `leads.get`, `prospecting.search` y las revisiones de lista, y
lo mismo pasaba en el servidor (`observedCoworkLeadIds`). Tras los reintentos, el turno terminaba con «No logré armar una respuesta
válida después de varios intentos».

Ahora `collectCoworkRecommendedLeadIds` (`src/lib/cowork/lead-export.ts`) lee los recomendados, y cuentan como vistos en el ciclo
(`effectTargetRun`), en el servidor (`observed-leads.ts`) y en el nombre de la tarjeta («Investigar contacto Valentina Fuentes
(Retail Andes)», en vez del identificador).

## 2. La tabla escrita en el texto

En «¿Qué toca hoy?» el modelo entregaba la tabla como tarjeta y, además, la escribía con barras verticales en el texto: todo dos
veces, y con «| --- |» crudo donde no se dibuja. `withTablesAsBlocks` (`src/lib/cowork/answer-quality.ts`), en el pulido final:
- si ya hay una tarjeta de tabla, quita la copia del texto;
- si no la hay, convierte la primera tabla del texto en la tarjeta (que se copia y se descarga en Excel o CSV);
- el código entre ``` no se toca.

## 3. «Por cierto» cuando el turno ya era la agenda

#253 quitaba el aviso «Por cierto» cuando nombraba a alguien que la respuesta ya había nombrado. En «¿Qué toca hoy?» también salía sin
nombre («Por cierto, todavía espera respuesta»). `coworkWithoutAgendaAside` (`agent-loop.ts`) lo quita siempre que el turno leyó
`agenda.today`: la respuesta ya es sobre lo pendiente de hoy.

## Medición

Los 19 casos que fallaron en el banco completo, dos corridas cada uno con este PR:

| Caso | Banco completo (main con #253) | Este PR |
|---|---|---|
| `icp-a-quien-ofrezco` (recomendados) | falla: el turno termina en error | 2 de 2 |
| `agenda-toca-hoy` (tabla en el texto) | falla | 2 de 2 |
| `chat-aviso-hoy` («Por cierto» sin nombre) | falla | 2 de 2 |
| Otros 16 | fallan | 10 pasan 1 o 2 veces; 6 fallan las dos |

Los 6 que fallan las dos veces (`lectura-cupo-pendientes`, `lectura-saldo-creditos`, `lectura-seguimiento-empresa`,
`lote-sin-perfil`, `mkt-busqueda-y-campana`, `web-lee-mi-sitio`) no tocan lo que cambia este PR; quedan para revisar uno por uno.

Sin migraciones ni flags nuevos.
