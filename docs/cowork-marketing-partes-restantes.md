# Cowork: las 8 partes restantes del plan comercial

Documento de referencia permanente. Fuente de funciones: `C:\Users\nicol\Desktop\Asistente AXIS\FUNCIONES_MARKETING_Y_CONTACTO.md` (51 apartados; el resumen del archivo dice 42). Estado de seguimiento en `docs/cowork-marketing-implementation.md`.

**Regla de cierre:** una función solo queda terminada cuando está conectada al agente, respeta el alcance del usuario, supera sus casos de fallo y produce un resultado comprobable. Código existente o prueba simulada no cuentan como aceptación.

**Leyenda:** 🟢 Hecha (conectada al agente, con pruebas y migración aplicada; puede faltar recorrido autenticado). 🟡 Parcial (hay base reutilizable, falta integración o verificación). 🔴 Pendiente (falta una parte esencial).

**Contexto:** la parte 1 (Definición de audiencia, funciones 1.1–1.5) está implementada en local y parcialmente probada con modelo real y Apollo; faltan despliegue, recorrido autenticado y cierre visual. Detalle en `docs/cowork-audience-acceptance.md`.

---

## Parte 2 · Construcción de lista (2.1–2.6)

**Propósito:** convertir la audiencia en una lista contactable, verificada y sin duplicados.

| ID | Función | Estado | Qué falta para cerrarla |
|---|---|---|---|
| 2.1 | Enriquecer contactos para obtener correo verificado | 🟡 | Implementado individual con `verifiedForList`; solo `verified` completa el contacto guardado. Faltan: lotes, política por organización y aceptación desde chat desplegado. |
| 2.2 | Obtener perfiles de LinkedIn sin gastar créditos | 🟡 | La búsqueda no revela ni promete gratuidad; falta verificar recorrido real y costo. |
| 2.3 | Deduplicar contra historial completo | 🟡 | `lists.review_contact`/`lists.review_batch` cruzan email exacto + empresa normalizada exacta, con cobertura declarada. Falta aceptación con datos reales. |
| 2.4 | Excluir empresas prohibidas | 🟡 | Revisión integra contactabilidad/supresión y bloquea sin borrar. Falta lista de dominios normalizada compartida en ejecución. |
| 2.5 | Verificar el perfil real antes de contactar | 🟡 | Captura reciente de la extensión (≤90 días) corrobora o marca `mismatch`; sin captura queda `needs_current_source`. Falta verificación en sesión real. |
| 2.6 | Priorizar la lista por valor esperado | 🟡 | Prioridad por etapa CRM con conflictos explícitos; negociación ≠ contrato. Falta cola con cronología comprobable completa. |

**Avance verificado (22 sep 2026, local):** revisión por contacto y por lote (hasta 5, sin escrituras ni envíos), caché de escaneos compartida, `sendAuthorized:false` siempre, enriquecimiento solo con `verified`, pruebas locales aprobadas y 2 escenarios con modelo real (`docs/cowork-listbuild-model-results.json`): revisión correcta sin contactar y rechazo seguro de «envíale ahora» sin borrador aprobado. Cambios sin desplegar; aceptación autenticada pendiente.

**Dependencias:** parte 1 (audiencia), historial con cobertura (parte 6), contexto comercial por organización.

---

## Parte 3 · Mensaje (3.1–3.9)

**Propósito:** redactar mensajes que suenen al usuario, se adapten al destinatario y nunca inventen cobertura del producto.

| ID | Función | Estado | Qué falta para cerrarla |
|---|---|---|---|
| 3.1 | Escribir en la voz del usuario | 🟡 | Ejemplos de voz + estilo por defecto aplicados a borradores nuevos; falta aceptación con tu material real. |
| 3.2 | Adaptar el cuerpo por vertical | 🟡 | Notas por sector en contexto; faltan hechos aprobados por industria y pruebas multindustria. |
| 3.3 | Cambiar el pedido según quién recibe | 🟡 | Pedidos por rol configurables; la oferta de prueba solo se usa si está aprobada. Falta validación con casos reales. |
| 3.4 | Cambiar registro cercano/formal | 🟡 | Reutiliza estilos existentes vía estilo por defecto; falta evaluación por organización. |
| 3.5 | Aplicar restricciones de terminología | 🟡 | `message.check_terms` con veredicto blocked/pass sobre borrador observado; sin contexto configurado no valida nada. |
| 3.6 | Redactar respuesta a objeción o pregunta entrante | 🟡 | Redacción con hechos del informe y sin estirar un sí; falta lectura y respuesta en el hilo real (fase 5). |
| 3.7 | Interpretar la jerga del comprador | 🟡 | Error del casino corregido en una muestra; faltan variantes adversas. |
| 3.8 | Redactar corrección cuando algo salió mal | 🟡 | El modelo propone actualizar el contexto y rehacer dependientes; falta corrección en cascada autenticada. |
| 3.9 | Construir el gancho con un hecho verificable | 🟡 | `message.check_evidence` lista afirmaciones con evidencias observadas; el juicio semántico siempre es humano. |

