# Plan Apollo-Only e Integracion con Investigacion

## Objetivo

Restablecer Apollo como el unico proveedor de busqueda y enriquecimiento de
personas, retirar FullEnrich del runtime sin perder historicos y aprovechar el
contexto normalizado de Apollo para mejorar la investigacion de personas y
empresas.

El cambio debe mantener aislamiento por organizacion, cuotas atomicas,
idempotencia, trazabilidad, recuperacion de callbacks y una separacion clara
entre observaciones del proveedor y evidencia publica verificable.

## Decisiones Confirmadas

- usar enriquecimiento estandar de Apollo; no habilitar waterfall
- enriquecimiento de organizaciones Apollo solo por accion explicita
- permitir investigacion company-first desde leads Apollo guardados aunque el
  contacto aun no este enriquecido
- mantener Apollo API key solo en el gateway backend
- no editar ni revertir migraciones historicas ya aplicadas
- conservar registros historicos cuyo `source_provider` sea `fullenrich`
- conservar `source_provider` y `source_provider_id` como identidad generica
- conservar `apollo_id` donde exista por compatibilidad con datos persistidos

## Estado Inicial

- frontend y BFF: proyecto Firebase `leadflowai-3yjcy`, backend `studio`
- gateway: proyecto Firebase `backend-apollo-leads-prod`, backend
  `backend-antonia`
- nonprod Supabase: `htketmmhsfmucevvqmxi`
- produccion Supabase: `yfdelflsheurzaicwayi`
- el runtime actual fuerza FullEnrich en BFF y gateway
- varias rutas con nombre Apollo ejecutan actualmente FullEnrich
- los webhooks Apollo existentes estan retirados con HTTP 410
- existe `apollo_enrichment_callbacks`, pero el flujo antiguo no consume esa
  tabla de forma segura
- nonprod tiene aplicadas las migraciones `20260830120000` y
  `20260830130000`, ausentes inicialmente del arbol local
- al momento del relevamiento nonprod tenia cero callbacks activos y cero
  operaciones de cuota en estado `submitted`
- Docker Desktop debe estar activo para ejecutar reset, lint y pgTAP locales

## Arquitectura Objetivo

```text
Browser
  -> Next.js BFF autenticado y tenant-scoped
  -> Gateway interno con ENRICHMENT_SERVICE_SECRET
  -> Apollo API con APOLLO_API_KEY

Apollo webhook
  -> endpoint HTTPS publico con token opaco por solicitud
  -> RPC service-role atomica
  -> fila objetivo + callback + cuota

Firebase scheduler
  -> BFF cron autenticado
  -> claim de callbacks pendientes
  -> gateway interno
  -> Apollo webhook-result poll
  -> misma RPC atomica del webhook
```

El navegador nunca recibe secretos, nunca elige proveedor y nunca decide el
tenant de un registro. El gateway no escribe en Supabase. El BFF es responsable
de autenticacion, ownership, cuotas, persistencia y callbacks.

## Contrato Apollo

### Busqueda de Personas

- endpoint Apollo: `POST /api/v1/mixed_people/api_search`
- costo Apollo actual: cero creditos
- no devuelve emails ni telefonos
- maximo de 100 resultados por pagina
- filtros deben enviarse como query params documentados
- busquedas sin filtros acotados deben fallar cerradas
- resultados deben exponer disponibilidad de contacto, no datos inventados
- `source_provider` debe persistirse como `apollo`

### Busqueda de Organizaciones

- endpoint Apollo: `POST /api/v1/mixed_companies/search`
- costo Apollo actual: un credito por pagina
- debe limitarse la paginacion y mostrar el impacto de credito al usuario
- la seleccion de empresa debe persistir Apollo organization ID y dominio
- la API key solo vive en el gateway

### Enriquecimiento de Personas

- endpoint Apollo: `POST /api/v1/people/match`
- costo Apollo actual: entre uno y nueve creditos por persona cuando se
  encuentra informacion que consume creditos
- usar solo enriquecimiento estandar
- enviar identificadores y flags como query params segun el contrato actual
- el lookup exacto por LinkedIn es enriquecimiento, no busqueda gratuita
- toda operacion requiere idempotency key y claim atomico de cuota
- `reveal_phone_number=true` exige un `webhook_url` HTTPS publico
- email y demografia pueden llegar sincronicamente
- telefonos moviles o direct dial llegan asincronicamente
- el `request_id` firmado de 64 bits debe almacenarse como texto

