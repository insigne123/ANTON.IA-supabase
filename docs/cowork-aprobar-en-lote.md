# Aprobar en lote: varias personas de LinkedIn con una sola decisión

Antes, invitar o escribir por LinkedIn a 20 personas eran 20 tarjetas de aprobación. Con `COWORK_LINKEDIN_BATCH_ENABLED=true`, Cowork propone **un lote**: una tarjeta que lista a todas las personas (en los mensajes, con el texto de cada una), dice quién **no sale hoy y por qué**, deja **quitar a quien no quieras** antes de aprobar y, una vez ejecutado, cuenta **persona por persona** qué quedó en cola y qué no salió.

Es un lote de **trabajos en cola**, no de envíos: cada trabajo lo ejecuta tu extensión, en tu navegador, ante el perfil verificado. **Apagado por defecto**: sin el flag, Cowork sigue proponiendo una persona por vez con `linkedin.invite` y `linkedin.message`.

## Las dos acciones

| Acción | Qué propone | Límite |
|---|---|---|
| `linkedin.invite_batch` con `linkedinBatch {leads: [{leadId}]}` | Invitaciones **sin nota**. | 25 personas |
| `linkedin.message_batch` con `linkedinBatch {leads: [{leadId, message}]}` | Un mensaje **distinto para cada persona**, con sus datos y firmado con el nombre real de quien escribe. | 15 personas, 1.200 caracteres cada uno |

- Los `leadId` son de **contactos guardados que ya se consultaron en esta conversación** (`leads.search`, `leads.get` o una revisión de lista), de este turno o del que los leyó. El perfil de LinkedIn es el del contacto guardado: el modelo no puede ponerle otra URL.
- **El perfil viene de la lectura.** `leads.search` y `leads.get` devuelven `linkedin_url` de cada contacto guardado: la dirección canónica del perfil (`https://www.linkedin.com/in/…`) o `null` si no tiene uno válido (una página de empresa o un dato mal escrito no cuentan y nunca se pasan tal cual). Cowork solo propone a quien lo trae; a los demás los menciona aparte («sin perfil guardado») y ofrece el correo. El servidor vuelve a comprobarlo al preparar la propuesta.
- Cada persona va una sola vez; una invitación no lleva texto; cada mensaje lleva el suyo. Si no, el bucle lo rechaza con el motivo antes de llegar a una tarjeta.
- Para **una sola persona** se sigue usando la acción individual.
- Antes de invitar, Cowork consulta `linkedin.quota`: con el cupo cubierto no se propone.

## Cómo funciona

1. **Proponer.** El bucle acepta la acción solo con el flag encendido y con una consulta de contactos en el hilo; si no, la rechaza con la salida (proponer de a una persona). El modelo **no dice cuántas salen**: lo fija el servidor y lo muestra la tarjeta.
2. **Preparar.** `stageCoworkLinkedinBatch` comprueba a cada persona con **los mismos frenos de una acción individual**: perfil válido y nombre que coincide con el perfil, que no tenga ya un trabajo registrado, y en los mensajes que la empresa no haya respondido, que la cuenta no esté en negociación y una acción por perfil al día. Después planifica el día (`planLinkedinBatch`):
   - **Una empresa por día, sumando correo y LinkedIn.** Sale la primera persona de cada empresa, en el orden de la lista; las demás quedan para otro día. Una empresa con un correo enviado hoy o un trabajo de LinkedIn de hoy (cada trabajo guarda su `company_key`) también espera. La empresa se reconoce como en los envíos por correo: por dominio corporativo y por nombre, y el correo gratuito (Gmail, Outlook…) no identifica a nadie.
   - **Cupo semanal** de invitaciones: entran hasta lo que queda de las 100 semanales, contando pendientes y enviadas.
   - A **nadie se le descarta en silencio**: quien no sale hoy queda aparte, con su motivo: puede esperar (la empresa ya tuvo un envío, el cupo semanal) o no poder salir (sin perfil de LinkedIn, la empresa respondió, hay una negociación). Si nadie puede salir, no hay tarjeta: Cowork dice por qué.
   - La lista, con su hash, se guarda en `cowork_batch_proposals`, atada a la propuesta.
