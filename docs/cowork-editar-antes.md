# Cowork · editar antes de decidir (26 sep 2026)

Primer PR de la Ola B del plan de Cowork (punto 1.2: editar antes de aprobar).

## Qué cambia para el usuario

**Correos y secuencias, en el panel.** Al abrir una tarjeta de correo o de secuencia:
- **Editar** abre el asunto y el cuerpo de cada correo. «Listo» vuelve a la vista normal con tu versión, marcada «Editado por ti»; «Volver al original» la deshace.
- **Lo editado se mantiene** aunque cierres y vuelvas a abrir el panel en esa pestaña. Se guarda solo en el navegador.
- **¿Qué hago con esta versión?**
  - «Crear campaña con esta versión» le pide a Cowork una campaña pausada con tu texto exacto.
  - «Usar esta versión» se la deja a Cowork para lo que sigue, sin reescribirla.
  - Si Cowork está trabajando o hay una propuesta pendiente, los botones esperan y dicen por qué.
- **En el chat**, ese pedido se ve compacto: la instrucción y «Ver los 3 correos», plegado.

**La campaña propuesta, antes de aprobarla.** En la tarjeta de aprobación de «Crear campaña»:
- **Editar correos** abre el asunto y el cuerpo de cada correo.
- **Guardar cambios** la deja lista para aprobar con tu versión; la tarjeta dice «editados por ti».
- **Mientras editas**, «Crear borrador pausado» queda bloqueado hasta que guardes o canceles.
- **Qué no cambia:** los destinatarios, la cantidad de correos y los días entre ellos se mantienen como se revisaron. Para cambiarlos, se le pide a Cowork.

## Cómo funciona

**El texto exacto viaja en el mensaje.**
- El pedido lleva la versión en un formato que el bucle sabe leer: `coworkVersionMessage` lo arma y `coworkEditedEmails` lo lee.
- Cuando ese pedido termina en `campaign.create`, el bucle copia tus asuntos y cuerpos sobre lo que haya escrito el modelo (`coworkCampaignWithExactEmails`). Espacia los correos según sus días y no gasta otra llamada.
- Si la versión se fijó un turno antes («Usar esta versión» y después «créala»), el modelo la toma del historial. La regla 11 le dice que ese texto manda. En este caso no hay copia automática, así que el corpus lo mide aparte.

**La edición de la campaña es una actualización acotada.**
- `PATCH /api/cowork/runs/[id]/campaign-preview` con `{ messages: [{ subject, body }] }`.
- El servidor comprueba varias cosas antes de guardar:
  - que el trabajo sea tuyo;
  - que la propuesta siga pendiente;
  - que tenga la misma cantidad de correos y que cada uno tenga asunto y cuerpo dentro del largo permitido.
- Cambia solo asuntos y cuerpos de la definición preparada (`cowork_campaign_definitions`) y registra un evento `proposal.edited` con qué correos cambiaron, sin el texto.
- La creación lee esa definición cuando se ejecuta, así que se crea tu versión: pausada, y activarla es otra revisión atada a su propio hash.
- **Sin migración:** usa la tabla y el cliente de servidor que ya existen.
- **Límite conocido:** si aprobaras en el mismo instante en que se guarda la edición, podría crearse cualquiera de las dos versiones. En los dos casos queda pausada y visible antes de activarla. Cerrarlo del todo requiere una función en la base con bloqueo de fila, es decir, una migración. Queda para cuando se autorice.

| Pieza | Dónde |
|---|---|
| Editor del panel, «Usar esta versión» y «Crear campaña con esta versión» | `src/components/cowork/CoworkBlocks.tsx` (`DraftView`, `CoworkEmailFields`) |
| El panel recibe cómo enviar y por qué no se puede | `CoworkArtifactPanel.tsx`, `CoworkWorkspace.tsx` |
| Mensaje con la versión exacta y su lectura | `src/lib/cowork/blocks.ts` |
| La campaña copia el texto exacto | `coworkCampaignWithExactEmails` en `src/lib/cowork/agent-loop.ts` |
| Regla: ese texto manda | regla 11 en `src/lib/cowork/agent-instructions.ts` |
| Pedido compacto en el chat | `VersionMessage` en `src/components/cowork/CoworkTurn.tsx` |
| Edición de la campaña pendiente | `src/lib/cowork/campaign-edit.ts`, `editCoworkCampaignMessages` en `src/lib/server/cowork/campaign-ops.ts`, `PATCH` en `campaign-preview/route.ts` y `CampaignReview.tsx` |
| Casos del corpus | `EDIT_CORPUS` en `scripts/fixtures/cowork-marketing-corpus.ts` |

