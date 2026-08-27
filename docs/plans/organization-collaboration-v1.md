# Colaboracion Multiusuario por Organizacion V1

## Proposito

Este documento es el registro durable para implementar colaboracion real entre
miembros de una organizacion sin debilitar aislamiento tenant, aprobacion humana,
idempotencia ni control previo al proveedor.

Actualizar `Estado de ejecucion` al cerrar una fase o descubrir un riesgo. No
eliminar decisiones, tareas completadas ni limitaciones conocidas: este archivo
tambien es el handoff y la auditoria del rollout.

## Decisiones de Producto

1. Cada miembro envia exclusivamente desde su inbox personal conectado.
2. Leads, responsabilidad, estado de contacto e historial son compartidos por
   organizacion.
3. Un email normalizado solo puede tener un hilo comercial activo por
   organizacion y canal.
4. El primer envio reserva ese hilo. Solo el hilo o plan original puede hacer
   follow-up mientras permanezca activo.
5. Un owner o admin puede reabrir el destinatario despues de 90 dias y debe
   registrar un motivo.
6. Drafts nativos, research y Campaign V2 permanecen ligados a su creador en la
   primera entrega. Compartir su edicion es una fase posterior.
7. La primera entrega prioriza leads compartidos, equipo, atribucion, auditoria
   y bloqueo atomico de envios duplicados.
8. La implementacion es aditiva y se activa por organizacion. No se fusionan ni
   eliminan leads historicos automaticamente.

## Invariantes

1. Ningun miembro de otra organizacion puede leer, asignar, reservar o enviar
   sobre datos del tenant.
2. La organizacion activa nunca se acepta desde el navegador sin validar una
   membresia vigente en servidor.
3. El bloqueo de destinatarios ocurre en PostgreSQL antes de invocar Gmail u
   Outlook. Un check previo en UI no es suficiente.
4. Dos solicitudes concurrentes al mismo email y organizacion producen como
   maximo una invocacion al proveedor.
5. Un dispatch `unknown` conserva la reserva hasta reconciliarse para evitar un
   segundo envio ambiguo.
6. `discovered_by_user_id` es procedencia inmutable; `assigned_to_user_id` es
   responsabilidad operativa reasignable.
7. La salida o expulsion de un miembro no elimina ni desasocia el historial de
   una organizacion con colaboracion activada.
8. No se usa `unified_crm_data.owner` como autoridad de asignacion: es texto
   legacy y solo puede mantenerse como proyeccion de compatibilidad.
9. Los tokens de invitacion se guardan como hash, expiran, son de un solo uso y
   nunca aparecen en listados ni logs.
10. Siempre debe existir al menos un owner por organizacion.

## Roles y Capacidades

| Capacidad | Owner | Admin | Member |
| --- | --- | --- | --- |
| Ver leads, equipo e historial | Si | Si | Si |
| Crear y reclamar leads | Si | Si | Si |
| Asignarse un lead | Si | Si | Si |
| Reasignar cualquier lead | Si | Si | No |
| Preparar y enviar desde inbox propio | Si | Si | Si |
| Invitar miembros | Si | Si | No |
| Revocar invitaciones | Si | Si | No |
| Cambiar member/admin | Si | Si, sin promover owner | No |
| Transferir o retirar owner | Si | No | No |
| Expulsar miembros | Si | Si, excepto owner | No |
| Reabrir un hilo tras 90 dias | Si | Si | No |
| Renombrar organizacion | Si | No | No |
| Eliminar organizacion | Si | No | No |

## Modelo de Datos Objetivo

### Organizaciones y membresias

- `organizations.collaboration_v1_enabled`: activacion gradual.
- `organization_members`: conserva `owner`, `admin`, `member` y recibe reglas
  server-owned para cambios sensibles.
- La organizacion activa se conserva en una cookie HTTP-only y se valida contra
  `organization_members` en cada request que use contexto tenant.

### Colaboracion de leads

