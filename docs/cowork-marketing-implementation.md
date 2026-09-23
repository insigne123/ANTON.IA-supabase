# Cowork: implementación comercial y aceptación

Fuente: FUNCIONES_MARKETING_Y_CONTACTO.md del usuario. Contiene 51 apartados, aunque el resumen dice 42. Estado de seguimiento, no certificación de disponibilidad. P = parcial/base reutilizable; D = desarrollo o aceptación pendiente. Ninguna fila equivale a aceptación autenticada completa.

## Incremento confianza

- Separa `observedTurn` (registros de la app) de `turn` (desconocido sin cobertura de buzón). Hora de consulta nunca representa última sincronización.
- Registros truncados, respuesta no clasificada, fecha futura y salida fallida conservan incertidumbre. La clasificación de respuestas existente aún requiere auditoría: no se certifica equivalencia con el hilo completo.
- Instrucciones separan capacidades del producto de necesidades del comprador, piden dato bloqueante y evitan atribuir autoridad por cargo.
- Contexto de decisión expone UUID de contacto observado, presupuesto de lecturas y limitaciones de repetir una fuente incompleta.
- Búsqueda directa tolera únicamente una entrada alternativa inequívoca: un solo read con la misma acción cuando query falta. No amplía permisos ni normaliza escrituras.

## Evidencia real, conservada por intento

Desde el acumulado anterior de 39 llamadas se ejecutaron 14: tres respuestas, replay inicial 1, v2 3, v3 1 y v4 6. **Acumulado 53**; ampliación autorizada por el usuario. v3 falló validación tras llamada al proveedor sin telemetría de tokens; gasto total exacto y costo monetario desconocidos. No hubo Apollo, envíos, escrituras de prueba ni despliegue.

| Caso | Antes | Después | Evaluación |
|---|---|---|---|
| 01 | Mencionaba fecha faltante sin pedirla | «¿Qué fecha de entrega corresponde a la cotización de Cuenta A?» | Cumple el bloqueo observado; muestra única con evidencia fija |
| 05 | Prioridad de managers sin evidencia de autoridad | Declara que el cargo no demuestra autoridad; propone verificar contactos antes de repetir | Mejora; sigue extenso y conservador, requiere variantes |
| 06 | Capacidad judicial convertida en necesidad del comprador | Separa función del producto de consulta del cliente; conserva necesidad desconocida | Fallo factual corregido en esta muestra; estilo «vuestra» no coincide con voz chilena |
| 03 | Declaraba pendiente antes de consultar cronología | Busca, consulta cronología, responde con cobertura; vuelve a consultar tras corrección | Parcial: ejecuta ambas lecturas por turno, pero encabezado «Pendiente prioritario» sigue demasiado categórico |

Archivos: `cowork-axis-trust-response-results.json`, `cowork-axis-trust-replay-results.json`, `cowork-axis-trust-replay-v2-results.json`, `cowork-axis-trust-replay-v3-results.json`, `cowork-axis-trust-replay-v4-results.json`.

El resultado v4 contiene `passed:false`: su rúbrica histórica esperaba turno del prospecto incluso sin cobertura. Se actualizó el screening para exigir hora observada y limitación; no se reescribió el JSON histórico ni se cuenta como aprobación automática posterior. Evaluación semántica parcial como se describe arriba.

## Matriz de 51 funciones

