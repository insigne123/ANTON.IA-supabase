# Cowork · plazo de las tareas largas (Plan 14, 3)

La especificación de comportamiento de OpenAI (Model Spec) pide que todo alcance de autonomía tenga una condición de término, idealmente un plazo. Hasta ahora, una tarea larga aprobada (Plan 13, 4c) terminaba de tres formas:
- al hacer todos sus pasos;
- al escribir la persona;
- al salirse un paso del plan o de sus límites.

Le faltaba el tiempo.

## Qué cambia

- **Un plan aprobado aprueba sus pasos solo durante 24 horas** desde que se aprobó. Se cambia con `COWORK_TASK_TTL_HOURS`, de 1 a 168; cualquier otro valor deja 24.
- **Pasado el plazo**, la tarea deja de estar activa y cada paso que falte vuelve a pedir aprobación con su tarjeta, como fuera de una tarea. Lo mismo pasa si no se puede leer cuándo se aprobó: se pregunta antes que seguir sin límite.
- **La tarjeta del plan lo dice:** «Si escribes un mensaje, la tarea se detiene ahí, y si no termina en 24 horas, lo que falte te lo pregunto antes». La ruta del plan devuelve `ttlHours` para que el texto use el valor configurado.

## Cómo funciona

- `loadCoworkActiveTask` (`src/lib/server/cowork/task-state.ts`) lee la hora del evento `task.started` del turno que inició la tarea. Si ya pasó el plazo, o no hay hora, devuelve `null`.
- La hora actual y el plazo se pueden inyectar, para las pruebas.

Sin migración: la hora es el `created_at` del evento.

## Rollback

`git revert` del PR. Para dar más tiempo sin revertir, basta con subir `COWORK_TASK_TTL_HOURS`.