### Enriquecimiento de Organizaciones

- endpoint Apollo: `GET /api/v1/organizations/enrich`
- costo Apollo actual: un credito por organizacion
- solo se ejecuta por una accion explicita del usuario
- nunca se ejecuta automaticamente al iniciar investigacion
- debe requerir cuota e idempotencia y forzar refresh del artifact solo despues
  de persistir la nueva observacion Apollo

### Recuperacion de Webhooks

- endpoint Apollo: `GET /api/v1/webhook_result/{request_id}`
- costo Apollo actual: cero creditos
- `result_pending` es reintentable usando `retry_after_seconds`
- `request_id_unknown`, `request_id_expired` e `invalid_request_id` son
  terminales
- una respuesta lista debe pasar por la misma normalizacion y RPC que el
  webhook
- nunca repetir automaticamente una solicitud de enriquecimiento cuyo outcome
  sea ambiguo

### Uso y Creditos

- `POST /api/v1/usage_stats/api_usage_stats` para rate limits
- `POST /api/v1/usage_stats/credit_usage_stats` para balances de equipo
- `GET /api/v1/users/api_profile?include_credit_usage=true` para identidad y
  balance del usuario de la API key
- los snapshots de uso no deben contener PII ni secretos
- cuotas del producto y creditos Apollo son conceptos separados

## Modelo de Callback Apollo

La migracion forward-only debe endurecer `apollo_enrichment_callbacks` sin
destruir historicos.

Cada callback debe conservar:

- `organization_id` y `user_id`
- tabla e ID objetivo permitidos
- Apollo person ID esperado
- operation ID y recurso de cuota
- campos solicitados
- hash del token opaco, nunca el token en claro
- Apollo `request_id` como texto
- estado de procesamiento y estado terminal
- fingerprint del payload
- cantidad y fecha de entregas
- expiracion y error terminal
- lease, intentos y cooldown de reconciliacion

El token opaco es el unico identificador incluido en la URL del webhook. La URL
no debe contener tabla, record ID, user ID ni organization ID. El handler debe
redactar la URL completa de logs.

La RPC de aplicacion debe:

1. exigir `service_role`
2. bloquear la fila callback con `FOR UPDATE`
3. rechazar token, persona o request ID incompatibles
4. tratar callbacks terminales como duplicados idempotentes
5. validar limites de email y telefonos
6. actualizar solo los campos solicitados
7. filtrar la fila objetivo por user y organization persistidos
8. marcar callback terminal en la misma transaccion
9. completar la cuota solo cuando no queden callbacks activos de la operacion

Los resultados terminales son `succeeded`, `no_data`, `failed`, `cancelled` y
`expired`. Una operacion con telefono permanece `submitted` hasta que todos sus
callbacks sean terminales.

## Persistencia de Contexto Apollo

No se guarda el payload Apollo completo. Se persiste una allowlist normalizada:

- identidad de persona y Apollo person ID
- nombre, cargo, headline, seniority y departamentos
- LinkedIn y ubicacion
- identidad de empresa y Apollo organization ID
- dominio, website, LinkedIn, industria y headcount
- descripcion corta y metadatos de empresa cuando esten disponibles
- `providerRefreshedAt`, `observedAt`, version del normalizador y fingerprint

Email y telefonos permanecen en columnas operacionales. Los telefonos nunca se
copian al contexto de investigacion ni a prompts. Los campos de Apollo deben
persistirse con `source_provider='apollo'` y `source_provider_id`.

## Integracion con Investigacion

### Referencias Server-Side

La API de investigacion debe aceptar una referencia explicita a uno de estos
origenes:

- `leads`
- `enriched_leads`
- `enriched_opportunities`
- `people_search_leads`

El BFF debe cargar el registro con Supabase admin y filtros explicitos de
`organization_id` y `user_id`. Los campos enviados por el cliente son solo para
presentacion; si contradicen la fila canonica deben ignorarse.

Durante el rollout se mantiene el input manual actual para importaciones y para
evitar que una revision antigua del frontend falle mientras se publica el nuevo
BFF. Las pantallas propias deben migrar a referencias server-side en el mismo
release.