| ID | Función | Estado / próximo criterio de aceptación |
|---|---|---|
| 1.1 | Empresas por vertical/país/tamaño | P: búsqueda app; conectar filtros completos al chat |
| 1.2 | Personas por cargo/ubicación/nivel | P: ubicación personal existente; seniority/bilingüe/paginación pendientes |
| 1.3 | Frescura de vertical | D: población, período e identidad de cuenta explícitos |
| 1.4 | Decisor/referidor/descarte | P: límites de palabras; autoridad no inferida como hecho |
| 1.5 | Usuario vs comprador | P: reglas de razonamiento; datos/segmentación persistida pendientes |
| 2.1 | Correo verificado | P: enriquecimiento individual con `verifiedForList`; solo `verified` completa el contacto; lotes, política por organización y aceptación desplegada pendientes |
| 2.2 | URL sin enriquecer | P: búsqueda sin revelado ni promesa de gratuidad; recorrido real y costo pendientes |
| 2.3 | Deduplicación histórica | P: `lists.review_contact`/`lists.review_batch` con email exacto y empresa normalizada exacta, cobertura declarada; aceptación con datos reales pendiente |
| 2.4 | Empresas excluidas | P: contactabilidad/supresión integrada en la revisión, bloqueo sin borrado; lista de dominios compartida en ejecución pendiente |
| 2.5 | Contrastar perfil real | P: captura de extensión ≤90 días corrobora o marca `mismatch`; verificación en sesión real pendiente |
| 2.6 | Prioridad por valor | P: prioridad por etapa CRM con conflictos explícitos; cola con cronología comprobable completa pendiente |
| 3.1 | Voz del usuario | P: ejemplos de voz por organización + estilo por defecto aplicado a borradores generados; aceptación con material real pendiente |
| 3.2 | Mensaje por vertical | P: notas por sector en contexto + hechos de producto/comprador separados; pruebas multindustria pendientes |
| 3.3 | Pedido por rol | P: role_cta configurable (decisor/usuario/referidor) + oferta de prueba solo si aprobada; autoridad nunca inferida |
| 3.4 | Cercano/formal | P: estilos existentes de la app reutilizados vía estilo por defecto; evaluación por organización pendiente |
| 3.5 | Terminología | P: `message.check_terms` literal con veredicto blocked/pass sobre borrador observado; sin contexto configurado el chequeo no valida nada |
| 3.6 | Objeción entrante | P: respuesta con hechos del informe y sin estirar un sí; lectura/respuesta en hilo real pendiente (fase 5) |
| 3.7 | Jerga/industria | P: corrección casino reevaluada; variantes adversas pendientes |
| 3.8 | Corrección de error | P: modelo propone actualizar contexto y rehacer dependientes; corrección en cascada autenticada pendiente |
| 3.9 | Gancho verificable | P: `message.check_evidence` lista cifras/comparaciones/garantías/lanzamientos con evidencias observadas; juicio semántico siempre humano |

## Incremento mensaje (22 septiembre 2026, local + migración aplicada)

- Migración `20260922010000_cowork_messaging_context` aplicada y verificada en producción: tablas `organization_messaging_context` y `cowork_message_context_proposals` (RLS solo service_role), vocabulario de efectos ampliado con `message_context_update`. Sin seeds ni escrituras de datos.
- Efecto con revisión humana: `message_context.update` requiere `message.context` observado, prepara valores exactos, vista previa `messagecontext-preview` y tarjeta `MessageContextReview`; deriva o edición concurrente bloquean. Nunca se auto-aprueba.
- Estilo por defecto aprobado fluye a `createNativeDraft` en la cola de borradores; si el estilo se elimina después, la generación continúa sin él en vez de fallar.
- Modelo real (`docs/cowork-message-model-results.json`): ante borrador con término prohibido consultó borrador+contexto+chequeo y reportó blocked sin autorizar envío; ante corrección del usuario leyó el contexto y propuso prohibir los dos términos con afirmaciones vacías, pendiente de revisión.
- Fallos encontrados y corregidos en el camino: `z.record` rechazado por OpenAI (cambiado a lista sector/nota), nulos del modelo en campos opcionales (nullish), `draftId` no propagado a chequeos en el bucle.
- 150 pruebas + scripts aislados aprobados; build de producción aprobado. Cambios de app sin desplegar. Llamadas de este bloque: ~21 (1+3+2+3+5+5+2 aprox. en intentos y corridas finales); costo monetario desconocido.
| 4.1 | Lote espaciado | P: motores existentes; integración chat y aceptación |
| 4.2 | Registro por envío | P: ejecución durable; reporte por toque/lote completo |
| 4.3 | Escalonar empresa | D: reserva concurrente cuenta/período |
| 4.4 | Siete toques | D: propuesta chat hoy limita a tres; ampliar motor canónico y aceptación |
| 4.5 | Elegibilidad temporal | P: planificación; zona horaria y cambios de cadencia |
| 4.6 | Reintento selectivo | P: idempotencia; clasificación de fallos y conciliación por lote |
| 4.7 | Parar por respuesta de cuenta | P: ingesta; dominios compartidos, alias y carreras pendientes |
| 4.8 | Retener negociación | P: CRM/contactabilidad; preflight compartido por cuenta |
| 5.1 | Nuevas conexiones | D: punto de corte durable y cobertura |
| 5.2 | Bandeja completa LinkedIn | D: lectura paginada verificable, no solo visible |
| 5.3 | Invitaciones sin nota | D: puente chat y confirmación en gestor |
| 5.4 | Mensajes en lote | P: envío individual extensión; orquestación/recuperación |
| 5.5 | Identidad destinatario | P: controles extensión; pruebas autenticadas y puente chat |
| 5.6 | Cupo invitaciones | D: separar pendientes de cuota observada, sin límite fijo inventado |
| 5.7 | Seguimiento LinkedIn | D: historial, negativas, negociación y nuevo contenido |
| 6.1 | Rebotes/bloqueos | Hecha 23-09-2026: lectura `replies.attention` con acción por ítem; detalle en `docs/cowork-stage6-acceptance.md`. Falta recorrido autenticado. |
| 6.2 | Respuesta humana | Hecha 23-09-2026: cabeceras deterministas + métricas humanas separadas + corpus real; detalle en `docs/cowork-stage6-acceptance.md`. Falta buzón real. |
| 6.3 | Barrido histórico | Hecha 23-09-2026: cursor durable, ventanas acotadas, cobertura declarada, migración aplicada en prod; detalle en `docs/cowork-stage6-acceptance.md`. Primer barrido real con el despliegue. |
| 6.4 | Tibios olvidados | Hecha 23-09-2026: lectura `replies.stalled` (48 h, sin envío posterior ni compromiso abierto); detalle en `docs/cowork-stage6-acceptance.md`. |
| 6.5 | Estado de cuenta | Hecha 23-09-2026: lectura `contacted.account` con conflictos + índice en prod; detalle en `docs/cowork-stage6-acceptance.md`. |
| 6.6 | Origen de reunión | Hecha 23-09-2026: origen server-side + lectura `replies.meeting_chain` con veredicto; detalle en `docs/cowork-stage6-acceptance.md`. |
| 7.1 | Tasas | P: helpers; períodos y denominadores completos |
| 7.2 | Diagnóstico | P: hipótesis controladas; comparar evidencia sin causalidad inventada |
| 7.3 | Canales | D: cohortes comparables y atribución |
| 7.4 | Incidentes sistémicos | P: excepciones; detección automatizada y causas verificables |
| 8.1 | DNS entregabilidad | D: MX/SPF/DMARC/DKIM con selector y límites claros |
| 8.2 | Causa de rebote | P: detector; métrica temporal y umbral configurable |
| 8.3 | Remitente real | P: cuenta verificada; contraste con cabeceras entregadas |
| 9.1 | Legalidad vigente | D: fuentes, jurisdicción, fecha y certeza; no hardcodear documento histórico |
| 9.2 | Regulación comprador | P: investigación; industria desambiguada y evidencia |
| 9.3 | Límites de contacto | P: supresión; política transversal persona/cuenta/canal |

