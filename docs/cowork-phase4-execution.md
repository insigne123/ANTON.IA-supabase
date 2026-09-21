# Fase 4 — ejecución del plan completo

Estado: en curso. No es un informe de cierre.

## Incremento de recuperación, herramientas y consumo

- Migración `20260921022101_cowork_specialist_read_leases` aplicada en producción: recuperación de las diez lecturas de dominio nuevas, permisos de herramienta/entrada exactos ligados a la asignación y plazos por intento de especialista. RLS y privilegios verificados inmediatamente.
- Migración `20260921022150_cowork_model_usage` aplicada después: consumo durable por reserva, publicación autorizada e inmutable. Campos desconocidos quedan null. Costo calculable solo con precios explícitos por modelo/version y tokens suficientes; no hay tarifa configurada todavía.
- Adaptador local conectado al gateway compartido. Una lectura opcional por especialista, lista por rol, IDs observados, máximo tres lecturas compartidas entre coordinador y especialistas. No incluye escritura ni investigación externa desde el especialista.
- Pruebas de integración con PostgreSQL nativo y PGlite: agente, admisión, lectura registrada, resultado y consumo durable, reanudación sin nuevas llamadas. Regresiones de SQL, permisos, vencimiento y recuperación aprobadas.
- Política autónoma endurecida a una lista explícita: una nueva operación nunca obtiene aprobación automática por omisión. Activación general permanece apagada.
- Aceptación local: 101 pruebas TypeScript y scripts SQL/integración aprobados; después pasó una prueba adicional de política y la regresión de autonomía.
- Evaluación real `scripts/evaluate-cowork-live.ts --live`: modelo `gpt-5.6-luna`, cuatro casos sintéticos aprobados (truncamiento, contradicción, inyección, datos ausentes). Tokens totales: 452/420/494/409; duración 3403/2987/3147/2159 ms. Sin precio configurado, costo desconocido. No es benchmark estadístico, ni evaluación completa de todos los roles/operaciones.
- Las credenciales de evaluación se obtuvieron temporalmente de Secret Manager sin persistirlas ni imprimirlas. No se enviaron datos privados ni se usó la base de producción para pruebas.
- Despliegue de este incremento de app confirmado: `studio-build-2026-09-21-002`, 100% tráfico; build `834e6beb-f8d2-4e4e-9e5e-242bb3709f8c` exitoso. `COWORK_SPECIALIST_TOOLS_ENABLED` y `COWORK_MODEL_USAGE_ENABLED` activos. Autonomía general sigue ausente. Smoke sin sesión access/profile-preview: 401; Cloud Run ERROR+ sin entradas en la ventana consultada. El CLI agotó su timeout durante el rollout; se confirmó su finalización con Cloud Build y Cloud Run, sin repetir despliegue.
- Build previo al despliegue aislado al scope Cowork mediante stash; trabajo concurrente restaurado y contrastado contra el stash sin diferencias. Respaldo `cowork-phase4-runtime-preserve-concurrent` conservado. No se realizó commit.
- Corrección posterior **local, no desplegada**: eliminar búsquedas ahora prepara snapshot y hash, revalida versión y condiciona DELETE a usuario/organización/updated_at. Preview de edición/eliminación bloquea revisión obsoleta. Propuestas antiguas de eliminación sin snapshot se rechazan. Typecheck, efectos, autonomía y fairness aprobados.

## Evidencia disponible

| Incremento | Estado | Evidencia |
|---|---|---|
| Presupuesto por árbol de conversación | Aplicado en producción | Migración `20260921015112`; catálogo, RLS y privilegios verificados |
| Carrera entre ramas por último cupo | Aprobada en PostgreSQL nativo aislado | Dos conexiones, espera observada en `pg_stat_activity`, solo una reserva aceptada |
| Claims y publicaciones de especialistas concurrentes | Aprobados en PostgreSQL nativo aislado | Sin claim duplicado; un único evento de reanudación |
| Historial de migraciones | Archivos locales alineados | `20260921010035`, `20260921010105`, `20260921015112` |
| Firma Gmail/Outlook | Implementada y probada localmente | DOMPurify + DOM servidor sin recursos; staging/ejecución; preview sandbox/CSP |
| Revisión de firma en navegador | Automatización renderizada aprobada | Chrome, dos temas, 360/768/1440, teclado, carga, rechazo por deriva/revocación |
| Build | Aprobado en árbol actual | Incluye trabajo concurrente; pendiente release aislado |

Las pruebas con PostgreSQL nativo usan una instancia efímera en localhost creada por
`scripts/cowork-isolated-postgres.mjs`, sin URL de conexión configurable ni archivos de entorno.
No usan Supabase remoto. La versión de binarios empleada en esta ejecución fue PostgreSQL 18.4;
producción es PostgreSQL 17.6. PGlite sigue cubriendo las pruebas embebidas anteriores.

## Comandos

Usar Node 22. Instalar herramientas de pruebas fuera del repositorio y configurar sus rutas:

```powershell
$env:COWORK_PGLITE_MODULE='<directorio externo>\node_modules\@electric-sql\pglite\dist\index.js'
$env:COWORK_NATIVE_PG_MODULE='<directorio externo>\node_modules\embedded-postgres\dist\index.js'
$env:PLAYWRIGHT_MODULE='<directorio externo>\node_modules\playwright\index.mjs'
npm run typecheck
node scripts/accept-cowork-phase4.mjs --native --browser
```

