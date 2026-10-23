# Piloto de borradores y de Cowork con Haiku: qué está encendido, cómo se verifica y cómo se vuelve atrás (23 de octubre de 2026)

Esta página es la ficha de operación del piloto que autorizó el dueño: las tres mejoras de borradores de `docs/borradores-ganchos-y-reglas.md` y el harness de Cowork con Haiku, **solo para la cuenta del dueño**. Lo medido y por qué está en `docs/uso-como-persona-2026-10-23.md`.

## Qué se enciende y para quién

Siete variables de `apphosting.yaml`, todas de ejecución (`RUNTIME`):

| Variable | Valor | Qué hace |
| --- | --- | --- |
| `DRAFT_PILOT_USER_IDS` | `de3a3194-29b1-449a-828a-53608a7ebe47` | Las tres banderas de borradores valen solo para estas personas |
| `DRAFT_SIGNAL_EVIDENCE_ENABLED` | `true` | Las señales que eligió el análisis llegan al correo |
| `DRAFT_HOOK_FILTER_ENABLED` | `true` | Los ganchos no aptos no llegan al redactor |
| `DRAFT_ANCHOR_SPECIFICS_ENABLED` | `true` | El hecho conserva su dato concreto y el correo lo nombra |
| `COWORK_RUNTIME` | `harness` | El coordinador de Cowork es un Claude con herramientas |
| `COWORK_HARNESS_MODEL` | `claude-haiku-5-5` | El modelo del harness |
| `COWORK_HARNESS_USER_IDS` | la misma persona | El resto de las cuentas sigue en el bucle de Luna |

**La persona.** El mensaje que autorizó el piloto dejó `<correos o IDs>` sin completar y se tomó lo más acotado: la cuenta del propio dueño, `nicolas.yarur.g@yago.cl` (id de arriba; correo verificado, propietario o administrador de dos organizaciones, acceso a Cowork habilitado, la misma de `ADMIN_USAGE_PLATFORM_USER_IDS`).

**Lo que no se enciende:** la web de Claude (`COWORK_WEB_ENABLED`), los subagentes (`COWORK_SUBAGENTS_ENABLED`), las tareas programadas (`COWORK_SCHEDULES_ENABLED`), la lectura de documentos con visión (`COWORK_DOCUMENT_VISION`) ni ningún modelo caro: Opus, Sonnet, Fable, Sol, Terra y Astra están bloqueados en el código (`src/ai/blocked-models.ts`), y `src/lib/server/pilot-configuration.test.ts` comprueba que `apphosting.yaml` no nombre ninguno.

## Lo hecho y verificado antes del despliegue

| Paso | Estado | Qué se verificó |
| --- | --- | --- |
| PR 521 (filtro de ganchos y dato concreto, apagados) | fusionado | CI verde |
| PR 522 (`DRAFT_PILOT_USER_IDS`) | fusionado | CI verde; con la lista, quien no está en ella escribe como antes digan lo que digan las banderas |
| Migración `20261023120000_cowork_scheduled_tasks` | aplicada en producción (`yfdelflsheurzaicwayi`), registrada como `20261023210858` | Tabla nueva con RLS activada y una política de lectura propia (`cowork_scheduled_tasks_private_read`); lectura para `authenticated` solo de lo suyo, todo para `service_role` y `postgres`; sus dos índices y el trigger de tope; tablas 306 → 307, políticas 377 → 378, triggers 124 → 125; las 25 tablas sin RLS de antes siguen siendo las mismas; alertas de seguridad idénticas a las de antes (se comparó el archivo completo sin la hora de observación); el registro de Postgres no mostró `ERROR`, `FATAL` ni `PANIC` |
| Migración `20261023130000_cowork_delegate_model_calls` | aplicada, registrada como `20261023211042` | La función `cowork_reserve_model_call` de antes tenía exactamente el cuerpo del repositorio (md5 `c2accc77…`, 3 606 caracteres) y ahora tiene el nuevo (md5 `ffc3166c…`, 4 245); la restricción de roles tiene los 8 roles y está validada; `cowork_record_model_usage` reconoce `delegate`; permisos conservados; alertas de seguridad idénticas; registro sin errores |

Las dos son hacia adelante e inertes por sí solas: nada reserva el rol `delegate` ni lee la tabla de tareas mientras `COWORK_SUBAGENTS_ENABLED` y `COWORK_SCHEDULES_ENABLED` sigan apagados. **La función nueva no ha atendido tráfico real todavía**: el primer turno del piloto es su primera prueba (ver «Después del despliegue»).

Otras dos migraciones del repositorio, `create_enriched_opportunities` y `fix_enriched_opportunities`, no figuran en el registro de producción; no hacen falta para el piloto y no se tocaron.

