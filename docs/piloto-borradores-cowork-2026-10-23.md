# Mejoras de borradores, investigación y Cowork con Haiku: qué está encendido, cómo se verifica y cómo se vuelve atrás (23 y 24 de octubre de 2026)

Esta página es la ficha de operación de las mejoras de `docs/borradores-ganchos-y-reglas.md` y `docs/senales-de-la-investigacion-al-correo.md` y del harness de Cowork con Haiku. El 23 de octubre se encendieron **solo para la cuenta del dueño** (piloto). El 24 de octubre el dueño pidió que fueran **para todas las cuentas** y que las pruebas las hiciera yo, evaluadas con sesiones de Claude Code y no con modelos de pago; este documento cuenta cómo quedó. Lo medido, y por qué, está en `docs/uso-como-persona-2026-10-23.md`.

## Qué está encendido hoy (24 de octubre): para todas las cuentas

Variables de `apphosting.yaml`, todas de ejecución (`RUNTIME`):

| Variable | Valor | Qué hace |
| --- | --- | --- |
| `DRAFT_SIGNAL_EVIDENCE_ENABLED` | `true` | Las señales que eligió el análisis llegan al correo |
| `DRAFT_HOOK_FILTER_ENABLED` | `true` | Los ganchos no aptos no llegan al redactor |
| `DRAFT_ANCHOR_SPECIFICS_ENABLED` | `true` | El hecho conserva su dato concreto y el correo lo nombra |
| `RESEARCH_SIGNAL_HARVEST_ENABLED` | `true` | Un Claude (Haiku) elige, entre los hechos que la investigación ya leyó, las señales recientes que sirven de motivo para escribir; solo se aceptan las que están escritas en los hechos que citan. Del orden de US$0,001 por investigación |
| `COWORK_RUNTIME` | `harness` | El coordinador de Cowork es un Claude con herramientas |
| `COWORK_HARNESS_MODEL` | `claude-haiku-5-5` | El modelo del harness |
| `COWORK_SCHEDULES_ENABLED` | `true` | Tareas programadas de Cowork: cada persona decide si crea una (hasta 5 activas); sin crear ninguna, no pasa nada |
| `COWORK_WEB_ENABLED`, `COWORK_WEB_BASIC` | `true` | **Segunda tanda (24 de octubre, tarde):** Cowork busca en la web y lee páginas (Anthropic corre ambas), con herramientas básicas y un tope por turno; US$0,01 por búsqueda, ya en la tabla de precios |
| `COWORK_SUBAGENTS_ENABLED` | `true` | Las Investigadoras: investigan varias empresas a la vez (rol `delegate` del libro de consumo) |
| `RESEARCH_CLAUDE_WEB_ENABLED` | `true` | Un Claude (Haiku) con la web elige las páginas que la investigación de leads lee; una página que no nombra a la empresa no se usa. Unos US$0,044 por investigación |
| `COWORK_DOCUMENT_VISION` | `true` | Un Claude (Haiku) mira las páginas de un documento largo antes de entregarlo; si el servidor no puede dibujarlas, no mira |
| `COWORK_AUTONOMY_ENABLED` | `true` | El modo «Autónomo» aparece en el compositor (cada conversación parte «Con aprobaciones»): guardar contactos, investigar, pedir borradores, buscar un correo (1 crédito), crear campañas en pausa y una búsqueda de prospectos, con tope de 3 pasos por hilo; un turno que leyó la web no aprueba nada solo |

Ningún modelo caro: Opus, Sonnet, Fable, Sol, Terra y Astra están bloqueados en el código (`src/ai/blocked-models.ts`), y `src/lib/server/production-configuration.test.ts` comprueba que `apphosting.yaml` no nombre ninguno y que esto sea lo que dice producción.