3. **Aprobar.** La tarjeta (`LinkedinBatchReview`) lista a las personas con una marca **por persona** para dejarla fuera, muestra quién espera y por qué y, en invitaciones, el cupo semanal. «Aprobar N» guarda primero a quién quitaste y recién entonces aprueba. Bloquea la aprobación si la lista ya no es la propuesta, si ya se decidió o si quitaste a todos. Siempre pide revisión humana, también en modo autónomo: los dos tipos no están en la lista de efectos automáticos.
4. **Ejecutar.** `executeCoworkLinkedinBatch` vuelve a comprobar a cada persona que quedó (mismo perfil, la empresa sin nada hoy, el cupo contando lo que va entrando, la respuesta de la empresa y la negociación) y encola su trabajo, con llave de idempotencia por persona: aprobar dos veces no encola dos. A quien no pasa la comprobación **no se le encola** y queda con su motivo; a quien quitaste, tampoco. Si nadie se puede encolar, el efecto falla con los motivos en vez de informar un lote que no hizo nada.
5. **Resultado.** Por persona: en cola, ya estaba en cola, no salió (con el motivo) o la quitaste. Se ve en la tarjeta y en la respuesta del chat; un trabajo en cola no es un envío hasta que la extensión lo confirma en destino.
6. **Freno.** Apagar el flag detiene también un lote ya aprobado y aún sin ejecutar.

## Quitar a alguien, sin trampas

Las personas quitadas se guardan en `cowork_batch_proposals.excluded`, y el propio esquema impone que:

- la lista, quienes no salen hoy y su hash **nunca cambian** después de prepararse;
- solo se pueden quitar **personas del lote**, sin repetir, y **solo mientras la propuesta espera la decisión**: la fila de la propuesta se bloquea mientras se escribe la quita, así una aprobación que llega a la vez espera y, si llegó antes, la quita falla;
- pasada la aprobación, la lista de quitadas queda congelada.

Así una aprobación nunca alcanza a alguien que la persona no vio ni a alguien que sacó de la lista. La ruta `POST /api/cowork/runs/[id]/linkedinbatch` solo puede registrar una quita; el servidor además rechaza quitar a todos.

## Base de datos y despliegue

- **Migración `cowork_batch_proposals`** (tabla de staging con su guarda, los tipos `linkedin_invite_batch` y `linkedin_message_batch` y la columna `cowork_linkedin_jobs.company_key`): va en su propio PR (solo SQL y pgTAP) y debe estar **aplicada en producción antes** de desplegar esta parte: el encolado escribe `company_key`.
- **Cómo se enciende (lo hace el mantenedor):** tras medir el banco `lote-*` con el modelo real, agregar `COWORK_LINKEDIN_BATCH_ENABLED` = `"true"` al entorno de App Hosting. Para apagarlo, quitarla o ponerla en `"false"`.

## Cómo se prueba

- **Sin red:** `src/lib/cowork/linkedin-batch.test.ts` (el esquema, una empresa por día, el cupo, el hash, el resumen), `agent-loop.test.ts` (cuándo se acepta o rechaza la propuesta), `decision-context.test.ts`, `presentation.test.ts`, `effect-policy.test.ts` (nunca se aprueba sola) y `judge.test.ts`.
- **El servidor, con tablas en memoria** (`scripts/test-cowork-linkedin-batch.mjs`, dentro de `verify-cowork`): qué se rechaza, los frenos de cada acción individual por persona, una empresa por día entre correo y LinkedIn, el cupo, la tarjeta atada a la propuesta, quitar solo antes de aprobar, el flag como freno, cada comprobación al ejecutar y el resultado por persona. Nada se encola en una base real ni sale.
- **El banco `lote-*`** (`scripts/cowork-batch-corpus.test.ts`, con el lote encendido): invitar a varias personas (una por empresa, quien comparte empresa espera), escribir a tres con un texto para cada una, una sola persona (acción individual) y quien no tiene perfil. La propuesta pasa por el mismo plan del servidor, así que se comprueba lo que vería la tarjeta. Un turno bueno los pasa todos, responder sin mirar o mirar y no decir nada falla al menos tres verificaciones, y cada verificación se vio fallar con una sola cosa peor.
- **Con el modelo real:** `scripts/evaluate-cowork-conversations.ts --live --stream --cases=lote-invitar,lote-mensajes,lote-una-persona,lote-sin-perfil --repeat=3` y `scripts/judge-cowork-conversations.ts`. Las claves solo en el entorno; los scripts nunca leen `.env.local`.

