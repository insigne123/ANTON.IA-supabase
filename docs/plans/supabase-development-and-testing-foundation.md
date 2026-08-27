# Plan de Fundacion Supabase, Pruebas y Desarrollo Asistido

## Proposito

Este documento es el registro durable para hacer reproducible, seguro y rapido
el desarrollo de ANTON.IA. Cubre Supabase, cuentas de prueba, migraciones,
pruebas, CI y la configuracion de OpenCode.

La prioridad inmediata es resolver Supabase. Las fases posteriores no deben
olvidarse ni reemplazarse: se ejecutaran en orden para evitar que las pruebas o
el agente escriban accidentalmente en produccion.

Actualizar `Estado de ejecucion` al cerrar una fase o descubrir un bloqueo. No
eliminar tareas completadas ni riesgos conocidos; este archivo tambien es el
registro de decisiones y auditoria.

## Alcance y Fuera de Alcance

Incluye:

- Un proyecto Supabase nonprod en una cuenta nueva y aislada.
- Supabase local con Docker, datos sinteticos y migraciones reproducibles.
- Cuentas QA estables y usuarios efimeros para pruebas automatizadas.
- Separacion de pruebas unitarias, de base de datos, integracion, E2E y smoke.
- Tipos TypeScript generados desde el esquema local.
- Flujo seguro de migraciones, comandos de desarrollo, CI y OpenCode.
- Auditoria gradual de RLS de produccion.

No incluye:

- Copiar datos personales, secretos o tablas ajenas desde produccion.
- Dar al agente permisos de escritura sobre produccion.
- Crear un login especial, bypass de autenticacion o puerta trasera en la app.
- Activar RLS de forma masiva sin pruebas de politicas y propietarios claros.

## Estado de Ejecucion

| Fase | Estado | Nota |
| --- | --- | --- |
| 0. Guardrails y diagnostico seguro | Completada | Unitarias sin credenciales heredadas, targets fail-closed, native research opt-in y prebuild determinista. |
| 1. Cuenta y proyecto Supabase nonprod | Completada | Proyecto `htketmmhsfmucevvqmxi` enlazado, migrado y disponible por MCP separado. |
| 2. Stack local reproducible | Completada | Node 22, Docker, CLI fijada y replay completo verificado. |
| 3. Identidades y datos QA | Completada | Dos tenants, fixtures deterministas e identidades E2E efimeras con cleanup. |
| 4. Suites de pruebas | Completada (base) | Unit, pgTAP e integracion separadas; un browser E2E completo queda como mejora de producto. |
| 5. Migraciones, tipos y contratos | Completada (base) | Tipos versionados y 58 contratos pgTAP/RLS; adopcion estricta de tipos sera gradual por deuda legacy. |
| 6. OpenCode y documentacion tecnica | Completada | Docs y comandos seguros creados; reiniciar OpenCode para cargarlos. |
| 7. CI y release gates | Completada (local) | Workflow PR local-first sin secretos remotos; deploy gates siguen fuera del CI automatico. |
| 8. RLS y seguridad de produccion | Pendiente | Trabajo separado, gradual y con aprobacion explicita. |

## Registro de Decisiones

1. Produccion conserva el MCP actual en modo de solo lectura.
2. Se creara una cuenta Supabase nueva para desarrollo y pruebas, porque la
   cuenta actual llego a su limite de proyectos.
3. El primer proyecto de esa cuenta se llamara `antonia-nonprod`, salvo que se
   apruebe otro nombre antes de crearlo.
4. El proyecto nonprod contendra solo schema versionado y datos sinteticos.
5. Las pruebas no usaran `.env.local` por defecto ni podran apuntar al project
   ref de produccion.
6. Las cuentas QA usaran Supabase Auth real con email/password; no se agregara
   un bypass de autenticacion a la aplicacion.
7. Los usuarios E2E se crearan por ejecucion y se eliminaran en `finally`.
8. Las migraciones nuevas son forward-only. Una reparacion de replay de una
   migracion ya aplicada solo se permite si esta documentada, no se ejecutara
   contra produccion y se revisa antes de cualquier push externo.
9. Cualquier paso con escritura en produccion requiere autorizacion explicita
   de la persona responsable del release.