**Avance verificado (22 sep 2026):** migración de contexto aplicada en producción (tablas + vocabulario, sin datos); efecto con revisión, vista previa y tarjeta; estilo por defecto en generación; 150 pruebas + build aprobados; modelo real bloqueó término prohibido y propuso contexto tras corrección (`docs/cowork-message-model-results.json`). Cambios de app sin desplegar; aceptación autenticada pendiente.

**Dependencias:** material comercial aprobado de tu organización (voz, oferta, afirmaciones con evidencia) para configurar el contexto real.

---

## Parte 4 · Ejecución por correo (4.1–4.8)

**Propósito:** enviar lotes personalizados con cadencia, registro completo y frenos automáticos ante respuesta o negociación.

| ID | Función | Estado | Qué falta para cerrarla |
|---|---|---|---|
| 4.1 | Enviar personalizados en lote con espaciado | 🟡 | Motor ampliado a 7 mensajes; efecto `campaign_schedule_batch` (espaciado 5–480 min, revisión humana siempre) y worker que lo respeta. Falta prueba controlada de lote y despliegue. |
| 4.2 | Registrar cada envío y toque | 🟡 | `campaigns.batch_report` con identificador, proveedor, destinatario, versión, fecha, toque y cadencia. Falta aceptación desde chat desplegado. |
| 4.3 | Escalonar contactos por empresa | 🟡 | Plan determinista + reserva concurrente (`cowork_company_send_days`, única por organización/empresa/día) + preflight antes del proveedor. Falta aceptación con datos reales. |
| 4.4 | Ejecutar cadencia de siete toques | 🟡 | Días 1/3/7/11/16/23/38 implementados como demoras 0/2/6/10/15/22/37 en motor y propuesta Cowork; instrucciones la proponen por defecto. Falta ejecución observada de un lote de 7. |
| 4.5 | Calcular elegibilidad del siguiente toque | 🟡 | `campaigns.next_touch` con hora de Santiago, frenos y `cadence_not_approved` ante cambios. Falta aceptación con datos reales. |
| 4.6 | Reintentar fallos sin duplicar | 🟡 | `classifySendRetry` + `campaigns.retry_review`; inciertos exigen conciliar en Contactados; clave `bulk:campaign:draft`. Falta caso real. |
| 4.7 | Detener por respuesta de la empresa | 🟡 | Freno por cuenta (no dirección exacta) en el remitente compartido antes del proveedor; correo gratuito solo dirección exacta. Falta respuesta real de segunda dirección. |
| 4.8 | Retener cuentas en negociación | 🟡 | Preflight compartido: `negotiation`/`meeting` difieren 24 h. Falta cuenta real en negociación. |

**Avance verificado (22 sep 2026, local + migración + modelo):** lecturas `batch_report`/`next_touch`/`retry_review`/`company_plan`, efecto `campaign_schedule_batch` con staging y hash, frenos en remitente masivo, espaciado en worker, 23 pruebas unitarias + 7 escenarios aislados, typecheck/build/verify en verde, migración `20260922030000` aplicada y verificada (3 tablas, RLS, vacías), modelo real con los 4 escenarios completados (incluida propuesta de 7 toques canónica). Detalle en `docs/cowork-sendbatch-acceptance.md`, `docs/cowork-sendbatch-results.json` y `docs/cowork-sendbatch-model-results.json`. Cambios de app sin desplegar; aceptación autenticada pendiente.

**Dependencias:** parte 6 (detección de respuesta), parte 8 (entregabilidad), respuesta en hilo (motor), destinatarios controlados para pruebas.

---

## Parte 5 · Ejecución por LinkedIn (5.1–5.7)

**Propósito:** operar LinkedIn desde Cowork con lectura verificable, acciones confirmadas en destino y sin repetir inciertos.