**Segunda tanda (24 de octubre, tarde): las cinco funciones que habían quedado apagadas se probaron y se encendieron**, por pedido del dueño («todo lo que mejore el funcionamiento que se quede»). La web de Claude en Cowork y las Investigadoras no estaban encendidas porque su costo no tenía precio en la tabla del libro y su calidad con Haiku no se había leído; el investigador de leads, porque solo se había medido contra «solo el sitio»; la visión de documentos, porque no se sabía si el servidor podía dibujar las páginas; el modo autónomo, porque actúa sin que nadie apruebe. Qué se probó, qué se encontró y qué se cambió para dejarlas seguras está en **`docs/funciones-apagadas-encendidas-2026-10-24.md`**, con las consultas para vigilarlas y la forma de apagar cada una. Lo que sigue sin medirse: el investigador contra Serper (no hay llave de Serper de prueba), el modo autónomo de punta a punta contra una base, y si la organización de Anthropic de producción tiene encendida la búsqueda web (si no la tiene, el turno cae al bucle y la web se pausa 10 minutos, ver esa página).

## Evidencia para encenderlo para todos

- **Borradores, leídos a ciegas por una sesión de Claude Code** (sin API): 16 pares de correos, producción hoy frente a las tres banderas, con el orden barajado y la clave abierta después. **Gana lo nuevo en 11, lo de hoy en 4, un empate.** Las banderas sacan ganchos que no sirven (Gasco con la FNE, Ingevec explicando qué es un *backlog*, Aguas Andinas con «son comunas»), nombran el dato (Enaex: Antofagasta y Atacama) y no inventan razonamientos (tres frases sin respaldo en los correos de hoy, ninguna en los nuevos). Pierden donde el hecho que abre es un resumen (Sodexo) y empatan en SMU. Detalle, tabla y límites en `docs/borradores-ganchos-y-reglas.md`.
- **Cosecha de señales con Haiku** (prueba de humo, 8 informes guardados, unos US$0,007 reales): entrega señales fechadas y escritas en los hechos que cita en 5 de 8 empresas, y rechaza la que no sirve (Gasco). Es lo que arregla el caso de Sodexo. Detalle en `docs/senales-de-la-investigacion-al-correo.md`.
- **Cowork, leído a ciegas en el mismo formato**: las 8 conversaciones guardadas del bucle de Luna y del harness de Haiku; **gana Haiku 5, Luna 3**; la medida automática dio 7 de 8 contra 6 de 8. Costo parecido: unos US$0,007 por conversación contra US$0,006. Un turno que Anthropic no puede terminar (llave, saldo, 429, 5xx) sigue con el bucle de Luna.
- **Quiénes escriben hoy** (borradores de los últimos 60 días): Yago (AXIS), PSOL (selección de personal) y Grupoexpro (outsourcing, facility y seguridad). Ninguno vende cumplimiento o libre competencia, donde el filtro de ganchos (FNE, TDLC) podría sacar justo el mejor motivo para escribir.
- **La tabla de precios acierta con el modelo**: la API devuelve `claude-haiku-5-5`, igual que la clave de `COWORK_MODEL_PRICING_JSON`, así que el costo de cada llamada queda registrado (y no en blanco).
- **Pruebas**: el CI completo (tipos, unidades, base de datos con pgTAP y el `build` de producción) pasó antes de cada fusión.

**Riesgos que se conocen:**

- La función de base nueva (`cowork_reserve_model_call`) y el harness **no han atendido tráfico real**: el primer turno es su primera prueba. El harness reserva y registra con las mismas llamadas del libro de consumo que el bucle de Luna (rol `coordinator`, tope de 5 por turno), y esa parte del SQL no cambió; lo que cambió son las líneas del rol `delegate`.
- Un error `400` de Anthropic no cae al bucle de Luna (sí lo hacen 429, 5xx, saldo, llave y rechazos), **salvo que la petición llevara la web**: con la web encendida, un 400 hace que el turno siga con el bucle y que esa instancia no ofrezca la web durante 10 minutos. La prueba real con la API pasó los 8 casos con la misma construcción de la petición.
- Las tareas programadas y la cosecha tampoco han corrido en producción. Las dos fallan hacia lo que había: la cosecha, sin señales; las tareas, sin disparar.

## Historia: el piloto del 23 de octubre