10. Las creaciones historicas de `enriched_opportunities` que vivian fuera de
    `supabase/migrations` se recuperan con sus timestamps originales para que
    el reset local respete el orden de dependencias.
11. `pgcrypto` ya existe en el stack local, pero la CLI no puede ejecutar
    `create extension if not exists` bajo su rol de migracion. Las migraciones
    afectadas solo intentan crearlo cuando el catalogo confirma que falta.

## Inventario Confirmado

- `opencode.json` apunta al proyecto actual con `read_only=true`; la ausencia
  de escritura por MCP es un control de seguridad, no una falla.
- `supabase migration list --linked` confirmo paridad entre las 108 migraciones
  locales y el historial remoto al momento de la auditoria.
- La CLI local instalada es `2.84.2`; se identifico una version mas reciente.
- Docker Desktop no estaba ejecutandose, por lo que Supabase local no puede
  iniciarse todavia.
- `supabase/config.toml` configura `supabase/seed.sql`, pero ese archivo no
  existe aun.
- `scripts/run-node-tests.mjs` carga `.env.local`; la suite general puede usar
  credenciales reales.
- `__tests__/firestore-services.test.mjs` tiene una prueba que consulta una
  membresia real y consume cuota si hay credenciales disponibles. Por eso el
  comando actual `npm test` no puede considerarse unitario ni seguro.
- Los scripts E2E actuales cargan `.env.local` y usan `SUPABASE_SERVICE_ROLE_KEY`.
  En particular, el reporting E2E crea tareas sobre una mision existente sin una
  limpieza equivalente de todos sus efectos.
- El `prebuild` actual escribe `src/lib/app-version.ts`, de modo que un build
  puede dejar cambios no deseados en Git.
- No existen seed data, pruebas pgTAP, tipos de Supabase generados ni CI.
- El proyecto remoto actual contiene tablas no cubiertas por las migraciones de
  este repositorio y la auditoria reporto tablas con RLS desactivado. No se debe
  usar como entorno de escritura para desarrollo asistido.

## Actualizacion de Ejecucion (2026-08-26)

- `npm run db:reset` reconstruye el stack local desde cero y aplica todas las
  migraciones antes de ejecutar `supabase/seed.sql`.
- `npm run db:lint`, `npm run db:test` (112 aserciones pgTAP),
  `npm run test:integration` (4 pruebas locales) y `npm test` (585 pruebas)
  pasan con el stack local.
- `npm run test:env:local` genera `.env.test.local` desde
  `supabase status --output env`, valida que apunta a localhost y mantiene el
  archivo ignorado por Git. Nunca copiar claves de produccion a ese archivo.
- `npm run test:identity:ensure` crea o actualiza `qa-owner`, `qa-member` y
  `qa-outsider` con Supabase Auth real, perfiles y membresias idempotentes.
  `npm run test:reset` ejecuta reset local, genera el entorno y restaura esas
  identidades y fixtures deterministas. La password QA se genera localmente y
  solo vive en `.env.test.local`.
- La integracion local verifica con la clave anonima que owner y member ven
  `ANTON.IA QA`, mientras que outsider solo ve `ANTON.IA QA Externa`.
- Se recuperaron `20251208000000_create_enriched_opportunities.sql` y
  `20251220000000_fix_enriched_opportunities.sql` desde los scripts historicos
  que estaban fuera del directorio de migraciones de la CLI. Dos migraciones
  actuales reconcilian las columnas de `enriched_opportunities` y la
  compatibilidad de `lead_research_reports.report_id`.
- Node `22.23.2`, Supabase CLI `2.115.0` y el enlace exclusivo a nonprod estan
  verificados por `npm run doctor`.
- `src/lib/database.types.ts` se genera desde local y CI revisa su diff. Los
  clientes globales siguen temporalmente sin generico estricto porque activarlo
  revela contratos legacy ajenos a esta fundacion; la adopcion sera incremental.
- Produccion continua fuera de este flujo. No existe un script de push a
  produccion y cualquier release requiere aprobacion explicita separada.
- Nonprod tiene RLS activo en todas las tablas publicas expuestas a roles cliente.
  `antonia_exceptions` es server-owned y `unified_crm_data` aplica aislamiento
  por membresia desde `20260826130000_secure_legacy_crm_tables`.