`organization_lead_collaboration` es una capa aditiva con una fila por lead:

- `organization_id`
- `lead_id`
- `discovered_by_user_id`
- `discovered_at`
- `assigned_to_user_id`
- `assigned_at`
- `assigned_by_user_id`
- `claimed_by_user_id`
- `claim_expires_at`
- `contact_state`
- `created_at`, `updated_at`

El backfill usa `leads.user_id` como descubridor cuando ese usuario sigue siendo
miembro. Los nuevos leads crean su colaboracion mediante trigger o RPC para no
depender del cliente.

### Hilos y reservas de contacto

`organization_contact_threads` contiene una fila por identidad normalizada:

- `organization_id`
- `channel`
- `recipient_key` y `recipient_email`
- `status`: `reserved`, `active`, `closed`, `suppressed`
- `root_dispatch_id`, `active_campaign_id`, `active_lead_id`
- `opened_by_user_id`, `last_sent_by_user_id`
- `reserved_dispatch_id`, `reservation_expires_at`
- `first_contacted_at`, `last_contacted_at`, `closed_at`
- `reopened_at`, `reopened_by_user_id`, `reopen_reason`

`outbound_dispatches.contact_thread_id` vincula todo intento durable al hilo.
La reserva se adquiere bajo lock transaccional desde el mismo RPC que reclama
el dispatch como `sending`.

### Auditoria

`organization_collaboration_events` es append-only y consultable por miembros:

- actor, organizacion, lead e hilo
- tipo de evento y momento
- metadata pequena, sin secretos ni cuerpo de emails

Eventos minimos: `lead.discovered`, `lead.assigned`, `lead.claimed`,
`lead.claim_released`, `contact.reserved`, `contact.blocked`, `contact.sent`,
`contact.released`, `contact.reopened`, `member.invited`, `member.joined`,
`member.role_changed`, `member.removed`.

`antonia_event_ledger` sigue siendo la fuente de observabilidad tecnica. No se
expone directamente al navegador.

## Flujo de Organizacion Activa

1. El cliente obtiene las organizaciones visibles desde una ruta server-owned.
2. Si la cookie activa apunta a una membresia vigente, se usa esa organizacion.
3. Si no, se elige la membresia mas antigua y se actualiza la cookie.
4. El selector llama una ruta que valida membresia y escribe la cookie HTTP-only.
5. `AuthContext` recibe el ID validado y remonta scopes dependientes.
6. APIs y servicios dejan de escoger silenciosamente la primera membresia.
7. Requests internos siguen usando `x-organization-id`, firma interna y
   validacion explicita de membresia del actor.

## Flujo de Invitaciones

1. Owner/admin crea invitacion desde una API server-owned.
2. El servidor normaliza el email, genera un token aleatorio, persiste solo su
   SHA-256 y devuelve el enlace una unica vez.
3. La UI ofrece copiar el enlace y explica su expiracion. No usa consola.
4. La pagina de aceptacion envia el token al servidor.
5. El RPC bloquea la invitacion, valida hash, expiracion, email autenticado y
   rol permitido, crea membresia y marca `accepted_at`.
6. Revocar conserva auditoria y marca `revoked_at`; no borra silenciosamente.

## Flujo de Envio Seguro

1. La ruta valida sesion, organizacion activa, draft aprobado y provider del
   usuario autenticado.
2. Se crea/reutiliza `outbound_dispatches` por idempotency key.
3. El claim de `sending` normaliza el destinatario y toma un advisory lock por
   `organization_id + channel + recipient_key`.
4. Si no hay hilo, crea la reserva para el dispatch.
5. Si existe el mismo dispatch, retorna replay seguro.
6. Si existe un hilo activo diferente, solo permite continuar cuando el draft
   declara el mismo hilo o el recipient step pertenece al plan original.
7. Cualquier otro intento termina `pre_provider_rejected` con codigo
   `recipient_thread_conflict`; el proveedor no se invoca.
