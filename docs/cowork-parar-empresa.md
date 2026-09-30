# Parar a la empresa cuando responde otra persona (30 sep 2026)

Si alguien de una empresa responde, la app ya retiene los seguimientos a todas las personas de esa empresa. El problema era que no veía todas las respuestas: solo contaba a quien tenía **la dirección exacta** a la que se escribió. Si respondía un colega desde su propio correo, la empresa seguía recibiendo correos.

Es la causa de la operación G3 del banco AXIS (`docs/cowork-banco-axis.md`): cierres enviados a empresas que estaban negociando, porque el gerente había escalado desde otra dirección.

## Qué pasaba

- **El freno por empresa ya existía.** `findCompanyReply` (`src/lib/server/campaign-send-guards.ts`) retiene los toques a una empresa si alguien de su dominio corporativo tiene una respuesta registrada. Lo usan el envío de Cowork, los lotes, los seguimientos de campañas v2 y LinkedIn.
- **Lo que fallaba era el detector.** Para registrar una respuesta:
  - `inboundCandidates` (`src/lib/server/reply-sync.ts`) exigía que el remitente fuera el contacto exacto;
  - el barrido del buzón (`src/lib/server/mailbox-sweep.ts`) solo buscaba mensajes de direcciones que ya eran contactos.
- **Resultado:** una respuesta de un colega, en el hilo o fuera de él, no quedaba registrada y el freno nunca se activaba.

## Qué cambia

1. **En el hilo.** Un mensaje de otra persona del mismo dominio corporativo, dentro del hilo al que escribimos, cuenta como respuesta. La sincronización del contacto (`syncSingleContactRow`) ahora conserva esos mensajes.
2. **Fuera del hilo.** El barrido del buzón, que ya recorre los últimos 30 días, mira también a quien **no es un contacto pero trabaja en una empresa a la que escribimos**: si escribe después del contacto, lee ese mensaje (hasta 5 por página) y lo registra como respuesta de la empresa.
3. **Quién cuenta como la empresa:** otra dirección del mismo dominio corporativo. No cuentan:
   - los proveedores compartidos (`gmail.com`, `outlook.cl`, `vtr.net`…: `FREE_MAIL_DOMAINS` ahora se exporta y suma los principales de Chile);
   - los remitentes del sistema (`mailer-daemon`, `postmaster`) y los buzones que nadie lee (`no-reply`, `notificaciones`, `newsletter`…);
   - los mensajes automáticos (fuera de oficina) y las fallas de entrega;
   - mensajes anteriores al contacto, o ya cubiertos por una respuesta posterior de la empresa;
   - el dominio del propio buzón (el buzón también lista lo que envía el usuario);
   - una empresa cuyo único contacto rebotó.
4. **Cómo queda registrado.** Como respuesta del contacto más reciente de esa empresa (antes del mensaje), con «Respondió grace@empresa.cl, otra persona de la empresa.» al inicio del resumen y `repliedBy` en la clasificación. La base valida la dirección del contacto y no la del remitente, así que el registro va en el contacto. Un mensaje fuera del hilo no cambia el hilo del contacto. Si la respuesta es positiva, la alerta dice quién escribió.
5. **Qué detiene.** Nada nuevo: al quedar la respuesta registrada, `findCompanyReply` retiene los toques a esa empresa en Cowork, lotes, campañas v2 y LinkedIn («Esta empresa ya respondió por otra dirección»). Quien responde «no» detiene además al contacto, como siempre.

## Qué no cambia

- **La vista de la conversación** sigue mostrando solo los mensajes del contacto (`readMailboxConversation` no conserva a los colegas si no se le pide).
- **Sin migraciones, flags, secretos ni llamadas nuevas al modelo** salvo la clasificación de cada mensaje registrado, como con cualquier respuesta.

## Cómo verificarlo

1. `node --loader ./scripts/ts-test-loader.mjs --test src/lib/server/reply-sync.test.ts src/lib/server/mailbox-sweep.test.ts src/lib/cowork/send-cadence.test.ts`: quién cuenta como la empresa, el hilo verificado, el registro sin tocar el hilo del contacto, el barrido (tope por página, propio dominio, contactos conocidos, fallas del proveedor) y los proveedores compartidos.
2. En un entorno de prueba con un buzón conectado: escribir a una persona de una empresa y contestar desde otra dirección del mismo dominio, en el hilo o con un correo nuevo. Tras el barrido (`/api/cron/reply-sync`), el contacto aparece como respondido con «Respondió…» en el resumen, y un seguimiento a otra persona de esa empresa queda retenido.

## Límites conocidos

- **Tarda hasta una pasada del barrido.** Las ventanas se repiten cada 12 horas y cada pasada mira 2 páginas de 50 mensajes; un seguimiento que salga antes de que se registre la respuesta no se frena.
- **Un contacto que escribe fuera del hilo sigue sin verse:** el barrido deja a las direcciones conocidas en manos del hilo verificado. La empresa igual se detiene si escribe otra persona.
- **Cualquier mensaje de alguien de la empresa cuenta,** aunque no hable de nuestro correo (un cliente que pide una factura). El costo de un falso positivo es un seguimiento pausado, y la respuesta queda a la vista en Respondidos.
- **Dominios compartidos que no están en la lista** se tratan como una sola empresa.
- **El motor heredado de campañas** (`/api/cron/process-campaigns`) mira contacto por contacto y no usa el freno por empresa; tampoco se cambia aquí.
- **`findCompanyReply` lee las últimas 200 respuestas de toda la cuenta** y, si hay 200 o más sin coincidencia, falla cerrado y retiene los envíos. Con más respuestas registradas (ahora también las de colegas) una cuenta grande lo alcanzaría; buscar por empresa en vez de por las últimas 200 es un cambio aparte.