## Arquitectura Objetivo

```text
                    Produccion actual
                    datos reales
                    MCP: solo lectura
                           |
                           | diagnostico y release aprobado
                           v
Repositorio -> Supabase local -> antonia-nonprod -> produccion
             Docker + seed      nueva cuenta        gate manual/CI
             datos desechables  datos sinteticos
                    |
                    +-- unit, db, integration y E2E locales
                    +-- cuentas QA y usuarios efimeros
```

| Entorno | Datos | Escritura del agente | Uso permitido |
| --- | --- | --- | --- |
| Produccion actual | Reales | No | Consultas, logs y diagnostico de solo lectura. |
| `antonia-nonprod` | Sinteticos | Si, con guardrails | QA manual, migraciones validadas y smoke tests. |
| Local | Desechables | Si | Desarrollo diario, tests SQL, integracion y E2E. |

## Invariantes No Negociables

1. Ninguna prueba automatizada podra contactar produccion.
2. Ningun secreto de service role se enviara al navegador ni se versionara.
3. Ninguna prueba puede enviar correos, consumir proveedores pagados o disparar
   webhooks reales salvo en una suite explicitamente opt-in y sandbox.
4. Un `db reset` local debe reconstruir schema y datos de prueba desde cero.
5. Toda cuenta QA y fixture debe ser sintetica, identificable y eliminable.
6. La aplicacion debe seguir usando autenticacion real de Supabase para QA.
7. El agente solo podra escribir en local o nonprod despues de validar destino.
8. Un build, lint o test no debe modificar archivos versionados.
9. Las politicas RLS se prueban con usuarios de organizaciones distintas antes
   de cualquier cambio remoto.

## Cuentas e Identidades QA

### Tipos de Identidad

| Identidad | Uso | Persistencia | Organizacion |
| --- | --- | --- | --- |
| `qa-owner@antonia.test` | QA manual y smoke funcional | Estable | `ANTON.IA QA` como owner. |
| `qa-member@antonia.test` | Colaboracion y permisos internos | Estable | `ANTON.IA QA` como member. |
| `qa-outsider@antonia.test` | Pruebas RLS entre tenants | Estable | `ANTON.IA QA Externa` como owner. |
| `e2e-<run-id>@antonia.test` | Una ejecucion E2E concreta | Efimera | Organizacion unica por ejecucion. |

### Metodo de Provision

1. Crear `scripts/bootstrap-test-identities.mjs`.
2. El script debe validar primero que el destino es local o el project ref
   nonprod permitido.
3. El script usara `auth.admin.createUser` de Supabase para crear o recuperar
   las tres identidades estables de forma idempotente.
4. El trigger existente de perfiles crea la fila de `profiles` al crear el
   usuario; el script solo verificara que exista.
5. El script creara `organizations` y `organization_members` con service role.
6. Un segundo script, `scripts/bootstrap-test-fixtures.mjs`, cargara leads,
   campañas, misiones, borradores y estados sinteticos dentro de las
   organizaciones QA.
7. Las credenciales QA viviran en `.env.test.local` o secretos nonprod; nunca
   en SQL, Git, screenshots ni logs.
8. El comando `npm run test:identity:ensure` sera seguro de repetir.
9. El comando `npm run test:reset` ejecutara reset local, identidades y fixtures
   en un unico flujo.

### Reglas de Uso

- `qa-owner` es la cuenta que una persona puede usar para abrir la app y probar
  manualmente con datos previsibles.
- Los tests automatizados no reutilizan filas compartidas de `qa-owner`; crean
  un usuario, organizacion y datos con un `run-id` unico.
- Toda E2E guarda sus IDs raiz y elimina primero los datos dependientes, luego
  la membresia, la organizacion y finalmente el usuario.
- Si una E2E se interrumpe, `npm run test:e2e:identity:cleanup -- <run-id>` permite
  limpiar recursos huerfanos sin buscar datos manualmente.
- No se crea ninguna ruta HTTP de "login como QA" ni flag de bypass. La pantalla
  actual de login seguira usando `signInWithPassword`.

