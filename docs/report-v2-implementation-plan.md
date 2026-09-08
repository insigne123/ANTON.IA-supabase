# Report V2 Implementation Plan

Estado: implementacion local completa; migracion y rollout pendientes de autorizacion
Fuente: `C:\Users\nicol\Downloads\ANTONIA_REPORT_V2_SPEC_1.md` v1.1
Inicio: 2026-09-08

## Objetivo

Reconstruir el pipeline de reportes de investigacion en siete pasadas recuperables, mantener compatibilidad con Report V1 y dejar de publicar sintesis fallidas o contenido deterministico como si fuera un reporte valido.

## Decisiones del repositorio

- Report V1 permanece inmutable y legible para historicos.
- Report V2 se persiste por `(research_snapshot_id, schema_version)`.
- `lead_research_jobs` conserva la investigacion, cuotas e idempotencia.
- El estado de sintesis se persiste por separado para evitar generacion concurrente desde el worker y el GET.
- V2 usa solo OpenAI. P6 y P7 usan modelos OpenAI distintos y una auditoria deterministica.
- No se ejecutan busquedas Apollo automaticas. Solo se consume contexto Apollo ya persistido.
- El perfil del vendedor se carga con scope de organizacion. La oferta personal actual es fallback temporal cuando la organizacion aun no tiene perfil compartido.
- Sin reglas ICP del tenant, la calificacion es `qualified` con profundidad `shallow` y motivo `icp_rules_missing`.
- El esquema tiene 15 secciones (`0..14`), aunque la especificacion las llama 14.
- Las siete familias literales de P2 son obligatorias; `awards` y `tech` son condicionales.
- Un hecho corporativo sin fecha propia usa la fecha de publicacion/actualizacion de la fuente como `observedAt`; si tampoco existe, no se acepta como `fact`.
- La seccion `angle` comparte el contexto con el pipeline de drafts. El envio continua requiriendo la revision existente.
- Produccion no se modifica sin autorizacion explicita.

## Orden obligatorio

| Fase | Cambios | Gate |
|---|---|---|
| F0 | CH-01 a CH-03 | No se publica fallback; fixture dorado instalado |
| F1 | CH-04 a CH-10 | Contratos, parsing y reparacion pasan tests |
| F2 | CH-11 a CH-13 | Busqueda, claims y comite pasan fixture |
| F3 | CH-14 a CH-16 | P5/P6/P7 producen y auditan V2 |
| F4 | CH-17 | Cobertura y metricas validadas |
| Integracion | API, UI, drafts, perfil | V1/V2 coexisten y build pasa |

## F0 - Contencion

- [ ] CH-01: lanzar `ReportSynthesisFailed` cuando ninguna seccion de modelo sea aceptada.
- [ ] CH-01: eliminar fallback deterministico como salida publicable.
- [ ] CH-01: crear estado durable de sintesis con lease, reintentos 1/5/30 minutos y fallo permanente.
- [ ] CH-01: convertir el GET de detalle en lectura sin efectos para V2.
- [ ] CH-01: bloquear drafts cuando no exista un documento validado.
- [ ] CH-02: agregar `delivery_state` y ocultar documentos suprimidos en loader y RLS.
- [ ] CH-02: crear backfill idempotente con dry-run por defecto.
- [ ] CH-03: congelar fixture GrupoExpro y registrar todas las aserciones doradas.

Gate F0:

- [ ] Un fallo total del modelo no retorna documento visible.
- [ ] Un fallo retryable conserva el snapshot y programa reintento.
- [ ] El tercer fallo crea excepcion operativa y no expone diagnosticos.
- [ ] La suite unitaria permanece verde.

## F1 - Sintesis confiable

- [ ] CH-04: asignar IDs `c01..cNN` estables y persistir mapa al ID interno.
- [ ] CH-05: parsear HTML con Readability/JSDOM, filtrar ruido y truncar por palabra.
- [ ] CH-06: implementar P1 `EntityResolutionV2` y exclusiones por jurisdiccion.
- [ ] CH-07: implementar compuerta ICP deterministica y tenant-aware.
- [ ] CH-08: reparar citas por parrafo y reintentar solo la seccion vacia.
- [ ] CH-09: degradar a otro modelo OpenAI y despues omitir, nunca usar plantilla.
- [ ] CH-10: agregar JSON Schema estricto y `systemPrompt` especifico por pasada.

Gate F1:

- [ ] Ningun prompt contiene UUIDs de claims.
- [ ] HTML, assets y palabras truncadas son rechazados.
- [ ] P1 y la compuerta ICP pasan tests de jurisdiccion y contacto.
- [ ] Una cita invalida no elimina una seccion completa.

## F2 - Investigacion dirigida

