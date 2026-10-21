# «Metas semanales» y «Avisos»: volver a la app con algo concreto

**Fecha:** 20 de octubre de 2026.

Son las ideas 3 y 4 de la lista para que los usuarios vuelvan a usar la app:

- **Idea 3, avisos que traen de vuelta:** «Te respondió Juan Pérez», «2 licitaciones que te sirven cierran el viernes», «Tus 12 contactos de ayer ya tienen correo». Solo cuando hay algo real que hacer.
- **Idea 4, los jefes como motor:** una meta semanal simple por vendedor, que el jefe revisa en su reunión.

## Metas semanales

### Qué se mide

Cada persona tiene dos metas por semana, de lunes a domingo, hora de Chile:

1. **Personas contactadas** (la principal). Cuenta cada persona una vez, por cualquiera de estas vías:
   - un correo confirmado como enviado (`outbound_dispatches`, el mismo dato del informe semanal);
   - un mensaje de LinkedIn hecho;
   - una llamada hecha («Llamadas y LinkedIn»).

   Si a alguien se le escribió y también se le llamó, cuenta una vez.
2. **Contactos nuevos con correo:** contactos guardados en la semana que ya tienen correo, uno por dirección.

### Quién las pone

- **Por defecto:** sin nada configurado, la meta es **10 personas contactadas y 15 contactos nuevos con correo** (`DEFAULT_GOALS`).
- **Administradores y dueños:** cambian la meta del equipo y, para quien necesite otra, la de esa persona.
  - Se hace en «Tu semana» → «Equipo» → «Metas del equipo», o desde «Cambiar las metas del equipo» en la tarjeta de «Hoy».
  - Una persona en blanco sigue la meta del equipo.
  - Con 0 en ambas, el equipo no usa metas: no se muestran ni se mencionan en los correos.
- **Límites:** cada meta es un número entero de 0 a 500.

### Dónde se ven

- **«Hoy»,** tarjeta «Meta de la semana», arriba de la columna derecha. Muestra:
  - el avance de cada meta con su barra;
  - una línea con el ritmo, contado en días hábiles: «Vas al día. Para seguir así, contacta hoy a 2 personas», «Para ir al día, contacta hoy a 3 personas» o «Cumpliste tu meta de la semana»;
  - un solo paso: «Escribe a tus contactos listos» si hay contactos con correo sin escribir y aún faltan personas por contactar; si no, «Busca contactos nuevos».
- **«Tu semana»:**
  - Bloque «Meta de la semana», o «Meta de la semana pasada» si se mira la semana anterior.
  - En «Equipo», la columna «Meta» con las personas contactadas de cada uno contra su meta. Quien sumó contactos o hizo llamadas ya no aparece «sin actividad».
- **El correo del lunes («Informe semanal»):**
  - en «Tu semana», cómo cerró la meta;
  - en «Equipo», «meta 4 de 10» junto a cada persona.
- **Los avisos de la mañana:** el avance de la semana, con el siguiente paso.

## Avisos

### Cuándo llegan

- **Cuándo:** de martes a viernes, entre 8:00 y 9:30 de Chile (`dailyAlertsTick`). El lunes no hay aviso: ese día llega el informe semanal.
- **Cuántos:** como máximo un correo por persona, workspace y día.
- **Solo con algo concreto que hacer.** Lo que no cumple esta regla se guarda como «quiet» y no se envía.

### Qué dice

El asunto nombra lo más urgente, y el cuerpo lista cada cosa una vez, con su enlace. Este es el orden:

1. **Respuestas nuevas** desde el aviso anterior, con la regla de «Por responder». Asunto: «Te respondió Juan Pérez», «Te respondieron Ana y Pedro» o «Te respondieron Ana y 4 personas más».
2. **Compromisos** que vencen hoy o ya vencieron: «Hoy: Enviar propuesta con Rosa Díaz (Logística Norte)», o «Vencido: …».
3. **Oportunidades que cierran** desde hoy hasta el fin del tercer día (el martes, hasta el viernes en la noche). Ejemplos: «2 licitaciones que te sirven cierran el viernes», «Una licitación a tu cargo cierra mañana: …».
   - Las que la persona tiene a cargo.
   - Si administra o gestiona Oportunidades: además las recomendadas que nadie tiene.
   - Solo para quien puede ver Oportunidades.
4. **«Contacto del día»**, martes, miércoles y viernes: un contacto nuevo con correo, con su bloque y su botón en el cuerpo y un PDF adjunto (`docs/contacto-del-dia.md`). Es el botón principal del correo; no se repite como una línea de la lista. Asunto: «Tu contacto de hoy: Gerente de Personas en Ripley», si no hay algo más urgente.
5. **Investigaciones listas** desde el aviso anterior: «Lista la investigación de Pedro Rojas». El enlace abre la investigación en «Por escribir».
6. **Contactos que ya tienen correo:** los guardados desde el aviso anterior, con correo y sin escribir. Ejemplo: «Tus 12 contactos de ayer ya tienen correo». Dice «de ayer» cuando todos son de ayer.
7. **Respuestas de días anteriores** que aún esperan. Solo acompañan a otro motivo; nunca son motivo por sí solas.
8. **La meta de la semana,** con el siguiente paso.
   - Una meta atrasada es motivo suficiente solo **miércoles y viernes**.
   - Quien está en varios workspaces recibe ese recordatorio solo del primero al que entró.