El 23 de octubre se encendieron siete variables **solo** para la cuenta del dueño (`nicolas.yarur.g@yago.cl`, `de3a3194-29b1-449a-828a-53608a7ebe47`): `DRAFT_PILOT_USER_IDS` y `COWORK_HARNESS_USER_IDS` con ese id, más las tres banderas de borradores, `COWORK_RUNTIME` y `COWORK_HARNESS_MODEL`. El mensaje que autorizó el piloto dejó `<correos o IDs>` sin completar y se tomó lo más acotado. Cuando se amplió, nadie había usado todavía el piloto. Las dos listas siguen existiendo en el código: con ellas las mejoras valen solo para esas personas (ver «Limitar a unas personas»).

## Lo hecho y verificado antes del despliegue

| Paso | Estado | Qué se verificó |
| --- | --- | --- |
| PR 521 (filtro de ganchos y dato concreto, apagados) | fusionado | CI verde |
| PR 522 (`DRAFT_PILOT_USER_IDS`) | fusionado | CI verde; con la lista, quien no está en ella escribe como antes digan lo que digan las banderas |
| Migración `20261023120000_cowork_scheduled_tasks` | aplicada en producción (`yfdelflsheurzaicwayi`), registrada como `20261023210858` | Tabla nueva con RLS activada y una política de lectura propia (`cowork_scheduled_tasks_private_read`); lectura para `authenticated` solo de lo suyo, todo para `service_role` y `postgres`; sus dos índices y el trigger de tope; tablas 306 → 307, políticas 377 → 378, triggers 124 → 125; las 25 tablas sin RLS de antes siguen siendo las mismas; alertas de seguridad idénticas a las de antes (se comparó el archivo completo sin la hora de observación); el registro de Postgres no mostró `ERROR`, `FATAL` ni `PANIC` |
| Migración `20261023130000_cowork_delegate_model_calls` | aplicada, registrada como `20261023211042` | La función `cowork_reserve_model_call` de antes tenía exactamente el cuerpo del repositorio (md5 `c2accc77…`, 3 606 caracteres) y ahora tiene el nuevo (md5 `ffc3166c…`, 4 245); la restricción de roles tiene los 8 roles y está validada; `cowork_record_model_usage` reconoce `delegate`; permisos conservados; alertas de seguridad idénticas; registro sin errores |
| Despliegue del 24 de octubre (00:41 UTC) | hecho | `main` en `e19bc5ce`, con las siete variables del piloto; el backend `studio` actualizado a las 00:41:36, `/login` responde 200 y sin errores en los registros de Postgres |

Las dos migraciones son hacia adelante y no cambian lo que el libro hacía para los roles de antes. La tabla de tareas está vacía hasta que alguien cree una, y no hubo llamadas del rol `delegate` hasta que se encendieron las Investigadoras, la tarde del 24 de octubre.

Otras dos migraciones del repositorio, `create_enriched_opportunities` y `fix_enriched_opportunities`, no figuran en el registro de producción; no hacen falta y no se tocaron.

## Desplegar

Desde un checkout de `main` al día, no desde un árbol desprendido:

```bash
firebase deploy --only apphosting -P leadflowai-3yjcy --non-interactive
```

- Es el procedimiento de `docs/cowork-deploy-2026-09-21.md`: termina con `Rollout for backend studio complete` y `Deploy complete`. El backend es `studio`, en `us-central1`. App Hosting construye en la nube con el `apphosting.yaml` del código subido, así que lo que se despliega es lo que está en `main`. (`npm run verify:prod-config` pide el entorno de producción completo en la terminal; sin él falla por diseño y no sirve de comprobación local.)
- La credencial no se guarda en el repositorio. El CLI la toma de la sesión de `firebase login`, de `FIREBASE_TOKEN` (de `firebase login:ci`) o de `GOOGLE_APPLICATION_CREDENTIALS` (una cuenta de servicio). Si venció (`Authentication Error: Your credentials are no longer valid`, ya pasó antes: `docs/cowork-phase4-status.md`), se renueva con `firebase login --reauth` o se pone una nueva en las variables del entorno donde corre el despliegue; nunca se pega en el chat.
- `apphosting.yaml` se lee al desplegar: sin un despliegue nuevo, los cambios de variables no existen para la app.

