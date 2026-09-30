# «¿Qué toca hoy?»

Cowork responde «¿Qué toca hoy?», «¿qué tengo pendiente?» y «¿qué queda por hacer?» con **una sola lectura**, `agenda.today`, que trae la lista ya ordenada por valor comercial y ya contada. Antes la receta pedía tres lecturas (`contacted.search`, `replies.attention`, `campaigns.inbox`), el modelo contaba y ordenaba a mano, y ninguna calculaba cuántos seguimientos salen hoy ni qué interesados siguen sin respuesta.

Es solo lectura: no envía, no propone efectos por sí sola, no toca la base (sin migración) y no agrega flags ni secretos. Rige apenas se despliegue: la receta se lee en cada turno.

## Qué trae la lista

`agenda.today` no recibe entrada y es **lo tuyo**: tus envíos, tus campañas y tus aprobaciones. `contacted_leads` guarda cada envío a nombre de quien lo hizo y las acciones sobre un envío (clasificarlo, atender su respuesta) son de esa persona, así que las respuestas a los envíos de tus compañeros no aparecen aquí; siguen en `replies.attention` y `replies.stalled`, que son del equipo. Devuelve:

- **`items`**, ordenados (`rank` 1, 2, 3…), hasta 12. Cada uno trae su acción:

| Orden | `kind` | Qué es | `action` |
|---|---|---|---|
| 1 | `meeting_request` | Una empresa donde alguien **pidió reunión** y nadie respondió | `reply` |
| 2 | `interested_reply` | Una empresa con un interesado sin respuesta (menos de 14 días) | `reply` |
| 3 | `approval` | Propuestas de Cowork que esperan tu visto bueno, cada una en su hilo | `decide` |
| 4 | `unclassified_reply` | Respondieron y la app aún no sabe qué dijeron | `review_reply` |
| 5 | `campaign_step` | Pasos de campañas v2 que esperan (preparar, revisar, enviar, resolver) | `review_step` |
| 6 | `cooled_lead` | Interesados que llevan 14 días o más sin respuesta | `revive` |
| 7 | `linkedin_accepted` | Aceptaron tu invitación de LinkedIn y no recibieron mensaje | `message_linkedin` |
| 8 | `followups_due` | Por campaña: seguimientos que salen solos hoy, los que pasan a otro día y los que algo retiene | `let_run` |
| 9 | `bounce` | Rebotes de las últimas dos semanas con dirección por corregir | `fix_email` |

  Dentro de cada grupo va primero quien espera hace más; en los que se enfriaron, al revés: los más recientes son los que más probabilidad tienen de volver.
Un extracto de lo que lee el coordinador (el día completo del caso `agenda-toca-hoy`, armado con la función real):

```json
{ "scope": "own_agenda_today", "day": "2026-09-25", "weekday": "viernes",
  "counts": { "interestedAccounts": 3, "ofWhichMeetingRequests": 1, "cooledAccounts": 1, "unclassifiedReplies": 1, "autoReplies": 2,
              "approvals": 2, "followupsReady": 47, "followupsHeld": 3, "linkedinAccepted": 2, "bounces": 1 },
  "items": [
    { "rank": 1, "kind": "meeting_request", "action": "reply", "who": "Marcela Rojas", "company": "Servicios Norte", "people": 1, "daysWaiting": 4,
      "members": [ { "name": "Marcela Rojas", "daysWaiting": 4, "askedForMeeting": true, "contactedId": "…" } ] },
    { "rank": 6, "kind": "cooled_lead", "action": "revive", "who": "Iván Herrera", "company": "Servicios Integrales", "daysWaiting": 24 },
    { "rank": 8, "kind": "followups_due", "action": "let_run", "campaign": "Prospección construcción y RR. HH.", "ready": 47, "later": 0, "held": 3, "spacingMinutes": 30 }
  ],
  "sources": { "interested": "ok", "attention": "ok", "approvals": "ok", "campaignSteps": "none", "followups": "ok", "linkedin": "ok" }, "complete": true }
```

- **`counts`**, las cifras exactas (interesados, cuántos de ellos pidieron reunión, enfriados, sin clasificar, respuestas automáticas, aprobaciones, seguimientos que salen / pasan de día / retenidos, aceptaciones de LinkedIn, rebotes). El modelo no cuenta ni reordena. `ofWhichMeetingRequests` está **dentro** de `interestedAccounts` (el nombre lo dice porque en una primera prueba con el modelo real sumó la reunión pedida como una persona más y contó cuatro). **Un `null` significa que esa parte no se pudo leer y nunca es un cero:** con la fuente de seguimientos caída, el modelo repetía «0 seguimientos» cuando el conteo venía en 0.
- **`whenEmpty`**, solo cuando la lista está completa y vacía: qué leer a continuación (`leads.search` y `campaigns.list`) para proponer con datos. Va junto a los datos porque, con la receta sola, el modelo a veces ofrecía «¿reviso tus contactos?» en lugar de revisarlos. Una lista vacía con una fuente caída no lo trae: ahí corresponde decir qué no se pudo leer.
- **`sources`** y **`complete`**: qué fuentes se leyeron (`interested`, `attention`, `approvals`, `campaignSteps`, `followups`, `linkedin`). Si una falló o se cortó por un límite, la lista lo dice y el modelo no la presenta como completa.