## Desplegar

Desde un checkout de `main` al día (con los PR 523 y 524 fusionados), no desde un árbol desprendido:

```bash
firebase deploy --only apphosting -P leadflowai-3yjcy --non-interactive
```

- Es el procedimiento de `docs/cowork-deploy-2026-09-21.md`: termina con `Rollout for backend studio complete` y `Deploy complete`. El backend es `studio`, en `us-central1`. App Hosting construye en la nube con el `apphosting.yaml` del código subido, así que lo que se despliega es lo que está en `main`. (`npm run verify:prod-config` pide el entorno de producción completo en la terminal; sin él falla por diseño y no sirve de comprobación local.)
- La credencial no se guarda en el repositorio. El CLI la toma de la sesión de `firebase login`, de `FIREBASE_TOKEN` (de `firebase login:ci`) o de `GOOGLE_APPLICATION_CREDENTIALS` (una cuenta de servicio). Si venció (`Authentication Error: Your credentials are no longer valid`, ya pasó antes: `docs/cowork-phase4-status.md`), se renueva con `firebase login --reauth` o se pone una nueva en las variables del entorno donde corre el despliegue; nunca se pega en el chat.
- `apphosting.yaml` se lee al desplegar: sin un despliegue nuevo, las siete variables no existen para la app.
- **Antes de desplegar**, comprobar que la cuenta del piloto no tenga borradores a medio escribir (para que las banderas estén vivas antes de crear los borradores del piloto, no durante):

```sql
select (select count(*) from public.native_draft_generation_claims where user_id = 'de3a3194-29b1-449a-828a-53608a7ebe47') as claims,
       (select count(*) from public.research_sequence_preparations where user_id = 'de3a3194-29b1-449a-828a-53608a7ebe47' and status not in ('completed', 'failed', 'cancelled', 'review_required')) as preparaciones_en_curso,
       (select count(*) from public.lead_research_jobs where user_id = 'de3a3194-29b1-449a-828a-53608a7ebe47' and status in ('queued', 'running')) as investigaciones_en_curso;
```

Los tres en 0. (A las 21:40 UTC del 23 de octubre estaban en 0, 0 y 0, y el piloto no tenía borradores de las últimas 24 horas.)

## Después del despliegue: qué mirar

Sustituye `<DESDE>` por la hora del despliegue (UTC). Todas son de solo lectura. Los borradores del piloto se crean **después** de que el despliegue termine, no durante, para que ninguno quede a medio escribir con las banderas apagadas.

**1. ¿Quién corre en qué modelo?** El piloto en `claude-haiku-5-5`; todos los demás en `gpt-6-luna`; ninguna fila con un modelo bloqueado.

```sql
select c.user_id = 'de3a3194-29b1-449a-828a-53608a7ebe47' as piloto,
       c.usage->>'model' as modelo, c.role,
       count(*) as llamadas, count(c.usage) as con_consumo,
       round(sum((c.usage->>'costUsd')::numeric), 5) as usd
from public.cowork_model_calls c
where c.created_at >= '<DESDE>'
group by 1, 2, 3 order by 1 desc, 2, 3;
```

Si el piloto aparece en `gpt-6-luna`, el harness no se encendió (una variable ausente, o el turno cayó al bucle de Luna por un fallo del proveedor: es la salida segura prevista). Si `con_consumo` es menor que `llamadas`, hay llamadas reservadas sin consumo registrado.

**2. Costo por conversación del piloto.** Antes del cambio, con el bucle de Luna, las conversaciones de la cuenta en octubre costaron entre US$0,002 y US$0,015 (US$0,002 a US$0,004 por turno). Las 8 conversaciones medidas del harness con Haiku: unos US$0,007 cada una.

```sql
select coalesce(r.root_run_id, r.id) as conversacion,
       min(r.created_at)::timestamp(0) as desde,
       count(distinct r.id) as turnos,
       count(c.id) as llamadas, count(c.usage) as con_consumo,
       round(sum((c.usage->>'costUsd')::numeric), 5) as usd,
       round(sum((c.usage->>'costUsd')::numeric) / nullif(count(distinct r.id), 0), 5) as usd_por_turno
from public.cowork_runs r join public.cowork_model_calls c on c.run_id = r.id
where r.user_id = 'de3a3194-29b1-449a-828a-53608a7ebe47' and r.created_at >= '<DESDE>'
group by 1 order by min(r.created_at);
```

**3. ¿Fallaron turnos?** Un turno del piloto que termina en error o sin respuesta es lo primero que hay que mirar: la función `cowork_reserve_model_call` nueva y el tope de 5 llamadas del coordinador por turno (`COWORK_MAX_COORDINATOR_CALLS`; el harness trabaja con ese mismo tope) se prueban aquí por primera vez con tráfico real.