### Provider Context

El job guarda una copia congelada `apollo-context/v1` dentro de
`lead_research_jobs.request_payload` con:

- origen y record ID
- provider y provider IDs
- etapa `search` o `enrichment`
- campos normalizados de persona y empresa
- timestamps y fingerprints
- indicadores de disponibilidad de contacto sin telefonos

El fingerprint de input de investigacion incluye este contexto. El fingerprint
de empresa usa solo la seccion de empresa, para que dos personas de la misma
empresa puedan reutilizar el mismo artifact.

### Evidencia y Claims

Apollo es contexto de proveedor, no una fuente publica independiente. Sus datos
pueden mejorar identidad, queries y seleccion de fuentes, pero no deben crear un
claim de outreach por si solos.

Los claims listos para contacto siguen necesitando una URL HTTP(S), evidencia
explicita y los controles actuales de calidad. La investigacion company-first
puede ejecutarse con un resultado Apollo guardado, pero debe indicar cobertura
de persona limitada hasta encontrar evidencia publica o completar el
enriquecimiento.

### Cache de Empresa

La identidad de `research_company_artifacts` debe incorporar el fingerprint de
empresa Apollo. Un cambio material de dominio, industria, headcount o
descripcion produce un artifact nuevo. Un refresh explicito omite cache. La
frescura efectiva no puede superar la menor vigencia entre el artifact publico
y el contexto Apollo usado para generarlo.

## Cambios de Producto

- batch people search no muestra email ni telefono
- resultados de busqueda muestran disponibilidad de contacto
- lookup por LinkedIn se presenta como enriquecimiento con costo
- busqueda de empresa informa que consume un credito por pagina
- telefono muestra estados pending, ready, no data y failed
- leads guardados pueden iniciar investigacion company-first
- la UI advierte cuando el contexto de persona es limitado
- `Actualizar empresa con Apollo` es una accion secundaria explicita
- una operacion en progreso no permite reenvio automatico
- FullEnrich deja de aparecer en copy, payloads, badges y configuracion

## Retiro de FullEnrich

El retiro se hace en dos etapas:

1. dejar de crear nuevas solicitudes y remover el secreto del runtime
2. conservar temporalmente el webhook con HTTP 410 y mantener tablas historicas

No se eliminan inmediatamente migraciones, callbacks ni registros historicos.
Una limpieza posterior puede borrar funciones y tablas solo despues del periodo
de retencion y una verificacion de cero callbacks activos.

## Configuracion

### Gateway

- `APOLLO_API_KEY`
- `ENRICHMENT_SERVICE_SECRET`
- limites de request, resultados, timeout y rate limit Apollo
- `LEADS_PROVIDER_DEFAULT=apollo`

### Frontend y BFF

- `ENRICHMENT_SERVICE_SECRET`
- URL canonica HTTPS publica
- URL del gateway
- Supabase URL y service role
- no incluir `APOLLO_API_KEY`

### Functions

- `FIREBASE_SCHEDULER_SECRET`
- URL canonica del BFF
- bridge seguro para uso y reconciliacion Apollo

## Observabilidad

- restaurar snapshots horarios de balance y rate limits Apollo
- registrar request ID, operation ID, provider request ID, duracion y outcome
- no registrar payloads de contacto, emails, telefonos, API keys ni callback URL
- registrar `credits_consumed` cuando Apollo lo entregue
- alertar callbacks expirados, provider outcomes unknown, 401, 403 y 429
- diferenciar consumo de cuota del producto de consumo de creditos Apollo

## Seguridad

- corregir `WITH CHECK` de `enriched_opportunities`
- revocar `increment_contacted_count(text)` a roles cliente
- callbacks y RPCs de reconciliacion solo para `service_role`
- verificar ownership dentro de la RPC, no solo en TypeScript
- limitar body, arrays, emails, telefonos y tiempos de espera
- usar comparacion constante para secretos internos
- no aceptar `provider`, `organization_id`, tabla ni target desde el navegador
- comprobar supresion de privacidad antes y despues de toda frontera externa

## Pruebas

### Gateway

- busqueda sin PII y con filtros acotados
- paginacion y limites
- busqueda de organizacion y costo por pagina
- enriquecimiento sync y async
- webhook URL obligatoria para telefono
- request IDs firmados de 64 bits
- polling pending, success, unknown, expired e invalid
- 401, 403, 422, 429, timeout y respuesta invalida
- uso de query params segun contrato Apollo actual