### Reglas que fija el código

- **Una empresa cuenta una vez.** Se agrupa por dominio corporativo (o por el nombre de la empresa cuando escriben desde una casilla compartida como Gmail), con la misma clave que usa el envío (`companyKeysFor`). Si escribieron dos colegas, es una empresa, `people` dice cuántos y `members` trae, de cada persona (hasta tres, la que más espera primero), su nombre, cuánto lleva esperando, si fue ella quien pidió la reunión y su `contactedId`, la conversación que más lleva esperando, que es la que lee `replies.thread` para preparar su respuesta (docs/cowork-responder-en-hilo.md; no va en la respuesta al usuario). Una persona que aparece en varios envíos cuenta una vez, con la mayor espera y con la reunión si la pidió en alguno. Sin este dato por persona, el modelo real atribuía la reunión a los dos colegas cuando la pidió uno, y le ponía a uno la espera del otro.
- **Una respuesta de esta mañana ya es de hoy.** `replies.stalled` empieza a contar a las 48 horas; la agenda no espera (`selectStalledInterested(rows, now, 0)`). Descarta los que ya recibieron una respuesta nuestra y los que tienen un compromiso abierto.
- **Las respuestas automáticas son información.** Se cuentan aparte (`autoReplies`, solo las de los últimos 7 días) y nunca se suman a las respuestas ni generan un ítem.
- **Un rebote es noticia por dos semanas.** Los más antiguos son direcciones muertas que el motor ya evita. Una falla temporal (casilla llena, un error pasajero: `retry_later`) no pide corregir ninguna dirección, solo volver a intentar más tarde: se cuenta aparte en `softBounces` y no genera un ítem.
- **Un colega que escribió en las últimas dos semanas mantiene viva la cuenta,** aunque la primera persona haya escrito hace un mes.

## Los seguimientos de hoy

`campaigns.next_touch` calcula, por destinatario, si su siguiente toque puede salir y qué lo frena. La agenda usa **el mismo veredicto** (`nextTouchItems`, ahora compartido) sobre las campañas aprobadas del usuario (hasta 8) y lo reparte en:

| | |
|---|---|
| `ready` | sale hoy |
| `scheduledLater` | toca hoy, pero la regla de una empresa por día lo pone en otra fecha |
| `heldCompanyReplied` / `heldNegotiation` | alguien de la empresa ya respondió / la cuenta está en negociación o reunión |
| `historyIncomplete` | no se pudo comprobar (se retiene, nunca se cuenta como listo) |
| `retryWait`, `needsReconcile`, `terminal` | reintento pendiente, hay que conciliar, o no se reintenta |
| `waiting`, `done` | todavía no toca, o ya terminó |

El espaciado entre envíos de un lote programado (`spacingMinutes`) sí se informa. **El motor de lotes de Cowork no mira la hora del día** (solo el motor heredado de campañas y Suplia tienen su propia ventana), así que la receta le prohíbe al modelo inventar una. En AXIS, la IA anterior sugirió esperar al día siguiente para enviar 47 correos porque «eran las 17:40, fuera de la ventana de martes a jueves de 9 a 11», y el paquete lo cuenta como una falla.

Cómo se evita el costo: `campaigns.next_touch` revisa la etapa comercial de cada destinatario con dos o tres consultas (una campaña de 100 personas son entre 200 y 300). La agenda hace esa comprobación una sola vez para todos, con dos consultas (las cuentas en negociación o reunión y sus contactos), con la misma regla: mismo dominio corporativo o mismo nombre de empresa. Si no puede hacerla, deja al destinatario como «no comprobado» y lo retiene. Una prueba compara los conteos de la agenda con los veredictos de `campaigns.next_touch` sobre el mismo mundo.

## Las demás fuentes

- **Respuestas:** dos lecturas de `contacted_leads`, siempre con `user_id` de quien pregunta (interesados con sus respuestas más recientes, hasta 300, y las de atención: rebotes, sin clasificar, automáticas) y el estado del barrido del buzón. Si el buzón no está sincronizado por completo, `mailboxSynced` es `false` y la lista lo dice; nunca habla de «bandeja revisada».
- **Aprobaciones:** los trabajos en `waiting_approval` de esa persona, con sus ejemplos y cuánto lleva el más antiguo esperando. Solo cuenta propuestas; no decide nada.
- **Pasos de campañas v2:** `campaigns.inbox` sin los que aún no tocan o ya van saliendo.
- **LinkedIn:** quien **aceptó** una invitación enviada en los últimos 30 días (aparece en la red observada) y no tiene mensaje en cola ni enviado. Solo se afirma con la red sincronizada por completo; si no, `sources.linkedin` dice `sync_incomplete`, `linkedinAccepted` es `null` (no es cero) y la receta le pide al modelo no hablar de aceptaciones.

