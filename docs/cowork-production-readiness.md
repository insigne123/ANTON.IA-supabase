# Cowork: registro vigente de preparación para producción

## Corte de auditoría: 17 de septiembre de 2026

Este registro separa la evidencia actual de las notas históricas de implementación.
No certifica terminado el plan integral.

### Evidencia observada

- Repositorio en `main`, Node 22.23.2. Existen cambios locales concurrentes de extensión, investigación y secuencias que requieren revisión individual antes de publicarse.
- Runtime de studio: `COWORK_ENABLED=true`, `COWORK_WORKER_ENABLED=true`, propietario `de3a3194-29b1-449a-828a-53608a7ebe47`, proveedor OpenAI y modelo configurado `gpt-5.6-luna`.
- No aparecen flags activos para búsqueda externa, investigación, borradores, autonomía ni versiones en las variables Cowork inspeccionadas.
- Base de producción: dos trabajos en estado `completed`; el último creado el 17 de septiembre. El conteo no certifica contenido, calidad ni recorridos con efectos.
- La consulta de errores de `coworktick` de las últimas dos horas no devolvió entradas; no es una medición de disponibilidad.
- TypeScript y `scripts/verify-cowork.mjs` aprobados después del cambio local de instrucciones: 37 pruebas unitarias y los escenarios aislados del script. No son pruebas contra producción.

## Brechas de integración confirmadas

| ID | Brecha | Dependencia / criterio de cierre |
|---|---|---|
| CW-01 | Instrucciones contradictorias sobre herramientas y aprobación | Instrucciones unificadas localmente; verificar respuestas con corpus antes de activar nuevos modos |
| CW-02 | El bucle solo dispone de tres lecturas y propuestas de nota/búsqueda | Contrato de operaciones durables y continuación después de cada efecto |
| CW-03 | Búsqueda externa finaliza por separado | Reanudar el plan desde resultados persistidos sin repetir búsqueda ni cuota |
| CW-04 | Guardar/investigar/borradores dependen de controles sobre un trabajo completado | Adaptadores conversacionales con evidencia del destino y misma autorización que las acciones actuales |
| CW-05 | Gateway genérico tiene dependencias abstractas sin almacén durable conectado | Reserva, concesión, claim, replay, conciliación y resultado persistido atómicos |
| CW-06 | Cola prioriza borradores, luego búsquedas, luego conversación | Política de equidad y presupuesto temporal comprobada con colas simultáneas || CW-07 | Cobertura de operaciones de producto incompleta | Inventario por operación congelado con prueba y servicio compartido |
| CW-08 | Especialistas, sandbox y uploads ausentes | ADR, infraestructura aislada, contratos y validación de archivos |
| CW-09 | Versionado parcial; formatos adicionales y previews pendientes | Manifiesto privado por artefacto, versiones y lectores independientes |
| CW-10 | Memoria y programaciones de usuario pendientes | Scope por organización, revocación, corrección y ejecución recuperable |
| CW-11 | Evaluación integral y revisión renderizada pendientes | Corpus de 60 tareas, 40 fallos inyectados y matriz de acceso del plan |

## Avance 17 de septiembre de 2026

- Migración `20260917120000_cowork_operations.sql` aplicada en producción y verificada: tabla `cowork_operations`, RLS privado, RPC `cowork_reserve_operation` (replay por input idéntico), `cowork_complete_operation`, `cowork_fail_operation` y `cowork_cancel_operation` solo `service_role`.
- Nuevo `src/lib/server/cowork/operations.ts`: hash estable de entradas, reserva/replay/fallo y dependencias del gateway con lecturas siempre permitidas y escrituras/efectos externos denegados sin aprobación explícita.
- El worker ejecuta `leads.search`, `leads.get` y `research.get_existing` mediante el ledger (`read-capabilities.ts`): una consulta idéntica reutiliza su resultado en lugar de repetirse tras un reintento.
- Instrucciones del agente unificadas en `agent-instructions.ts` según flags vigentes; TypeScript y pruebas aprobadas (5 nuevas de operaciones).
- CW-05 y la primera parte de CW-02 quedan implementadas en código; falta la continuación conversacional después de efectos (CW-03/CW-04) y la activación de este incremento en producción.

## Avance: continuación tras búsqueda externa

- El historial del trabajo ahora conserva los 3 resultados de herramienta más recientes en orden cronológico, en lugar de solo los 3 más antiguos.
- Al terminar una búsqueda externa, el worker admite un trabajo hijo con identificador determinista que retoma el resultado persistido sin repetir búsqueda ni consumir cuota de nuevo. La admisión es idempotente y su fallo nunca invalida la búsqueda ya terminada.
- Pruebas de continuación idempotente, UUID determinista y observaciones recientes aprobadas junto a la suite existente.

## Orden de construcción

1. Resolver CW-05 y CW-02 juntos: operaciones durables antes de exponer efectos al modelo.
2. Conectar CW-03/CW-04, probar buscar → guardar → investigar → preparar borrador y recuperación.
3. Completar presupuestos, aprobación ligada a versión y equidad CW-06.
4. Integrar herramientas restantes CW-07 y coordinación de especialistas.
5. Sandbox, archivos y artefactos; después memoria y programaciones.
6. Evaluación integral, verificación del artefacto exacto de release y activación privada.

La restricción al email verificado `nicolas.yarur.g@yago.cl`, UUID autorizado, grant vigente y membresía debe conservarse en cada incremento. Una pantalla disponible no equivale a capacidad operativa ni a aprobación del lanzamiento integral.