## Después del despliegue: qué mirar

Sustituye `<DESDE>` por la hora del despliegue (UTC). Todas son de solo lectura.

**1. ¿Quién corre en qué modelo?** Los coordinadores de Cowork en `claude-haiku-5-5`; `gpt-6-luna` solo en los roles de redacción y revisión y en los turnos que cayeron al bucle por un fallo de Anthropic; ninguna fila con un modelo bloqueado.

```sql
select c.usage->>'model' as modelo, c.role, count(distinct c.user_id) as personas,
       count(*) as llamadas, count(c.usage) as con_consumo,
       round(sum((c.usage->>'costUsd')::numeric), 5) as usd
from public.cowork_model_calls c
where c.created_at >= '<DESDE>'
group by 1, 2 order by 1, 2;
```

Si el coordinador aparece en `gpt-6-luna` en todas las filas, el harness no se encendió (una variable ausente) o todos los turnos cayeron al bucle. Si `con_consumo` es menor que `llamadas`, hay llamadas reservadas sin consumo registrado.

**2. Costo por conversación.** Antes del cambio, con el bucle de Luna, las conversaciones de la cuenta del dueño en octubre costaron entre US$0,002 y US$0,015 (US$0,002 a US$0,004 por turno). Las 8 conversaciones medidas del harness con Haiku: unos US$0,007 cada una.

```sql
select coalesce(r.root_run_id, r.id) as conversacion,
       min(r.created_at)::timestamp(0) as desde,
       count(distinct r.id) as turnos,
       count(c.id) as llamadas, count(c.usage) as con_consumo,
       round(sum((c.usage->>'costUsd')::numeric), 5) as usd,
       round(sum((c.usage->>'costUsd')::numeric) / nullif(count(distinct r.id), 0), 5) as usd_por_turno
from public.cowork_runs r join public.cowork_model_calls c on c.run_id = r.id
where r.created_at >= '<DESDE>'
group by 1 order by min(r.created_at) desc limit 20;
```

**3. ¿Fallaron turnos?** Un turno que termina en error o sin respuesta es lo primero que hay que mirar: la función `cowork_reserve_model_call` nueva y el tope de 5 llamadas del coordinador por turno (`COWORK_MAX_COORDINATOR_CALLS`; el harness trabaja con ese mismo tope) se prueban aquí por primera vez con tráfico real.

```sql
select status, count(*) as turnos, count(distinct user_id) as personas, max(updated_at)::timestamp(0) as ultimo
from public.cowork_runs
where created_at >= '<DESDE>'
group by 1 order by 2 desc;
```

Y en los registros de Postgres, errores `Model budget exhausted`, `Model attempt expired` o `Model access revoked` (consulta de `query_logs`: `select timestamp, event_message from logs where source = 'postgres_logs' and event_message ilike '%Model %' order by timestamp desc limit 20`). Los turnos que cayeron al bucle dejan un evento `turn.rescued` con `failure: 'harness_error'` en `cowork_run_events`.

**4. Los borradores** (la muestra que hay que leer: asunto y cuerpo, y si el redactor tuvo que reintentar):

```sql
select v.created_at::timestamp(0) as creado, v.preflight->>'status' as preflight,
       v.content->>'subject' as asunto, left(v.content->>'text', 900) as cuerpo
from public.messaging_draft_versions v
where v.created_at >= '<DESDE>'
order by v.created_at desc limit 10;
```

```sql
select a.created_at::date as dia, a.model,
       count(distinct a.draft_id) as borradores, count(*) as intentos,
       count(*) filter (where not a.passed) as fallidos,
       round(count(*)::numeric / nullif(count(distinct a.draft_id), 0), 2) as intentos_por_borrador
from public.messaging_draft_generation_attempts a
where a.created_at >= now() - interval '14 days'
group by 1, 2 order by 1 desc, 2;
```