| ID | Función | Estado | Qué falta para cerrarla |
|---|---|---|---|
| 5.1 | Leer la red y detectar contactos nuevos | 🟡 | `linkedin.network` con punto de corte durable (`sweep_state`) y cobertura declarada. Falta emisión real desde la extensión. |
| 5.2 | Auditar toda la bandeja | 🟡 | `linkedin.inbox` con paginación (`cursor`/`hasMore`); pendientes solo con barrido completo. Falta emisión real desde la extensión. |
| 5.3 | Enviar invitaciones sin nota | 🟡 | Efecto → cola → reclamo atómico → flujo DOM sin nota → confirmación solo con estado Pendiente observado. Falta verificación con DOM real y sesión vigente. |
| 5.4 | Enviar mensajes en volumen | 🟡 | Efectos con frenos + panel con sección Trabajos de Cowork; ejecución reutiliza `EXECUTE_SEND` con deduplicación compartida. Falta sesión real. |
| 5.5 | Verificar identidad antes de enviar | 🟡 | `verifyLinkedinIdentity` (URL exacta + cruce slug/nombre) en staging y ejecución. Falta aceptación real desde chat. |
| 5.6 | Controlar cupo de invitaciones | 🟡 | `linkedin.quota` cuenta **pendientes** contra 100/sem operativos; staging rechaza con cupo cubierto. Límite observado, no oficial. |
| 5.7 | Segundo contacto a no respondedores | 🟡 | `linkedin.followups` con historial, exclusión de negociación, 7 días de espera e información nueva exigida. Falta historial real. |

**Avance verificado (22 sep 2026, local + migración + modelo):** 5 lecturas, 2 efectos con staging y hash, protocolo de extensión (`linkedin-job-next`/`claim`/`result`, `network-report`, `inbox-report`), flujo DOM de invitación con 4 pruebas JSDOM, panel con trabajos pendientes, 17 pruebas unitarias + 10 pasos aislados + 63 de extensión, typecheck/build/verify en verde, migración `20260922050000` aplicada y verificada (5 tablas, RLS, vacías), modelo real 4/4. Detalle en `docs/cowork-linkedin-acceptance.md`, `docs/cowork-linkedin-results.json` y `docs/cowork-linkedin-audit-1790099672978.json`. Sin desplegar; sesión real de LinkedIn pendiente (bloqueo explícito).

**Dependencias:** auditoría de la extensión actual, sesión real de LinkedIn, puente con trabajos identificables y estado durable. Sin esto, nada de esta parte puede certificarse.

---

## Parte 6 · Detección y seguimiento de respuestas (6.1–6.6)

**Propósito:** saber quién respondió, de quién es el turno y qué oportunidades se enfriaron, antes de ejecutar más volumen. Prioridad del documento original: construir esto antes que ejecución.

| ID | Función | Estado | Qué falta para cerrarla |
|---|---|---|---|
| 6.1 | Detectar rebotes y bloqueos | 🟢 | Lectura `replies.attention` con acción recomendada por ítem; automáticas informativas aparte. |
| 6.2 | Distinguir respuesta humana de automática | 🟢 | Cabeceras deterministas + métricas humanas separadas + corpus de mensajes reales. Buzón real pendiente de recorrido autenticado. |
| 6.3 | Barrer el historial completo | 🟢 | Cursor durable por buzón, ventanas acotadas, cobertura declarada en cada lectura; migración aplicada en prod. Primer barrido real con el despliegue. |
| 6.4 | Encontrar interesados nunca seguidos | 🟢 | Lectura `replies.stalled`: interés humano sin seguimiento tras 48 h. |
| 6.5 | Reconstruir el estado de una cuenta | 🟢 | Lectura `contacted.account` con conflictos explícitos e índice en prod. |
| 6.6 | Trazar una reunión hasta su origen | 🟢 | Origen server-side en compromisos + lectura `replies.meeting_chain` con veredicto verificable. |

**Avance verificado (23 sep 2026, local + migración + PGlite + build):** 4 lecturas Cowork registradas (`replies.attention`, `replies.stalled`, `contacted.account`, `replies.meeting_chain`), barrido conectado al cron sin romper el tick, migración `20260923020000` aplicada y verificada en prod (tabla con RLS, índice, función con origen; `contacted_leads` intacta), typecheck/build en verde, 19 pruebas nuevas en verde. Detalle en `docs/cowork-stage6-acceptance.md`. Cambios de app por desplegar; aceptación autenticada pendiente.

