# «Llamadas y LinkedIn»: la secuencia sigue fuera del correo

**Fecha:** 19 de octubre de 2026.

**Propuestas 15 y 19** de la comparación con otras apps de prospección: secuencias multicanal (correo, llamada y LinkedIn) y llamadas con resumen para el CRM.

## Por qué

Las secuencias de ANTON.IA eran solo de correo. Quien no responde un correo a veces contesta el teléfono o acepta una invitación de LinkedIn, y las apps comparables (Apollo, Outreach, lemlist, HubSpot) ponen esos pasos en la misma secuencia. Faltaba además dejar en el CRM lo que se habló en una llamada sin escribirlo a mano.

## Qué hace

1. **Una cadencia por persona,** en «Hoy» → «Llamadas y LinkedIn» → «Ajustar»:
   - por defecto, LinkedIn el día 1 y la llamada el día 3 después del primer correo;
   - cada canal se enciende o apaga solo;
   - el día se elige entre 1, 2, 3, 4, 5, 7, 10 y 14.
2. **La invitación,** solo cuando ya hay personas a quienes se escribió: «Suma una llamada y LinkedIn a tus seguimientos» → «Activar».
3. **La tarjeta del día** lista lo que toca, las llamadas primero:
   - cada fila trae el canal y el día («Llamar · día 3»), el cargo, la empresa y el asunto del correo que sigue;
   - un botón llama al número (`tel:`) o abre el perfil de LinkedIn; sin perfil guardado, abre la búsqueda por nombre y empresa;
   - se ven 5 y el resto con «Ver N más».
4. **«Guion y resultado»** prepara con IA, al pedirlo y una sola vez (queda guardado; «Otra versión» pide otro):
   - para una llamada: qué decir al contestar, hasta tres preguntas para entender si le sirve y el mensaje si no contesta;
   - para LinkedIn: la nota de la invitación (300 caracteres como máximo) y el mensaje cuando acepte.
5. **Qué pasó:** «Hablamos», «Dejé mensaje», «No contestó» o «Número equivocado» para llamadas; «Envié la invitación», «Le escribí» o «No encontré su perfil» para LinkedIn. Con una nota opcional. «Saltar» la cierra sin resultado.
6. **El resumen de la llamada:** después de «Hablamos», «Subir grabación» acepta mp3, m4a, wav, webm u ogg de hasta 25 MB:
   - la grabación se transcribe y la IA deja el resumen, los acuerdos, los próximos pasos con fecha, las objeciones y el interés (alto, medio o bajo);
   - si el contacto está en el CRM, el resumen queda en sus notas, el primer próximo paso pasa a ser su próxima acción y, si acordaron una reunión o el interés es alto, el CRM sugiere moverlo a «Reunión» o «Interesado»;
   - el audio no se guarda.

## Reglas

- **Quién entra:** solo quienes recibieron el primer correo desde que se activó la cadencia y en los últimos 45 días. Cambiar los días no cambia a quiénes se aplica.
- **Llamadas:** solo a quien tiene teléfono guardado (`enriched_leads.phone_numbers` o `primary_phone`).
- **Se cancela solo** lo pendiente de quien respondió, cerró su conversación, rebotó o pidió no recibir más correos.
- **LinkedIn:** hasta 20 al día por persona, para cuidar la cuenta; las demás quedan para mañana y la tarjeta lo dice.
- **Vencimiento:** una tarea abierta se cierra sola una semana después de su día.
- **El día** se cuenta con la fecha de Chile.

## Cómo funciona

- **Tabla `contact_touches`** (migración `20261019130000_contact_touches.sql`): una fila por contacto y regla (`call:3`, `linkedin:1` o `manual:<uuid>`), con estado (`open`, `done`, `skipped`, `cancelled`), resultado, nota, guion y resumen. Única por `(contacted_id, rule_key)`, borrada en cascada con el contacto. RLS activa y solo `service_role`: la app la lee y escribe desde el servidor con el usuario verificado.
- **La cadencia** se guarda en `profiles.signatures.touches` junto a las firmas, sin columna nueva.
- **`GET /api/touches`** crea al leer las tareas que vencen hoy (sin duplicar), cancela y vence las que corresponde y devuelve la lista. `POST /api/touches` guarda la cadencia o agenda una tarea manual.
- **`POST /api/touches/[id]`** con `done`, `skip` o `script`; **`POST /api/touches/[id]/recording`** con el audio.
- **Modelos:** el guion usa `TOUCHES_MODEL` (Haiku por defecto) y el resumen el mismo; la transcripción usa `CALL_TRANSCRIBE_MODEL` de OpenAI (`gpt-4o-mini-transcribe` por defecto), con `OPENAI_API_KEY`.
- **El CRM:** `syncLeadAutopilotToCrm` escribe la nota y la próxima acción, y la sugerencia de etapa usa los eventos `call_summary` y `call_meeting` de `src/lib/crm-stage-suggestions.ts`.

## Llamar desde ANTON.IA (preparado, apagado)

`src/lib/server/call-bridge.ts` deja listo el puente con Twilio: llama primero al vendedor, le recuerda pedir permiso para grabar, conecta con el contacto desde el número de la empresa y graba desde que contesta. La grabación vuelve firmada a `POST /api/touches/twilio/recording`, se resume igual que una subida y se borra de Twilio.

No hace nada hasta que existan:
- `CALL_BRIDGE_ENABLED=true`;
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` y `TWILIO_FROM_NUMBER` (formato internacional, como `+56…`);
- el teléfono del vendedor en «Ajustar», que solo aparece con el puente encendido.

Requiere una cuenta de Twilio con un número chileno y la aprobación del dueño por el costo por minuto.

## Límites

- La app no marca ni envía en LinkedIn: abre el perfil y prepara el texto. Automatizar LinkedIn viola sus términos.
- Sin `OPENAI_API_KEY` no hay transcripción; el resto funciona.
- La grabación la hace el vendedor, con su consentimiento y el de la otra persona.

## Pruebas

- `src/lib/touches.test.ts`: días, cadencia, cancelaciones, orden (llamadas primero), límite de LinkedIn y enlaces.
- `src/lib/server/touches.test.ts`: lectura sin tabla, creación sin duplicar, cancelación, resultado y guion guardado.
- `supabase/tests/database/contact_touches.test.sql`: RLS, permisos, una tarea por contacto y regla, claves y resultados válidos, y borrado en cascada.
- Recorrido local con navegador sobre la base local: invitación, cadencia, tarjeta, guion, grabación de prueba → resumen → CRM, e invitación de LinkedIn.
