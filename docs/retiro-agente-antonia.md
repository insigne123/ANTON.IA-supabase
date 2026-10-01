# Retiro del agente ANTON.IA (misiones)

**Fecha:** 1 de octubre de 2026.

**Decisión del dueño:** el agente de misiones se retira y su rol lo asume Cowork. Por ahora Cowork sigue habilitado solo para la cuenta dueña. Abrirlo a más personas es una decisión aparte.

## Por qué

- **Poco uso:** en producción, una sola persona tenía una misión activa (GrupoExpro).
- **Fallaba todos los días desde el 24 de septiembre:** 369 errores `INVALID_ENRICHMENT_CONTACT_COUNT`. El worker mandaba hasta 50 contactos por llamada al enriquecimiento, que acepta 25.
- **Duplicaba a Cowork:** hacía lo mismo que Cowork (buscar, investigar y contactar), pero sin aprobación por acción.
- **Confundía:** sumaba una entrada al menú y un paso al tutorial.

## Qué se retiró

| Dónde | Qué |
|---|---|
| Pantallas | `/antonia` y `/antonia/reply-lab`. `/antonia` ahora redirige a `/cowork` (si la persona tiene acceso) o a `/dashboard`. También salió la página suelta `/admin/suggestions`. |
| Componentes | `src/components/antonia/*` y los módulos sin uso `src/lib/antonia-playbooks.ts` y `src/lib/services/antonia-service.ts`. |
| API | `/api/antonia/{missions,autopilot,exceptions,executive-report,next-actions,playbook-benchmarks,quota,reply-lab,trigger}` y `/api/cron/antonia`. |
| Worker (Firebase) | `antoniaTick`, `antoniaTickHttp`, el legacy `antoniaWorker` y todo el código de misiones de `functions/index.ts`. Quedan solo los puentes de las tareas programadas que siguen vivas. |
| Configuración | `ANTONIA_FIREBASE_TICK_URL` y `ANTONIA_FIREBASE_TICK_SECRET` en `apphosting.yaml`. |
| Menú y tutorial | La entrada «Agente ANTON.IA» y el paso «Deja que el agente trabaje». |
| Webhook de seguimiento | Ya no pausa misiones ni cancela tareas ante una respuesta negativa. Sigue clasificando, escalando y actualizando el CRM. |

## Qué se queda (lleva «antonia» en el nombre, pero no es el agente)

- **Créditos:** `antonia_event_ledger`, `antonia_credit_policies`, `antonia_daily_credit_buckets` y `antonia_event_rollups_daily` (con su tarea `antoniaRollupsTick`). Los usan los créditos de toda la app y el panel de administrador.
- **Respuestas:** `src/lib/antonia-reply-*`, `src/lib/server/antonia-reply-*` y `/api/antonia/replies/draft`. Es el motor de respuestas que usan Contactados, Cowork y el inicio.
- **Backend:** el backend `backend-antonia`, que hace la búsqueda, el enriquecimiento y la investigación de toda la app.
- **Datos:** las tablas `antonia_missions`, `antonia_tasks`, `antonia_reports` y `antonia_exceptions`. Quedan como **historial**: no se borra nada y no hay migración.

## Lo que hace el mantenedor

1. **Desplegar la app** como siempre.
2. **Desplegar las funciones:** `firebase deploy --only functions`. Firebase avisa que `antoniaTick`, `antoniaTickHttp` y `antoniaWorker` ya no existen en el código; confirmar su borrado (`--force` en CI).
3. **Pausar la misión activa.** Es una escritura en producción y la hace el mantenedor:

   ```sql
   update antonia_missions set status = 'paused', updated_at = now() where status = 'active';
   ```

   No hay que borrar nada.
4. **Opcional:** rotar el secreto histórico `ANTONIA_TICK_SECRET`. Sigue en uso como `CRON_SECRET`.