- [ ] CH-11: implementar P2 con 6-12 consultas tipadas y plan deterministico de emergencia.
- [ ] CH-12: implementar P3 por fuente con campos objetivo y `notFoundFields`.
- [ ] CH-12: implementar P4 con integridad, deduplicacion, conflictos y jurisdiccion.
- [ ] CH-13: construir comite desde claims, fuentes publicas y Apollo persistido.
- [ ] CH-13: marcar emails no consultados como `not_searched`.

Gate F2:

- [ ] P2 contiene las siete familias obligatorias.
- [ ] Menos del 60% de fuentes aceptadas son del dominio objetivo.
- [ ] GrupoExpro extrae escala, paises, sede y ejecutivo externo.
- [ ] Una fuente fallida no cancela las demas.

## F3 - Analisis y redaccion

- [ ] CH-14: implementar P5 `AnalysisV2` con el modelo critico de OpenAI.
- [ ] CH-14: implementar P6 por seccion sobre analisis validado.
- [ ] CH-14: construir deterministicamente snapshot, committee, volume y sources.
- [ ] CH-15: calcular tres escenarios desde un claim base y supuestos declarados.
- [ ] CH-16: ejecutar auditoria deterministica y P7 con modelo OpenAI distinto.
- [ ] CH-16: reescribir una vez solo las secciones bloqueadas.

Gate F3:

- [ ] El fixture GrupoExpro pasa todas las aserciones aplicables.
- [ ] P6 no introduce claims fuera de P5.
- [ ] Volumen sin inputs configurados queda ausente, no inventado.
- [ ] Ningun documento se publica con defectos `block`.

## F4 - Cobertura y observabilidad

- [ ] CH-17: definir campos obligatorios en un registro declarativo.
- [ ] CH-17: calcular cobertura por campo poblado con claim valido.
- [ ] CH-17: derivar `gaps` desde la misma lista `missing`.
- [ ] CH-17: limitar a 40% un reporte sin cifras de escala.
- [ ] CH-17: emitir metricas operativas sin contenido sensible.

Gate F4:

- [ ] `missing` y `gaps` son consistentes.
- [ ] La telemetria conserva modelo, tokens, duracion y aceptacion por seccion.
- [ ] La cobertura no depende del numero bruto de URLs recuperadas.

## Integracion

- [ ] Agregar registro discriminado V1/V2 sin ensanchar el schema V1.
- [ ] Exponer `reportDocuments` y `preferredReportSchemaVersion` de forma aditiva.
- [ ] Mantener `reportDocument` y `reportSynthesis` como campos legacy V1.
- [ ] Agregar adaptadores de presentacion V1 y V2.
- [ ] Implementar estados ready, refreshing, partial, fallback, loading y failed.
- [ ] Fijar drafts, rewrites y follow-ups al documento, version y hash usados.
- [ ] Cargar seller profile desde el scope del snapshot y no desde la organizacion activa.
- [ ] Separar identidad personal y oferta compartida en la UI existente.
- [ ] Auditar responsive, dark mode, foco, contraste, loading y empty states.

## Verificacion final

- [ ] Tests focalizados por fase.
- [ ] `npm run test:unit`.
- [ ] `npm run typecheck`.
- [ ] `npm run build`.
- [ ] Revision de migraciones forward-only, RLS y funciones SECURITY DEFINER.
- [ ] Revision de `git diff` y ausencia de secretos o cambios ajenos.
- [ ] Dry-run de backfill documentado, sin ejecutar contra produccion.

## Rollout posterior

1. Aplicar la migracion foundation con autorizacion explicita.
2. Verificar esquema, RLS y RPCs inmediatamente.
3. Activar V2 en shadow mode por organizacion piloto.
4. Comparar calidad, cobertura, errores, latencia y costo con V1.
5. Ejecutar el backfill de fallbacks solo tras revisar su dry-run.
6. Preferir V2 en UI cuando exista un documento validado.
7. Mantener V1 como fallback de lectura y rollback durante la estabilizacion.

## Cierre local 2026-09-08

- Reportes V1/V2 persistidos como revisiones inmutables y vinculados al estado vigente por `report_document_id`.
- Lifecycle y persistencia de drafts/provenance resueltos mediante RPCs transaccionales service-role-only.
- Rewrites y aprobaciones fallan cerrados si falta o cambia la provenance fijada.
- Rollout `off`, `shadow` y `visible`, telemetria P5/P6/P7 y fallback de lectura V1 implementados.
- `npm run typecheck`: aprobado.
- `npm run test:unit`: 783/783 aprobado.
- `npm run build`: aprobado.
- `git diff --check`: aprobado con advertencias locales LF/CRLF.
- No se aplicaron migraciones, backfills ni escrituras en produccion.
