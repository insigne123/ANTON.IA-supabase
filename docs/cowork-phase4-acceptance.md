# Aceptación local de dominios y runtime — Fase 4

Fecha: 21-09-2026. Resultado: aprobada para las consultas y efectos implementados y el runtime local y desplegado. **No constituye aceptación del recorrido privado ni de los frentes diferidos.**

## Operaciones nuevas

| Acción | Alcance | Evidencia |
|---|---|---|
| `missions.list` | Misiones propias de la organización activa, máximo 20 | Filtro usuario/org, payload interno omitido, límite/truncamiento |
| `exceptions.list` | Incidencias abiertas del equipo, máximo 20 | Filtro organización/estado, sin payload de ejecución |
| `campaigns.inbox` | Pendientes propios de campañas-v2 | Servicio `getCampaignV2Inbox`, flags vigentes, una organización, truncamiento explícito |
| `campaigns.plan` | Plan de seguimiento por borrador, sin textos de mensajes | Servicio nativo, flag v2, minimización a estructura/estados |
| `campaigns.step_context` | Estado y envío de un paso, sin internos del proveedor | Servicio nativo, verificación de creador, minimización |
| `crm.collaboration` | Responsable y reserva del contacto en la organización | Contacto existente, flag de colaboración, filtros de entidad y organización |
| `crm.record` | Ficha comercial (`lead_saved|`, `lead_enriched|`) por contacto | Filtros de entidad y organización, notas acotadas |
| `privacy.contactability` | Restricciones de un contacto identificado por UUID | Supresión compartida, dominios excluidos, último contacto; falla cerrado ante errores |
| `privacy.contactability_batch` | Restricciones de hasta 5 contactos en una operación | Mismas comprobaciones por recipiente; consume el turno de lecturas |

## Efectos nuevos (todos con revisión humana, sin auto-aprobación)

| Acción | Alcance | Evidencia |
|---|---|---|
| `profile_update` | Identidad comercial propia; deriva rechazada | Propuesta preparada con hash, relectura con `updated_at`, actualización optimista, `test-cowork-domain-effects.mjs` |
| `saved_search_create/update/delete` | Solo búsquedas propias; duplicados y deriva rechazados; nunca ejecuta | Propuesta preparada, verificación de propiedad, confirmación de escritura |
| `campaign_stop_v2` | Detiene seguimiento observado en inbox; servicio nativo idempotente | Target con IDs observados, revalidación en servicio, preview de estado |

Son lecturas salvo los 5 efectos con revisión listados arriba: no asignan responsables, editan etapas, resuelven incidencias ni ejecutan campañas. Contactabilidad no verifica existencia del buzón ni autoriza envíos. Esquema de misiones, incidencias y colaboración contrastado mediante consulta de catálogo en producción, sin leer registros privados ni escribir datos.

## Ejecución reproducible

Instalar `@electric-sql/pglite` fuera del repositorio y definir `COWORK_PGLITE_MODULE` con la ruta absoluta a su `dist/index.js`.

```powershell
node scripts/accept-cowork-phase4.mjs
```

El comando no carga archivos de entorno ni accede a Supabase. La base SQL es PostgreSQL embebido en memoria. Los modelos y proveedores se sustituyen por fixtures deterministas.

## Resultado observado (21-09-2026)

- TypeScript aprobado.
- `verify-cowork` aprobado, incluidos suites `domains` (9 adaptadores por agente/gateway/planes) y `domain-effects`
  (staging/ejecución de perfil, búsquedas y campaign-stop con propiedad, deriva y confirmación).
- Siete pruebas de servicios compartidos de campañas-v2 y privacidad aprobadas.
- Prueba SQL de leases: propiedad del token, intento vencido, replay, recuperación de lecturas, resultado incierto, cancelación/revocación y privilegios aprobados.
- Prueba SQL de cola/presupuesto: admisión, claims sucesivos exclusivos, finalización y reanudación atómicas, límites,
  vencimiento, permisos y agregado por hilo (16 reservas/96000 aceptadas, 17ª rechazada; ancestro cíclico rechazado) aprobados.
- Integración real agente → RPC PostgreSQL → ticks independientes del adaptador → resultados/consumo durables → síntesis reanudada aprobada. Dos llamadas de especialista; un tick posterior no genera de nuevo; la síntesis no ejecuta más herramientas.
- Despliegue `studio-build-2026-09-21-001` (100% tráfico, flags Fase 4 activos): smoke 401 en `/api/cowork/access`,
  `profile-preview` y `campaign-stop-preview`; Cloud Logging ERROR+ sin entradas en la ventana consultada.

Duraciones de suites en esta ejecución: Cowork ~70 s; servicios compartidos ~2,6 s; leases SQL ~6–7 s; cola SQL ~6–7 s; integración completa local ~7 s. Son tiempos de ejecución de pruebas, no latencia de producto.

## Límites pendientes de cierre

- Recorrido privado autenticado del propietario y revisión visual/accesible renderizada.
- Calidad factual con modelos/proveedores reales y costo monetario (sin precios del proveedor).
- Asignación/etapa/próxima acción CRM, importación/Sheet por lote, respuesta en hilo, resolución de misiones,
  crear/editar planes v2 y modo autónomo: diferidos con motivo en el inventario v1.
- Carreras SQL entre conexiones independientes (PGlite no demuestra ese escenario).
- Las lecturas nuevas aún no están en la lista SQL de recuperación automática de leases v2; ante interrupción fallan conservadoramente, sin reejecución. Añadirlas exige migración forward-only y pruebas de recuperación.