## Medido con el modelo real

Con `scripts/evaluate-cowork-conversations.ts --live --stream --writer --repeat=4` (el modelo de producción, la Redactora y el texto retenido encendidos, sin jueza en el turno) y el juez fuera de línea (`judge-cowork-conversations.ts`, gpt-6-sol). Los cuatro casos `lote-*` (16 corridas después de este ajuste; 12 antes):

| | Antes del ajuste | Después |
|---|---|---|
| Corridas que pasan todas las verificaciones | 9 de 12 | 14 de 16 |
| Verificaciones | 167 de 174 | 230 de 232 |
| Veracidad media del juez (1 a 5) | 3,58 | 4,94 |
| Utilidad media del juez | 4,25 | 4,44 |
| Veredictos (buena / mejorable / mala) | 6 / 2 / 4 | 12 / 0 / 4 |

**Lo que apareció y se corrigió.** `leads.search` y `leads.get` no devolvían el perfil de LinkedIn de los contactos: el modelo lo suponía (afirmó que una persona sin perfil sí lo tenía y propuso invitarla), así que el lote no podía filtrar por perfil. Ahora la lectura trae `linkedin_url` canónico o `null`. Además, el modelo decía cuántas personas salían («5 personas») con una tarjeta de 4 (una persona por empresa): ahora se le pide no dar ninguna cifra y hablar de «las personas con perfil». El corredor del banco reproduce también el rechazo del servidor a una invitación individual sin perfil, así que `lote-sin-perfil` mide el resultado recuperado y no el error.

**Cómo leer la comparación.** Son muestras chicas (12 y 16 corridas) y las verificaciones cambiaron entre las dos medidas: `noCount` ahora cubre cualquier cifra o número junto a «personas, contactos, invitaciones o mensajes» (y deja pasar los datos del cupo), «aprob…» cuenta como dejarlo a la aprobación y `lote-sin-perfil` acepta más formas de decir que no hay perfil. El juez es independiente de las verificaciones, y es la columna que más pesa.

**Lo que queda.** En `lote-sin-perfil` el juez califica de «mala» las cuatro corridas por el mismo motivo: cierra con una pregunta de sí o no para escribirle por correo en vez de dejar el correo ya redactado. Se dejó así a propósito: el usuario pidió LinkedIn, y escribir por correo sin que lo haya pedido es cambiar de canal. En una corrida aparte de las mismas condiciones (1 de 4 de `lote-invitar`) el modelo nombró mal a quién no tenía perfil (dijo Iván en vez de Paz): el juez lo detectó. La tarjeta no se equivoca, porque la arma el plan del día y no la respuesta.

## Límites

- **Solo LinkedIn, invitaciones y mensajes.** Guardar contactos o enriquecer varios a la vez tienen sus propios límites (el enriquecimiento por lote admite hasta 5 por decisión, por el gasto de créditos) y no cambian aquí.
- **«Quienes aceptaron»:** Cowork parte de los contactos guardados que consultó; todavía no hay una lectura que cruce invitaciones confirmadas con conexiones nuevas, así que la lista la arma el pedido y lo que muestran `leads.search` y `linkedin.jobs`.
- **El día es el de Santiago** (como el resto de los envíos). El tope de «una acción por perfil al día» de los mensajes individuales conserva su corte actual.
- **Un lote por trabajo:** cada trabajo guarda una sola lista; otro lote es otra propuesta con su propia aprobación.
- **Mide contra casos sintéticos** sobre mundos armados con las funciones reales; las cuentas reales tienen más variedad.