## Correcciones de auditoría (22 septiembre 2026, locales + 2 migraciones aplicadas)

Fase 2: capturas inmutables `extension_profile_captures` registradas en cada guardado de la extensión (ambas ramas); la revisión usa solo esa tabla con URL canónica (sin fallback por email) e igualdad estricta de cargos. Antigüedad del correo desde `data.providerObservedAt` con fallback a `updated_at`. Nuevo `listReady` separado de la aprobación de envío. Revisión con consultas exactas acotadas (sin escaneos completos) y limitación documentada sobre variantes de capitalización. Efecto `lead.enrich_batch` (1–5, costo estimado, vista previa `enrichbatch-preview`, tarjeta `EnrichBatchReview`): valida observados y propios, reconcilia por ítem (enriched/reused/failed/skipped/already_requested), detiene el resto ante cuota y permite reanudar sin doble cobro.

Fase 3: operaciones `clear` con semántica de reseteo y rechazo de contradicciones (lista vacía equivale a borrar); actualización atómica por versión (inserción solo si no existe, update condicional) incluyendo creación concurrente; hash sobre valores saneados con verificación al ejecutar; veredictos `blocked/fail/unconfigured/pass` con conflictos; control de términos obligatorio en el flujo de envío sobre la versión exacta; contexto comercial completo (voz, términos, afirmaciones, oferta, CTA, notas) en la generación solo si está configurado; errores de estilo distinguidos (denegado detiene, eliminado registra sustitución y continúa, temporal falla explícito); afirmaciones con fragmento citado; cambio de contexto devuelve `draftsNeedRecheck`.

Verificación: 156 pruebas + scripts aislados aprobados, typecheck y build aprobados. Modelo real: revisión sin contactar, rechazo seguro de envío sin borrador, propuesta de lote desde historial y bloqueo de término prohibido con propuesta de contexto. Migraciones `20260922010000` y `20260922020000` aplicadas y verificadas (tablas + RLS + vocabulario). Cambios de app sin desplegar; aceptación autenticada pendiente.