### Desde dónde se envían

- **Remitente:** igual que el informe semanal (`sendReportEmail`).
  - **Con Resend** (`RESEND_API_KEY`), todos los correos de la app salen desde una dirección de Yago (`REPORTS_FROM_EMAIL`, por defecto `ANTON.IA <avisos@yago.cl>`), hacia el correo de cada persona. Así le llegan a todos, tengan o no su correo conectado. Ver «Activar Resend» en `docs/informe-semanal.md`.
  - **Sin Resend**, salen desde el Gmail u Outlook conectado de la persona o desde el correo de informes (`WEEKLY_REPORTS_SENDER_USER_ID`). Sin ninguno de los dos, a esa persona no se le prepara aviso.
- **Quiénes no los reciben:**
  - **cuentas internas y de prueba:** el 20 de octubre se les apagaron a las 18 que no son de clientes (`daily_alerts.email = false` e `internal = true`). Se usan solo para probar;
  - **direcciones de prueba** (example.com, `.test`, `.local`…): nunca reciben un correo automático (`isTestAddress`).
- **En producción:** solo 3 de 53 usuarios tienen correo conectado, así que **Resend es lo que hace que los avisos lleguen a todos**. Está activo desde el 21 de octubre.

### Cómo se apagan

- **Por persona:** «Avisos por correo» en «Tu semana», al final de la página. Vienen encendidos (`profiles.signatures.daily_alerts.email`).
- **Para todos:** `DAILY_ALERTS=off` los detiene.

### Primera corrida real: miércoles 21 de octubre de 2026

Revisada en producción el mismo día, solo con lecturas (`daily_alerts` y `lead_drops`), sin datos personales.

- **Resultado:** las 35 filas del día quedaron en `sent`, con `email_error` vacío. Salieron entre las 11:00:06 y las 11:00:28 UTC, es decir a las 8:00 de Chile, dentro de la ventana de `dailyAlertsTick`.
- **A quién:** había 35 personas que debían recibirlo (con correo, avisos encendidos y sin dirección de prueba) y las 35 tienen su fila; ninguna quedó sin aviso. No se envió ninguno a quien los apagó, a una dirección de prueba ni a alguien sin correo.
- **Cómo llegaron:** solo 4 conexiones de Gmail u Outlook, así que el resto salió por Resend. La regla antigua, «solo a quien tiene buzón o correo de informes», ya no aplica desde que Resend está activo.
- **Contacto del día (era día de entrega):** 33 contactos enviados con su aviso y 2 en `empty`, personas para quienes no se encontró a nadie.
- **Qué no se comprobó:**
  - los logs de `/api/cron/daily-alerts`, que corre en App Hosting y no se leyeron en esta revisión: «sin errores» sale del estado de las filas;
  - la entrega real: `sent` quiere decir que Resend aceptó el correo, no que llegó a la bandeja; los rebotes y el spam se ven en el panel de Resend.

## Datos

La migración `20261020170000_weekly_goals_and_daily_alerts.sql` crea dos tablas, solo para el servidor: RLS activo, sin permisos para `anon` ni `authenticated`, y todos para `service_role`.

- **`weekly_goals`:** la meta del equipo (`user_id` nulo) y las personales. Única por (`organization_id`, `user_id`), con nulos iguales (`nulls not distinct`).
- **`daily_alerts`:** el aviso de cada persona, workspace y día. Única por (`organization_id`, `user_id`, `alert_date`).
  - **Estado:**
    - `quiet`: sin nada que decir;
    - `stored`: con avisos apagados o sin dirección;
    - `sent`: enviado;
    - `failed`: no se pudo enviar.
  - **Contenido:** guarda las líneas enviadas y la ventana usada.
  - **Una sola vez:** dos pasadas a la vez no envían dos correos, porque el segundo insert falla por la clave única.

## Código

| Pieza | Archivo |
| --- | --- |
| Metas (puro) | `src/lib/weekly-goals.ts` |
| Metas (lecturas y guardado) | `src/lib/server/weekly-goals.ts` |
| Avisos (puro: qué decir y el correo) | `src/lib/daily-alerts.ts` |
| Avisos (lecturas y envío) | `src/lib/server/daily-alerts.ts` |
| API de metas | `src/app/api/weekly-goals/route.ts` |
| Interruptor de avisos | `src/app/api/weekly-report/route.ts` (acción `alerts`) |
| Cron | `src/app/api/cron/daily-alerts/route.ts`, `functions/index.ts` (`dailyAlertsTick`) |
| Tarjeta de «Hoy» | `src/components/home/WeeklyGoalCard.tsx` |
| Editor de metas | `src/components/weekly-goals/GoalsEditor.tsx` |