## Contrato de Entornos

| Variable | Local | Nonprod | Produccion |
| --- | --- | --- | --- |
| `APP_ENV` | `test` o `local` | `staging` | `production` |
| `NEXT_PUBLIC_SUPABASE_URL` | `http://127.0.0.1:54321` | URL de `antonia-nonprod` | URL actual productiva |
| `SUPABASE_TEST_PROJECT_REF` | No necesaria | Ref de nonprod | No definida |
| `TEST_DATABASE_ENABLED` | `true` | `true` solo para QA autorizado | Nunca `true` |
| `OUTBOUND_DELIVERY_MODE` | `mock` | `disabled` o `mock` | Configuracion productiva |
| `ALLOW_EXTERNAL_SIDE_EFFECTS` | `false` | `false` | Solo controlada por release |

El validador de destino rechazara un test si se cumple alguna de estas
condiciones:

- `APP_ENV` no es `test` ni `staging`.
- La URL coincide con el host o project ref de produccion.
- El host no es localhost y no coincide con `SUPABASE_TEST_PROJECT_REF`.
- Falta `TEST_DATABASE_ENABLED=true`.
- Se intenta activar un proveedor externo sin la bandera opt-in especifica.

## Fase 0: Guardrails y Diagnostico Seguro

### Tareas

- [ ] Crear un validador comun de destino de pruebas.
- [ ] Hacer que `npm test` sea estrictamente unitario y no cargue `.env.local`.
- [ ] Mover la prueba de cuota real fuera de la suite unitaria.
- [ ] Separar los scripts actuales de endpoint, reporting y mission edit en una
  suite de integracion/E2E con guardrails de entorno.
- [ ] Deshabilitar por defecto AI, email, Apollo, webhooks y cron reales durante
  pruebas.
- [ ] Centralizar la proteccion de side effects en los adaptadores de proveedor,
  no en condiciones repartidas por las rutas API.
- [ ] Cambiar el generador de version para que `prebuild` no escriba
  `src/lib/app-version.ts`.
- [ ] Crear `npm run doctor` para verificar Node, Docker, CLI, entorno, destino,
  migraciones y archivos de configuracion minimos.

### Criterios de Salida

- `npm test` no puede leer service role ni llamar Supabase remoto.
- Un intento de ejecutar E2E contra produccion falla antes de crear una peticion.
- `npm run build` no deja cambios en `git status`.
- `npm run doctor` explica de forma accionable cualquier prerequisito faltante.

## Fase 1: Cuenta y Proyecto Supabase Nonprod

### Prerequisito Operativo

La persona responsable creara una nueva cuenta Supabase y un proyecto vacio
para ANTON.IA. Solo se debe compartir el `project_ref` cuando este creado; no
se deben compartir passwords de base de datos, PATs ni service-role keys por
chat o Git.

### Tareas

- [ ] Crear la cuenta Supabase aislada y el proyecto `antonia-nonprod`.
- [ ] Elegir region, facturacion y titularidad de la nueva cuenta.
- [ ] Configurar Auth para QA por email/password.
- [ ] Mantener datos reales fuera del proyecto nonprod.
- [ ] Crear secretos nonprod separados para Supabase, OpenAI sandbox y otros
  proveedores que sean estrictamente necesarios.
- [ ] Configurar un runtime/app nonprod separado antes de cualquier smoke test.
- [ ] Conectar la CLI al nuevo project ref solo en el entorno nonprod.
- [ ] Validar que el nuevo proyecto empieza sin tablas ajenas al repositorio.

### Reglas de Bootstrap

- No ejecutar `supabase db pull` contra produccion compartida para poblar el
  nuevo proyecto: arrastraria schema ajeno y posibles dependencias no deseadas.
- El bootstrap parte de las migraciones versionadas del repositorio.
- Antes de `db push` a nonprod se debe conseguir un `db reset` local exitoso.
- Si la app necesita una tabla no representada por migraciones, se identifica el
  propietario y se crea una migracion explicita, no se importa todo el schema.

### Criterios de Salida

- Existe un project ref nonprod aislado y sin datos de clientes.
- Todas las migraciones pasan localmente y pueden desplegarse al proyecto nuevo.
- La app nonprod usa solo URLs y claves nonprod.