### BFF

- auth y organizacion obligatorias
- rechazo de provider y organization controlados por cliente
- claim, replay y conflicto de idempotency key
- liberacion pre-provider
- provider outcome unknown despues de la frontera
- persistencia canonica y allowlist de campos
- ausencia de API key en bundle y logs

### Base de Datos

- tablas callback service-role-only
- token opaco y fingerprint validos
- ownership de target
- callback duplicado
- target y provider request mismatch
- settlement de cuota con multiples callbacks
- leases `SKIP LOCKED`
- cooldown y expiracion de reconciliacion
- RLS cross-tenant
- permisos de `increment_contacted_count`

### Investigacion

- hidratacion desde cada tabla permitida
- rechazo cross-tenant
- cliente no puede sobrescribir fila canonica
- fingerprint estable y sensible a cambios Apollo
- cache de empresa compartida por empresa, no por persona
- Apollo no cuenta como evidencia publica
- email y telefono no se filtran a prompts
- company-first desde lead guardado
- draft bloqueado sin evidencia suficiente

### Scheduler y UI

- Firebase es propietario unico de los bridges programados
- snapshots de uso y reconciliacion requieren secreto scheduler
- estados loading, pending, empty, partial, failed y disabled
- responsive, focus, dark mode y contraste

## Secuencia de Implementacion

1. documentar el plan y restaurar el ledger local
2. agregar migraciones de seguridad y callback Apollo
3. implementar y probar adaptador Apollo del gateway
4. conectar BFF de busqueda, organizacion y enriquecimiento
5. implementar webhook y reconciliacion
6. persistir contexto Apollo canonico
7. hidratar investigacion server-side
8. restaurar observabilidad y scheduler Apollo
9. actualizar UI y retirar FullEnrich del runtime
10. ejecutar reset, lint, pgTAP, unit, integracion y builds
11. aplicar y validar en nonprod con dry-run revisado
12. solicitar la API key Apollo para pruebas reales y canary
13. preparar release y checklist de produccion

## Comandos de Validacion

```powershell
npm run doctor
npm run test:reset
npm run db:reset
npm run db:lint
npm run db:test
npm run db:types
npm run test:unit
npm run typecheck
npm run verify:scheduler-ownership
npm --prefix backend test
npm --prefix backend run typecheck
npm --prefix backend run build
npm --prefix functions run build
npm run build
npm run db:push:dry-run
```

Las suites usan `.env.test.local`; nunca deben cargar `.env.local`. Ningun reset,
seed o suite puede ejecutarse contra produccion.

## Gates de Rollout

### Local

- Docker disponible
- reset reproducible incluyendo migraciones historicas recuperadas
- lint y pgTAP sin errores
- unit, typecheck y builds verdes

### Nonprod

- autorizacion explicita antes de escribir
- dry-run revisado
- scopes Apollo verificados
- busqueda, enriquecimiento sync, webhook y poll probados
- RLS, callbacks, cuotas y snapshots de uso verificados
- canary con limites bajos y sin waterfall

### Produccion

- solicitud explicita y release preparado
- backup o ventana de cambio confirmada
- migraciones pequenas, forward-only y por familia de tablas
- schema, RLS y logs verificados antes de ampliar rollout
- Apollo habilitado primero para canary
- FullEnrich desactivado solo despues de validar Apollo end-to-end

## Criterios de Aceptacion

- toda busqueda y enriquecimiento nuevo usa Apollo
- ninguna ruta activa envia datos a FullEnrich
- la API key Apollo existe solo en el gateway
- people search nunca revela PII
- lookup LinkedIn y enriquecimiento son idempotentes y medidos
- telefonos siempre llegan a estado terminal por webhook o poll
- callbacks no aceptan tabla, target ni tenant desde la URL
- ninguna actualizacion cruza organizaciones
- leads Apollo guardados pueden iniciar investigacion company-first
- Apollo mejora contexto sin reemplazar evidencia publica
- prompts de investigacion no contienen telefonos
- creditos y rate limits Apollo tienen observabilidad horaria
- historicos FullEnrich siguen legibles
- todos los gates locales y nonprod estan verdes antes de produccion
