# Campañas: un correo escrito para cada persona (17 nov 2026)

## Problema

Una campaña era un texto con `{{nombre}}`, `{{empresa}}` y `{{cargo}}`: cien personas leían el mismo correo con otro nombre. El dueño,
después de que los contactos recomendados tuvieran su propia redactora: «ese sistema sigue generando mails genéricos, que es justamente
lo que no quiero; quiero que cada correo sea personalizado y distinto, que se haga de cero».

## Qué cambia

- **Los correos de la campaña pasan a ser la base.** En el paso «Correos» la persona dice qué quiere conseguir y deja (o genera con IA)
  una secuencia. Eso ya no es lo que se envía: es la guía de qué se ofrece, qué se pide y en qué tono.
- **Al guardar, se escribe la secuencia completa de cada destinatario** (botón «Escribir un correo para cada persona»). Para cada uno
  la redactora lee lo que hay guardado de él (cargo, empresa y qué hace, rubro, tamaño, ciudad, cómo se presenta en LinkedIn y los
  extractos de la investigación que el usuario haya corrido), el perfil de quien vende y la campaña. Es la misma redactora de los
  contactos recomendados (`src/lib/server/lead-drop-writer.ts`), con la cantidad de correos y los días de la campaña.
- **Se ve cómo avanza.** «Escribiendo un correo para cada persona… 12 de 40», con barra, tiempo estimado y «Detener». Lo ya escrito se
  guarda aunque se detenga.
- **La revisión muestra a cada persona con sus correos.** Quien no pudo escribirse queda con la base, marcado «Texto base», y un aviso
  ofrece «Escribir sus correos». Cada correo sigue pudiéndose editar a mano.
- **Si la base cambia, se vuelve a escribir solo lo que cambió.** Cambiar los días no reescribe nada; cambiar un correo de la base o el
  objetivo, sí. En una campaña aprobada (editar pendientes) solo cambia el paso editado.
- **Salida explícita.** «Enviar este mismo texto a todos, sin escribir uno para cada persona» deja la campaña como antes (un aviso
  interno, una invitación idéntica).

Nada cambia en la aprobación ni en el envío: cada correo escrito se guarda como una edición de esa persona (`overrides`), que la campaña
ya tenía para los correos corregidos a mano. El tope sube de 500 a 700 (100 personas × 7 correos).

## Cómo escribe

Las reglas son las de los contactos recomendados (parte de algo cierto de su empresa o de su cargo, un servicio concreto, una prueba
usada una sola vez, una petición que se contesta en una línea) más una regla de campaña: de la guía se toma qué se ofrece, qué se pide y
el tono; no se copian sus frases, su orden ni sus asuntos. Lo que la campaña pide manda (una invitación sigue siendo una invitación) y
un dato que la guía afirma se dice tal como viene. Con «Contactados anteriormente» no se finge un primer contacto.

Los papeles de la secuencia salen de cuántos correos tiene: primero, cortos que agregan una cosa, otro ángulo con llamada y, desde tres
correos, un cierre. Las comprobaciones propias leen el resultado y corrigen una vez; en campaña además avisan cuando un asunto es el de
la guía con el nombre de la empresa o cuando un correo repite sus frases.

Los correos se guardan sin despedida (la casilla firma al enviar), con el nombre de pila ya puesto y sin variables.

## Medición (17 nov 2026, 12 contactos reales guardados, modelo permitido Haiku)

| | Texto único (antes) | Un correo por persona |
| --- | --- | --- |
| Asuntos distintos del primer correo | 1 de 12 (el mismo con otra empresa) | 12 de 12 |
| Parecido entre los primeros correos de dos personas (tríos de palabras en común) | el mismo texto, salvo nombre y empresa | promedio 0,15, máximo 0,35 |
| Parecido con la base | es la base | máximo 0,12 |
| Tiempo | 0 | 17 a 60 s por persona, 12 a la vez en 60 s |
| Llamadas al modelo | 0 | 17 para 12 personas (5 correcciones) |
| Costo | 0 | unos USD 0,004 por persona (cuatro correos) |

Con poco dato guardado (cargo, empresa y una línea de qué hace) los correos cambian en el servicio elegido para el cargo, la prueba y
el asunto, pero comparten la forma de abrir («Te escribo porque…»). Con investigación guardada tienen más de dónde partir.

## Topes