## Fase 2: Stack Local Reproducible

### Tareas

- [ ] Fijar Node 22 con `.nvmrc` y `engines`, alineado con Firebase Functions.
- [ ] Agregar la CLI de Supabase como dependencia de desarrollo con version fija.
- [ ] Crear `supabase/seed.sql` con datos no sensibles o delegar los datos Auth
  al bootstrap idempotente de identidades.
- [ ] Instalar e iniciar Docker Desktop como prerequisito documentado.
- [ ] Crear `.env.test.example` con URL local y sin secretos productivos.
- [ ] Agregar `npm run db:start`, `db:stop`, `db:reset` y `db:status`.
- [ ] Hacer que todos los comandos usen `--local` o `--linked` explicitamente.
- [ ] Guardar reportes temporales en una carpeta ignorada, no en archivos fuente.

### Criterios de Salida

```text
git clone
-> npm ci
-> iniciar Docker
-> npm run doctor
-> npm run test:reset
-> npm run dev
-> login con qa-owner@antonia.test
```

Ese flujo debe funcionar sin datos de produccion ni pasos manuales ambiguos.

## Fase 3: Datos QA, Fixture Factory y Limpieza

### Tareas

- [ ] Crear un factory de datos de prueba con IDs y prefijos deterministas.
- [ ] Cargar fixtures de dos organizaciones para probar aislamiento tenant.
- [ ] Incluir estados de interfaz: vacio, normal, bloqueado, error, campana,
  investigacion, borrador y reply.
- [ ] Usar dominios de correo no entregables como `example.test`.
- [ ] Crear helpers para crear y limpiar usuarios E2E efimeros.
- [ ] Registrar `run-id`, IDs creados y fecha de expiracion para limpieza segura.
- [ ] Crear comando de limpieza manual para ejecuciones interrumpidas.

### Criterios de Salida

- QA manual tiene datos previsibles despues de un reset.
- Las pruebas de organizacion A no pueden leer ni escribir en organizacion B.
- Una E2E fallida deja un camino de limpieza documentado y automatizable.

## Fase 4: Separacion de Suites de Prueba

| Suite | Entorno | Permite red externa | Proposito |
| --- | --- | --- | --- |
| `test:unit` | Node | No | Logica pura, contratos y adaptadores mock. |
| `test:db` | Supabase local | No | pgTAP, RLS, RPC, constraints y migraciones. |
| `test:integration` | App local + Supabase local | No | Rutas API, Auth, persistencia y workers mock. |
| `test:e2e` | Browser + local | No | Flujos reales de UI con usuarios efimeros. |
| `test:staging` | `antonia-nonprod` | Solo mock por defecto | Smoke controlado con `qa-owner`. |
| `test:live` | Sandbox externo | Si, opt-in | Verificacion manual de proveedores sandbox. |

### Tareas

- [ ] Mantener Node test runner para unitarias si sigue siendo suficiente.
- [ ] Agregar una herramienta E2E de navegador y configuracion explicita.
- [ ] Crear pgTAP en `supabase/tests/` para RLS, funciones y restricciones.
- [ ] Agregar mocks de `fetch` y proveedores en un punto reutilizable.
- [ ] Convertir los scripts E2E actuales en pruebas con setup, teardown y
  aserciones de limpieza.
- [ ] Eliminar side effects live de las rutas que se ejecutan por defecto en
  endpoint smoke tests.
- [ ] Definir una lista minima de smoke tests staging que no envie correos ni
  consuma cuota externa.

### Criterios de Salida

- Cada suite declara claramente su destino y efectos permitidos.
- Los resultados son deterministas y no dependen de filas existentes remotas.
- No hay credenciales de produccion requeridas para CI o desarrollo diario.

## Fase 5: Migraciones, Tipos y Contratos de Base de Datos

### Comandos Propuestos

```text
npm run db:status
npm run db:migration -- <nombre-en-snake-case>
npm run db:reset
npm run db:lint
npm run db:test
npm run db:types
npm run db:push:dry-run
npm run db:push:nonprod
npm run db:push:production
```

### Flujo Obligatorio

