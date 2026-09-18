# Cowork — Fase 2: terminada en código, pendiente despliegue

Fecha de revisión: 18 de septiembre de 2026. Commit `ba7293b` en `main`.

Estado: implementación completa y verificada localmente. Migraciones SQL
aplicadas en producción y registradas en el ledger. Falta el despliegue del
backend (credenciales Firebase locales expiradas) y el recorrido privado.

## Correcciones verificadas en esta revisión

- El verificador incluye las suites de enriquecimiento, campañas, equidad y envío
  con argumentos de Node correctos. Los mocks de las suites anteriores aíslan los
  nuevos adaptadores sin importar accidentalmente sus dependencias externas.
- Las consultas de campañas reciben el cliente de datos en AuthContext. El nombre
  se toma de `definition.name`, no de una columna `name` inexistente en el contrato.
- La vista previa de creación valida la definición completa con CampaignInputSchema.
- La ejecución de creación usa el trabajo que contiene la definición, que puede
  diferir del trabajo donde se observó la lista de campañas.
- La migración local amplía tanto el constraint como `cowork_propose_effect`.
- El envío verifica propuesta persistida en ejecución, alcance, objetivo exacto,
  trabajo vigente y permisos. Revalida después de renovar credenciales y reservar
  cuota. Comprueba hash después de aprobar y antes de invocar al proveedor.
- La clave de envío depende de la versión y no del trabajo que originó la propuesta.
- El enriquecimiento no completa por segunda vez una cuota que liquida el callback
  compartido; conserva resultados inciertos para conciliación. El replay recupera
  el registro persistido con alcance usuario/organización y respeta supresión.
- El mensaje de campaña aprobada distingue automatización activa de inicio manual;
  pausar no promete cancelar un envío que ya estaba en curso.

## Evidencia local

- `npm run typecheck`: aprobado (incluido `next build` limpio sobre el árbol del commit).
- `node scripts/verify-cowork.mjs`: aprobado, 61 pruebas unitarias y 17 scripts
  aislados, incluidos controles de versión, autorización persistida, revocación
  durante renovación, supresión, cuota y resultado incierto.
- `scripts/test-cowork-workspace.mjs`: las tarjetas de envío y campaña renderizan
  remitente, cuerpos completos y destinatarios; una versión que no coincide
  bloquea el botón de aprobar.
- Columnas de `leads`, `contacted_leads`, `bulk_campaigns`, `enriched_leads` y
  `apollo_enrichment_callbacks` verificadas contra producción antes de codificar;
  el replay usa `target_lead_id` (columna real, no `target_id`).
- Son pruebas con dependencias simuladas. No certifican concurrencia SQL, envío
  real ni recorridos autenticados en producción.

## Condiciones pendientes para cerrar la fase

1. Remitente/proveedor y cuenta real fijados en la revisión de envío; la misma
   identidad se comprueba al ejecutar; HTML con fallback a texto. Hecho en código.
2. Creación de campañas idempotente en el servicio compartido (`creationId`
   determinista con recuperación y conflicto 409 ante otra definición),
   definición inmutable después de proponer, y revisión con destinatarios y
   cuerpos completos. Hecho en código.
3. Activar con automatización desactivada no equivale a iniciar envíos: el reply
   lo distingue y pausar no promete cancelar envíos en curso. Hecho en código.
4. Migraciones aplicadas una por vez y verificadas: `20260919090000`
   (constraint + RPC con las 8 clases) y `20260919100000`
   (`cowork_campaign_definitions` con RLS). Ambas registradas en el ledger.
5. Lecturas validadas contra esquema real de producción; métricas con período
   explícito `last_7_days`; `app.context` expone conexiones-snippet, no tokens.
6. Continuidad guardar → enriquecer → investigar → borrador: el email verificado
   rellena el guardado vacío (nunca sobrescribe) para que investigación,
   borradores y envíos lo vean.
7. Revisar tarjetas nuevas en navegador (teclado, revocación, móvil, claro/oscuro).
8. Desplegar el artefacto exacto verificado y ejecutar el recorrido privado.

## Bloqueo actual: despliegue

- `firebase deploy --only apphosting` falla con credenciales expiradas
  (`firebase login --reauth` requerido, interactivo). Sin token CI ni componente
  beta de gcloud disponibles en este entorno.
- Acción requerida del operador: ejecutar `firebase login --reauth` en una
  terminal con navegador y luego `firebase deploy --only apphosting -P
  leadflowai-3yjcy --non-interactive` sobre `main` en `ba7293b`.
- Tras el despliegue: verificar revisión 100% de tráfico y ejecutar el recorrido
  privado (buscar → guardar → enriquecer → investigar → borrador → enviar a un
  destinatario propio).

No se realizaron envíos reales en esta revisión.