## Validación

**Modelo real** (gpt-6-luna, bucle real, lecturas de fixture, 3 repeticiones). Son los 31 casos de siempre más 3 casos nuevos de edición, 102 ejecuciones en total. El PR anterior (plan visible) se midió el mismo día:

| | PR anterior | Este PR |
|---|---|---|
| Los 31 casos de siempre | 90/93 | **92/93** |
| Casos nuevos de edición | — | 8/9 |
| Verificaciones (total) | 817/825 | 901/903 |
| Turnos que terminan con error | 1 | 0 |
| Consultas por caso | 1,67 | 1,73 |
| Llamadas al modelo por caso | 2,16 | 2,15 |

Casos nuevos (`EDIT_CORPUS`):

| Caso | Resultado | Qué mide |
|---|---|---|
| `editar-campana` | 3/3 | «Crear campaña con esta versión»: la campaña lleva el texto exacto, solo para Felipe y Camila |
| `editar-luego-crear` | 3/3 | La versión se fijó un turno antes y el usuario dice «sí, créala». Aquí el bucle no copia nada: el modelo tomó el texto exacto del historial por sí solo |
| `editar-usar` | 2/3 | «Usar esta versión»: confirmar sin reescribir. Una vez propuso de inmediato la campaña (con el texto exacto, gracias a la copia del bucle) en vez de preguntar primero |

La otra falla (`linkedin-seguimiento`, 1 de 3) es la conocida: no explicó cómo sincronizar LinkedIn.

**Pruebas sin modelo:**
- `blocks.test.ts`: el mensaje con la versión exacta va y vuelve sin perder nada. Pedir una campaña se distingue de solo usarla, y nada de lo que el usuario escribe a mano se confunde con una versión.
- `agent-loop.test.ts`: la campaña pedida con la versión exacta lleva ese texto aunque el modelo lo reescriba, espaciada según los días.
- `campaign-edit.test.ts`: la edición cambia solo asuntos y cuerpos, dice qué correos cambiaron, y rechaza agregar o quitar correos, dejarlos vacíos o tocar los días.
- Corpus sin modelo: las respuestas ideales de los 3 casos nuevos pasan por el bucle real. En `editar-campana`, la ideal reescribe el texto a propósito y el bucle lo corrige.

**Navegador** (Playwright contra el build de producción local, con un Supabase simulado solo en local que acepta el `PATCH` en memoria):
- Escritorio claro y oscuro (1440 px) y teléfono (390 px).
- **Secuencia en el panel:**
  - editar dos correos;
  - mientras se edita, «Crear campaña con esta versión» espera;
  - «Listo» muestra «Editado por ti», y la edición sigue ahí al cerrar y reabrir el panel;
  - el pedido enviado empieza con «Crea una campaña pausada con esta versión editada de «Secuencia AXIS para RR. HH.», sin cambiar el texto.» y lleva el texto editado. El envío se intercepta: no se guarda nada.
- **Campaña pendiente:**
  - «Editar correos» bloquea «Crear borrador pausado» mientras se edita;
  - «Guardar cambios» guarda el asunto nuevo, la tarjeta dice «editados por ti» y queda registrado un evento `proposal.edited` con el correo 3;
  - no se aprobó nada.
- Sin scroll horizontal en ningún caso.

## Pendientes

- **La tarjeta del chat no muestra la edición:** sigue con el texto de Cowork; la versión editada vive en el panel. Se puede marcar «Editado» también en la tarjeta.
- **Cambiar destinatarios o días desde la tarjeta de campaña:** hoy se le pide a Cowork.
- **Edición atómica con la aprobación:** requiere una migración, como se explica arriba.