**Dependencias:** sincronización Gmail/Outlook (alcance, paginación, última actualización), cuentas controladas `nicolas.yarur.g@yago.cl` ↔ `nicogun123@gmail.com`.

---

## Parte 7 · Medición (7.1–7.4)

**Propósito:** cifras rastreables y diagnósticos que separan observación de hipótesis.

| ID | Función | Estado | Qué falta para cerrarla |
|---|---|---|---|
| 7.1 | Tasas de respuesta, rebote y reunión | 🟡 | Período, unidad y registros de origen por métrica (línea base real: 1.143 correos · 4 respuestas · 2 reuniones · 0,17%). |
| 7.2 | Diagnosticar bajo rendimiento | 🟡 | Probar hipótesis contra datos (el largo del mensaje no era el problema; mirar segmento y entregabilidad). Sin causalidad inventada. |
| 7.3 | Comparar canales | 🔴 | Cohortes comparables y atribución (LinkedIn superó al correo en el caso real; no generalizar sin denominadores). |
| 7.4 | Detectar fallas sistémicas | 🟡 | Detección de cierres a empresas en negociación o plantillas a quien ya dijo que sí; causas verificables. |

**Dependencias:** partes 4, 5 y 6 (datos de ejecución y respuesta completos).

---

## Parte 8 · Entregabilidad (8.1–8.3)

**Propósito:** que los correos lleguen y que el remitente sea el declarado. Sin esto, todo lo demás llega a spam.

| ID | Función | Estado | Qué falta para cerrarla |
|---|---|---|---|
| 8.1 | Verificar SPF, DKIM, DMARC y MX | 🔴 | Herramienta conectada a Cowork; DKIM requiere selector o evidencia suficiente (su ausencia conocida ≠ ausencia de DKIM). |
| 8.2 | Diagnosticar causas de rebote | 🟡 | Tasa por período vs umbral configurable (referencia: 2%; operación llegó a 5,1%). |
| 8.3 | Detectar remitente mal configurado | 🟡 | Identidad de Gmail ya verificada; falta contraste con cabeceras del correo enviado (caso real: dominio sin SPF/DKIM sobrescrito por el proveedor). |

**Dependencias:** envío real de prueba a `nicogun123@gmail.com` para contrastar cabeceras.

---

## Parte 9 · Cumplimiento y límites de contacto (9.1–9.3)

**Propósito:** contactar dentro del marco legal y de los límites, sin presentar certeza inexistente.

| ID | Función | Estado | Qué falta para cerrarla |
|---|---|---|---|
| 9.1 | Consultar legalidad vigente | 🔴 | Investigación con jurisdicción, fecha y fuentes (Ley 19.628 excepción fuente pública; Ley 21.719 restringe hacia fines de 2026). No hardcodear el caso histórico. |
| 9.2 | Explicar regulación que presiona al comprador | 🟡 | Identificar la ley que obliga a ese cargo en esa industria, con industria desambiguada y evidencia. |
| 9.3 | Respetar límites y exclusiones | 🟡 | Máximos por persona, una persona por empresa por día, exclusión de quien declinó; política transversal persona/cuenta/canal en todos los motores. |

**Dependencias:** investigación con fuentes y fecha; decisiones de producto sobre supresiones.

---

## Orden de construcción recomendado

El documento original indica el orden que produjo resultados:

1. **Parte 6** (detección de respuesta) antes que ejecución: un sistema que envía sin saber quién respondió hace daño neto.
2. **Parte 1** (audiencia), en curso: el cambio operativo→decisor produjo la única reunión de LinkedIn en dos meses.
3. **Parte 3** (mensaje), sobre todo el pedido según quién recibe.
4. **Parte 8** (entregabilidad).
5. Recién después, volumen de ejecución (partes 4 y 5), con medición (7) y cumplimiento (9) como controles transversales.

## Cuentas y accesos ya autorizados para las pruebas

- Cuenta conectada: `nicolas.yarur.g@yago.cl` (Gmail verificado: identidad, OAuth y lectura real).
- Destinatario controlado: `nicogun123@gmail.com`.
- Sin contraseñas ni tokens en el repositorio; secretos solo vía Secret Manager en memoria del proceso.
- Las pruebas externas usan destinatarios controlados; nunca prospectos arbitrarios. Sin seeds ni suites contra producción.
