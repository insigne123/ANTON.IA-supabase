# «Informe semanal»: la semana de cada rol, en la app y por correo

**Fecha:** 19 de octubre de 2026.

**Propuesta 2** de la comparación con otras apps: informe semanal automático para jefaturas (LicitaLAB, Apollo), ampliado a cada rol y con «Gestor de oportunidades».

## Por qué

«Hoy» dice qué hacer en el día. Nadie decía cómo fue la semana: cuánto se escribió, quién respondió y qué quedó pendiente. Tampoco cómo iba el equipo, ni qué cerraba pronto en Oportunidades. Los informes semanales de Diego (PSOL) y Gonzalo (GrupoExpro) se armaron a mano en PDF. Este informe los reemplaza y llega a cada persona según su rol.

## Qué muestra

Una página, «Informe semanal», en «Centro de mando», con «Esta semana» (de lunes a hoy) o «Semana pasada» (de lunes a domingo, hora de Chile). Tiene una pestaña por rol:

1. **Tu semana** (todos):
   - una frase con lo importante;
   - correos enviados y personas contactadas, ambos con su cambio frente a los mismos días de la semana anterior;
   - respuestas (con el % de las personas contactadas) y reuniones pedidas;
   - **«Para esta semana»:** hasta tres acciones con enlace, en este orden:
     1. responder a quien escribió;
     2. el compromiso más próximo;
     3. asignar oportunidades que cierran (si eres gestor);
     4. hablar con quien del equipo no envió (si administras);
     5. si la semana fue floja, «Por escribir».
   - **«Te esperan»:** quien respondió y espera respuesta, con la misma regla que «Por responder».
   - **Compromisos:** los abiertos que vencen en los próximos 8 días, incluidos los atrasados.
   - Llamadas y LinkedIn hechos, cuando esa función existe.
2. **Equipo** (dueños y administradores):
   - totales con su cambio;
   - una tabla con quienes tuvieron actividad en la semana (enviaron, les respondieron, pidieron reunión o tienen respuestas por contestar): enviados, respuestas, reuniones y por responder;
   - el resto queda contado en una línea («3 personas sin actividad esta semana»), y «Ver» agrega sus filas;
   - si nadie escribió, una frase lo dice en lugar de los totales y la tabla, y ofrece «Ver Oportunidades» a quien también lo recibe. Así un equipo que trabaja solo licitaciones no ve una fila de ceros por persona (en producción había uno con 31, oct 2026).
   - En el correo del lunes es igual: hasta 8 personas con actividad, una línea con las demás, o «Nadie del equipo envió correos la semana pasada».
3. **Oportunidades** (gestores, o los administradores mientras no haya gestores; solo para quien puede ver Oportunidades):
   - lo que llegó en la semana por tipo, sin las excluidas;
   - lo que cierra en los próximos 7 días, con «Sin asignar» cuando nadie lo tiene;
   - las ganadas y perdidas de la semana.

## Por correo, cada lunes

- **Activación:** «Recibirlo por correo cada lunes» queda apagado hasta que la persona lo enciende.
- **Cuándo:** a las 8:00 de Chile llega el informe de la semana anterior.
- **Desde dónde:** sale desde **su propio Gmail u Outlook conectado, hacia su mismo correo**. No hay proveedor de correo nuevo ni costo, y no usa el cupo de envíos.
- **Contenido:** a diferencia de la prospección, no lleva enlace de baja, seguimiento ni la cabecera de baja con un clic, que agregaría la propia dirección a la lista de no contactar. Se apaga en la misma página.
- **«Enviármelo ahora»:** manda el informe que está en pantalla.
- **Gestores:** un administrador elige a los gestores de oportunidades en «Gestores de oportunidades».

## Cómo funciona

- **`src/lib/weekly-report.ts`** (sin efectos): la semana en hora de Chile (`reportWeek`), la frase, las acciones y el correo en HTML y texto.
- **`src/lib/server/weekly-report.ts`:** lecturas con el cliente de servicio, siempre filtradas por organización y persona.
  - Envíos: `outbound_dispatches` confirmados por el proveedor, como «Hoy».
  - Respuestas: humanas, de `contacted_leads`.
  - Compromisos: `contacted_leads.data.commitment`.
  - Oportunidades: `commercial_opportunities` y `opportunity_work`.
  - Roles: `organization_members` y `organization_report_roles`.
- **`src/lib/server/self-email.ts`:** el envío a uno mismo por la API de Gmail (MIME propio) o por Microsoft Graph (`sendMail`), con el correo elegido por defecto en «Conexiones». El destinatario se valida, sin saltos de línea. `WEEKLY_REPORTS_EMAIL=off` detiene todo.
- **Migración `20261019140000_weekly_reports.sql`:**
  - `weekly_reports`: una fila por persona, organización y semana, con `week_start` en lunes, `emailed_at` y `email_error`.
  - `organization_report_roles`: el rol `opportunities`.
  - Ambas tablas con RLS y solo `service_role`.
- **Rutas:**
  - `GET /api/weekly-report?week=current|previous` entrega el informe y los ajustes.
  - `POST /api/weekly-report` recibe `email`, `managers` o `send`.
  - `POST /api/cron/weekly-reports`: puente del programador. Solo los lunes; procesa lotes de 40 y salta lo ya enviado.
- **Programador:** `weeklyReportsTick` en `functions/index.ts`, los lunes de 8:00 a 10:30 de Chile, cada 30 minutos. Queda activo al desplegar Functions.

## Límites

- Una persona en dos organizaciones recibe un informe por cada una.
- El equipo cuenta los envíos de la organización; el detalle por módulo sigue en «Administración».
- Sin correo conectado el informe se guarda y se ve en la app, pero no se envía.

## Pruebas

- `src/lib/weekly-report.test.ts`: semanas en hora de Chile (domingo en la noche sigue en su semana), frase, cambios, acciones y correo escapado sin seguimiento.
- `src/lib/server/weekly-report.test.ts`:
  - cuentas de la semana y de la anterior;
  - respuestas automáticas y conversaciones ya respondidas;
  - compromisos;
  - roles y gestores;
  - entrega una sola vez y reintento tras un fallo;
  - firmas que se conservan.
- `src/lib/server/self-email.test.ts`: MIME, Gmail y Outlook, correo no conectado, inyección de cabeceras e interruptor general.
- `supabase/tests/database/weekly_reports.test.sql`: RLS, permisos, únicos, lunes, roles y borrado en cascada.
