# Campañas de Cowork: un correo por persona, saludo con el nombre y «pausada» en simple (1 oct)

**Problema (prueba del 1 oct, `Pruebas_de_app.docx`):**
- La campaña que armó Cowork llevaba un solo texto para todos y saludaba «Hola,», sin nombre. Las instrucciones exigían un saludo neutro para varias personas.
- La tarjeta mostraba los destinatarios como correos sueltos, sin el correo que recibiría cada uno.
- «Se crea pausada como borrador» no decía qué significa pausada.

## Qué cambia

1. **Saludo con el nombre de pila, siempre.**
   - En una campaña para varias personas, los correos abren con «Hola {{nombre}},». La campaña lo completa con el nombre de pila de cada una. También existen {{empresa}} y {{cargo}}, y ninguna otra variable.
   - El texto nunca se reescribe solo: puede ser la versión exacta del usuario, fijada en un turno anterior («Usar esta versión» y luego «créala»). En cambio, la tarjeta marca a cada persona cuyo saludo no lleva su nombre («Saludo sin su nombre») y dice cómo corregirlo.
   - **Nombre oculto:** {{nombre}} nunca escribe un nombre de pila oculto («Ra\*\*\*l»). Sin nombre de pila, la persona sale de la campaña antes de la tarjeta, y Cowork le dice al usuario que lo complete en Contactos. Esto se valida en `renderCampaignMessage` con `firstNameOf`, y vale también para la campaña manual.
   - **Redactora:** en textos para varias personas marca un nombre fijo o un «Hola,» sin nombre, y pide «Hola {{nombre}},».
2. **Un primer correo por persona** (`firstEmails` en `campaign.create`).
   - Si Cowork investigó a los destinatarios, o el usuario pide un correo distinto para cada uno, el primer correo de cada persona se escribe con lo útil de su investigación.
   - Se guarda como la versión propia de esa persona: `overrides` en el primer paso, el mismo campo de la campaña manual.
   - Los seguimientos siguen siendo la secuencia común, con variables.
   - **Antes de la tarjeta** se arma cada correo de cada persona con sus datos (`coworkCampaignRenderProblem`). Si falta un dato, la propuesta vuelve al modelo y no falla al crear la campaña.
3. **Tarjeta persona por persona** (`CampaignPeople`).
   - **Encabezado:** «Para: 3 personas · 1 necesita revisión» y el canal.
   - **Cada persona:** nombre, cargo y empresa, más una marca: «Escrito para esta persona», «Plantilla con su nombre» o, si el saludo no la nombra, «Saludo sin su nombre». Al abrirla se ve su primer correo tal como lo recibirá, ya con su nombre.
   - **Editar su correo:**
     - a mano;
     - o pidiéndole un cambio a la IA solo para esa persona. Se reutiliza el asistente de la campaña manual (`/api/campaigns/bulk/assist`, modo `message`). La propuesta se ve antes y solo se aplica con «Usar la propuesta».
     - Guardar cambia solo el primer correo de esa persona.
   - **Mientras se edita,** no se puede aprobar ni editar otra cosa.
   - **Debajo, la secuencia para todos:**
     - aviso: «{{nombre}}, {{empresa}} y {{cargo}} se completan con los datos de cada persona»;
     - cuando alguien tiene su propio correo 1, se dice que el de la secuencia va solo a quienes no lo tienen.
4. **«Pausada» en simple.**
   - El botón dice «Crear campaña sin enviar».
   - La nota: «Al aprobar, la campaña queda guardada sin enviar en Gmail: nada sale hasta que la actives, y activarla pide otra aprobación».
   - La misma idea aparece en la etiqueta de la propuesta, en lo que pasa al aprobar y en el estado «Campaña creada · guardada sin enviar».
   - Al activar o pausar, la tarjeta dice qué pasa con los envíos.

## Base de datos

**Migración `20261001235000_cowork_campaign_edit_people.sql`:**
- Reemplaza `cowork_edit_campaign_definition`, con las mismas guardas, bloqueos y evento.
- Además acepta cambios en `overrides`. Cada uno lleva `{email, messageIndex, subject, body}`, de un destinatario de la campaña y un correo que existe, sin duplicados y con texto.
- Siguen sin poder cambiar:
  - los destinatarios;
  - la cantidad de correos;
  - su espaciado;
  - el resto de la definición.
- La app anterior solo cambia la secuencia, y eso sigue permitido.

## Pruebas

- **Unitarias:**
  - `campaign-proposal.test.ts`: primeros correos válidos y solo las tres variables.
  - `campaign-people.test.ts`:
    - primer correo de cada persona;
    - saludo sin su nombre, señalado y nunca reescrito;
    - nombre oculto;
    - dato faltante;
    - persona fuera de la audiencia o bloqueada.
  - `campaign-edit.test.ts`: edición de una persona.
  - `bulk-campaigns.test.ts`: {{nombre}} nunca escribe un nombre oculto.
  - `writer.test.ts`: saludo con {{nombre}} en textos para varias personas.
  - `agent-loop.test.ts`: primeros correos, y la versión exacta del usuario intacta.
  - `scripts/cowork-conversation-corpus.test.ts`: la secuencia de la Redactora saluda con {{nombre}}.
- **`scripts/test-cowork-campaign-edit.mjs`:**
  - la edición de una persona es la misma llamada atómica;
  - el armado de la propuesta guarda cada primer correo y rechaza a alguien sin nombre de pila.
- **`scripts/test-cowork-campaign-people-ui.mjs` (DOM):**
  - la tarjeta con cada persona;
  - edición a mano y con IA;
  - aprobación retenida mientras se edita;
  - textos de «sin enviar»;
  - aviso de saludo sin su nombre.
- **`supabase/tests/database/cowork_campaign_edit.test.sql` (pgTAP), 7 casos nuevos:**
  - la edición de una persona;
  - quien no es destinatario;
  - un correo fuera de la secuencia;
  - duplicados;
  - un correo vacío;
  - destinatarios que no cambian.

## Pendiente (PR-6b)

- Remitente predeterminado (Cowork deja de preguntar Gmail u Outlook).
- La oferta en juego como `sellerProfile` de los borradores.
- El saludo con nombre de pila en los borradores individuales.
- Revisión de la campaña manual.
- Medición con el juez.