8. Un envio confirmado activa el hilo y registra actor/fechas.
9. Un fallo confirmado o deferred pre-provider libera la reserva. Un resultado
   ambiguo la conserva.

## UX Objetivo

### Selector de workspace

- Mostrar organizacion activa y permitir cambiarla desde una unica superficie.
- El cambio debe indicar loading y remontar datos scoped sin mezclar caches.
- Mobile usa un selector de ancho completo sin scroll horizontal.

### Equipo

- Una accion principal: `Invitar miembro`.
- Lista responsive con identidad, rol, fecha y menu contextual autorizado.
- Empty state: explicar que la persona trabaja sola y ofrecer invitar.
- Invitaciones pendientes muestran email, rol, vencimiento y revocacion.
- Formularios con labels visibles, errores por campo, loading y success claros.

### Leads

- Mostrar `Descubierto por`, `Responsable` y estado de contacto en el detalle.
- La card solo muestra responsable/estado cuando aporta decision inmediata.
- CTA principal contextual: `Asignarme`, `Preparar email` o `Continuar hilo`.
- En conflicto, deshabilitar enviar y explicar quien contacto, cuando y desde
  que hilo, sin exponer contenido privado del mailbox.

## Fases

### Fase 0. Documento y contratos

- [x] Registrar decisiones aprobadas.
- [x] Confirmar contratos SQL, API y UI afectados.

### Fase 1. Esquema, RPC y RLS

- [x] Crear migracion aditiva y feature flag.
- [x] Endurecer membresias e invitaciones.
- [x] Crear colaboracion de leads, hilos y eventos.
- [x] Implementar backfill seguro.
- [x] Implementar reserva atomica y reapertura.
- [x] Ajustar salida de miembros para preservar datos compartidos.
- [x] Añadir pgTAP de roles, tenant y concurrencia.

### Fase 2. Organizacion activa

- [x] Crear rutas de listado y seleccion.
- [x] Actualizar `requireAuth` y `request-auth`.
- [x] Actualizar `AuthContext` y servicios cliente.
- [x] Añadir selector global.

### Fase 3. Equipo e invitaciones

- [x] Crear APIs server-owned.
- [x] Sustituir operaciones directas del navegador.
- [x] Completar gestion de roles y miembros.
- [x] Completar invitacion, copia, revocacion y aceptacion.

### Fase 4. Leads compartidos

- [x] Crear contratos y servicio de colaboracion.
- [x] Añadir asignacion y claims.
- [x] Proyectar atribucion e historial en CRM.
- [x] Preservar datos al retirar miembros.

### Fase 5. Seguridad de envio

- [x] Integrar claim de hilo en dispatcher central.
- [x] Cubrir provider send, campañas legacy y Campaign V2.
- [x] Añadir mensajes de conflicto y reapertura.
- [x] Verificar exactamente una llamada concurrente al provider.

### Fase 6. Verificacion y rollout

- [x] Regenerar tipos Supabase.
- [x] Ejecutar reset, lint, pgTAP, unit, integracion, typecheck y prebuild.
- [x] Auditar responsive, dark mode, teclado, focus y estados.
- [x] Documentar activacion, reporte de duplicados y rollback por flag.

## Pruebas de Aceptacion

1. Owner y member ven el mismo lead; outsider no lo ve.
2. El descubridor no cambia al reasignar o retirar a un miembro.
3. Member puede asignarse; solo owner/admin puede reasignar a terceros.
4. Nadie puede retirar al ultimo owner.
5. Admin no puede promover ni retirar owners.
6. Invitaciones exponen el token solo en la respuesta de creacion y persisten
   solo hash.
7. Una invitacion expirada, revocada, usada o para otro email falla cerrada.
8. Un usuario miembro de dos organizaciones puede cambiar workspace y no ve
   datos mezclados.
9. Dos miembros enviando concurrentemente al mismo email y organizacion causan
   exactamente una llamada al proveedor.
10. El mismo email en organizaciones diferentes puede recibir un primer envio
    en cada tenant.