Cada fuente puede fallar sola: el resto de la lista se conserva, `sources` marca cuál no se pudo leer (`unavailable`) o se cortó (`partial`) y `complete` es `false`.

## Cómo la usa Cowork

La receta (`agent-instructions.ts`) pide: la tabla en `blocks`, como un bloque `table` (el usuario puede copiarla y exportarla; una tabla escrita con barras verticales dentro de la respuesta se ve como tabla, pero sin esas opciones) con el orden, quién o qué, qué pasó y qué hacer, una fila por ítem y hasta 8 filas (una empresa con varias personas es una sola fila), una frase con las cifras exactas, primero las personas que respondieron (con lo que espera y pidió cada una, sin mezclar lo de una con lo de otra), después lo que solo la persona puede decidir y lo que se enfrió, al final lo que sale solo y los rebotes; las respuestas automáticas aparte; cuántos seguimientos salen hoy, cuántos pasan de día y cuántos retiene una respuesta o una negociación; no inventar una ventana horaria; decir qué fuente no se pudo revisar; y cerrar con la pregunta del primer paso («¿Te preparo las respuestas a los 3 interesados?»). Con algo pendiente, `agenda.today` es la única lectura del turno. Sin nada pendiente (`items` vacío), dilo en una línea y lee entonces `leads.search` y `campaigns.list` en paralelo para proponer 2 o 3 acciones concretas con su dato, sin preguntarle si quiere que lo revises; el caso `pendientes-vacio` lo verifica.

## Cómo se prueba

- `src/lib/cowork/agenda.test.ts`: el orden, la agrupación por empresa, el punto exacto de los 14 días, los conteos, el corte a 12 ítems, `complete`.
- `src/lib/server/cowork/agenda-read.test.ts`: cada fuente por separado (aprobaciones, aceptaciones de LinkedIn) y cómo falla cada una sin tumbar la lista.
- `src/lib/server/cowork/batch-reads.test.ts`: el veredicto de los seguimientos contra `campaigns.next_touch`, la comprobación de negociación en una sola pasada y su falla cerrada.
- `src/lib/server/cowork/reply-reads.test.ts`: el interesado de esta mañana que `replies.stalled` todavía no ve.
- `scripts/cowork-agenda-corpus.test.ts`: tres casos del banco (`scripts/fixtures/cowork-agenda-corpus.ts`), con el mundo armado por la función real `buildCoworkAgenda`: un día completo (3 interesados, 47 seguimientos, 1 rebote, respuestas automáticas aparte, un lead enfriado), una fuente caída y dos colegas de una misma empresa. Cada uno tiene una respuesta buena que pasa todas sus verificaciones, un turno que no mira y uno que mira y no dice nada (ambos fallan al menos tres), y doce casos de «una respuesta buena con una sola cosa peor» que dicen qué verificación debe notarlo. El caso existente `pendientes-vacio` ahora lee `agenda.today`.

```bash
node --loader ./scripts/ts-test-loader.mjs --test \
  src/lib/cowork/agenda.test.ts src/lib/server/cowork/agenda-read.test.ts src/lib/server/cowork/batch-reads.test.ts \
  src/lib/server/cowork/reply-reads.test.ts scripts/cowork-agenda-corpus.test.ts scripts/cowork-conversation-corpus.test.ts
```

Con el modelo real (claves solo en el entorno; los scripts nunca leen `.env.local`):

```bash
node --loader ./scripts/ts-test-loader.mjs scripts/evaluate-cowork-conversations.ts \
  --live --stream --writer --max-calls=150 --repeat=3 --output=agenda.json \
  --cases=agenda-toca-hoy,agenda-fuente-caida,agenda-dos-personas-una-empresa,pendientes-vacio
```

## Límites

- **Sin medición con el modelo real todavía.** La cuenta de OpenAI de las mediciones está sin créditos. El orden de la lista es un criterio explícito y probado, no un resultado medido; se ajusta con el banco AXIS (D2 y G1) cuando haya línea base.
- **La aceptación de LinkedIn es una señal indirecta:** la persona figura en la red observada y hay una invitación confirmada. No distingue una conexión aceptada de una que ya existía y se observó después.
- **Los interesados son los 300 más recientes.** Con más, `sources.interested` queda en `partial` y la lista lo dice.
- **Solo lo tuyo.** Si una respuesta llegó a un envío de un compañero, no figura en tu lista aunque sea de la misma empresa; lo que sí se comparte es el freno: si alguien de la empresa respondió (a quien sea), tus seguimientos a esa empresa quedan retenidos y se cuentan como tales.
- **Son hasta 8 campañas aprobadas;** con más, `sources.followups` queda en `partial`.
- **Las respuestas automáticas se cuentan sobre las 10 más recientes** que devuelve `replies.attention`; es una cifra informativa, nunca trabajo pendiente.
- **Lo registrado en ANTON.IA.** Cada envío vuelve a comprobar los frenos de la empresa antes de salir: que un seguimiento figure como «sale hoy» no lo autoriza.
- **Fuera de esta PR:** responder dentro del hilo y aprobar en lote, y el tope de una empresa por día sumando correo y LinkedIn.
