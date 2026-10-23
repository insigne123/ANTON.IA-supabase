# Cowork: tareas programadas (23 oct 2026)

**Qué falta frente a Claude Cowork:** Cowork solo trabaja cuando la persona escribe. Una tarea programada es un pedido que se repite («cada lunes a las 9, dime quién respondió y a quién escribir hoy», «todas las mañanas, revisa si hay respuestas nuevas»): a la hora indicada Cowork abre una conversación nueva con ese pedido y lo atiende solo.

**Apagado por defecto.** Necesita la migración `20261023120000_cowork_scheduled_tasks.sql` (la tabla y el tipo de efecto `schedule_create`) y `COWORK_SCHEDULES_ENABLED=true`. La migración está escrita y tiene su prueba pgTAP (corre en el CI), pero **no se ha aplicado a producción**: esa decisión es de quien despliega.

## Cómo funciona

1. La persona crea la tarea: nombre, pedido completo, frecuencia (todos los días, de lunes a viernes, un día de la semana, un día del mes), hora local y zona (por defecto America/Santiago). Hasta 5 tareas activas y 20 en total por persona.
2. El worker de Cowork, que ya corre cada minuto (`coworkTick` → `/api/cron/cowork`), mira las tareas cuya hora llegó (`processCoworkSchedules`) y, por cada una, abre una conversación con `cowork_admit_run` **siempre en modo «aprobación»**: nadie está mirando, así que nada se envía ni se gasta sin que la persona lo apruebe. Lo que necesita una decisión queda como propuesta en esa conversación.
3. La primera línea del mensaje dice qué es (`⏰ Tarea programada · Resumen del lunes`), cuándo se disparó y trae el pedido tal cual. Cada ejecución es una conversación nueva: el límite de consumo por conversación (200 llamadas, 1 M de tokens) no se acumula día a día.
4. La tarea pasa a su siguiente hora (sensible a los cambios de hora de Chile: una hora que no existe se corre después del salto, una que ocurre dos veces se corre la primera vez).

## Qué la hace segura

- **Una ejecución, una conversación.** El id de la solicitud sale de la tarea y del momento en que le tocaba; si dos workers (o un reintento) miran la misma hora, `cowork_admit_run` devuelve la misma conversación y la tarea solo avanza una vez (el avance compara la fecha que leyó).
- **Lo atrasado no se ejecuta tarde.** Una ejecución que lleva más de 6 horas de atraso (el worker estuvo caído) se salta y la tarea sigue con la siguiente. Una tarea vencida muchas veces se ejecuta una sola vez.
- **Fallas.** Una ejecución que falla se reintenta el minuto siguiente; tres fallas seguidas pausan la tarea (`last_status = failed`).
- **Acceso.** Antes de cada ejecución se verifica que la persona sigue con acceso a Cowork y a su organización. Se rechaza todo campo que el formulario no conoce (el dueño siempre es la sesión) y la base de datos repite los límites en un disparador.
- **Se cobra como cualquier mensaje.** Cada ejecución entra a los mismos límites de consumo por persona (con el agente nuevo: 300 llamadas y 1,8 M de tokens al día).

## Interfaz de programación (`/api/cowork/schedules`)

| Método y ruta | Qué hace |
| --- | --- |
| `GET /api/cowork/schedules` | Las tareas de la persona (con su sesión, bajo RLS). `enabled: false` mientras esté apagado o falte la tabla. |
| `POST /api/cowork/schedules` | Crea una tarea. |
| `PATCH /api/cowork/schedules/[id]` | Pausa (`enabled: false`), reanuda, renombra o cambia el horario. Cambiar el horario mueve la próxima ejecución; reanudar reinicia la cuenta de fallas. |
| `DELETE /api/cowork/schedules/[id]` | Borra la tarea. Las conversaciones que ya abrió quedan. |
| `POST /api/cowork/schedules/[id]/run` | «Ejecutar ahora»: abre la conversación ya, sin mover el horario (dos clics en el mismo minuto son la misma conversación). |

## Para encenderlo

1. Aplicar la migración (una sola, hacia adelante) y revisar esquema, RLS y registros.
2. `COWORK_SCHEDULES_ENABLED=true` en el entorno de la aplicación.
3. Crear una tarea de prueba para dentro de unos minutos y mirar que aparezca la conversación «Tarea programada · …» con su propuesta.

## Pruebas

- `src/lib/cowork/schedules.test.ts`: próxima hora para cada frecuencia, cambios de hora de Chile (salto adelante, salto atrás), zonas, entrada validada, textos.
- `src/lib/server/cowork/schedules.test.ts`: crear con límites, pausar y reanudar, cambiar el horario, tareas ajenas, una ejecución por hora aunque dos workers la vean, atrasos, fallas y pausa, acceso revocado, «ejecutar ahora».
- `src/app/api/cowork/schedules/schedules-route.test.ts`: las rutas actúan por la sesión, no por el cuerpo; apagado, errores.
- `supabase/tests/database/cowork_scheduled_tasks.test.sql`: RLS, restricciones, límites y el nuevo tipo de efecto.