11. Un retry con la misma idempotency key es replay, no conflicto.
12. Un follow-up del hilo original es permitido; una campaña paralela no.
13. `unknown` bloquea nuevos intentos hasta reconciliacion.
14. Admin puede reabrir despues de 90 dias con motivo; antes falla.
15. La salida de un miembro de una organizacion activada conserva leads,
    dispatches e historial y elimina su acceso.

## Rollout y Rollback

1. La cadena de migraciones se valida primero con `npm run test:reset` local.
2. No se aplica a nonprod sin peticion explicita y gates completos.
3. Antes de activar una organizacion se genera un reporte de emails repetidos,
   hilos sin enlazar, destinatarios invalidos y dispatches no resueltos. El RPC
   rechaza la activacion si cualquiera de esos contadores es mayor que cero.
4. El backfill elige el envio confirmado mas antiguo como raiz y el mas reciente
   como `last_contacted_at`; las ambiguedades quedan marcadas para revision.
5. El rollout empieza con una organizacion piloto.
6. El rollback operativo desactiva `collaboration_v1_enabled`. No elimina tablas,
   eventos, hilos ni atribucion historica.

### Gates locales completados el 2026-08-26

- Node `22.23.2` y `npm run doctor`: aprobado.
- `npm run test:reset`: aprobado contra Supabase local.
- `npm run db:lint`: aprobado.
- `npm run db:test`: 112 pruebas pgTAP aprobadas.
- `npm run db:types`: tipos regenerados y `src/lib/database.types.ts` actualizado.
- `npm run test:unit`: 582 pruebas aprobadas.
- `npm run test:integration`: 4 pruebas aprobadas. La prueba de concurrencia
  atraviesa `dispatchOutboundMessage` y registra exactamente una invocacion al
  proveedor falso.
- `npm run typecheck`, `npm run prebuild` y `npm run build`: aprobados.
- Auditoria estatica de responsive, dark mode, foco, teclado, loading, errores y
  contraste: aprobada tras remediacion. El browser E2E sigue como riesgo residual.

### Piloto nonprod ejecutado el 2026-08-26

- Proyecto: `htketmmhsfmucevvqmxi`; produccion no fue modificada.
- Organizacion piloto: `ANTON.IA QA`. `ANTON.IA QA Externa` permanece desactivada.
- Migracion remota: `20260826120000_organization_collaboration_v1` aplicada y el
  dry-run posterior confirma que la base esta al dia.
- Reporte previo: cero destinatarios confirmados, ambiguos, hilos y dispatches
  `sending`/`unknown`.
- `npm run test:staging`: conectividad e identidades/aislamiento aprobados.
- `npm run test:collaboration:pilot`: concurrencia, dispatcher y RLS aprobados con
  una sola llamada a un proveedor falso. `OUTBOUND_DELIVERY_MODE=disabled` y
  `ALLOW_EXTERNAL_SIDE_EFFECTS=false` permanecieron activos.
- `supabase db lint --linked --level error`: aprobado al recuperarse el pooler.
- Evidencia durable: un dispatch sintetico `sent`, uno `pre_provider_rejected` y
  un hilo activo con provider `integration-noop`. No hubo envio externo.
- Reporte posterior: un destinatario confirmado sintetico, cero ambiguos y cero
  dispatches `sending`/`unknown`.
- Supabase tuvo una incidencia activa de pgBouncer durante el rollout. Produjo
  timeouts transitorios; la aplicacion y los smokes finalizaron correctamente.

### Cierre RLS legacy en nonprod

- La migracion `20260826130000_secure_legacy_crm_tables` se aplico despues de un
  replay local completo, lint, 112 pruebas pgTAP y 4 integraciones aprobadas.
- `antonia_exceptions` queda server-owned: `anon` y `authenticated` no tienen
  privilegios directos; las APIs existentes continuan mediante `service_role`.
- `unified_crm_data` permite CRUD autenticado solo cuando
  `is_current_user_organization_member(organization_id)` es verdadero.
