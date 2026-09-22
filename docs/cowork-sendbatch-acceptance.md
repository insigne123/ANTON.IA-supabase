# Cowork fase 4: aceptación de ejecución por correo (4.1–4.8)

Fecha: 22 de septiembre de 2026. **Estado: correcciones locales verificadas, fase 4 NO aceptada integralmente.** La migración previa `20260922030000` se conserva intacta; su aplicación remota está informada por el trabajo anterior, no revalidada en esta auditoría. La nueva `20260922040000` no está aplicada ni probada en PostgreSQL. Sin deploy, commit ni escrituras en producción.

## Alcance

Lotes sobre el motor masivo canónico (`bulk_campaigns` + `outbound_dispatches`). Los días 1/3/7/11/16/23/38 corresponden a offsets 0/2/6/10/15/22/37, pero el contrato **delayDays es relativo al envío anterior**: 0/2/4/4/5/7/15. Si un envío se retrasa, los siguientes esperan desde su envío confirmado. No se reinterpretan campañas legacy ni se reescriben definiciones aprobadas existentes.

## Por función

| ID | Función | Implementación | Verificación |
|---|---|---|---|
| 4.1 | Espaciado | Worker corta tras un envío o resultado incierto; error de consulta no se convierte en intervalo cero. RPC propuesta serializa slots y espera desde el último envío confirmado | Regresión worker/sender aprobada; concurrencia SQL pendiente |
| 4.2 | Registro | Toques exponen `draftId`, `versionId`, `dispatchId` si existe, proveedor y fecha solo cuando salió. Los no intentados son `planned`, no inciertos | Pruebas de reporte aprobadas. Remitente real NO persistido: `email:null`, `verified:false` |
| 4.3 | Empresa/día | Dominio corporativo y alias de nombre; planificación comprueba ambos. RPC transaccional guarda lote y reservas conjuntamente; claim comprueba reserva inicial, día, revisión y despacho | Contrato RPC con fake aprobado; rollback real y carreras PostgreSQL pendientes |
| 4.4 | Cadencia | Intervalos corregidos en constantes e instrucciones sin alterar semántica del motor legacy | Regresión ejecuta `nextCampaignMessage` en cada fecha exacta y un milisegundo antes |
| 4.5 | Siguiente toque | Incluye cobertura incompleta, día reservado, cooldown, espaciado y conciliación | Calculado sobre registros de app; no sustituye claim ni preflight final |
| 4.6 | Reintentos | Conserva clasificación conservadora; `planned` no exige conciliación. Idempotencia de programación reconoce la propuesta ya persistida | Fake y tests puros; resultados del proveedor siguen requiriendo conciliación real |
| 4.7 | Respuesta de empresa | Dominio sigue disponible aunque haya nombre; historial truncado falla cerrado. Revisión ocurre después de refresh y cuota, antes del proveedor | Regresión respuesta durante refresh y otra dirección/dominio aprobada |
| 4.8 | Negociación | Busca peers por dominio y nombre case-insensitive; mismo criterio en reporte y sender | Tests de peer en mayúsculas aprobados; identidad corporativa no es resolución exhaustiva de alias |

## Garantías transversales

- Programar no autoriza envíos: la activación conserva su revisión y cada toque su preflight (supresión, dominio, idioma, cuota, remitente).
- `campaign_schedule_batch` nunca se auto-aprueba, ni siquiera en modo autónomo.
- Lecturas de campaña propias; evidencia de empresa dentro de la organización. Errores y cobertura truncada no certifican ausencia de actividad.
- La nueva migración agrega dos columnas y dos RPC `service_role` con `search_path` vacío y bloqueo transaccional por organización. Se conserva RLS existente. Revisión estática solamente; no equivale a aplicar ni a probar permisos/carreras reales.

## Limitaciones conocidas

- **Bloqueo de release:** ejecutar la nueva migración en PostgreSQL de prueba y verificar rollback, idempotencia, dos campañas/dos workers simultáneos, límites de día Santiago y permisos. No hay `psql` disponible en este entorno; no se usó producción como sustituto.
- La exclusión concurrente propuesta abarca lotes que pasan por este sender. Envíos individuales, otros motores y correo enviado fuera de la app no participan en ese lock; no se certifica exclusión global de todos los canales.
- Respuestas: hasta 200; envíos del día: hasta 500 por fuente. Al alcanzar el límite se bloquea, en vez de permitir envío por ausencia aparente. Esto puede detener lotes en organizaciones grandes; falta consulta indexada exhaustiva/paginación segura.
- Peers CRM: hasta 100 por consulta de dominio/nombre. Mayúsculas se cruzan; nombres con variantes ortográficas, acentos o espacios distintos y dominios diferentes pueden requerir identidad corporativa canónica. No se infieren grupos empresariales.
- Un claim sin envío confirmado conserva el bloqueo; hace falta validar recuperación operativa tras rechazo definitivo/caída, no expirar claims inciertos por tiempo.
- No hay sincronización instantánea con Gmail/Outlook; una respuesta aún no registrada no puede ser detectada. No existe atomicidad distribuida entre la lectura de respuesta y la llamada al proveedor.
- Remitente real histórico pendiente de persistencia; no se inventa a partir del perfil o del proveedor.
- Campañas ya creadas con offsets como intervalos necesitan revisión explícita, no una corrección retroactiva silenciosa.
- Aceptación autenticada, envío real y build de release no ejecutados en esta auditoría.

## Verificación ejecutada

