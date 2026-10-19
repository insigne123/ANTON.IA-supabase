# «Para retomar»: a quién volver a escribir, y por qué ahora

**Fecha:** 19 de octubre de 2026. **Propuesta 7** de la comparación con otras apps: alertas para retomar conversaciones (Apollo, HubSpot).

## Por qué

Una conversación que terminó sin acuerdo, o que la persona dejó en silencio, se olvida. Meses después las prioridades cambian, pero nadie se acuerda de volver a escribir. «Para retomar» trae a esas personas a «Hoy», con el motivo y un correo nuevo listo para revisar.

## Qué ve la persona

Una tarjeta en «Hoy», debajo de «Llamadas y LinkedIn». Solo aparece cuando hay alguien.

- **Cada fila:** el nombre, la empresa y el motivo en una línea, por ejemplo:
  - «Cerraste sin acuerdo hace 64 días».
  - «Transportes Cordillera está contratando: “Analista de reclutamiento”. Hablaron hace 35 días».
- **«Retomar»:** la IA prepara un correo con un ángulo distinto al anterior y lo abre en «Redactar» para revisarlo. No envía nada.
  - Si la persona no está investigada, pide investigarla primero: el ángulo nuevo sale de esa investigación.
- **«…»:** «Posponer 30 días» o «No retomar», con «Deshacer».
- **«Avisarme después de»:** 30, 60 o 90 días, o nunca. La misma opción está en «Firmas y estilo» → «Agenda».

## Quién aparece

Por cada correo cuenta solo la conversación más reciente: una antigua cerrada «Sin acuerdo» no trae de vuelta a quien respondió la semana pasada.

| Motivo | Cuándo |
|---|---|
| Señal | Su empresa está contratando, publicó una licitación, una Compra Ágil o un proyecto (en «Oportunidades», últimos 30 días) y hablaron hace 14 días o más |
| Cerrada sin acuerdo | Al cerrarla elegiste «Sin acuerdo», y pasaron los días elegidos (60 por defecto) |
| «Lo retomo yo» | Al cerrarla elegiste «Lo retomo yo», y pasaron los días elegidos |
| Se enfrió | Te respondió, le contestaste y no volvió a escribir en 45 días |
| No respondió | Le escribiste hace 45 días o más y nunca respondió |

**Nunca aparece:**

- quien cerraste como «No interesado» o «Ganado»;
- quien pidió no recibir más correos o respondió que no;
- un correo que rebotó o una dirección sin correo;
- quien te respondió y espera tu respuesta: esa persona está en «Lo que te espera».

## Cómo funciona

- **Reglas puras:** `src/lib/reconnect.ts`.
  - `buildReconnectAlerts`: quién aparece y por qué.
  - `reconnectInstruction`: lo que se le dice a la redactora. Correo breve, sin «solo quería hacer seguimiento», con una sola pregunta.
- **Servidor:** `src/lib/server/reconnect.ts`.
  - Lee las conversaciones propias, las marcas, las señales de «Oportunidades» y la preferencia guardada en `profiles.signatures.reconnect`.
- **Rutas:**
  - `GET /api/reconnect`: las alertas.
  - `POST /api/reconnect`: posponer, descartar, deshacer y la preferencia de días.
  - `POST /api/reconnect/[contactedId]/draft`: «Retomar». Prepara el borrador con la misma redactora de «Redactar» y su revisión.
- **Migración `20261019110000_contact_reconnect.sql`:**
  - `contacted_leads.conversation_close_outcome`: cómo se cerró (`no_deal`, `won`, `not_interested`, `keep`).
    - Lo escribe `closeContactedConversation` junto a la fecha de cierre.
    - Antes de la migración se guarda solo la fecha.
  - `contact_reconnect_marks`: lo pospuesto o descartado por persona. RLS activa y solo `service_role`.
  - Sin la tabla, la tarjeta funciona sin «…».

## Pruebas

- `src/lib/reconnect.test.ts`: cada motivo, los que nunca vuelven, la conversación más reciente por correo, las señales y la instrucción.
- `src/lib/server/reconnect.test.ts`: lectura por organización y persona, marcas, preferencia y borrador.
- `src/lib/server/conversation-close.test.ts`: el cierre guarda cómo terminó.