- La validacion remota confirma RLS activo, cuatro politicas CRM, lint aprobado
  y ninguna tabla publica expuesta a `anon`/`authenticated` sin RLS.
- El smoke PostgREST confirma escritura dentro del tenant, aislamiento owner vs.
  outsider y rechazo `42501` para acceso cliente a `antonia_exceptions`.
- El dry-run posterior confirma que nonprod esta al dia. Produccion no fue
  modificada.

### Cadena canonica preparada el 2026-08-27

- Las cuatro migraciones amplias aplicadas solo al piloto nonprod se conservaron
  como evidencia en `supabase/migrations-archive/`; ya no forman parte de la
  cadena activa que se propone para produccion.
- La cadena activa divide reconciliacion, rollout, invitaciones, eventos, leads,
  hilos, backfill, runtime, membresias y cada tabla CRM en migraciones
  forward-only separadas bajo `20260827090000` a `20260827106000`.
- El backfill de dispatches no elimina el trigger global. Usa
  `session_replication_role` solo en la sesion de migracion, con `lock_timeout`
  de 5 segundos y `statement_timeout` de 60 segundos.
- Invitaciones legacy sin token valido quedan revocadas; roles legacy fuera de
  `admin`/`member` se normalizan a `member`; duplicados activos conservan solo la
  fila mas reciente; el token plaintext se elimina al finalizar.
- La activacion es fail-closed para destinatarios ambiguos o invalidos,
  dispatches `sending`/`unknown` y envios confirmados sin hilo.
- Replay local, lint, 112 pgTAP, 4 integraciones y 585 pruebas unitarias del
  candidato aislado aprobaron la cadena nueva. Debe ensayarse nuevamente en
  nonprod desde esta misma linea antes de produccion.

### Auditoria read-only de produccion del 2026-08-27

- El dry-run de la linea anterior proponia seis migraciones y por eso fue
  rechazado; no se ejecuto `db push --include-all`.
- El esquema confirma que las dos migraciones historicas recuperadas de
  `enriched_opportunities` ya estan materializadas. Su historial solo puede
  repararse durante una ventana aprobada y con evidencia conservada.
- Produccion no contiene una organizacion cuyo nombre incluya `Expro` ni cuentas
  para `laramirez@grupoexpro.com` o `kmory@grupoexpro.com`.
- `GrupoExpro` no se creara sin un owner designado. Tampoco se enviaran
  invitaciones hasta completar backup/ventana, ensayo nonprod, dry-run y deploy.

### Activacion controlada

Estas operaciones se ejecutan solo mediante una conexion segura con rol
`service_role`. Nunca se expone esa credencial al navegador ni se activa nonprod
o produccion sin autorizacion explicita.

1. Obtener y conservar el reporte previo:

```sql
select public.organization_collaboration_rollout_report_v1('<organization-id>'::uuid);
```

2. La activacion falla automaticamente si `ambiguousRecipientCount`,
   `inFlightOrUnknownDispatchCount`, `unlinkedConfirmedDispatchCount` o
   `invalidConfirmedRecipientCount` es mayor que cero. Resolver la evidencia y
   generar un reporte nuevo antes de continuar.
3. Activar una unica organizacion piloto con un motivo auditable:

```sql
select public.set_organization_collaboration_v1_enabled(
  '<organization-id>'::uuid,
  true,
  'Piloto aprobado en <entorno> por <responsable> el <fecha>'
);
```

4. Repetir el reporte y revisar eventos `organization.collaboration_enabled`,
   conflictos `contact.blocked`, dispatches `unknown` y feedback del piloto.

### Rollback operativo

```sql
select public.set_organization_collaboration_v1_enabled(
  '<organization-id>'::uuid,
  false,
  'Rollback de <entorno> por <motivo> el <fecha>'
);
```

El rollback no revierte la migracion ni elimina datos. Conserva auditoria,
atribucion, hilos e historial y devuelve la UI al comportamiento legacy.