```text
Crear migracion
-> revisar SQL
-> db:reset local
-> test:identity:ensure y fixtures
-> db:lint
-> db:test
-> test:integration
-> db:types
-> revisar diff
-> db:push:nonprod
-> smoke nonprod
-> aprobacion de release
-> db:push:production
```

### Tareas

- [ ] Crear wrappers de comandos que validen el destino antes de llamar la CLI.
- [ ] Generar `src/lib/database.types.ts` desde el schema local.
- [ ] Reemplazar clientes `SupabaseClient<any>` por clientes genericos tipados.
- [ ] Validar que tipos generados no cambian sin una migracion revisada.
- [ ] Añadir pruebas de RLS con owner, member y outsider.
- [ ] Probar RPC, quotas, idempotencia, transiciones y privacidad relevantes.
- [ ] Bloquear `db:push:production` fuera del flujo de release aprobado.

### Criterios de Salida

- Un cambio de schema incompatible se detecta localmente por SQL o TypeScript.
- Los tipos son una representacion versionada y verificable del schema local.
- Nonprod nunca recibe una migracion que no paso reset, lint y pruebas.

## Fase 6: OpenCode y Documentacion Tecnica

### MCP

| Conexion | Configuracion | Permiso |
| --- | --- | --- |
| `supabase-production` | Project ref actual, `read_only=true`, grupos `database,docs` | Solo lectura. |
| `supabase-nonprod` | Nuevo project ref, grupos `database,docs` | Escritura solo tras preflight y peticion explicita. |

La autenticacion del MCP nonprod se realizara con la nueva cuenta mediante OAuth.
Si OpenCode no permite mantener ambas sesiones OAuth simultaneamente, se usara
un perfil/configuracion aislada para nonprod en vez de degradar la proteccion de
produccion.

### Tareas

- [ ] Crear `docs/development.md` con arquitectura, servicios, comandos y
  reglas de entorno.
- [ ] Crear `docs/testing.md` con cuentas QA, fixtures, suites y troubleshooting.
- [ ] Crear `docs/database.md` con migraciones, rollback y criterios de release.
- [ ] Añadir comandos OpenCode `/doctor`, `/db-status`, `/migration` y `/verify`.
- [ ] Añadir reglas tecnicas concisas a `AGENTS.md`.
- [ ] Mantener instrucciones UI disponibles para trabajo visual, pero no cargar
  toda la documentacion visual como contexto obligatorio de tareas backend.
- [ ] Documentar que el agente nunca debe usar una credencial o URL productiva
  para crear datos de prueba.

### Criterios de Salida

- Una nueva sesion puede identificar el entorno, comando de prueba y protocolo
  de migracion sin redescubrir el repositorio completo.
- El agente puede trabajar con nonprod, pero no tiene una via de escritura a
  produccion.

## Fase 7: CI, Release y Observabilidad

### Tareas

- [ ] Crear workflow CI para pull requests.
- [ ] Instalar dependencias de raiz, `functions` y `backend` de forma aislada.
- [ ] Ejecutar lint, typecheck y unit tests de cada proyecto.
- [ ] Iniciar Supabase local en CI con Docker.
- [ ] Ejecutar reset, pgTAP, lint de base y generacion de tipos.
- [ ] Verificar que build no modifica archivos versionados.
- [ ] Ejecutar integracion local sin secretos productivos.
- [ ] Definir un gate manual para migraciones nonprod y otro independiente para
  produccion.
- [ ] Guardar reportes como artefactos de CI, no como archivos versionados.

### Criterios de Salida

- Un pull request no puede integrar una migracion rota ni un cambio que rompa
  RLS probado localmente.
- Produccion solo recibe cambios a traves de un release deliberado y trazable.

## Fase 8: RLS y Seguridad de Produccion

### Tareas

- [ ] Inventariar las tablas con RLS desactivado y asignar propietario funcional.
- [ ] Confirmar cuales pertenecen a ANTON.IA y cuales a otros sistemas.
- [ ] Replicar solo el schema necesario en nonprod para probar politicas.
- [ ] Escribir pruebas de owner, member y outsider antes de crear la migracion.
- [ ] Revisar grants, `SECURITY DEFINER`, search paths y RPC expuestas.
- [ ] Aplicar correcciones de produccion mediante migraciones pequenas y
  forward-only, una familia de tablas a la vez.
