# Cobertura AXIS por capacidad

Inventario de 51 capacidades. «Base» indica una capacidad relacionada existente,
no equivalencia demostrada con el encargo AXIS. Ninguna fila está cerrada sin prueba
del recorrido correspondiente. Esta matriz conserva el alcance completo.

| ID | Capacidad | Base reutilizable / falta de aceptación |
|---|---|---|
| P1 | Empresas por vertical/país/tamaño | Búsqueda app; filtros completos desde chat pendientes |
| P2 | Personas por cargo/ubicación/seniority | Búsqueda Cowork parcial; equivalencia de filtros pendiente |
| P3 | Enriquecer solo candidatos y verified | Enriquecimiento individual existente; lotes y política verified pendientes |
| P4 | Saldo por tipo y renovación | Cuotas existentes; consulta conversacional completa pendiente |
| P5 | URLs LinkedIn sin enriquecimiento | Resultados existentes; comprobar costo real y entrega conversacional |
| P6 | Deduplicar contra historial | Comparación exacta probada local; cruce completo pendiente |
| P7 | Empresas prohibidas | Normalización probada local; unificación de exclusiones pendiente |
| P8 | Frescura del vertical | Agregado por población y fechas pendiente |
| P9 | Decisor/referidor/descarte | Límites de términos probados; clasificación contextual pendiente |
| P10 | Contrastar perfil real | Extensión/perfil; lectura reciente y evidencia desde chat pendientes |
| C1 | Envíos personalizados espaciados | Motores correo/campañas; encargo completo desde chat pendiente |
| C2 | Registro por envío/toque | Registro existente; reporte integral de lote pendiente |
| C3 | Escalonar por empresa | Exclusión concurrente por cuenta/día pendiente |
| C4 | Cadencia de siete toques | Motor de secuencias; cobertura exacta de siete pasos pendiente |
| C5 | Elegibles por días | Motor de planificación; reloj controlado y consulta chat pendientes |
| C6 | Reintentos recuperables | Conciliación existente; aceptación de lote sin duplicados pendiente |
| C7 | Parar por respuesta de cuenta | Ingesta de respuestas; alcance por cuenta/dominio pendiente |
| C8 | Retener negociación viva | CRM/contactabilidad; preflight compartido por cuenta pendiente |
| D1 | Rebotes y bloqueos | Detector/ingesta existentes; acceso y acción chat pendientes |
| D2 | Respuesta humana posterior al envío | Clasificador existente; regresiones y lectura completa pendientes |
| D3 | Barrido histórico completo | Sync existente; cursor durable/alcance histórico desde chat pendientes |
| D4 | Interesados olvidados | Turno calculado local; cola con evidencia actual pendiente |
| D5 | Cronología y turno | Integrado en `contacted.timeline` con cobertura/frescura y pruebas; hilo entrante/saliente completo (Gmail/Outlook) pendiente |
| D6 | Incidentes sistémicos | Excepciones existentes; diagnóstico con causas verificables pendiente |
| D7 | Atribución de reunión | Eventos existentes; recorrido causal y confirmación pendientes |
| R1 | Voz del usuario | Redacción nativa; corpus de estilo y aceptación AXIS pendientes |
| R2 | Adaptación por vertical | Investigación/redacción; hechos aprobados y aceptación pendientes |
| R3 | CTA por autoridad | Reglas incorporadas; clasificación y ejecución contextual pendientes |
| R4 | Terminología | Reglas generales locales; política AXIS versionada y chequeo final pendientes |
| R5 | Responder objeciones | Redacción existente; integración hilo y pruebas pendientes |
| R6 | Corregir error | Regla incorporada; generalización a todos los artefactos pendiente |
| R7 | Estilo LinkedIn | Redacción extensión; acceso desde chat y aceptación pendientes |
| L1 | Nuevas conexiones | Lectura exhaustiva y corte durable pendientes |
| L2 | Auditar toda la bandeja | Paginación y prueba de cobertura pendientes |
| L3 | Invitación sin nota verificada | Puente de acciones desde Cowork y aceptación destino pendientes |
| L4 | Mensajes en lote verificados | Capacidades extensión por contrastar; orquestación chat pendiente |
| L5 | Identidad antes de enviar | Protecciones extensión; aceptación real y conexión chat pendientes |
| L6 | Cupos de invitación | Diferenciar pendientes y límite vigente; herramienta pendiente |
| L7 | Recuperación navegador | Recuperación extensión parcial; continuidad encargo chat pendiente |
| A1 | Tasas por toque | Helper unidades probado; consultas completas pendientes |
| A2 | Diagnóstico con hipótesis | Modelo/evidencia; evaluación causal y cobertura pendientes |
| A3 | Comparar canales | Denominadores probados; agregación y evaluación pendientes |
| A4 | Priorizar por valor | Escenarios modelo parciales; cola comercial real pendiente |
| A5 | Conflictos regla/datos | Regla contextual determinista probada; integración y modelo pendientes |
| I1 | SPF/DKIM/DMARC/MX | Adaptador DNS y selectores DKIM pendientes |
| I2 | Diagnosticar rebotes | Detector existente; métricas/causa y acción contextual pendientes |
| I3 | Remitente real | Identidad verificada existente; cabeceras entregadas pendientes |
| I4 | Reloj confiable | Escenario evaluado; verificación servidor/fuentes y cálculos pendientes |
| N1 | Legalidad vigente | Investigación con fuentes; jurisdicción/fecha/certeza pendientes |
| N2 | Regulación comprador | Investigación; desambiguación rubro y respaldo pendiente |
| N3 | Interpretar necesidad | Casos 06/09 parciales; contexto aprobado e integración pendientes |

## Principios de aceptación

1. Verificar en destino antes de reportar; incertidumbre explícita.
2. Releer estado cambiante y declarar cobertura/frescura.
3. No afirmar capacidades del producto sin respaldo vigente.
4. Corregir brevemente y rehacer conclusiones dependientes.
5. Terminar todo el alcance ejecutable y declarar bloqueos concretos.
6. Explicar conflictos sin ampliar permisos ni recortar alcance unilateralmente.

### Actualización: regresión 03 cerrada y matriz de colaboración conectada

- Caso 03 reevaluado con `replyGapMinutes` determinista: «tu respuesta saliente a las 11:55», «le toca a Rafael», «brecha de 9 minutos». 21 llamadas reales acumuladas.
- `crm.assign_lead` implementado con la matriz de roles v1 (asignar/reservar/liberar), probado localmente, migración aplicada; despliegue de app pendiente por reautenticación Firebase.
- Respuesta en hilo general entrante: **bloqueada por motor** (solo existe threading de pasos de campaña v2 en Gmail; no hay envío en hilo de inbound). Bloqueo de privacidad desde el chat: **bloqueado por producto** (acción solo de admin). No se simulan.

Pruebas y gasto acumulado: `cowork-axis-acceptance.md`.