Para el piloto sintetico tambien existen comandos guardados y fail-closed:

```powershell
npm run collaboration:pilot:report
npm run collaboration:pilot:disable
npm run collaboration:pilot:enable
```

## Estado de Ejecucion

| Fase | Estado | Nota |
| --- | --- | --- |
| 0. Documento y contratos | Completada | Decisiones y contratos registrados el 2026-08-26. |
| 1. Esquema, RPC y RLS | Candidato canonico local | Cadena granular aprobada localmente; falta reensayo nonprod. |
| 2. Organizacion activa | Completada local | Cookie HTTP-only y membresia validadas en servidor. |
| 3. Equipo e invitaciones | Completada local | Operaciones sensibles trasladadas a APIs server-owned. |
| 4. Leads compartidos | Completada local | Drafts y Campaign V2 continuan personales en V1. |
| 5. Seguridad de envio | Validada en nonprod | Guard atomico y una sola llamada falsa concurrente verificados. |
| 6. Verificacion y rollout | Piloto nonprod historico | `ANTON.IA QA` activa en la linea archivada; produccion intacta. |

## Riesgos Conocidos

- El repositorio conserva muchos servicios legacy que resuelven la primera
  organizacion; deben migrarse sin mezclar caches durante el rollout.
- `contacted_leads.user_id` representa al remitente y debe conservar ese
  significado. No debe reinterpretarse como owner del lead.
- Campaign V2 y drafts usan claves foraneas compuestas con `user_id`; volverlos
  editables por equipo requiere una migracion posterior independiente.
- La proteccion solo es completa si todo egress de email atraviesa
  `dispatchOutboundMessage`; cualquier nuevo sender debe usar ese limite.
- El browser E2E completo sigue siendo una mejora de la fundacion de pruebas.

## Archivos Principales

- `src/lib/services/organization-service.ts`
- `src/context/AuthContext.tsx`
- `src/lib/server/auth-utils.ts`
- `src/lib/server/request-auth.ts`
- `src/lib/server/organization-context.ts`
- `src/lib/server/lead-collaboration.ts`
- `src/lib/server/outbound-dispatch.ts`
- `src/lib/services/lead-collaboration-service.ts`
- `src/app/api/providers/send/route.ts`
- `src/app/api/cron/process-campaigns/route.ts`
- `src/app/api/organizations/`
- `src/components/organization/WorkspaceSwitcher.tsx`
- `src/components/organization/MembersList.tsx`
- `src/components/organization/InviteMemberDialog.tsx`
- `src/components/crm/LeadCard.tsx`
- `src/components/crm/LeadDetailDrawer.tsx`
- `supabase/migrations/20260827092000_organization_collaboration_rollout_flag.sql`
- `supabase/migrations/20260827093000_secure_organization_invitations.sql`
- `supabase/migrations/20260827094000_organization_collaboration_events.sql`
- `supabase/migrations/20260827095000_organization_lead_collaboration.sql`
- `supabase/migrations/20260827100000_organization_contact_threads.sql`
- `supabase/migrations/20260827101000_backfill_organization_contact_threads.sql`
- `supabase/migrations/20260827102000_organization_contact_thread_runtime.sql`
- `supabase/migrations/20260827103000_organization_membership_runtime.sql`
- `supabase/migrations/20260827104000_organization_collaboration_rollout_runtime.sql`
- `supabase/migrations/20260827105000_secure_antonia_exceptions.sql`
- `supabase/migrations/20260827106000_secure_unified_crm_data.sql`
- `supabase/migrations-archive/20260826120000_organization_collaboration_v1.sql`
- `supabase/migrations-archive/20260826130000_secure_legacy_crm_tables.sql`
- `supabase/tests/database/organization_collaboration_v1.test.sql`
- `__tests__/organization-contact-thread.integration.test.mjs`
- `scripts/run-collaboration-pilot.mjs`
- `scripts/run-collaboration-pilot-tests.mjs`
