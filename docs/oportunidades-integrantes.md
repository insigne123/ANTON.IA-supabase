# Oportunidades para integrantes

Qué ve y qué puede hacer una persona que **no es administradora** cuando le asignan una oportunidad. Se escribió después de revisar
la sección con datos de producción: ninguna de las 37 personas de GrupoExpro y PSOL tenía una oportunidad asignada, así que el
camino del integrante no se había usado con gente real.

## Qué cambia

| Antes | Ahora |
|---|---|
| El aviso de asignación solo estaba dentro de Oportunidades («Novedades») | Además llega **un correo** a quien se suma al equipo: quién asignó, qué es, cuándo cierra, la próxima acción y qué se espera. No le llega a quien asigna ni a quien apagó los avisos en «Tu semana» |
| «Desde tu última visita» (en «Hoy») contaba las oportunidades nuevas de **toda la organización**, que el integrante no puede abrir | Al integrante le dice **lo que le asignaron** desde su última visita. Los administradores siguen viendo lo nuevo del workspace |
| Existían los filtros «En gestión» y «Bloqueadas», pero nadie podía poner una oportunidad en esos estados desde la pantalla | Franja **«Tu avance»** bajo el título: el estado, la próxima acción, quién asignó y cuántas tareas tuyas quedan, con el paso que sigue: *Empezar a gestionarla → Marcar como presentada*, y *Reportar un bloqueo* o *Retomarla* |
| No había cómo decir «propongo no postular» ni «necesito que decidan» | **«Plantear una decisión»**: queda en la actividad, avisa a administradores y a quien está a cargo, y la respuesta de un administrador aparece en la misma oportunidad |
| «Mi trabajo» mostraba todo, también lo presentado o cerrado | «Mi trabajo» es lo que sigue abierto; **«Presentadas y cerradas»** es un filtro aparte |

## Reglas que se mantienen (y ahora se revisan en el servidor)

- Un integrante solo puede pasar una oportunidad a **En gestión, Bloqueada o Presentada**. «Asignada», «Sin asignar», «Ganada»,
  «Perdida» y «Archivada» son de los administradores; si un administrador ya la cerró, el integrante no la reabre.
- **Un bloqueo exige su motivo** (3 a 500 caracteres). Queda en la actividad y se avisa a los administradores y a quien está a cargo.
- Responder una decisión es solo de administradores. Mientras no la responden, la decisión se ve en un recuadro para todo el equipo.
- Los avisos nuevos usan la tabla de novedades existente (tipo `task`): no hay migración.

## Correo de asignación

- Sale por el mismo canal que los demás correos automáticos (Resend desde la dirección de Yago, o el buzón de la persona).
- Respeta el interruptor de «Tu semana» y no sale a direcciones de prueba.
- `OPPORTUNITY_ASSIGNMENT_EMAIL=off` los detiene todos. Sin esa variable, están encendidos.
- Se envía después de responderle al administrador: si falla, la asignación queda hecha igual.

## Lo que vale por la empresa pasa por un administrador

Los precios de la oferta y lo que se responde en «¿Cumplimos?» son afirmaciones de la empresa, y las ofertas son públicas. Por eso:

- **Precios.** Los fija un administrador o quien quedó a cargo de la oportunidad. Si nadie quedó a cargo, cualquiera del equipo puede (alguien tiene que poder). El resto del equipo ve los precios y los totales, pero no los edita; el servidor lo revisa, no solo la pantalla. Si cree que hay que cambiarlos, lo plantea como decisión.
- **Respuestas para la ficha.** Si un integrante responde una pregunta de «¿Cumplimos?», no entra a la ficha: queda como *respuesta por confirmar* (en la actividad, con aviso a los administradores). Un administrador la **confirma** (se guarda en la ficha como si la hubiera escrito él y los requisitos se revisan de nuevo) o la **descarta**; quien la dio recibe el aviso en cualquiera de los dos casos. La misma persona respondiendo de nuevo la misma pregunta reemplaza su respuesta.
- Las respuestas de un administrador siguen entrando directo, y la ficha completa sigue siendo solo de administradores.

Tampoco hay migración: las propuestas usan la actividad de la oportunidad (`fit_proposal`).

## Pendiente (otro PR)

- Escenarios de puntaje por precio y la calculadora de valor hora.
