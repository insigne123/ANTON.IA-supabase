# Avisos de seguridad de Supabase: auditoría (6 oct 2026)

Esta auditoría es parte del Plan 12, punto 7. Se leyeron los avisos de seguridad (`get_advisors`) del proyecto de producción `yfdelflsheurzaicwayi` y el catálogo (`pg_proc`), **solo con lecturas**: nada se cambió en producción.

Cada aviso se cruzó con el código del repositorio (`src/`, `supabase/functions/`, `scripts/` y `supabase/migrations/`) para saber si es de ANTON.IA o de otra app que comparte el proyecto.

## Resumen

| Aviso | Nivel | Hallazgos | De ANTON.IA | Qué hacer |
|---|---|---|---|---|
| `rls_disabled_in_public` y `policy_exists_rls_disabled` (los «31 avisos antiguos») | ERROR | 31, sobre 25 tablas | **Ninguna** | Lo deciden los dueños de esas apps |
| `anon_security_definer_function_executable` | WARN | 54 | 20 están en las migraciones del repo; **7 están expuestas de verdad** | **Revocar** (SQL abajo) |
| `authenticated_security_definer_function_executable` | WARN | 72 | Varias, a propósito (RPC de la app con su propio control) | Se revisa con las 7 de arriba |
| `function_search_path_mutable` | WARN | 28 | Algunas | Bajo riesgo; arreglarlas cuando se toquen |
| `extension_in_public` | WARN | 3 (`vector`, `http` y `pg_net`) | No | Mover implica riesgo; no urge |
| `rls_enabled_no_policy` | INFO | 56 | Varias, a propósito (solo las lee el worker) | Nada: sin política, nadie las lee por la API |
| `auth_leaked_password_protection` | WARN | 1 | Toda la app | Encenderla en Auth → «Password security» |

## 1. Los 31 avisos antiguos de RLS: ninguno es de ANTON.IA

Son 25 tablas. En 6 de ellas hay políticas, pero RLS está apagado: `batches`, `excel_maps`, `organization_invitations`, `organization_requests`, `procedures` y `projects`.

Todas sin RLS:

- `approval_instances`, `approval_step_approvals`, `audit_logs`;
- `batch_files`, `batches`, `chat_histories`;
- `conversation_messages-proyecto-cris`, `conversations-proyecto-cris`;
- `document_metadata`, `document_rows`, `documents_pg`;
- `excel_maps`, `organization_invitations`, `organization_requests`;
- `outputs`, `procedure_comments-proyecto-cris`, `procedure_versions`, `procedures`, `projects`;
- `schema_migrations`, `search_queue`, `staging_rows`;
- `tenant_branding-proyecto-cris`, `users`, `usuarios_sofiage`.

Ninguna aparece en el código ni en las migraciones de ANTON.IA. Los nombres apuntan a otras apps del mismo proyecto: «proyecto-cris», «sofiage», un flujo de procedimientos y aprobaciones, y un RAG de documentos.

**Recomendación:** no tocarlas desde ANTON.IA. Sin RLS, cualquiera con la llave pública puede leerlas y escribirlas por la API, así que conviene que sus dueños las revisen.

## 2. Siete funciones de ANTON.IA que cualquiera puede ejecutar (sin sesión)

Son `SECURITY DEFINER`: corren con los permisos de su dueño y se exponen como `/rest/v1/rpc/<nombre>`. El catálogo confirma `has_function_privilege('anon', …, 'execute') = true` en todas.

| Función | Qué permite a cualquiera | ¿La usa la app? |
|---|---|---|
| `claim_antonia_tasks(p_limit, p_worker_id, p_worker_source)` | Tomar tareas pendientes del agente: las marca «processing» y devuelve sus filas | No (el agente de misiones se retiró en el Plan 4) |
| `schedule_daily_mission_tasks()` | Programar tareas de todas las misiones activas | No |
| `increment_daily_usage(p_organization_id, p_date, …)` | Inflar el uso diario de cualquier organización | No |
| `claim_suplia_tool_lease(…)` | Tomar cupos de herramientas de cualquier organización | No (Suplia se retiró en el Plan 9) |
| `release_suplia_tool_lease(p_lease_token)` | Liberar un cupo con su token | No |
| `trigger_antonia_worker()` | Llamar a la Cloud Function `antoniaWorker` | No (no está en el repo) |
| `trigger_antonia_daily_execution()` | Llamar a la Cloud Function `antoniaTick` | No (no está en el repo) |

**Por qué pasa:** las migraciones hacían `revoke all … from public` y `grant execute … to service_role`. Pero Supabase da `EXECUTE` a `anon` y `authenticated` **por separado** en sus privilegios por defecto, y revocar a `public` no quita esos permisos.

**Las otras 13 del repo que aparecen en el aviso:**

- 7 son funciones de trigger (`returns trigger`). PostgREST no las expone y no se pueden llamar fuera de un trigger.
- El resto revisa `auth.uid()` o la membresía de la organización antes de hacer algo.

### Arreglo propuesto (no aplicado)

Es una escritura en producción, así que se aplica solo con tu confirmación, como migración aparte:

```sql
-- Solo el worker (service_role) ejecuta estas funciones; la app no las llama.
revoke execute on function public.claim_antonia_tasks(integer, text, text) from public, anon, authenticated;
revoke execute on function public.schedule_daily_mission_tasks() from public, anon, authenticated;
revoke execute on function public.increment_daily_usage(uuid, date, integer, integer, integer, integer) from public, anon, authenticated;
revoke execute on function public.claim_suplia_tool_lease(uuid, text, integer, integer, uuid, uuid, uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.release_suplia_tool_lease(text) from public, anon, authenticated;
revoke execute on function public.trigger_antonia_worker() from public, anon, authenticated;
revoke execute on function public.trigger_antonia_daily_execution() from public, anon, authenticated;
```

**Para verificarlo después:** los siete deben dar `false`.

```sql
select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon,
  has_function_privilege('authenticated', p.oid, 'execute') as authenticated
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('claim_antonia_tasks', 'schedule_daily_mission_tasks', 'increment_daily_usage',
  'claim_suplia_tool_lease', 'release_suplia_tool_lease', 'trigger_antonia_worker', 'trigger_antonia_daily_execution');
```

**Si algún `pg_cron` llama a `trigger_antonia_*`:** sigue funcionando, porque corre como `postgres`.

**Sin uso conocido:** ninguna de las dos aparece en el repo, así que conviene borrarlas o desactivar su cron cuando se confirme que nadie las usa.

## 3. Otras funciones `SECURITY DEFINER` que `anon` puede ejecutar y no son de ANTON.IA

Son 34 y no están en el repo:

- `lic_srv_*` y `lic_trg_*`, de un servicio de licitaciones;
- `seo_*`;
- `current_tenant_id`, `is_tenant_admin`, `is_organization_owner` y `decrement_social_credit`.

**Recomendación:** que las revisen sus dueños, sobre todo `decrement_social_credit` y `lic_srv_set_config`.

## Cómo se hizo

- **Avisos:** `get_advisors` (seguridad) del proyecto de producción.
- **Catálogo:** una consulta de solo lectura a `pg_proc` para los permisos y el cuerpo de cada función.
- **Uso en el repo:** se buscó `from('<tabla>')` y `rpc('<función>')` en `src/` y `supabase/functions/`. Para las funciones, también su última definición en `supabase/migrations/`, con sus `grant` y `revoke` y si revisa `auth.uid()`.