- Node **22.23.2**. Sin cargar archivos `.env`; ninguna suite contra producción.
- `npm run typecheck`: aprobado.
- `node scripts/verify-cowork.mjs`: aprobado, 171 tests Node más scripts aislados (incluye programación por contrato RPC, envío individual, efectos y campañas).
- Suite adicional bulk/guards: 40/40, incluyendo sender, worker, motor legacy y flujos de revisión.
- Tras acotar peers CRM a consultas por dominio/nombre: 15/15 tests de guards/reportes, script de envío individual y typecheck aprobados nuevamente. `git diff --check` sin errores.
- Los resultados anteriores `cowork-sendbatch-results.json` y `cowork-sendbatch-model-results.json` se preservan como históricos, **no como certificación**: el evaluador omitía historial en el prompt, tenía fixtures inconsistentes y no assertions semánticas.

## Evaluación de modelo de esta auditoría

`gpt-5.6-luna`; **10 llamadas en total** (7 + 1 + 2), 3 archivos nuevos sin sobrescribir corridas. Herramientas sintéticas; ninguna ejecución de efectos/proveedores de correo.

- `cowork-sendbatch-audit-1790087631329.json`: cuatro escenarios terminan y pasan assertions estructurales iniciales. Revisión manual encuentra cierres prematuros de hilo en la secuencia y que el caso de escalonado se resolvió por respuesta de empresa, sin aislar el escalonado. No se declara 4/4 de aceptación.
- Se añadió instrucción de coherencia de secuencia, assertion de cierre solo al final y caso de escalonado sin otros bloqueos. No se relajaron assertions.
- `cowork-sendbatch-audit-1790087782284.json`: solo siete toques. **Falla** por «Cierro el hilo» en el cuarto toque, aunque destinatarios, proveedor e intervalos son correctos. La instrucción sola no resolvió la coherencia comercial; sigue pendiente una validación/corrección de contenido.
- `cowork-sendbatch-audit-1790087790442.json`: solo escalonado. Consulta el plan correcto, niega dos envíos y aclara que no están programados. **Assertion falla** por exigir literalmente `dia`, palabra que la respuesta no usa. Se registra como falso negativo del criterio léxico, sin cambiarlo ni repetir hasta verde. Revisión semántica favorable, test automatizado no aprobado.
- Respuesta de empresa e incierto: respuestas de la primera corrida frenan/conciliación correctamente, sin efectos. No se repitieron.

El harness ahora pasa el mismo historial al loop y al prompt, fija el reloj del fixture, usa búsqueda por frase (como el adaptador real, no OR de tokens), permite `--case`, limita llamadas, exige destinatarios/cadencia/proveedor y conserva cada salida con creación exclusiva (`wx`). Los checks de texto son señales parciales, no certificación semántica.

## Archivos intervenidos en esta auditoría

### Continuación de la revisión

- Se agregó validación en `coworkCampaignDraftSchema` que rechaza promesas explícitas de cierre antes del último mensaje, tanto en asunto como en cuerpo. No reescribe contenido silenciosamente. Es una comprobación léxica acotada: no demuestra calidad comercial ni detecta todas las paráfrasis.
- Regresión dirigida: **42/42** (propuesta, cadencia, guards, reporte, worker y sender) y `npm run typecheck` aprobados.
- Una llamada adicional a `gpt-5.6-luna`, caso `seven_touch_default`, conservada en `cowork-sendbatch-audit-1790090424211.json`: destinatarios/proveedor/intervalos correctos, cierre del hilo en el séptimo toque y assertions aprobadas. Revisión manual: texto todavía genérico; el quinto asunto dice «Seguimiento final de esta etapa», expresión ambigua aunque no promete terminar todo el hilo. No se considera aceptación de personalización comercial.
- El resultado no elimina los bloqueos de PostgreSQL, cobertura transversal, remitente real ni aceptación autenticada enumerados arriba. Total de llamadas de esta auditoría: **11**; no se ejecutaron envíos.

Código:
- `src/lib/cowork/send-cadence.ts`
- `src/lib/cowork/agent-instructions.ts`
- `src/lib/server/campaign-send-guards.ts`
- `src/lib/server/bulk-campaign-worker.ts`
- `src/lib/server/bulk-campaign-sender.ts`
- `src/lib/server/cowork/send-batch.ts`
- `src/lib/server/cowork/batch-reads.ts`

Pruebas y evaluación:
- `src/lib/cowork/send-cadence.test.ts`
- `src/lib/cowork/campaign-proposal.test.ts`
- `src/lib/server/campaign-send-guards.test.ts`
- `src/lib/server/bulk-campaign-worker.test.ts`
- `src/lib/server/bulk-campaign-sender.test.ts`
- `src/lib/server/cowork/batch-reads.test.ts`
- `scripts/test-cowork-send-batch.mjs`
- `scripts/evaluate-cowork-sendbatch.ts`

Migración/documentación/resultados:
- `supabase/migrations/20260922040000_cowork_send_batch_atomicity.sql` (nueva, sin aplicar)
- `docs/cowork-sendbatch-acceptance.md`
- `docs/cowork-sendbatch-audit-1790087631329.json`
- `docs/cowork-sendbatch-audit-1790087782284.json`
- `docs/cowork-sendbatch-audit-1790087790442.json`

`agent-loop.ts` y la migración anterior fueron revisados sin añadir cambios de esta auditoría. Los demás cambios preexistentes del usuario se preservan.