Qué mirar al leerlos, en el orden de lo medido: que el correo **nombre el dato concreto** de la investigación (regiones, cifra, nombre propio, la vacante con su fecha) y no «el norte de Chile»; que **no abra con un gancho no apto** (una glosa de boletín, «son comunas», el debate de competencia); y que no haya afirmaciones que ninguna fuente respalde. Lo medido esperaba: ganchos no aptos de 6 de 16 a 2 de 16, el dato concreto en 4 de 4 en el caso que lo perdía, menos reintentos, y ningún cambio en «suena humano» (sigue en «corregir» y no en «enviar»: lo que falta es un Perfil de vendedor más rico, es decir, cifras propias y clientes que se puedan nombrar).

La referencia de los reintentos es la de antes del 24 de octubre en la misma consulta (en octubre, las demás cuentas tuvieron 5,2 intentos por borrador con 105 intentos fallidos de 130, contando todos los pasos de la secuencia).

## Volver atrás

De más fino a más grueso. En todos los casos el siguiente borrador y el siguiente turno ya corren como antes, y no hace falta tocar la base:

1. **Una sola mejora:** quitar su variable de `apphosting.yaml` (`DRAFT_ANCHOR_SPECIFICS_ENABLED`, `DRAFT_HOOK_FILTER_ENABLED`, `DRAFT_SIGNAL_EVIDENCE_ENABLED`, `RESEARCH_SIGNAL_HARVEST_ENABLED`, `COWORK_SCHEDULES_ENABLED`) y desplegar. Un aviso: un borrador escrito con `DRAFT_ANCHOR_SPECIFICS_ENABLED` encendida y vuelto a validar con ella apagada puede no pasar la verificación de personalización; conviene cambiarla entre campañas. Apagar las tareas programadas no borra las que alguien creó: quedan en su tabla, sin disparar.
2. **El harness de Cowork:** quitar `COWORK_RUNTIME` y `COWORK_HARNESS_MODEL` y desplegar. Los turnos vuelven al bucle de Luna (y sin harness no hay web ni Investigadoras).
   **Las funciones de la segunda tanda** se apagan una por una quitando su variable (`COWORK_WEB_ENABLED`, `COWORK_SUBAGENTS_ENABLED`, `RESEARCH_CLAUDE_WEB_ENABLED`, `COWORK_DOCUMENT_VISION`, `COWORK_AUTONOMY_ENABLED`); la tabla está en `docs/funciones-apagadas-encendidas-2026-10-24.md`.
3. **Todo:** quitar las variables de las dos tandas y desplegar con el mismo comando (la prueba `production-configuration.test.ts` hay que actualizarla en el mismo cambio: describe lo que dice producción). Otra salida, sin cambiar el repositorio, es volver al despliegue anterior desde la consola de App Hosting (backend `studio`, «Rollouts»); después, comprobar con la consulta 1 que los coordinadores ya no corren en Haiku.
4. **Las migraciones no se deshacen:** son hacia adelante, no cambian lo que las funciones hacían para los roles de antes, y la tabla de tareas solo tiene lo que la gente cree. Dejarlas aplicadas es lo seguro.

## Limitar a unas personas

Las dos listas del piloto siguen funcionando: con **`DRAFT_PILOT_USER_IDS`** las tres banderas de borradores valen solo para esas personas, y con **`COWORK_HARNESS_USER_IDS`** el harness corre solo para ellas y el resto sigue en el bucle de Luna. Se escriben ids de usuario (no correos) separados por coma, y `production-configuration.test.ts` exige que, si están las dos, sean las mismas personas. La web de Cowork y las Investigadoras son parte del harness, así que `COWORK_HARNESS_USER_IDS` también las limita a esas personas. La cosecha de señales, las tareas programadas, el investigador de leads, la visión de documentos y el modo autónomo no tienen lista: se apagan con su variable.

El id de una persona sale de `select id from auth.users where lower(email) = lower('<correo>')`.