```sql
select status, count(*) as turnos, max(updated_at)::timestamp(0) as ultimo
from public.cowork_runs
where user_id = 'de3a3194-29b1-449a-828a-53608a7ebe47' and created_at >= '<DESDE>'
group by 1 order by 2 desc;
```

Y en los registros de Postgres, errores `Model budget exhausted`, `Model attempt expired` o `Model access revoked` (consulta de `query_logs`: `select timestamp, event_message from logs where source = 'postgres_logs' and event_message ilike '%Model %' order by timestamp desc limit 20`).

**4. Los borradores del piloto** (la muestra que hay que leer: asunto y cuerpo, y si el redactor tuvo que reintentar):

```sql
select v.created_at::timestamp(0) as creado, v.preflight->>'status' as preflight,
       v.content->>'subject' as asunto, left(v.content->>'text', 900) as cuerpo
from public.messaging_draft_versions v
where v.user_id = 'de3a3194-29b1-449a-828a-53608a7ebe47' and v.created_at >= '<DESDE>'
order by v.created_at;
```

```sql
select (a.user_id = 'de3a3194-29b1-449a-828a-53608a7ebe47') as piloto, a.model,
       count(distinct a.draft_id) as borradores, count(*) as intentos,
       count(*) filter (where not a.passed) as fallidos,
       round(count(*)::numeric / nullif(count(distinct a.draft_id), 0), 2) as intentos_por_borrador
from public.messaging_draft_generation_attempts a
where a.created_at >= '<DESDE>'
group by 1, 2 order by 1 desc;
```

Qué mirar al leerlos, en el orden de lo medido: que el correo **nombre el dato concreto** de la investigación (regiones, cifra, nombre propio) y no «el norte de Chile»; que **no abra con un gancho no apto** (una glosa de boletín, «son comunas», el debate de competencia); y que no haya afirmaciones que ninguna fuente respalde. Lo medido esperaba: ganchos no aptos de 6 de 16 a 2 de 16, el dato concreto en 4 de 4 en el caso que lo perdía, menos reintentos, y ningún cambio en «suena humano» (sigue en «corregir» y no en «enviar»: lo que falta es un Perfil de vendedor más rico).

La cuenta del piloto no tiene una línea de base propia con Luna (sus cuatro borradores de octubre son del 5 de octubre y los escribió un modelo que hoy está bloqueado); la referencia es el resto de las cuentas, que siguen escribiendo como antes, en el mismo período.

## Volver atrás

De más fino a más grueso. En todos los casos el siguiente borrador y el siguiente turno ya corren como antes, y no hace falta tocar la base:

1. **Una sola mejora de borradores:** quitar su variable (`DRAFT_ANCHOR_SPECIFICS_ENABLED`, `DRAFT_HOOK_FILTER_ENABLED` o `DRAFT_SIGNAL_EVIDENCE_ENABLED`) y desplegar. Un aviso: un borrador escrito con `DRAFT_ANCHOR_SPECIFICS_ENABLED` encendida y vuelto a validar con ella apagada puede no pasar la verificación de personalización; conviene cambiarla entre campañas.
2. **El harness de Cowork:** quitar `COWORK_RUNTIME`, `COWORK_HARNESS_MODEL` y `COWORK_HARNESS_USER_IDS` y desplegar. Los turnos vuelven al bucle de Luna.
3. **Todo el piloto:** quitar las siete variables de `apphosting.yaml` y desplegar con el mismo comando (la prueba `pilot-configuration.test.ts` acepta que no haya ninguna). Otra salida, sin cambiar el repositorio, es volver al despliegue anterior desde la consola de App Hosting (backend `studio`, «Rollouts»); después, comprobar con la consulta 1 que el piloto ya no corre en Haiku.
4. **Las migraciones no se deshacen:** son hacia adelante, no cambian lo que las funciones hacían para los roles de antes, y la tabla de tareas está vacía y no hay llamadas del rol `delegate` (a las 21:40 UTC del 23 de octubre, 0 y 0). Dejarlas aplicadas es lo seguro.

## Sumar o quitar personas

Agregar su id de usuario (no el correo) a **las dos listas**, `DRAFT_PILOT_USER_IDS` y `COWORK_HARNESS_USER_IDS`, separado por coma, y desplegar. `pilot-configuration.test.ts` exige que sean las mismas personas y que sean ids. Para abrirlo a todos hay que sacar las listas, y eso obliga a cambiar la prueba: es una decisión, no un descuido. Conviene ampliar después de leer los borradores y el costo del piloto, no antes.

El id de una persona sale de `select id from auth.users where lower(email) = lower('<correo>')`.