El comando extendido incorpora las pruebas nativas y la tarjeta de perfil. No acredita los
otros dominios pendientes, modelos reales, toda la accesibilidad ni aceptación autenticada.

## Revisión renderizada de tarjetas (Chrome headless, APIs simuladas)

- `scripts/test-cowork-reviews-browser.mjs`: las siete tarjetas (ficha, asignación, incidencia, misión, preparación, búsqueda, detener seguimiento) en claro/oscuro, 360/1440 sin overflow, aprobación por teclado con foco visible, deriva que deshabilita aprobar y revocación que retira acciones, sin peticiones externas. Registrado en la aceptación con `--browser`.
- Transiciones activar/pausar campañas v2: **bloqueadas por motor** (no existe transición de lanzamiento/pausa expuesta; el ciclo draft/active lo mueve el propio motor). Cobertura v2 vía Cowork: inbox/plan/step, stop y prepare. No se simula.

## Trabajo siguiente

1. Ampliar recuperación de lecturas y registrar consumo del coordinador/especialistas con costo conocido/desconocido explícito.
2. Especialistas con herramientas limitadas por rol y registro durable; probar revocación y fallos.
3. CRM/tareas y responsables con autorización equivalente a RPC nativas; no suplantar `auth.uid()`.
4. Búsquedas completas, importación/edición/enriquecimiento por lote y cuotas/resultados por fila.
5. Campañas v2 y respuestas en hilos mediante servicios nativos e idempotencia.
6. Misiones, excepciones, acciones permitidas de privacidad y política autónoma.
7. Corpus real de modelos, navegador del resto de superficies y aceptación privada con registros controlados.
8. Release aislado y trazable desde main, documentación final y verificación de producción.

La revisión `studio-build-2026-09-21-002` incluye firma, herramientas de especialistas y consumo.
La corrección posterior de eliminación de búsquedas sigue local. Cambios sin commit.
No se ejecutaron envíos externos ni suites contra datos de producción. El recorrido autenticado sigue pendiente.

## Incremento de efectos CRM y preparación v2 (desplegado)

- Migraciones `20260921041859_cowork_phase4_effects_2` (kinds `crm_update_record`, `campaign_prepare_draft_v2` + tablas `cowork_crm_record_proposals` y `cowork_campaign_prepare_proposals`) y `20260921041917_cowork_propose_effect_origin_semantics` (restaura raise ante origen inválido) aplicadas una por vez; RLS, políticas privadas y privilegios solo-`service_role` verificados.
- `crm.update_record`: etapa, responsable de ficha, notas, próxima acción y enlace, con versión optimista y creación controlada; nunca reasigna colaboración. `campaign.prepare_draft_v2`: prepara el borrador del paso observado con claim nativo atómico; rechaza pasos con borrador o estado movido.
- Ambos exigen revisión humana siempre (fuera de la lista autónoma por construcción) y tienen tarjeta de revisión con preview que bloquea ante deriva, más rutas preview 401 sin sesión.
- Pruebas: `test-cowork-domain-effects-2.mjs` aprobado; `verify-cowork` completo aprobado (incluye fixtures de autonomía/equidad ampliados).
- Despliegue `studio-build-2026-09-21-003`, 100% tráfico, condiciones Ready/Active/Healthy en True, flags Fase 4 + herramientas + consumo activos, autonomía ausente. Smoke 401 en access y ambos previews nuevos; cero ERROR+ en 30 min. Build aislado al scope Cowork con stash; concurrente restaurado sin diferencias; respaldo `cowork-phase4-effects2-preserve-concurrent` conservado. Sin commit.
- Junto a este incremento se desplegaron también la corrección de eliminación de búsquedas ligada a versión, el turno D5 en `contacted.timeline` y las reglas conversacionales AXIS en instrucciones.

## Incremento de asignación, incidencias y misiones (código verificado, despliegue bloqueado)

- Migración `20260921133043_cowork_phase4_effects_3` aplicada y verificada: kinds `crm_assign_lead`, `exception_resolve`, `mission_control`; wrapper `cowork_lead_collaboration_op` con la matriz v1 exacta y actor explícito (solo `service_role`); tres tablas preparadas con RLS y políticas privadas.
- `crm.assign_lead`: asignar/reservar/liberar con la misma función pura de permisos de la UI; pre-chequeo en staging y revalidación atómica en ejecución.
- `exception.resolve`: solo abiertas → resolved/dismissed con motivo; motivo preservado en payload sin destruir datos.
- `mission.control`: solo misiones propias active↔paused; pausar replica la transición de la app (tareas pendientes omitidas + log).
- Los tres exigen revisión humana, con tarjeta de revisión y preview que bloquea ante deriva.
- Pruebas: `test-cowork-domain-effects-3.mjs` aprobado; `verify-cowork` completo aprobado.
- Build aislado aprobado. **Despliegue bloqueado: credenciales Firebase vencidas** (`firebase login --reauth` interactivo requerido; sin token CI disponible y sin vía gcloud para App Hosting). Producción sigue en `studio-build-2026-09-21-003` sin este incremento. Respaldo `cowork-phase4-effects3-preserve-concurrent` conservado. Sin commit.
