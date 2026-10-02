# El pipeline lee las respuestas (Plan 6, PR-B)

## Problema (prueba del 1 oct, `Pruebas_de_app.docx`, pág. 11)

El usuario pidió que las etapas cambien según lo que pasa en los correos, con IA o scripts, y nombró a Jev.

Desde #103 los eventos proponen la etapa y la persona la confirma («La IA propone, la persona confirma»). Pero las respuestas solo proponían «Interesado»:
- un pedido de reunión no proponía «Reunión»;
- un «no me interesa» no proponía nada;
- nada leía si la respuesta pedía una propuesta o confirmaba la compra.

## Qué cambia

**Cada respuesta propone su etapa** (`src/lib/reply-stage.ts`), siempre como sugerencia:

| La respuesta | Etapa propuesta | Motivo que se ve |
|---|---|---|
| Pide o acepta una reunión | Reunión | «Pidió una reunión.» |
| Muestra interés | Interesado | «Respondió con interés.» |
| Interesada y pide propuesta, precio o contrato (Jev) | Negociación | «Pidió una propuesta, un precio o un contrato.» |
| Interesada y confirma la compra (Jev) | Ganado | «Confirmó que quiere comprar.» |
| No le interesa | Perdido | «Respondió que no le interesa.» |
| Pide no recibir más correos | Perdido | «Pidió no recibir más correos.» |
| Automática o neutra | Nada | |

Las reglas de #103 siguen igual: solo avances, nunca un contacto cerrado, y una sugerencia pendiente por contacto, la más avanzada.

**Jev** responde una pregunta de opción sobre el texto de la respuesta (`REPLY_JEV_DEAL_QUESTION`):
- sus opciones son `negotiation`, `won` o `none`;
- se le pregunta solo si la respuesta muestra interés o pide una reunión;
- su palabra se toma desde una confianza de 0,8;
- sin `TYPESAFE_API_KEY`, ante una espera vencida o un error, no dice nada y la respuesta propone la etapa de su tipo;
- nunca se registra el texto de la respuesta.

## Calibración (2 oct)

`scripts/calibrate-reply-deal-jev.ts --live --repeat=2` sobre 30 respuestas ficticias etiquetadas (`scripts/fixtures/reply-deal-samples.ts`):
- 10 de negociación;
- 8 de compra;
- 12 de interés, reunión o pregunta.

| Umbral | Acierto | Empujadas de más | Perdidas |
|---|---|---|---|
| 0,6 a 0,8 | 60 de 60 | 0 | 0 |
| 0,85 y 0,9 | 58 de 60 | 0 | 2 |

Latencia: 137 ms la mediana y 374 ms la máxima. Se fija 0,8.

## Pruebas

- **`src/lib/reply-stage.test.ts`:**
  - la etapa de cada tipo de respuesta;
  - un rechazo nunca es una venta;
  - el umbral de Jev;
  - Jev sin clave o con error no dice nada.
- **`src/lib/server/reply-sync.test.ts`:** la etapa que propone cada respuesta (reunión, interés, negociación, compra, rechazo, baja y automática) al pasar por la sincronización.