## Fase 4 — Ejecución por correo (22 septiembre 2026, local + migración aplicada)

Lotes sobre el motor masivo con cadencia canónica de 7 toques (días 1/3/7/11/16/23/38), reporte por toque, escalonado una empresa por día con reserva concurrente, elegibilidad en hora de Santiago, reintentos sin duplicar e inciertos que exigen conciliar, freno por respuesta de la empresa (cualquier dirección de la cuenta) y retención de cuentas en negociación. Programar nunca autoriza envíos ni se auto-aprueba. Migración `20260922030000` aplicada y verificada (tablas + RLS + vocabulario, vacías). Verificación: 18 pruebas unitarias + 7 escenarios aislados, typecheck, build y verify en verde. Detalle en `docs/cowork-sendbatch-acceptance.md`. Cambios de app sin desplegar; evaluación con modelo y aceptación autenticada pendientes.

## Fase 5 — Ejecución por LinkedIn (22 septiembre 2026, local + migración + modelo)

Puente Cowork↔extensión con cola durable (`linkedin.invite`/`linkedin.message` con revisión humana siempre), 5 lecturas con cobertura declarada (red, bandeja, cupo, segundos contactos, trabajos), protocolo de extensión (reclamo atómico, resultados confirmados, reportes paginados), flujo DOM de invitación sin nota y panel con trabajos pendientes. Verificación: 17 unitarias + 10 pasos aislados + 63 de extensión, typecheck, build y verify en verde; migración `20260922050000` aplicada y verificada; modelo real 4/4. Detalle en `docs/cowork-linkedin-acceptance.md`. Sin desplegar; sesión real de LinkedIn pendiente.

## Orden y dependencias pendientes

### Incremento audiencia y Gmail

Prueba autenticada de lectura (21 septiembre 2026): propietario confirmó `nicolas.yarur.g@yago.cl` y destinatario controlado `nicogun123@gmail.com`. `scripts/check-cowork-gmail-live.ts --live` verificó identidad de usuario y mailbox, renovación OAuth y lectura real mediante el adaptador. Recuperó 20 metadatos, con entrantes y salientes, `hasMore:true`. No se imprimieron cuerpos, asuntos ni credenciales. No se ejecutó envío ni se modificó Supabase; no certifica UI, worker, paginación completa o respuesta en hilo. Configuración obtenida de revisión Cloud Run y versiones de Secret Manager en memoria, sin archivos env. El primer acceso por alias de secreto falló antes de cualquier consulta; se resolvió al nombre real y se completó la prueba.

- Búsqueda conversacional admite seniority, rango de empleados, dominios y ubicación de empresa independiente de persona. Todos se muestran en revisión. Validación del proveedor real (sin llamada externa) conserva filtros y límites; no se certifica recall ni búsqueda de empresas independiente.
- `gmail.contact_history` conectado al catálogo, contrato y adaptador: recibe UUID de lead en la organización, usa token del usuario, revalida acceso antes/después y consulta perfil más hasta 20 metadatos con timeout total 25s. No devuelve cuerpos ni tokens. Excluye borradores, spam/trash y direcciones ambiguas; autorespuestas por cabeceras no se confunden con respuestas humanas confirmadas.
- `hasMore` informa paginación pendiente, pero este incremento no consume páginas siguientes ni implementa cursor durable. No certifica hilo completo, aliases, reuniones ni entrega. Lectura Gmail autenticada pendiente: usuario eligió Gmail, todavía falta contacto/destinatario controlado y conexión con permisos de lectura verificada.
- Tests aislados: metadatos, dirección, borradores, respuesta automática, permisos, inyección de query; pruebas de búsqueda y compatibilidad de adaptadores existentes aprobadas. Sin despliegue.

1. Cerrar confianza con múltiples variantes y consulta de prioridades; completar lectura de buzones antes de certificar turnos actuales.
2. Contexto comercial por organización, audiencias y listas.
3. Entregabilidad, preflight de cuenta, correo en hilo y siete toques.
4. Puente LinkedIn y operaciones verificadas en sesión real.
5. Medición y aceptación de las 51 funciones.

Solo las partes descritas en «incremento confianza» se implementaron en este cambio. La matriz es un backlog explícito, no funciones completadas. Acceso autenticado y destinatarios controlados serán necesarios para verificar los canales reales. No se realizaron migraciones ni cambios de permisos de Cowork.