- 5 personas por solicitud (`POST /api/campaigns/bulk/personalize`), 3 solicitudes a la vez desde la página; 100 personas, unos 5 minutos.
- 600 personas al día por usuario (`BULK_AI_PERSONAL_DAILY_LIMIT`), contadas aparte de las ayudas de IA de campañas
  (`bulk_ai_personal_usage`, `consume_bulk_ai_personal_v1`). Al llegar al tope se dice y quedan con la base.
- La ruta no decide quién puede recibir la campaña: guardar vuelve a comprobar a cada destinatario.

## Código

- `src/lib/bulk-campaign-personal.ts`: qué falta por escribir, qué se conserva cuando cambia la base, los grupos y el recorrido que hace la página.
- `src/lib/server/campaign-personal.ts`: los datos de cada destinatario y la llamada a la redactora.
- `src/lib/server/lead-drop-writer.ts`: `SequencePlan`, `sequenceRoles`, `sequenceRules`, `writeSequence`.
- `src/lib/server/lead-drop-seller.ts`: quién vende, para recomendados y campañas.
- `src/app/api/campaigns/bulk/personalize/route.ts`, `src/lib/server/bulk-ai-budget.ts`, `supabase/migrations/20261117120000_bulk_ai_personal_usage.sql`.
- `src/components/campaigns/BulkCampaignWorkspace.tsx`, `CampaignSequenceEditor.tsx`, `CampaignPreview.tsx`.

## Pruebas

- `src/lib/bulk-campaign-personal.test.ts`, `src/lib/server/campaign-personal.test.ts`, `src/lib/server/lead-drop-writer.test.ts`.
- Recorridos visuales `campanas-nueva-personal` y `campanas-nueva-personal-telefono` (`scripts/visual-audit/journeys/campanas.mjs`).

## En Cowork

Las campañas que Cowork arma en el chat siguen la misma regla, antes de aprobar:

- **La tarjeta escribe sola.** Al abrirse una propuesta para varias personas, la tarjeta pide los correos de cada una al mismo servicio
  (`/api/campaigns/bulk/personalize`): «Escribiendo un correo para cada persona… 3 de 8», con «Detener». «Crear campaña sin enviar»
  espera a que termine.
- **La campaña que propuso Cowork es la guía.** Quien ya tenía un primer correo propio (Cowork lo escribió con su investigación, o la
  persona lo editó) lo conserva: sus seguimientos se escriben a partir de ese correo.
- **Cada persona muestra lo que recibe**: su primer correo y, debajo, «Sus N seguimientos, escritos para esta persona».
- **La secuencia pasa a ser la base** cuando todos tienen sus correos: se lee, no se edita y no se envía a nadie. Mientras alguien quede
  con los correos comunes, la secuencia sigue editable y la tarjeta ofrece «Escribir sus correos».
- **Para una sola persona no cambia nada**: Cowork ya le escribe a ella (la campaña se guarda con `personalize: false`).
- Se guardan con las mismas garantías de cualquier edición de la propuesta (`cowork_edit_campaign_definition`: solo mientras está
  pendiente y sobre la versión vista) y dejan su propio evento (`proposal.personalized`), así «editada por ti» cuenta solo lo que
  editó la persona.

No se escriben dentro del turno del asistente: ese turno tiene 105 segundos para todo y la escritura de 25 personas puede tomar uno.

Código: `src/components/cowork/CampaignPeople.tsx`, `CampaignReview.tsx`, `src/lib/cowork/campaign-edit.ts`
(`coworkPersonalCampaignDefinition`), `src/lib/cowork/campaign-people.ts` (`written`, `rest`),
`src/lib/server/cowork/campaign-ops.ts` (`saveCoworkCampaignPersonal`), `src/app/api/cowork/runs/[id]/campaign-preview/route.ts`.
Pruebas: `campaign-edit.test.ts`, `campaign-people.test.ts`, `campaign-ops.test.ts`, `scripts/test-cowork-campaign-personal-ui.mjs`.

## Pendiente

- No se investiga a cada destinatario al escribir: se usa lo guardado. Investigar a cien personas es otro costo y otro tiempo.
- Una propuesta de Cowork que se aprueba desde fuera de la tarjeta (modo Autónomo) se crea con los correos comunes. Al abrirla en
  Campañas se ofrece escribirlos, y la tarjeta de «Aprobar y activar» de Cowork avisa cuántas personas recibirían el mismo texto, con
  el enlace a la campaña. Avisa y no bloquea.