- [ ] Monitorear errores de autorizacion y rollback de aplicacion tras cada
  cambio de politicas.

### Regla Critica

No habilitar RLS en bloque. Una tabla sin politica correcta puede dejar de ser
utilizable inmediatamente, y el proyecto actual contiene aplicaciones ajenas a
ANTON.IA.

## Archivos Planeados

| Ruta | Accion | Responsabilidad |
| --- | --- | --- |
| `package.json` | Modificar | Scripts de DB, tests, doctor y CLI versionada. |
| `.nvmrc` | Crear | Fijar Node 22. |
| `.env.test.example` | Crear | Contrato de entorno seguro sin secretos. |
| `supabase/seed.sql` | Crear | Datos SQL sinteticos minimos. |
| `supabase/tests/` | Crear | pgTAP y politicas RLS. |
| `scripts/assert-test-target.mjs` | Crear | Fallar cerrado ante destino incorrecto. |
| `scripts/bootstrap-test-identities.mjs` | Crear | Cuentas QA idempotentes. |
| `scripts/bootstrap-test-fixtures.mjs` | Crear | Datos demo de QA. |
| `scripts/cleanup-test-run.mjs` | Crear | Limpieza de E2E interrumpidas. |
| `scripts/generate-supabase-types.mjs` | Crear | Tipos reproducibles sin redireccion de shell. |
| `scripts/run-node-tests.mjs` | Modificar | Suite estrictamente unitaria. |
| `src/lib/database.types.ts` | Crear | Tipos generados de schema. |
| `src/lib/supabase.ts` | Modificar | Cliente browser tipado. |
| `src/lib/server/supabase-admin.ts` | Modificar | Cliente service role tipado. |
| `opencode.json` | Modificar | MCP production/nonprod con permisos separados. |
| `AGENTS.md` | Modificar | Reglas tecnicas y de seguridad. |
| `.opencode/commands/` | Crear | Comandos de desarrollo guiados. |
| `docs/development.md` | Crear | Mapa tecnico y operaciones locales. |
| `docs/testing.md` | Crear | QA, suites y reproduccion de fallos. |
| `docs/database.md` | Crear | Protocolo de migraciones y releases. |
| `.github/workflows/ci.yml` | Crear | Validacion automatica. |

## Orden de Implementacion Inmediato

1. Crear la nueva cuenta y proyecto `antonia-nonprod`; registrar solo su
   `project_ref` como dato operativo.
2. Implementar Fase 0 para bloquear pruebas contra produccion.
3. Activar Docker y completar Fase 2 para conseguir `db reset` local.
4. Implementar las cuentas QA, fixtures y limpieza de Fase 3.
5. Conectar nonprod solo despues de que local sea reproducible.
6. Implementar pruebas SQL, tipos y comandos de migracion.
7. Añadir OpenCode y CI una vez que los comandos sean estables.
8. Ejecutar la auditoria RLS de produccion como proyecto separado y aprobado.

## Definicion de Completitud

- Un clon nuevo puede levantar la app y entrar con `qa-owner@antonia.test` tras
  ejecutar comandos documentados.
- Ningun test toca produccion ni requiere datos reales.
- Las E2E no dejan usuarios, tareas, campañas, reportes ni membresias huerfanas.
- Cada migracion pasa reset, lint, pgTAP, tipos y pruebas locales antes de
  nonprod.
- OpenCode tiene lectura en produccion y escritura acotada en nonprod/local.
- Build, lint y test dejan un `git status` limpio.
- CI protege las tres aplicaciones: raiz, Firebase Functions y backend.
- Las correcciones RLS de produccion se prueban primero en nonprod con las tres
  identidades QA.

## Referencias Operativas

- Supabase MCP y seguridad: <https://supabase.com/docs/guides/ai-tools/mcp>
- Flujo local de CLI: <https://supabase.com/docs/guides/local-development/cli-workflows>
- Testing y linting de base: <https://supabase.com/docs/guides/local-development/cli/testing-and-linting>
- Tipos TypeScript: <https://supabase.com/docs/guides/api/rest/generating-types>
