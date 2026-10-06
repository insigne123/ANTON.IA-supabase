# Para la IA mantenedora: deploy del 6 de octubre de 2026 (Plan 11 y Plan 12)

Hola. Te dejo lo que hay que llevar a producción, en orden. Todo está en `main`; no hay PR pendientes.

**Las reglas de `AGENTS.md` siguen igual:**

- deploy desde un `main` limpio, smoke y tag `prod-*`;
- una migración por vez, verificada antes de seguir;
- sin envíos reales.

Una regla nueva del dueño: **nunca usar modelos `astra`** (ver «Modelos» abajo).

## 1. Qué se despliega

- **`main` en `a07ace0`** (#217). El último deploy etiquetado es `prod-2026-10-04-2`.
- **Lo que entró desde entonces son 40 PR (#178 a #217):**
  - **Plan 11:** Oportunidades con ticket propio, Leads Finder, el Pipeline como CRM, importar Excel, firmas y estilo, tutoriales y sencillez.
  - **Plan 12 (Cowork):** artefactos con código y lienzo, la Diseñadora, «hace el trabajo en vez de devolverlo», la Redactora que propone la campaña, preferencias, cifras, la Analista, seguridad y el bloqueo de astra.
  - El detalle está en `docs/cowork-plan12-final.md`.
- **Si hubo un deploy sin tag después del 4 de octubre,** compara con la revisión activa antes de seguir.

**El código no depende de las migraciones pendientes**, así que se despliega primero:

- **Los montos del Pipeline** van detrás de `CRM_DEAL_VALUES_ENABLED`. Si faltan las columnas (`42703`), la app lee sin ellas.
- **Las preferencias** van detrás de `COWORK_PREFERENCES_ENABLED`.
- **El REVOKE** no cambia nada que la app use: el worker usa `service_role`.

**Pasos:**

1. **App Hosting:** `firebase deploy --only apphosting -P leadflowai-3yjcy --non-interactive` (backend `studio`).
2. **Functions:** cambió `commercialOpportunitiesTick` (`retryCount: 0`, para no repetir consultas pagadas de JSearch). Despliégala: `firebase deploy --only functions:commercialOpportunitiesTick -P leadflowai-3yjcy --non-interactive`.
3. **Comprueba el rollout:**
   - revisión nueva con el 100 % del tráfico, Ready;
   - Cloud Logging sin errores de severidad ERROR o mayor en esa revisión.
4. **Smoke sin sesión:** `/api/onboarding/tour` da 401, `/cowork` da 200 y `POST /api/cowork/wake` da 401.
5. **Tag:** `prod-2026-10-06`.

## 2. Las tres migraciones pendientes

Proyecto de producción `yfdelflsheurzaicwayi`.

- **Lo que falta:** el 6 de octubre, `list_migrations` mostró que faltan exactamente estas tres. `commercial_opportunity_tickets` y `lead_search_vault` ya están aplicadas.
- **Autorización:** el dueño autorizó las tres, y quiere correrlas él en el editor SQL de Supabase. Coordina con él; si te pide aplicarlas tú, es una por vez y cada una se verifica antes de la siguiente.

### 2.1 `supabase/migrations/20261005150000_crm_deal_values_stage_events.sql` (Pipeline)

**Qué hace:**

- agrega a `unified_crm_data` las columnas `deal_value`, `deal_currency`, `stage_changed_at`, `won_at` y `lost_at`;
- crea la tabla `crm_stage_events`, con RLS y una política de lectura para los miembros de la organización;
- crea los triggers `crm_stage_dates` y `crm_log_stage_change`.

**Verificación** (deben salir 5 columnas, 2 triggers, RLS en `true` y 1 política):

```sql
select count(*) as columnas from information_schema.columns
where table_schema = 'public' and table_name = 'unified_crm_data'
  and column_name in ('deal_value', 'deal_currency', 'stage_changed_at', 'won_at', 'lost_at');
select tgname from pg_trigger
where tgrelid = 'public.unified_crm_data'::regclass and tgname in ('crm_stage_dates', 'crm_log_stage_change');
select relrowsecurity from pg_class where oid = 'public.crm_stage_events'::regclass;
select polname from pg_policy where polrelid = 'public.crm_stage_events'::regclass;
```

**Después:** `CRM_DEAL_VALUES_ENABLED=true` (sección 3).

### 2.2 `supabase/migrations/20261006150000_revoke_internal_functions_from_clients.sql` (seguridad, #212)

**Qué hace:** saca `EXECUTE` a `public`, `anon` y `authenticated` en siete funciones del worker. `service_role` lo conserva.

**Verificación:** las siete filas deben dar `false` y `false`.

```sql
select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon,
  has_function_privilege('authenticated', p.oid, 'execute') as authenticated
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('claim_antonia_tasks', 'schedule_daily_mission_tasks', 'increment_daily_usage',
  'claim_suplia_tool_lease', 'release_suplia_tool_lease', 'trigger_antonia_worker', 'trigger_antonia_daily_execution');
```

**Después:** revisa los logs del worker de ANTON.IA y de `pg_cron` durante una hora. Si alguna función se llamaba con sesión, aparecerá como `permission denied`.

### 2.3 `supabase/migrations/20261006160000_cowork_memory_save_effect.sql` (preferencias, #215)

**Qué hace:** agrega el tipo de efecto `memory_save` al check de `cowork_effect_proposals` y a `cowork_propose_effect`.

**Verificación** (las dos deben dar `true`):

```sql
select pg_get_constraintdef(oid) like '%memory_save%' from pg_constraint where conname = 'cowork_effect_proposals_kind_check';
select pg_get_functiondef('public.cowork_propose_effect(uuid,uuid,text,uuid,text,text)'::regprocedure) like '%memory_save%';
```

**Después:** `COWORK_PREFERENCES_ENABLED=true` (sección 3).

## 3. Flags en `apphosting.yaml`

Los flags viven en el repositorio: se cambian con un PR (`claude/*` o `feat/*`, con `ia-automerge`) y un deploy. Hazlo después de verificar el deploy base.

`COWORK_ANSWER_HOLD_ENABLED` ya está en `"true"`. Faltan estos:

```yaml
  # La consulta que una respuesta ofrece («¿Reviso…?») se hace en el mismo turno (docs/cowork-plan12-causas-raiz.md).
  # Sin migración. Es la queja más repetida del juez en la ronda final del Plan 12.
  - variable: COWORK_OFFERED_READS_ENABLED
    value: "true"
    availability: [RUNTIME]
  # La Diseñadora: tableros y gráficos a medida en el lienzo (docs/cowork-disenadora.md). Sin migración: usa el bucket
  # privado cowork-artifacts, que ya existe en producción.
  - variable: COWORK_CODE_ARTIFACTS_ENABLED
    value: "true"
    availability: [RUNTIME]
```

**Después de cada migración:**

- `CRM_DEAL_VALUES_ENABLED: "true"`, después de la 2.1 (`docs/pipeline-grafico.md`).
- `COWORK_PREFERENCES_ENABLED: "true"`, después de la 2.3 (`docs/cowork-preferencias.md`).

**Medidos y listos, pero se encienden solo con el OK del dueño,** porque terminan en envíos o cambios reales (siempre con su tarjeta de aprobación). Sus migraciones ya están aplicadas:

- **`COWORK_REPLY_THREAD_ENABLED`:** responder en el hilo; 24 de 24 corridas (`docs/cowork-responder-en-hilo.md`).
- **`COWORK_LINKEDIN_BATCH_ENABLED`:** lotes de LinkedIn; 14 de 16 corridas. Va después de la prueba guiada con un contacto (`docs/cowork-aprobar-en-lote.md`).
- **`COWORK_CONTACTS_IMPORT_ENABLED`:** importar contactos desde un archivo (`docs/cowork-importar-contactos.md`).
- **`LEADS_FINDER_ENABLED`** con `LEADS_FINDER_ALLOWED_EMAILS` (`docs/leads-finder.md`).

**Quedan apagados:**

- **`COWORK_ANALYST_ENABLED`:** señal positiva en 9 casos, falta medirla con más repeticiones.
- **`COWORK_INTENT_PROMPTS_ENABLED`:** empeoró en la ronda 1.
- **`COWORK_JUDGE_ENABLED`:** se midió con la respuesta retenida. Corrige 1 de cada 5 respuestas, pero al corregir baja la veracidad (4,1 a 3,4) y suma unos 5 s (`docs/cowork-una-respuesta.md`).

## 4. Modelos

- **Nunca `astra`.** Desde #216, `src/ai/openai-json.ts` rechaza cualquier modelo astra antes de llamar a OpenAI.
  - Comprueba que ninguna variable `*_MODEL` del entorno lo tenga: `OPENAI_*_MODEL`, `COWORK_MODEL`, `COWORK_WRITER_MODEL`, `COWORK_REVIEWER_MODEL`, `COWORK_DESIGNER_MODEL`, `COWORK_ANALYST_MODEL` y `COWORK_JUDGE_MODEL`.
  - Hoy `apphosting.yaml` no tiene ninguno.
- **Coordinador:** `COWORK_MODEL` sigue en `gpt-6-luna`.
- **Las pruebas con el modelo real usan `gpt-6-luna`.** `gpt-6.1-sol` solo en casos puntuales y con el OK del dueño, porque gasta más créditos.

## 5. Aceptación en la app

La hace el dueño con su sesión, o tú con la suya si te la da. No apruebes envíos.

1. **«¿Qué queda por hacer hoy?»:** la respuesta no termina ofreciendo «¿reviso…?» algo que pudo consultar (con `COWORK_OFFERED_READS_ENABLED`).
2. **«Muéstrame mi pipeline en un gráfico»:** se abre un artefacto en el lienzo y en el chat queda una tarjeta compacta (con `COWORK_CODE_ARTIFACTS_ENABLED`).
3. **«Recuerda que no le escribo a empresas de seguridad privada»:**
   - aparece la tarjeta «Recordar preferencia»;
   - al aprobarla, un pedido nuevo la respeta (con la migración 2.3 y su flag).
4. **«Escríbeme un correo para los gerentes de personas de retail»:** la actividad muestra a la Redactora, el correo llega en una tarjeta y propone la campaña pausada.
5. **En `/crm`:** cambia la etapa de un contacto y pon un monto. El panel suma el pipeline abierto (con la migración 2.1 y su flag).

## 6. Rollback

- **Una función:** apaga su flag y vuelve a desplegar. Es lo más rápido.
- **El código:** `git revert` del PR, redeploy y el smoke de la sección 1. El punto de retorno es `prod-2026-10-04-2`.
- **Las migraciones no se revierten:** son forward-only y aditivas, y la app funciona sin ellas.

Cuando termines, cuéntale al dueño:

- la revisión desplegada y el tag;
- qué migraciones quedaron aplicadas y verificadas;
- qué flags encendiste;
- cómo salió la aceptación.
