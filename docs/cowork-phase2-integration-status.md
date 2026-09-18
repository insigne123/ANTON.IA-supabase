# Cowork — Fase 2: desplegada, pendiente recorrido privado

Fecha de revisión: 18 de septiembre de 2026. Commits `ba7293b` y `5c679e6` en `main`.

Estado: implementación completa, migraciones aplicadas y backend desplegado con
`firebase deploy --only apphosting` (Deploy complete, 18-09-2026). Falta el
recorrido privado de aceptación.

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

## Bloqueo anterior (resuelto): despliegue

- El primer intento falló por credenciales Firebase expiradas; el operador
  reautenticó con `firebase login --reauth`.
- Los reintentos devolvieron 409 sobre `build-2026-09-18-002` (ID ya existente);
  tras esperar a que se asentara el estado del backend, el despliegue completó.
- La app responde en producción (ruta protegida devuelve 401 sin sesión, como
  corresponde). La confirmación final es el recorrido privado.

## Recorrido privado de aceptación (pendiente, sin envíos reales ajenos)

1. Buscar → guardar → enriquecer un contacto propio y comprobar que el email
   aparece en la ficha guardada.
2. Investigar y pedir borrador sobre ese contacto.
3. Revisar el borrador y proponer envío: comprobar remitente real, destinatario,
   asunto y cuerpo exactos en la tarjeta.
4. Enviar a un destinatario propio y comprobar registro en Contactados sin
   duplicados.
5. Crear una campaña de prueba (1 destinatario propio), comprobar cuerpos
   completos en la tarjeta, aprobar creación (queda pausada), luego activar y
   pausar comprobando los mensajes de consecuencia.

No se realizaron envíos reales en esta revisión.
