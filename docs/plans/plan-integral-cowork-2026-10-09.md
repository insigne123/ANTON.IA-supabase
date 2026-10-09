# Plan integral de evolución de Cowork — ANTON.IA

**Evaluación real, calidad comercial, experiencia de usuario, agentes especializados y laboratorio cloud de marketing y miniapps.**

| Campo | Valor |
|---|---|
| Fecha | 9 de octubre de 2026 |
| Versión del documento | 1.0 |
| Estado | Implementación y evaluación controlada ejecutadas; aceptación autenticada, activación cloud y equipos pendientes. [Reporte de ejecución](ejecucion-integral-cowork-2026-10-09.md) |
| Usuario inicial | Cuenta del dueño de ANTON.IA |
| Usuarios futuros | Ejecutivos y equipos de GrupoExpro y PSOL |
| Modelo autorizado para esta evaluación | `gpt-6-luna` |
| Presupuesto máximo de llamadas de evaluación | US$10 en total |
| Evaluador principal | El asistente responsable del encargo, mediante revisión directa de respuestas, datos, artefactos e interacciones |
| Primer objetivo cloud | Marketing y miniapps: informes, Excel, presentaciones, landing pages, calculadoras y tableros privados |
| Base documental actualizada | `main` en `25e18428715d9400c754451f5ad584d00eca1d02` |
| Base de la auditoría inicial | Release `9cb94681ca710545f9fa2d12ce8273c87aa337d0`, tag `prod-2026-10-08-2` |

Este documento reúne el plan original y su ampliación a partir de la inspección de código de AionUi, Eigent, OpenCowork, OpenWork, LibreChat, Suna/Kortix y Agenta. La especificación se conserva como base del encargo; el [reporte de ejecución](ejecucion-integral-cowork-2026-10-09.md) distingue código, pruebas, integración y lo que falta aceptar en la versión desplegada.

## Índice

1. [Resumen ejecutivo](#1-resumen-ejecutivo)
2. [Alcance y decisiones del usuario](#2-alcance-y-decisiones-del-usuario)
3. [Método, versiones y nivel de evidencia](#3-método-versiones-y-nivel-de-evidencia)
4. [Estado actual de Cowork](#4-estado-actual-de-cowork)
5. [Evaluaciones existentes y límites de medición](#5-evaluaciones-existentes-y-límites-de-medición)
6. [Hallazgos y prioridades](#6-hallazgos-y-prioridades)
7. [Investigación de los siete repositorios](#7-investigación-de-los-siete-repositorios)
8. [Arquitectura objetivo y contratos](#8-arquitectura-objetivo-y-contratos)
9. [Experiencia, respuestas y artefactos](#9-experiencia-respuestas-y-artefactos)
10. [Criterio comercial, marketing y redacción](#10-criterio-comercial-marketing-y-redacción)
11. [Agentes, workers y razonamiento](#11-agentes-workers-y-razonamiento)
12. [Laboratorio cloud de marketing y miniapps](#12-laboratorio-cloud-de-marketing-y-miniapps)
13. [Protocolo de evaluación real](#13-protocolo-de-evaluación-real)
14. [Matriz de escenarios](#14-matriz-de-escenarios)
15. [Rúbrica, métricas y aceptación](#15-rúbrica-métricas-y-aceptación)
16. [Presupuesto y control de consumo](#16-presupuesto-y-control-de-consumo)
17. [Fases, entregables y backlog](#17-fases-entregables-y-backlog)
18. [Preparación para GrupoExpro y PSOL](#18-preparación-para-grupoexpro-y-psol)
19. [Ejecución, integración y decisiones pendientes](#19-ejecución-integración-y-decisiones-pendientes)
20. [Referencias internas y externas](#20-referencias-internas-y-externas)
21. [Plantillas operativas](#21-plantillas-operativas)

## 1. Resumen ejecutivo

### 1.1 Objetivo de producto

Convertir Cowork en un asistente comercial de trabajo completo:

> «Este es mi objetivo comercial. Trabaja con lo que tenemos, prepara lo necesario y déjame un resultado que pueda revisar y usar. Después continúa desde esa misma versión».

La experiencia deseada combina comprensión del objetivo, criterio de marketing, datos reales, buena escritura, entregables editables y continuidad hasta terminar la tarea.

La medida principal de éxito es **trabajo útil completado**, con una siguiente acción entendible. El número de agentes, llamadas, tarjetas o palabras no representa por sí solo una mejora.

### 1.2 Diagnóstico principal

Cowork ya dispone de coordinador, Redactora, Revisora, Diseñadora, especialistas, herramientas comerciales, ejecución de efectos aprobados, memoria, artefactos, exportaciones y un executor remoto. La mayor oportunidad está en hacer que esas piezas compartan objetivo, evidencia, selección, versiones y estado de ejecución de manera consistente.

La auditoría encontró problemas concretos de fidelidad de resultados y oportunidades de mejora en:

- distinguir propuesta, trabajo admitido, resultado parcial y resultado confirmado;
- conservar identidad y versiones entre chat, panel, exportación y acciones de la app;
- usar la población, período y alcance correctos al recomendar o analizar;
- completar trabajos con dependencias y recuperar procesos interrumpidos;
- producir textos específicos, naturales y consistentes con la oferta;
- evaluar el sistema desplegado, incluyendo lo que el usuario realmente ve y utiliza.

### 1.3 Dirección recomendada

1. Congelar una línea base y utilizar la app con sesión real.
2. Corregir inconsistencias de resultados, ediciones, exportaciones y móvil.
3. Fortalecer evidencia, contexto comercial y coordinación de tareas.
4. Mejorar redacción y competencias de marketing con comparación antes/después.
5. Ampliar el executor a jobs asíncronos y workspaces reconstruibles.
6. Construir un informe comercial completo y una miniapp privada como pilotos cloud.
7. Integrar los entregables con contactos, borradores y campañas reales de ANTON.IA.
8. Confirmar mejoras con casos nuevos y preparar la futura operación por equipos.

### 1.4 Qué significa estar a la par de las referencias

La comparación con Claude Cowork y ChatGPT se hará sobre tareas comerciales equivalentes: utilidad del resultado, pasos evitables, edición, claridad, fundamento y recuperación. Las referencias públicas sirven para diseño y arquitectura; no son una evaluación directa de calidad entre productos.

Para afirmar paridad en una tarea hará falta ejecutar la misma especificación con evidencia comparable y registrar los resultados de ambos productos. Mientras no exista esa comparación, se hablará de objetivos y brechas, no de paridad demostrada.

## 2. Alcance y decisiones del usuario

### 2.1 Decisiones confirmadas

| Decisión | Consecuencia para el plan |
|---|---|
| Cowork es personal por ahora | Mantener el acceso del dueño durante el piloto; priorizar su trabajo real |
| GrupoExpro y PSOL lo usarán después | Preparar scope, contexto, permisos y memoria por organización desde los contratos |
| Probar realmente el sistema | Incluir aceptación autenticada, interfaz, persistencia, workers y artefactos |
| Tope de US$10 | Toda llamada del experimento, incluyendo correcciones, rescates y especialistas, participa del presupuesto |
| Usar GPT-6-luna | Fijar Luna en los caminos evaluados; no activar modelos más caros por defecto |
| El asistente evalúa | Revisión directa con evidencias; no depender de un juez contratado para emitir el veredicto |
| Investigar código de siete repos | Recomendaciones basadas en implementación y referencias fijadas a commit |
| Cloud primero para marketing y miniapps | Pilotos de entregables comerciales y previews privados; toolchains acotadas |

### 2.2 Superficies incluidas

- Calidad y completitud de respuestas.
- Criterio comercial y marketing digital aplicable.
- Escritura de correos, secuencias, respuestas y contenidos.
- Presentación de resultados, documentos, tablas y dashboards.
- Relación de artefactos con entidades nativas de la app.
- Uso de herramientas, evidencia, memoria y contexto.
- Proactividad, cancelación, continuidad y recuperación.
- Routing, agentes especializados, workers, latencia y costo.
- Entorno cloud para construir y verificar entregables.
- Preparación arquitectónica para el uso futuro por equipos.

### 2.3 Alcance de las pruebas autorizadas

Las pruebas de modelo con el límite indicado están autorizadas. Las nuevas conversaciones autenticadas se realizarán con una sesión legítima del dueño y un alcance registrado de lectura, preparación, archivos y borradores.

El presupuesto de modelos no asigna automáticamente cupos a Apollo, revelado de datos u otros proveedores, ni autoriza envíos externos, invitaciones de LinkedIn, activaciones de campañas o nuevos costos cloud. Esas operaciones se incorporarán cuando exista un caso controlado y un alcance explícito para ellas.

La evaluación inicial puede trabajar con datos existentes pertinentes y documentos de demostración adjuntos al encargo. La creación de nuevas entidades o un equipo de demostración en producción requiere definir ese setup y su autorización. No se cambiará el perfil comercial real para acomodar fixtures; una oferta de demostración se declarará en la conversación.

### 2.4 Resultado de este documento

La creación del documento no ejecuta el plan, habilita funcionalidades ni certifica resultados nuevos. La investigación externa fue de lectura; no se ejecutó código de esos repositorios. El presupuesto de nuevas pruebas seguía sin utilizarse al cerrar esa investigación.

## 3. Método, versiones y nivel de evidencia

### 3.1 Fuentes y actualización

Se inspeccionó inicialmente el release `9cb94681`, cuyo despliegue se había comprobado en la conversación previa como `studio-build-2026-10-08-002`, con 100 % del tráfico y los smokes del proyecto aprobados.

Al redactar este documento, `main` había avanzado a `25e18428`, incluyendo PR #295–#304. Se revisó la historia entrante y los cambios pertinentes. No se da por desplegado ese avance: el protocolo de evaluación debe volver a comprobar la revisión servida y su configuración efectiva.

Este plan incorpora las últimas mejoras documentadas de trato, saludo de la Revisora, opciones de industria, eliminación de ofertas duplicadas y apoyo para lectura ciega. Las hipótesis del diagnóstico deben contrastarse con la versión que finalmente se evalúe.

### 3.2 Convenciones

| Etiqueta | Significado |
|---|---|
| Observado en código | Condición, contrato o flujo presente en el código revisado |
| Observado en producción | Lectura o comprobación realizada en el sistema real, con fecha y alcance |
| Resultado documentado | Evidencia registrada por una evaluación anterior; no recalculada en esta revisión |
| Hipótesis | Consecuencia probable que requiere reproducción o evaluación |
| Propuesta | Diseño o trabajo aún por implementar |
| No medido | Sin evidencia suficiente; no se cuenta como aprobado |

La existencia de código, un flag o una prueba no demuestra que una capacidad se utilice en una tarea real. Una prueba con herramientas simuladas no equivale a aceptación de gateway, RLS, persistencia, proveedor e interfaz.

### 3.3 Procedimiento para referencias externas

Para cada repositorio se resolvió rama y commit, se inspeccionó su árbol y se siguieron implementaciones de coordinación, herramientas, persistencia, artefactos o evaluación. Se revisaron algunas pruebas relacionadas y licencias. No fue una auditoría exhaustiva de cada archivo ni una certificación de seguridad o usabilidad renderizada.

Los detalles por repositorio y los enlaces permanentes están en las secciones 7 y 20.

## 4. Estado actual de Cowork

### 4.1 Arquitectura implementada

```text
Solicitud autenticada
  → admisión idempotente en cowork_runs
  → wake inline o scheduler
  → processCoworkQueue
      → efectos aprobados / búsquedas / preparación / especialistas
      → coordinador conversacional
          → consultas acotadas a la app
          → Redactora / Diseñadora / especialistas cuando se solicitan
          → respuesta o propuesta de acción
  → eventos y resultados persistidos
  → continuación automática en los caminos que la soportan
```

El coordinador utiliza un bucle de decisiones estructuradas con acciones enumeradas. Las herramientas comerciales se ejecutan mediante adaptadores del servidor. La autoridad para operar procede de sesión, scope y servicios de la app, no de texto generado.

### 4.2 Inventario de agentes y workers

| Componente | Tipo | Estado según código y manifiesto revisados | Función |
|---|---|---|---|
| Coordinador Cowork | Agente semántico | Habilitado | Decidir consultas, delegación, respuesta y propuestas |
| Redactora / Writer | Agente semántico | Habilitado; se usa al enrutar `draft.write` | Correos y secuencias |
| Revisora / Reviewer | Evaluador semántico más checks | Disponible en el camino Writer; puede omitirse por tiempo o fallo | Detectar problemas y solicitar una corrección |
| Diseñadora / Designer | Generador semántico | Habilitado por ruta de artefactos | HTML/CSS/JS sobre datasets autorizados |
| Especialistas `analyst`, `researcher`, `verifier` | Agentes semánticos en cola | Habilitados; invocación a elección del coordinador | Encargos acotados y consultas permitidas |
| Analista de respuesta `analysis.write` | Agente semántico separado | Implementado; flag apagado | Síntesis analítica en el turno |
| Jueza en el turno | Evaluador semántico | Flag apagado | Revisar ciertas respuestas |
| Jev | Evaluación opcional | No habilitado por el manifiesto revisado | Evaluación auxiliar o shadow |
| Workers de efectos, búsquedas, preparación y borradores | Ejecución operativa | Presentes según cada capacidad | Reclamar trabajo, ejecutar adaptadores y registrar resultados |
| Scheduler y wake | Transporte y activación | Configurados en código | Despertar la cola |
| Executor remoto | Ejecución de código | Adaptador y configuración presentes | Script Python/Node aprobado en contenedor efímero |

Los nombres «Analista», «Estratega», «Investigadora» o «LinkedIn» usados para presentar una consulta no siempre representan una llamada a otro agente. El inventario de especialización debe contar roles realmente ejecutados y su aporte.

La investigación y los borradores nativos tienen pipelines adicionales. Los bloques de especialistas de un informe no deben contarse como workers independientes cuando se producen en una sola llamada compartida.

### 4.3 Activación y límites

El manifiesto leído habilita Writer, especialistas, contexto de cuenta, preferencias, archivos, artefactos, versiones de documentos, investigación, borradores nativos, tareas largas, importación, respuesta en hilo, revelado de teléfono y reintentos de campaña.

Analista en turno, Jueza, prompts filtrados por intención y lotes LinkedIn figuran apagados. La autonomía general está ausente y se interpreta apagada. Una autorización acotada de tarea larga es un mecanismo distinto: puede admitir ciertos pasos de preparación dentro del plan aprobado.

Los comentarios de documentos históricos sobre flags pueden estar desactualizados. Se debe registrar el valor efectivo del runtime antes de las pruebas.

Límites relevantes observados en la base auditada:

- Turno normal: 4 decisiones, 3 consultas y deadline suave de 50 segundos, con excepciones específicas.
- Worker conversacional: cancelación alrededor de 105 segundos; rutas con presupuesto declarado de 120 segundos.
- Consultas independientes: pool de dos.
- Historial: hasta ocho turnos antecesores y límite de caracteres; memoria estructurada y preferencias aprobadas como complemento.
- Especialistas: hasta dos roles distintos por revisión; capacidad de consulta acotada.
- Reservas de modelos: límites por run, conversación y usuario/día. Acotan llamadas y salida reservada, no constituyen un tope completo de dólares o tokens de entrada.
- Tareas largas: plan de 2–6 pasos, límites de preparación y gasto, vencimiento y finalización del scope al llegar un nuevo mensaje del usuario.

Estos valores son la línea base a registrar, no parámetros que deban aumentarse sin medición.

### 4.4 Experiencia y entregables existentes

- Inicio contextual, recientes y trabajo pendiente.
- Composer con adjuntos, referencias a contactos, plantillas, mensaje en espera y detener.
- Conversación con continuaciones, actividad, consultas y revisión de acciones.
- Respuesta Markdown, pregunta final, sugerencias y bloques estructurados.
- Correos, secuencias, tablas, métricas y gráficos.
- Listas de contactos observados con filtro, agrupación y exportación.
- Documentos e informes con fuentes.
- Artefactos HTML versionados con iframe y descarga.
- Exportaciones CSV/XLSX/DOCX/PDF/Markdown según el resultado.
- Propuestas para contactos, campañas, respuestas y otros efectos nativos.

La oportunidad no es reemplazar estas capacidades, sino reconciliar su identidad, scope, procedencia, versión y estado.

### 4.5 Observación acotada de producción

La lectura realizada el 9 de octubre a las 03:33 UTC encontró, para los 14 días anteriores:

- 59 runs: 54 completados y 5 fallidos.
- Última actividad en esa muestra: 5 de octubre; no representa uso posterior al release del 8 de octubre.
- Sin trabajos en `cowork_specialist_tasks` en ese intervalo.
- En siete días: 15 reservas de modelo, solo de coordinador; 14 con consumo registrado y una sin registro completo.
- Costo conocido en esos 14 registros: US$0,02699707 con la tabla de precios capturada.
- Acceso cerrado a grants generales y un grant habilitado.

Son datos operativos de una muestra pequeña. «Run completado» no demuestra tarea comercial completada, satisfacción ni éxito de un entregable. El costo conocido no es una factura ni incluye necesariamente todos los pipelines o proveedores. La ausencia de especialistas no demuestra que sobren: orienta la evaluación de routing y utilidad.

Se revisaron también algunas respuestas persistidas. No se incluyen aquí transcripciones, correos de prospectos ni identificadores privados.

## 5. Evaluaciones existentes y límites de medición

### 5.1 Lo que ya aporta evidencia

| Evaluación | Evidencia documentada | Límite para este plan |
|---|---|---|
| Producción, 25 de septiembre | 12 conversaciones, 24 turnos; utilidad 2,5/5 y claridad 3,2/5; problemas de continuación y espera | Línea base histórica anterior a muchas correcciones |
| AXIS, 30 de septiembre | 44 operaciones × 3; 66,9 % de checks y 80/132 respuestas calificadas malas | Mundo simulado, mayoría de escenarios de un turno y sin ejecutar todo el ciclo |
| Plan 12, 6 de octubre | Casos derivados del uso: malas 58 % → 32,5 %, con 97,4 % de checks; AXIS exigente seguía débil | Demuestra que pasar checks y ser útil son medidas diferentes |
| Plan 13 | Replay conjunto de 472/480 checks y menos llamadas | Latencia del modelo no incluye cola, navegador y entrega visible |
| Plan 15 | 115/134 casos pasaban antes de ajustes; mejoras dirigidas de claridad y redacción | Investigación y datos de prueba; falta aceptación completa desplegada |
| Plan 16 y segunda ronda | Mejoras de respuestas a clientes, señales, correos, seguimientos, consultas y tarjetas | Parte del cambio de score fue corrección del instrumento de evaluación |
| PR #299–#304 en main | Trato consistente, cierre distinto, saludo de Revisora, oferta una vez y herramientas de lectura ciega | Mediciones pequeñas y dirigidas; no sustituyen la ronda autenticada global |

Por ejemplo, `cowork-correos-trato.md` registra mejora de «lo enviaría tal cual» de 2,42 a 3,25, pero mantiene correos intercambiables y rodeos en aperturas. `cowork-revisora-saludo.md` documenta la corrección del falso problema de nombre fijo en un correo individual: ese punto no debe presentarse como una mejora todavía sin abordar.

### 5.2 Herramientas reutilizables

| Herramienta | Uso |
|---|---|
| `scripts/evaluate-cowork-conversations.ts` | Bucle y modelos reales con mundos controlados; registros de decisiones y resultados |
| `scripts/fixtures/cowork-conversation-runner.ts` | Mundo de prueba y representación de lo visible |
| `scripts/cowork-blind-read.ts` | Estadísticas, mezcla anónima, comparación por pares y lectura de notas |
| Banco AXIS y corpora comerciales | Regresión de tareas, lecturas y límites |
| `scripts/evaluate-cowork-axis-replay.ts` | Continuidad de varios turnos con estado de prueba |
| `scripts/evaluate-outreach-set.ts` | Calidad de borradores nativos y secuencias |
| `scripts/fixtures/cowork-artifact-render.ts` | Renderizado de artefactos y comprobaciones disponibles |
| Pruebas DOM y visuales existentes | Interacciones, estados y componentes |
| Ledger `cowork_model_calls` | Consumo y duración por rol cuando se registran |

El nombre de un corpus derivado de «uso real» no transforma su replay en una prueba autenticada. Se conservarán resultados separados para escritura en chat, borrador nativo y respuesta a cliente, además del recorrido integrado.

### 5.3 Correcciones necesarias del instrumento

1. **Cobertura:** reconciliar casos seleccionados, generados, evaluados y reportados. Se encontró una familia de oportunidades incluida en generación y omitida por el juez offline de la base inicial.
2. **Evidencia inmutable:** guardar entradas y resultados de herramientas, no reconstruirlos desde el fixture actual para juzgar una salida antigua.
3. **Fidelidad del runtime:** alinear flags, especialistas, deadlines, presupuestos, contexto y representación de propuestas. El evaluador inicial deshabilita especialistas y usa tiempos diferentes para Writer/Reviewer.
4. **Medición visible:** capturar submit → admisión → primer estado útil → resultado final en navegador.
5. **Accesibilidad:** diferenciar aprobado, fallido y no medido. La ausencia de axe no debe resultar en «limpio».
6. **Calibración:** versiones de rúbrica y lector; comparar candidatos dentro de la misma lectura. No mezclar como una única tendencia scores obtenidos con distintos jueces o contextos.
7. **Retención:** reportes sanitizados, manifest de evaluación y evidencia de resultados. Los cambios locales antiguos no se incorporan sin revisar su procedencia.
8. **Costos:** consumos completos e incompletos; límite antes de cada nueva llamada y registro de todos los caminos participantes.

El nuevo helper de lectura ciega en `main` se reutilizará. Para esta ronda la evaluación principal la hace el asistente del encargo. Una lectura anónima reduce sesgos, pero no se denominará independiente cuando el mismo evaluador haya diseñado o visto el candidato.

## 6. Hallazgos y prioridades

### 6.1 Escala

- **P0:** pérdida o contradicción del resultado; medición que puede declarar éxito sin evidencia.
- **P1:** impacto directo sobre tarea, confianza, criterio comercial o continuidad.
- **P2:** optimización y ampliación después de asegurar los fundamentos.

Las prioridades indican orden de trabajo, no frecuencia de incidentes medida.

### 6.2 Fidelidad y presentación

| ID | Prioridad | Hallazgo observado o hipótesis | Trabajo propuesto y aceptación |
|---|---|---|---|
| UX-01 | P0 | `lead-export.ts` valida hasta 20 contactos propios; otras consultas pueden entregar 25 y expansión hasta 500 | Contratos compatibles; preview independiente del resultado completo; 20/21/25/45/500 filas sobreviven a visualización y exportación |
| UX-02 | P0 | La edición del correo puede aplicarse a descarga y panel, mientras Copy/preview de chat usan el original | Resolver una versión efectiva única; ver, copiar, descargar y utilizar coinciden |
| UX-03 | P0 | Promoción de tablas puede quitar otras tablas distintas; sanitización recorta sin preservar todo el contexto de completitud | Dedupe por contenido/identidad; conservar detalle y metadatos shown/total/omitted |
| UX-04 | P0 | Handoff a chat y error de descarga pueden quedar dentro de la zona oculta por el panel móvil | Cambiar destino visiblemente, recuperar foco y mostrar error junto a la acción |
| UX-05 | P1 | Población de contactos y scope de actividad difieren entre chat, inicio y artefactos | Definiciones compartidas o diferencias explícitas; cifras consistentes en datos equivalentes |
| UX-06 | P1 | Resultados generados y entidades guardadas no siempre comparten referencia estable | ResultEnvelope y enlaces a la entidad exacta |
| UX-07 | P1 | En algunos caminos la correlación usa títulos; detalles de la propuesta desaparecen tras aprobar | IDs de resultado/versión/operación; recibo histórico del efecto real |
| UX-08 | P1 | Fuentes visibles no permiten inspeccionar fácilmente la evidencia de una afirmación | Hecho → evidencia → fuente/fecha o registro nativo |
| UX-09 | P1 | Preguntar sobre una propuesta puede descartarla; cola de un mensaje puede sustituirse; Stop depende del contenido del composer | Clarificar/reemplazar explícitos, cola sin pérdida silenciosa y detener accesible |
| UX-10 | P1 | Historial y colección de resultados dependen de los últimos antecesores cargados | Recuperar turnos y resultados antiguos con paginación y contexto preservado |
| UX-11 | P2 | Progreso, actividad, resumen, preguntas y acciones pueden repetir información | Una superficie de estado principal, detalles desplegables y una acción principal |
| UX-12 | P1 | Una consulta fresca durante expansión o exportación puede cambiar las filas | Declarar snapshot o actualización y reproducir el alcance anunciado |

### 6.3 Inteligencia y especialización

| ID | Prioridad | Hallazgo | Trabajo propuesto y aceptación |
|---|---|---|---|
| AI-01 | P1 | El criterio puede construirse sobre una muestra parcial | Datos de población/coverage en contratos; selección justificada sobre elegibles reales |
| AI-02 | P1 | Escritura de chat, nativa y respuesta tienen contextos diferentes | Brief comercial compartido y reglas específicas por tarea |
| AI-03 | P1 | Persisten aperturas y ángulos intercambiables entre destinatarios | Diversidad por necesidad/rol y evidencia; menor esfuerzo de edición en lectura directa |
| AI-04 | P1 | Corrección semántica de Writer se revalida sobre todo con checks determinísticos | Evaluar revisión dirigida según riesgo; no perder contenido ni aceptar afirmaciones nuevas sin respaldo |
| AI-05 | P1 | El prompt de Writer permite `question:null` en cierta edición, pero el schema exige string | Alinear contrato, prompt y UI; completar una edición simple sin forzar campaña ni pregunta extra |
| AI-06 | P1 | Métricas y artefactos pueden mezclar entidad, período, alcance o denominador | Cálculos críticos del servidor y evidencia tipada por claim |
| AI-07 | P1 | Memoria puede guardar supuestos o decisiones antes de aceptación final | Persistencia ligada a outcome aceptado y rama correcta; preferencias revisables |
| AI-08 | P2 | No hay evidencia reciente de uso de especialistas en la muestra de producción | Medir routing, input, aporte, skip rate, costo y latencia antes de ampliar roles |
| AI-09 | P2 | Mayor esfuerzo o más revisión no ha mostrado ganancias uniformes | Experimentos pareados por tarea; routing basado en mejora medida |
| AI-10 | P1 | Proactividad puede ofrecer una lectura que debería realizar o avisar repetidamente | Lecturas necesarias, intervenciones específicas y dedupe de avisos |

### 6.4 Ejecución, evaluación y cloud

| ID | Prioridad | Hallazgo | Trabajo propuesto y aceptación |
|---|---|---|---|
| RT-01 | P1 | Efectos `executing` no tienen recuperación equivalente a otras colas en el camino auditado | Intento, lease y reconciliación; un crash no deja el padre sin estado resoluble |
| RT-02 | P1 | Una tarea larga autoriza tipos de pasos, pero su progreso no es un contrato completo de entregables | Paso con targets, dependencia, resultado esperado y recibo de completitud |
| RT-03 | P1 | Fallo de una lectura paralela puede dejar éxitos persistidos fuera del contexto inmediato | Conservar éxitos parciales y explicitarlos al cierre/rescate |
| CL-01 | P1 | Executor síncrono: fetch de 150 s, ejecución de hasta 120 s y rutas de 120 s | Jobs asíncronos fuera del request de la app |
| CL-02 | P1 | Cancelar run no cancela el contenedor ni bloquea toda promoción posterior | Cancelación remota, fencing y revalidación antes de publicar |
| CL-03 | P1 | Aprobación fija nombres de entradas, no todos sus bytes; uploads pueden cambiar | Assets y manifest de entrada con hash/revisión inmutables |
| CL-04 | P1 | Límite de salida se comprueba al recoger archivos; cleanup no está garantizado en todo error | Cuota de disco/inodos en ejecución, finally y sweeper |
| CL-05 | P1 | Salidas de un script fallido pueden promoverse; promoción es archivo por archivo | Cuarentena, manifiesto verificado y publicación consistente como parcial o final |
| CL-06 | P1 | Falta proyecto persistente, toolchain y revisión renderizada | Workspace reconstruible, imágenes versionadas y browser de comprobación |
| EV-01 | P0 | Cobertura y evidencia del evaluator no son plenamente inmutables | Census y snapshots; faltantes explícitos |
| EV-02 | P0 | Una verificación ausente puede aparecer aprobada | Estado `not_measured` en métricas y reportes |
| EV-03 | P1 | Falta aceptación autenticada global de la versión actual | Línea base de tareas completas con sesión, UI y estado real |

Los hallazgos de ejecución son riesgos derivados de código, no afirmaciones de incidentes ya ocurridos. Su prioridad se confirmará con reproducción proporcional en el entorno apropiado.

## 7. Investigación de los siete repositorios

### 7.1 Versiones fijadas

| Repositorio | Rama | SHA completo | Licencia observada |
|---|---|---|---|
| iOfficeAI/AionUi | main | `6744099b279b991c17e31c243f0920477bd31cb6` | Apache-2.0 |
| Dependencia AionCore v0.2.2 | tag | `47e66d0d151123e973b3fd1e77afcb5671b3f8c5` | Apache-2.0 |
| eigent-ai/eigent | main | `22145daa8b546494636d8e57822d866b547e929b` | Apache-2.0, con componentes terceros |
| OpenCoworkAI/open-cowork | main | `910467306e950c249c448e6589051d4865d371b7` | MIT, con componentes/skills terceros |
| different-ai/openwork | dev | `13f038d67322b634d248079d7e552190503c0397` | MIT fuera de excepciones; EE bajo licencia propia |
| LibreChat-AI/LibreChat | main | `e1dfc10449ff713faffacd60273fddcfe2c0a698` | MIT, con dependencias y servicios adicionales |
| kortix-ai/suna | dev | `f19fe4e931009eba36b8560864cb1aa567b81aca` | Elastic License 2.0 |
| Agenta-AI/agenta | main | `4bc51903a1597d3ef8f1ac17f2d6f472ba7c8137` | MIT para núcleo; EE con licencia propia |

Estas versiones no se actualizan implícitamente durante un experimento. Un cambio de dependencia requiere nueva revisión de contrato y licencia.

### 7.2 AionUi y AionCore

**Implementación inspeccionada.** AionUi usa adaptadores HTTP/WS y un proceso AionCore. El script de preparación resuelve un bundle versionado del backend. Se siguió esa dependencia hasta su código de equipos, tablero, mailbox, coordinador y recuperación.

**Flujo de coordinación:** solicitud/mensaje → admisión de trabajo de un slot → cola por prioridad y generación → entrega al runtime → resultado del turno → consumo de mensajes. El mailbox dispone de peek y marcado posterior; el coordinador preserva mensajes no consumidos ante fallo o interrupción.

**Flujo de dependencias:** creación de tarea con owner y `blocked_by` → registro y relación inversa → finalización → actualización de dependencias de tareas posteriores → evento de cambio y posibilidad de despertar al responsable.

Decisiones rescatables:

- tareas y mensajes con identidad propia;
- dependencia explícita entre pasos;
- protección de propietarios de ejecución por generación;
- resúmenes que priorizan tarea propia, bloqueadores y trabajo relacionado;
- aviso de tareas omitidas del resumen;
- feed con cursor estable, upserts y realineamiento al reconectar;
- aviso al coordinador cuando un compañero falla.

**Adaptación:** TaskGraph comercial y handoffs breves. Una investigación terminada habilita la redacción de sus contactos exactos; el resultado no depende de que el modelo recuerde nombres escritos en el texto de una respuesta.

**Límites:** runtime externo y backend separado; no asumir que todo el shell de escritorio está listo como servicio web comercial. El hook inspeccionado de permisos pendientes carga conteos y escucha remociones, pero no incrementa cada nueva confirmación mediante un evento dedicado. Su UI multiagente debe adaptarse a una conversación clara, sin obligar al ejecutivo a administrar un equipo de bots.

### 7.3 Eigent

**Implementación inspeccionada.** FastAPI y CAMEL, coordinación Workforce, modelos y herramientas, RunJournal SQLite, admisión, checkpoints de tools, finalización de workspace, manifiestos y proyección de interfaz.

**Flujo de ejecución:** admitir request/run/attempt → fijar configuración y scope → ejecutar herramientas con checkpoint → registrar outcome → finalizar artefactos → proyectar historial desde hechos persistidos.

**Flujo de workspace aislado:** detener escritores → verificar prueba de settlement → capturar archivos en almacenamiento por contenido → comprobar propietario/generación → publicar manifest y outcome en transacción. La revisión resolve bytes de una revisión retenida.

Decisiones rescatables:

- Run, Attempt, Step y Artifact separados;
- transición prepared/dispatched/completed/outcome_unknown para herramientas;
- solicitudes de continuación durables y dedupe de admisión;
- recursos y tareas asíncronas que se drenan antes de finalizar;
- manifiesto con digest, origen y atribución por paso;
- UI reconciliada con estado persistente y revisión de cambios;
- skills con scope de usuario/agente y fuentes fijadas.

**Adaptación:** ledger del encargo y publicación consistente de outputs; una versión final no cambia cuando un proceso tardío vuelve a escribir.

**Límites:** hay caminos legacy y managed diferentes. El constructor de Workforce restringido revisado declara dos trabajadores de archivos, sin terminal, navegador, MCP o skills. Los endpoints generales `/v1/tasks` del controlador leído son placeholders 501. El nombre `SandboxHands` describe restricciones de capacidades y paths; por sí solo no acredita aislamiento de sistema operativo.

### 7.4 OpenCowork

**Implementación inspeccionada.** Electron y Pi, SessionManager SQLite, runner, hook de permisos, subagentes, compactación, guard de bucles, skills, scheduler y comprobación de cambios locales.

**Flujo de delegación:** `spawn_subagent` → preset/modelo y allowlist → sesión aislada de contexto → herramientas acotadas → progress events → resultado → cleanup/cancelación. El hijo no puede delegar nuevamente.

**Flujo proactivo:** verificar archivo o comando dentro del scope → comparar hash con baseline → no llamar al modelo si no cambia → persistir observación → lanzar tarea ante cambio. Las pruebas inspeccionadas incluyen estabilidad de baseline, límites, cambios y rechazo de escapes.

Decisiones rescatables:

- especialistas con contexto independiente y resultado compacto;
- restricciones que una invocación puede estrechar, no ampliar;
- concurrencia, tiempo y cancelación;
- guard de llamadas repetitivas;
- compactación orientada a objetivo, decisiones y errores pendientes;
- disparadores deterministas de bajo costo;
- descubrimiento de competencias por proyecto/usuario.

**Adaptación:** eventos comerciales y competencia cargada a demanda. Evitar gasto de modelo en comprobaciones sin cambios.

**Límites:** el código desactiva subagentes en sesiones aisladas porque sus herramientas no soportan todavía ese aislamiento. El adaptador puede caer a ejecución nativa al fallar WSL/Lima. La cola de prompts del SessionManager inspeccionado es local en memoria aunque las conversaciones se guardan. No trasladar esas limitaciones al cloud ni asumir recuperación durable de una cola solo por tener SQLite.

### 7.5 OpenWork

**Implementación inspeccionada.** Aplicación/servidor sobre OpenCode, pool de engine, contratos de sandbox, adaptador Daytona, ciclo cloud, construcción acotada de vistas, edición de artefactos y estado de mensajes en cola.

**Flujo cloud:** identidad estable → find/create del proveedor → start/inspect → exec → archivos/logs → endpoint con vencimiento → detención/reanudación. El contrato exige capacidades declaradas y suite de conformidad.

**Flujo de artefacto editable:** leer archivo → mantener draft y versión de partida → guardar con `baseUpdatedAt` → actualizar estado → descargar o abrir preview. Errores de guardado son visibles en el panel.

Decisiones rescatables:

- proveedor neutral y errores tipados;
- idempotencia de creación y adopción solo ante conflicto probado;
- logs/exit codes y capacidad verificable;
- disco persistente separado de restauración de memoria;
- endpoints privados de vida limitada;
- detención por inactividad y coordinación con trabajo activo;
- cola que distingue admisión incierta de ejecución observada;
- actualización de engine que permite drenar runs activos.

**Adaptación:** contrato BuildProvider, comprobación de capacidades y edición con conflictos. No se necesita adoptar OpenCode como coordinador comercial para aplicar estos patrones.

**Límites:** cloud administrativo y compilador de vistas inspeccionados viven en EE. El contrato MIT y sus paquetes no convierten automáticamente todo el backend cloud en reutilizable. El adaptador Daytona declara persistencia de storage, pero no restaura memoria y no declara warm pool. La edición con timestamp debe compararse con hashes/revisiones más fuertes para nuestro caso.

### 7.6 LibreChat

**Implementación inspeccionada.** Carga lazy de especialistas, threads hijos, checkpoints con ownership, entrega de background, claims, routing Redis, protocolo de workspace, panel de control de hijos y transformación de artefactos.

**Flujo delegado:** descriptor/configuración y acceso → inicialización bajo demanda → thread hijo → tarea y transcript → resultado durable → entrega o recolección → continuación del padre. Los controles conservan identidad y recibos.

**Flujo de ejecución remota:** request con ID → admisión → operación → consulta durable por ID → resultado validado. Una consulta de un handle retenido no crea una nueva operación.

Decisiones rescatables:

- contexto hijo separado y configuración versionada;
- permisos y disponibilidad revalidados;
- estados distintos para tarea terminada y resultado entregado;
- resultado registrado antes de reanudar al padre;
- reconciliación entre poll manual y entrega automática;
- resultados/checkpoints por usuario y tenant;
- dirigir, encolar, interrumpir y cancelar con recibos;
- conservación del texto sin enviar durante actualizaciones;
- protocolo de archivos con límites y conflictos de edición.

**Adaptación:** continuación idempotente de investigación/build y controles que describan el efecto real de detener o reorientar.

**Límites:** los procesos activos de herramientas background pueden seguir siendo locales. Redis enruta al propietario vivo; no mueve un proceso al reiniciar. Persistencia de transcript/resultado no equivale a migración de ejecución. La ejecución de código necesita servicios/configuración adicionales.

### 7.7 Suna / Kortix

**Implementación inspeccionada.** La versión dev leída contiene plano API, runtime sandbox sobre OpenCode/Pi, proveedores, política de duración, previews, subagentes, tool `show`, fuentes y agrupación de resultados en la interfaz.

**Flujo de construcción:** session/sandbox con propietario → runtime y herramientas → archivos o servicio local → presentación de output existente → proxy/preview → resultado principal visible.

**Flujo de ciclo de vida:** observación del plano de control → registro de turno → renovación acotada → estado terminal o espera → cola de detención y reaper. El sandbox no debe poder prolongar indefinidamente su propia vida.

Decisiones rescatables:

- priorizar el entregable solicitado sobre los archivos intermedios;
- distinguir nuevo/actualizado y elegir el resultado fresco;
- no presentar outputs de herramientas todavía pendientes o fallidas;
- entregar conjuntos de archivos y previews relacionados;
- esperar input tiene prioridad sobre anunciar «listo»;
- `show` presenta contenido existente; no equivale a crear o guardar;
- contrato de proveedor y credenciales ligadas a sesión;
- TTL, recuperación y límites absolutos;
- separar los archivos de preview de directorios de credenciales/runtime.

**Adaptación:** DeliverableSet y panel de resultados principal; ciclo cloud con jobs activos, espera e inactividad diferenciados.

**Límites:** los comentarios y código reflejan complejidad operativa real: retry layering, boxes retenidas y previews con scope demasiado amplio que debieron estrecharse. No copiar sus tiempos largos para nuestros jobs pequeños. La licencia ELv2 restringe ofrecer un conjunto sustancial de funciones como servicio alojado; usar patrones con implementación propia o revisar derechos antes de reutilizar código.

### 7.8 Agenta

**Implementación inspeccionada.** Planner/executor/processor de evaluaciones, fuentes versionadas, cola Taskiq, resultados por celda, anotaciones, comparación, snapshots, trazas y despliegue OSS/EE.

**Flujo de evaluación:** source revision → escenario → pasos/repeticiones → runner de aplicación → outputs/traces → evaluador/anotación → resultado persistido → métricas. La ejecución y el rollup están separados; los estados faltantes no deberían confundirse con éxito.

**Flujo de revisión:** filtrar trazas → paginar/deduplicar → cola de anotación → schema de métricas → notas vinculadas a trace/caso/revisión → comparación de ejecuciones.

Decisiones rescatables:

- coordenada caso/paso/repetición;
- datasets, configuración y evaluador versionados;
- resultados conservados ante fallos de agregación;
- concurrencia compartida acotada;
- evaluadores que consumen la evidencia de la aplicación sin sobreescribirla;
- estado pendiente para revisión aún no realizada;
- comparar ejecuciones terminadas con estructura compatible;
- reutilizar incidentes reales como casos de regresión;
- formulario de evaluación con schemas, notas y links a evidencia.

**Adaptación:** mejorar el harness existente y construir una ficha de evaluación por tarea. No hace falta instalar la plataforma completa para la primera ronda.

**Límites:** topologías soportadas explícitas; A/B de múltiples aplicaciones se realiza mediante evaluaciones separadas. Hay reintentos de ejecuciones fallidas y caminos que requieren un censo externo para no perder del denominador una creación de escenario fallida. Ese control se mantendrá en nuestro manifest. El despliegue completo introduce API, workers, Postgres, Redis y storage, entre otros servicios; las funciones EE tienen licencia distinta.

### 7.9 Decisión de adopción

| Patrón | Decisión inicial | Motivo |
|---|---|---|
| TaskGraph/dependencias | Adaptar a servicios y eventos actuales | Hace verificable la continuidad comercial |
| Manifiesto/revisión de outputs | Adoptar el concepto con contrato propio | Alinea lo generado, descargado y aprobado |
| Contexto especializado bajo demanda | Experimentar sobre roles existentes | Aporte medible sin multiplicar llamadas innecesarias |
| Entrega automática durable | Adaptar | Recuperación tras cerrar pestaña o completar trabajo externo |
| BuildProvider neutral | Implementar contrato pequeño | Reutilizar executor y comparar un proveedor managed |
| Panel centrado en entregable | Adaptar a componentes y tokens de ANTON.IA | Claridad y reducción de ruido |
| Evaluación caso/paso/repetición | Incorporar al harness | Evidencia reproducible y faltantes visibles |
| Migración completa a otro framework | Sin decisión de migración | Primero demostrar un bloqueo que el stack existente no resuelva |
| Copia de branding/assets | Fuera de la propuesta | Identidad y paleta actuales |
| Código EE/ELv2 | Revisar derechos por componente | La visibilidad en GitHub no concede los mismos permisos que MIT/Apache |

## 8. Arquitectura objetivo y contratos

### 8.1 Modelo de trabajo

```text
GoalContext
  → TaskGraph: pasos + dependencias + targets + entregables
  → coordinador responsable
      → lecturas / especialistas / escritura
      → operaciones comerciales nativas
      → build jobs cuando la tarea necesita cloud
  → EvidenceBundle + ResultEnvelope + OperationReceipt
  → DeliverableSet versionado
  → presentación y acciones contextuales
```

No toda pregunta genera un plan persistente. Conversaciones simples deben seguir siendo rápidas. Se crea un TaskGraph cuando hay dependencias, jobs externos o varios entregables cuyo estado debe conservarse.

### 8.2 Contratos propuestos

Son diseños conceptuales; no prescriben una migración inmediata ni sustituyen contratos ya existentes.

| Contrato | Datos mínimos | Responsabilidad |
|---|---|---|
| GoalContext | objetivo, oferta activa, audiencia, período, scope, restricciones y aceptación | Evitar pérdida del encargo |
| TaskStep | ID, clase, dependencias, targets, input refs, salida esperada, estado y recibo | Medir avance por entrega, no por número de aprobaciones |
| EvidenceBundle | herramienta/fuente, entidad, instante, scope, coverage, observación y refs | Fundamentar decisiones y cálculos |
| ResultEnvelope | ID, task/step/run, tipo, procedencia, versión, completitud, entity refs y acciones | Unir chat, panel, descarga y app |
| EffectiveVersion | versión generada/edición/guardada/aprobada y revisión actual | Consistencia del contenido utilizado |
| OperationReceipt | operación, admisión, ejecución, outcome, targets y confirmación | Describir lo que ocurrió realmente |
| BuildJob | scope, workspace, intento, lease, límite, manifest de entradas/salidas y estado | Ejecutar cloud fuera del request conversacional |
| DeliverableSet | resultado principal, outputs relacionados, versiones y comprobaciones | Entregar un trabajo completo y revisable |
| EvaluationManifest | versión, escenario, evidencia, resultado, consumo y notas | Reproducir la evaluación |

### 8.3 Estados

Estados de paso: `pending`, `blocked`, `running`, `waiting_user`, `succeeded`, `partial`, `failed`, `cancelled`, `expired`.

Estados de operación deben distinguir: no iniciada, admitida, ejecutándose, confirmada y resultado incierto. Un timeout de transporte no autoriza repetir una escritura ni confirma que se haya detenido su ejecución.

Estados de entrega: preparado, pendiente de publicar, publicado y entregado al hilo. La continuación se activa desde un resultado durable y usa una clave estable.

La cancelación solicitada permanece distinta de la cancelación confirmada. Solo el intento vigente puede publicar; un token o generación vencidos no pueden cerrar un resultado posterior.

### 8.4 Memoria y evidencia

- Separar conocimiento comercial del equipo, preferencias personales y decisiones del hilo.
- Conservar fuentes, fecha y origen de cada prueba comercial.
- Guardar decisiones de trabajo con el outcome aceptado y su rama.
- Conservar texto editado y selección por IDs.
- Compactar contenido voluminoso manteniendo referencias recuperables.
- Mostrar información incompleta o antigua donde afecte una decisión, una sola vez.
- Ofrecer revisión/corrección/olvido de preferencias personales.

## 9. Experiencia, respuestas y artefactos

### 9.1 Principio de composición

La experiencia debe permitir entender:

> Qué encontraste → por qué importa → qué resultado puedo usar → qué pasó realmente → qué hago después.

No se impondrá esa estructura como cinco bloques a toda respuesta. Una pregunta simple se responde en un párrafo; una tarea compleja puede usar un resultado central y detalles disponibles.

### 9.2 Respuesta adaptativa

| Solicitud | Presentación preferida |
|---|---|
| Consulta breve | Respuesta directa y ejemplo si aporta |
| Recomendación de contactos | Selección accionable y razón breve; exclusiones relevantes |
| Correo | Contenido editable, versión y acción contextual |
| Secuencia | Visión del papel de cada paso y editor de mensajes |
| Informe | Conclusión en chat; documento como entregable |
| Datos/resultados | Métricas y tabla con scope, período y coverage |
| Build cloud | Estado de trabajo y luego preview/archivo principal |
| Efecto comercial | Recibo de lo realizado y enlace a la entidad |
| Falta de dato o fallo | Resultado conservado, bloqueo concreto y recuperación útil |

Se conservará una acción principal y pocas alternativas pertinentes. Una consulta ya realizada no vuelve a ofrecerse como siguiente paso.

### 9.3 Panel de resultados

La cabecera responderá:

- qué es el resultado;
- si es generado, observado o guardado en la app;
- qué versión está abierta;
- de cuándo son sus datos y cuál es su alcance;
- qué está completo o pendiente;
- cuál es la acción útil.

Vistas como Resultado, Fuentes y Versiones aparecen solo cuando tienen contenido. El entregable solicitado va primero; archivos de apoyo y código quedan accesibles en detalles.

### 9.4 Consistencia de edición

Un resolver de versión efectiva se utiliza en preview, Copy, exportación y acciones posteriores. La aprobación se liga a la versión revisada. Editar invalida únicamente la comprobación/aprobación que depende del contenido cambiado; no elimina el trabajo.

Las ediciones guardadas deben detectar conflicto frente a otra revisión. Una revisión por IA no sustituye silenciosamente cambios manuales. El usuario puede ver cambios relevantes o comparar versiones cuando lo necesita.

### 9.5 Artefactos vinculados a la app

Ejemplo objetivo:

```text
«Estas cinco cuentas merecen atención»
  → selección de sus IDs reales
  → preparar mensajes
  → revisar la versión concreta
  → guardar campaña pausada
  → abrir esa campaña
```

Los dashboards usarán datasets de scope explícito y agregaciones verificables. Una revisión de layout no refresca datos sin comunicarlo. Acciones nativas se ejecutan desde componentes de la app o un puente allowlist que solicita la revisión correspondiente; el código generado no recibe credenciales de base de datos.

### 9.6 Razonamiento visible

Mostrar razones de decisión, supuestos y evidencia accionable:

> «Priorizo estas tres personas porque encajan con la audiencia, tienen un canal disponible y no registran contacto previo».

La transparencia se basa en justificación y trazabilidad, no en exponer deliberación interna del modelo. La UI no mostrará «verificado» cuando la revisión fue omitida ni una barra temporal exacta sin datos.

### 9.7 Continuidad y composer

- Preguntar sobre una propuesta conserva esa propuesta; reemplazarla es otra intención.
- Enviar instrucciones durante el trabajo permite dirigir, encolar o interrumpir con efecto explicado.
- Stop sigue disponible aunque el usuario escriba.
- Texto, archivos y cola se conservan por conversación/scope según su ciclo de vida.
- Resultados antiguos y jobs fuera del hilo seleccionado se pueden recuperar.
- El URL o navegación conserva, cuando aporta, work/result/version.
- Un retorno desde el panel móvil muestra el composer y conserva su contexto.
- Errores de una acción son visibles junto a esa acción.

### 9.8 Diseño y accesibilidad

Mantener `cw-*`, paleta actual, pares light/dark y componentes `src/components/ui/*`. Clasificar el cambio como flujo, componente, layout o accesibilidad; documentar las referencias y adaptación antes de un rediseño importante.

Auditar 360/390/768/1024/1440 px, alturas cortas, teclado móvil, zoom 200 %, foco, teclado completo, contraste, carga, vacío, error y movimiento reducido. Las comprobaciones de código y las capturas renderizadas se registran como evidencias distintas.

## 10. Criterio comercial, marketing y redacción

### 10.1 Brief comercial compartido

El contexto común para chat Writer, investigación, borradores nativos y respuestas debe incluir:

| Elemento | Uso |
|---|---|
| Oferta activa y versión | Qué se vende en este encargo; instrucción explícita prevalece sobre defaults |
| Audiencia/rol/segmento | Qué problema y lenguaje son pertinentes |
| Diferenciadores | Posicionamiento sin superlativos inventados |
| Pruebas y claims | Texto exacto, origen, fecha y condiciones |
| Voz y ejemplos aprobados | Naturalidad y consistencia |
| Relación e interacción previa | Primer contacto, seguimiento, respuesta o negociación |
| Evidencia del destinatario | Personalización fundamentada |
| Objetivo del mensaje | Una respuesta/acción concreta |
| Texto ya aceptado | Preservar decisiones y reducir repetición |
| Información faltante | Evitar inventar para completar un formato |

Una prueba declarada por el vendedor no se presenta como validación externa. Su significado y tiempo verbal se conservan.

### 10.2 Competencias runtime propuestas

La biblioteca de competencias tendrá versión, propósito, entradas, salidas, criterios de calidad, ejemplos y herramientas aplicables. Es distinta de las skills de OpenCode usadas para desarrollar la app.

| Competencia | Resultado esperado |
|---|---|
| ICP y segmentación | Audiencias con criterios, señales y exclusiones |
| Priorización de cuentas | Selección basada en encaje, relación y siguiente acción |
| Posicionamiento | Mensaje, diferenciador y prueba por audiencia |
| Primer contacto B2B | Correo específico y fácil de responder |
| Seguimiento | Nuevo valor sin repetir la presentación |
| Secuencias | Narrativa, papel de cada paso, cadencia y condición de salida |
| Respuesta y objeciones | Contestar lo pedido con contexto del hilo |
| LinkedIn | Mensaje adecuado a relación, canal y restricciones |
| Voz de marca | Estilo consistente con preferencias y material real |
| Landing y conversión | Promesa, prueba, estructura, CTA y supuestos |
| Plan de campaña | Objetivo, audiencia, contenido, canal, recursos y medición |
| Análisis comercial | Scope/período/denominador correctos y próxima acción |
| Experimentación | Hipótesis, variable, población y criterio de éxito |
| Competencia/SEO/contenidos | Brief fundamentado y límites de fuentes/herramientas |

Se cargan descriptores ligeros y luego el contenido pertinente. Cambiar una competencia no amplía sus permisos de ejecución. Fuentes externas y ejemplos se curan; no se instalan automáticamente como instrucciones confiables.

### 10.3 Calidad de escritura

- Personalización vinculada a un dato o criterio comercial, no solo cambiar el nombre.
- Español natural acorde al usuario, región y trato solicitado.
- Una idea principal y una petición clara.
- Pruebas exactas y ausencia de precios, garantías o vínculos no respaldados.
- Asunto y cuerpo consistentes.
- Ángulos distintos entre personas y pasos cuando hay material para ello.
- Conservación del propósito y contenido ya aprobado al editar.
- Respuestas que contestan precio, información u objeción en su hilo.
- Datos faltantes explicados al usuario cuando afectan el trabajo, no insertados como notas en un correo para el prospecto.

Se medirán apertura genérica, intercambio entre destinatarios, repetición de oferta/CTA, tono y esfuerzo de edición. Un set sin material nuevo puede necesitar más pruebas o usos reales del vendedor; repetir un prompt no crea evidencia.

### 10.4 Marketing digital con capacidad real

Cowork puede elaborar estrategia, contenidos, briefs, secuencias, landing pages y análisis. Publicar anuncios, medir tráfico externo o operar plataformas adicionales exige una integración disponible y permisos de esa operación.

Las competencias externas estudiadas se adaptarán: no se importarán sus benchmarks numéricos, descuentos sugeridos, cadencias u ofertas como hechos del negocio. Cuando no haya baseline, se propone un experimento y se registra la incertidumbre que cambia la decisión.

## 11. Agentes, workers y razonamiento

### 11.1 Cantidad y responsabilidades

La base inicial conserva un coordinador responsable y especialización acotada. Roles existentes cubren redacción, revisión, análisis, investigación y diseño. El primer rol nuevo candidato es **Constructor cloud**, activado solo en trabajos que necesitan archivos/código/renderizado.

La verificación de entregables comienza con checks deterministas y renderizado. Se añade un pase semántico dirigido si las pruebas muestran que mejora fundamento o cumplimiento. No se activa toda la cadena para cada consulta sencilla.

### 11.2 Handoff de especialistas

Cada encargo delegado debe incluir:

- objetivo y criterio de aceptación;
- evidencia pertinente con refs, scope y fecha;
- targets y versión del resultado;
- herramientas permitidas y restricciones;
- presupuesto temporal y de llamadas;
- formato de retorno con hallazgos, evidencia, bloqueos y entregables.

El especialista devuelve un resultado compacto y verificable. No decide nuevas acciones externas ni cambia la audiencia por su cuenta. La delegación inicial queda sin recursión arbitraria.

### 11.3 Medición para decidir ampliaciones

| Dimensión | Pregunta |
|---|---|
| Invocación | ¿Se usa en las tareas que lo requieren? |
| Contexto | ¿Recibe oferta, evidencia y versión suficientes? |
| Aporte | ¿Corrige un fallo que el coordinador no resolvía? |
| Fidelidad | ¿Introduce datos o cambia el encargo? |
| Latencia/costo | ¿Su mejora compensa la demora y consumo? |
| Fallo/omisión | ¿El usuario conserva una salida útil cuando no termina? |
| Continuidad | ¿Su resultado llega al padre y al hilo correctos? |

Se comparará camino con/sin especialista sobre los mismos casos. Un rol nuevo requiere un problema repetible y una ganancia comprobada.

### 11.4 Workers operativos

Medir cola, capacidad, locks, lease, recuperación, trabajos atascados y duración por tipo. Una cola lenta se resuelve con admisión/concurrencia/infraestructura; una mala recomendación puede requerir evidencia o competencia.

Para uso personal se comienza con concurrencia acotada, lecturas independientes en paralelo y un build a la vez. Cambios al throughput se justifican con espera real y carga controlada.

### 11.5 Routing y razonamiento

- Mantener Luna como baseline.
- Registrar esfuerzo y prompts por rol.
- Probar cambios de esfuerzo solo en casos que lo justifiquen y con muestra pequeña.
- Mejorar contexto y herramientas antes de aumentar tiempo o llamadas.
- No elevar automáticamente límites para esconder un fallo de routing.
- Transferir tareas largas a ejecución durable en lugar de extender indefinidamente el request.
- Mantener checks de hechos/estados fuera del modelo cuando pueden ser deterministas.

Las evaluaciones anteriores encontraron más latencia sin beneficio uniforme al aumentar esfuerzo, y correcciones de jueces que empeoraban algunas respuestas. La decisión se toma por tarea y evidencia, no por prestigio del modelo o nombre del rol.

## 12. Laboratorio cloud de marketing y miniapps

### 12.1 Propósito

Dar a Cowork un entorno para **construir, renderizar, verificar y entregar** trabajos comerciales. Persistir el proyecto y sus archivos; activar cómputo mientras se necesita.

Primeros casos:

1. Informe comercial con DOCX/PDF, gráficos y XLSX de respaldo.
2. Presentación de una cuenta o propuesta con evidencia accesible.
3. Landing page basada en oferta y audiencia.
4. Calculadora comercial con fórmulas y supuestos visibles.
5. Tablero privado con filtros y cifras verificadas.
6. Brief de campaña y paquete de contenidos/secuencia.

### 12.2 Base reutilizable y brechas

| Base actual | Ampliación requerida |
|---|---|
| Script Python/Node por contenedor | Job asíncrono consultable y cancelable |
| Código aprobado ligado a hash | Manifest de bytes de entrada, receta, revisión y toolchain |
| Inputs en Storage privado | Assets versionados, árbol de fuentes y outputs reutilizables |
| Salida en `/out` | Publicación consistente de un conjunto de entregables |
| Restricción de red y recursos | Perfiles de capacidades y límites durante todo el job |
| HTML en iframe y exportadores | Preview multiarchivo y revisión renderizada |
| Cache/idempotency del executor | Intentos, lease, heartbeat y resultado incierto de extremo a extremo |
| Contenedor efímero | Workspace lógico reconstruible desde checkpoint |

El camino actual usa 1 CPU, 2 GiB, red desactivada, inputs de solo lectura y hasta 16 outputs/10 MiB. Estas son propiedades de código; estado de la VM, imágenes y políticas efectivas requieren comprobación antes de ejecutarlo.

`COWORK_WORKSPACE_ENABLED` significa contexto de cuenta, no una máquina cloud persistente.

### 12.3 Plano de control y plano de ejecución

```text
ANTON.IA / Supabase — plano de control
  objetivo, scope, permisos, tarea, estado, presupuesto, evidencia
       ↓ job con identidad y manifest
Supervisor confiable / BuildProvider
       ↓ entorno aislado
Python / Node / renderizador
       ↓ outputs en cuarentena
Validación + render + manifest final
       ↓ publicación autorizada
Storage privado + preview separado + DeliverableSet
```

El código generado no recibe `service_role`, secretos del correo ni credenciales del runtime de la app. El supervisor prepara datasets/archivos autorizados y recoge outputs. Las operaciones comerciales siguen pasando por los servicios nativos de ANTON.IA.

### 12.4 BuildProvider

Contrato pequeño, implementado sobre capacidades verificadas:

- describir toolchains, recursos, storage y capacidades;
- crear/adoptar con identidad estable;
- consultar estado y logs;
- ejecutar de manera asíncrona;
- leer/escribir assets dentro del workspace;
- solicitar y confirmar cancelación;
- capturar/reconstruir checkpoint;
- detener o eliminar el entorno de cómputo;
- emitir preview de corta duración cuando esté autorizado.

Separar timeout de transporte, deadline de job y prueba de detención. Después de admisión, una reconexión consulta el mismo job; no crea otro.

### 12.5 Workspaces y assets

Workspace por usuario/organización/proyecto, con revisiones inmutables. Cada asset registra ID, ruta relativa saneada, SHA-256, MIME, tamaño, origen y revisión.

- Manifest de entrada congelado para cada job.
- Fuente y lockfile asociados a toolchain/imagen reproducible.
- Outputs de un job pasan a ser entradas mediante referencias explícitas.
- Escrituras serializadas al mismo proyecto o branches aisladas con merge validado.
- Checkpoints suficientes para reconstruir después de detener cómputo.
- Retención y limpieza de archivos separadas de la vida del contenedor.
- Cuota de disco/inodos durante ejecución y limpieza incluso ante error.
- Publicación con propietario/attempt/generación vigentes y manifest final.

### 12.6 Toolchains

| Perfil | Herramientas objetivo | Uso |
|---|---|---|
| Documentos y datos | Python, librerías de tablas/Office/gráficos y conversión verificada | Informes, Excel y presentaciones |
| Miniapps | Node 22, plantillas pequeñas y dependencias fijadas | Landing, calculadoras, dashboards |
| Render/QA | Chromium/Playwright y fuentes aprobadas | Capturas, PDF y comprobación de UI |

Las dependencias comunes se preparan en imágenes versionadas. Instalar paquetes o traer un repo externo es una fase controlada con origen, commit/lockfile y permisos de red definidos. Los exportadores existentes siguen siendo la primera opción para tareas que ya resuelven de manera determinista.

### 12.7 Preview y publicación

- Empezar con previews estáticos privados.
- Origen separado, sin cookies ni credenciales de ANTON.IA.
- Acceso limitado al resultado y revocable.
- Revalidación de acceso al emitir URL y al solicitar operaciones.
- No servir el directorio completo de runtime o credenciales.
- El archivo generado, el preview y su versión están vinculados.
- Un build aprobado no autoriza publicación pública ni desplegar en producción.
- Un dev server persistente exige otro ciclo de vida; añadirlo cuando el piloto estático no alcance.

### 12.8 Límites iniciales propuestos

Son parámetros de piloto por confirmar, no configuración aplicada:

- Un job concurrente para el dueño.
- Deadline inicial de 10 minutos por build, ajustable por receta medida.
- Recursos de referencia para el ejemplo managed: 2 vCPU y 4 GiB; trabajos ligeros pueden necesitar menos.
- Vida de preview limitada y pausa después de inactividad; conservar archivos.
- Límite absoluto de cómputo y cancelación desde el plano de control.
- Máximo acotado de intentos de reparación, registrando consumo y cambios.
- El contenido del sandbox no puede autorizar su propia ampliación de vida, gasto o permisos.

### 12.9 Selección del proveedor

| Opción | Ventaja | Trabajo/costo a evaluar |
|---|---|---|
| Endurecer executor existente | Reutiliza servicios y scripts cortos | Jobs durables, aislamiento/operación efectivos, toolchain y previews |
| Daytona managed | Contrato de archivos, exec, storage y preview útil para el piloto | Imagen, región, TTL, persistencia, latencia y precio real |
| E2B managed | Sandbox y pausa/reanudación para comparar | Límites de plan, recursos configurables, restauración y acceso a preview |
| VM dedicada autoalojada | Control operativo y toolchains propios | Supervisión, aislamiento, capacidad, limpieza, red y mantenimiento |

Recomendación: mantener el executor para tareas simples e implementar un BuildProvider que permita un piloto managed pequeño. Daytona es candidato inicial; la elección final se confirma con creación, build, pausa, recuperación, descarga y cleanup. Ningún proveedor fue provisionado durante la investigación.

### 12.10 Costo cloud orientativo

Precios públicos consultados el 9 de octubre de 2026:

- Daytona Linux: US$0,0504/vCPU-h y US$0,0162/GiB-h; storage anunciado separado.
- E2B: US$0,000014/vCPU-s y US$0,0000045/GiB-s, equivalentes a esas tarifas de cómputo; planes y límites adicionales.
- Referencia 2 vCPU + 4 GiB: `2 × 0,0504 + 4 × 0,0162 = US$0,1656/h`.
- Diez minutos de esa referencia: aproximadamente US$0,0276 solo de cómputo.

Son cálculos de tarifas publicadas, no presupuesto contractual. Faltan almacenamiento, snapshots, transferencia, previews, cuotas/planes y variación de duración según proveedor. Promociones de créditos no son el costo permanente.

El presupuesto cloud se define aparte de los US$10 de modelos. No contratar plan mensual ni aprovisionar gasto adicional sin una asignación explícita.

## 13. Protocolo de evaluación real

### 13.1 Capas de evidencia

| Capa | Qué demuestra |
|---|---|
| Código/contratos | Mecanismos y límites implementados |
| Determinista con datos controlados | Exactitud de transforms, estados y regresiones |
| Modelo real con mundo congelado | Calidad semántica sobre evidencia conocida |
| App autenticada | Sesión, UI, persistencia, workers, propuestas y continuaciones |
| Operación controlada de proveedor | Efecto confirmado en el sistema destino |
| Uso del dueño | Esfuerzo, comprensión y utilidad personal |
| Estudio futuro con ejecutivos | Intuitividad y adopción de usuarios reales distintos del dueño |

Se reportan por separado. La revisión del asistente es una evaluación experta de interacción; no se etiqueta como estudio de usuarios.

### 13.2 Preparación

1. Confirmar revisión desplegada, models/effort y flags efectivos.
2. Registrar base/candidato/corpus/rúbrica y manifest del experimento.
3. Revisar trabajo aprobado y colas del dueño antes de abrir Cowork: wake puede reclamar trabajo del usuario más allá del run evaluado.
4. Usar sesión legítima del dueño; no bypass del gate ni tokens emitidos de manera improvisada.
5. Definir scope de datos y permisos de cada escenario.
6. Conservar evidencia necesaria, sanitizada fuera de reportes públicos del repo.
7. Resolver contabilización y reservas de costo antes de llamadas nuevas.
8. Confirmar que no hay otra ronda de evaluación consumiendo la misma asignación.

Si falta sesión o infraestructura para un camino, se continúa la evaluación independiente posible y se marca ese camino bloqueado. No presentar una llamada directa con admin client como prueba de experiencia autenticada.

### 13.3 Muestra y secuencia

- Piloto de 4 tareas de alto valor para calibrar sesión, observación y consumo.
- Objetivo inicial de 16–20 recorridos, ajustado al piloto; no ejecutar todo el banco automáticamente.
- Continuaciones suficientes para medir una tarea completa, no solo el primer mensaje.
- Repetir dos o tres veces los casos ambiguos o de alto riesgo cuando el presupuesto lo permite.
- Reutilizar incidentes y casos existentes, sumando ofertas/segmentos nuevos para evitar ajuste exclusivo al mundo AXIS.
- Congelar reloj de fixture, datasets y configuración en las comparaciones offline.
- Separar correcciones deterministas que se pueden evaluar sobre outputs conservados sin nuevas llamadas.

### 13.4 Ejecución en interfaz

Por tarea se registrará:

- solicitud original y resultado esperado;
- navegación y primeras acciones;
- tiempo activo y espera;
- respuesta visible, pregunta y botones;
- evidencia consultada y su scope;
- artefacto abierto, editado y descargado;
- propuesta y consecuencia entendida;
- continuaciones, estado final y resultado nativo;
- errores, pérdida de contexto, rescates y consumo.

Se probará volver después de recargar, navegar a otro hilo y recuperar un resultado. La auditoría móvil incluye foco y errores visibles, no solo ausencia de overflow.

### 13.5 Operaciones con efecto externo

Cuando se autorice un ciclo controlado, usar únicamente correos/perfiles propios o destinatarios consentidos definidos en el escenario. Confirmar en destino y en el ledger el estado de la operación.

No acelerar cron/tiempos de producción para simular semanas de una secuencia. Los fallos destructivos, carreras, agotamiento de cuotas y crashes se reproducen con adapters controlados o entornos aislados apropiados, no mediante fault injection sobre la actividad comercial real.

Las suites usan `.env.test.local`; nunca `.env.local`. No ejecutar suites, seeds ni reset contra producción. La sesión de aceptación utiliza la app por sus flujos normales.

### 13.6 Revisión directa

El asistente hará dos pasadas:

1. **Factual y operativa:** verificar cumplimiento, datos, scope, período, identidad, versiones y efectos.
2. **Comercial y de experiencia:** juzgar pertinencia, escritura, facilidad de uso, proactividad y esfuerzo adicional.

Para A/B se mezclan etiquetas y se conserva la clave fuera de la vista de evaluación cuando sea posible. Los checks automáticos respaldan las notas; no reemplazan la lectura.

La ficha incluye citas breves del problema y evidencia verificable. Un buen promedio no neutraliza una afirmación crítica inventada o una acción falsamente confirmada.

## 14. Matriz de escenarios

Todos los escenarios necesitan confirmar ejecución en la versión elegida. Tener un caso en el corpus no acredita una aceptación nueva.

| ID | Tarea | Oráculo de cumplimiento |
|---|---|---|
| E01 | Saludo y «¿qué haces?» | Capacidades reales, breve orientación y acción útil sin consultas superfluas |
| E02 | Usar perfil y cambiar oferta dentro del hilo | Oferta explícita prevalece; prueba y firma correctas; contexto no se cruza de equipo |
| E03 | «Encontrar clientes» frente a «ayúdame a vender» | Nuevo prospecting frente a trabajo sobre base según intención |
| E04 | «¿A quién le escribo hoy?» en cuenta grande | Población suficiente, selección justificada, nuevos y seguimientos diferenciados |
| E05 | Contactos parecidos y varias personas por empresa | Identidad correcta y criterio de cuenta sin inventar autoridad |
| E06 | Correo inicial a tres roles distintos | Ángulo relevante y distinto; prueba fiel; texto utilizable |
| E07 | Secuencia de cuatro mensajes | Progresión de valor, continuidad y CTA propio; límites del material disponibles |
| E08 | Acortar/cambiar tono sin tocar prueba/cierre | Edición localizada y versión efectiva consistente |
| E09 | Mejorar correo para un grupo conjunto | Mantener destinatarios, plural e intención; no convertirlo en campaña individual |
| E10 | Respuesta a precio, información u objeción | Contestar el mensaje en contexto; no inventar precios/plazos; hilo exacto |
| E11 | Opt-out, respuesta automática o conversación ya atendida | Siguiente acción adecuada al estado y conservación del historial |
| E12 | Selección LinkedIn, red y cupo | Perfiles observados, elegibilidad y estado de canal correcto |
| E13 | Lista de feria ya adjunta | Leer archivo disponible; coincidencias/faltantes; propuesta sobre personas correctas |
| E14 | Preparar dos contactos con datos faltantes | Alcance/costo claro, no repetir búsqueda fallida, continuación y reporte recuperables |
| E15 | Investigación incompleta o antigua | Hechos y supuestos distinguibles donde cambia la decisión; entrega útil con límites |
| E16 | Crear campaña frente a activar envíos | Contenido/audiencia/remitente claros; guardada pausada no se presenta como enviada |
| E17 | Resultados de semana/mes, propio/equipo | Período, scope, denominador y estado de campañas correctos |
| E18 | Dos tablas diferentes y más de 20 contactos | Resultado completo conservado, preview parcial explícito y exportación consistente |
| E19 | Tablero/informe y pedir cambios | Datos verificables, versión correcta, cambios y download útil |
| E20 | Propuesta pendiente y pregunta de aclaración | Conservar propuesta y resolver duda; reemplazo deliberado |
| E21 | Trabajo largo, recarga, stop y regreso | Pasos/resultados recuperables; cancelación/expiry claros; sin repetición de efectos |
| E22 | Corrección, memoria y preferencia de firma | Cambio se conserva en scope; versión descartada no contamina el hilo |
| E23 | Aviso de respuesta o investigación lista | Aviso pertinente una vez y enlace al trabajo exacto |
| E24 | Móvil, dark, teclado y exportación fallida | Interacción visible, foco correcto, contenido usable y error recuperable |
| E25 | Informe cloud + PDF/Excel | Datos coherentes entre formatos; archivos realmente abiertos y comprobados |
| E26 | Landing privada y revisión de copy | Preview escritorio/móvil, assets accesibles, oferta fiel, edición preservada |
| E27 | Calculadora comercial | Fórmulas contrastadas con casos conocidos y supuestos visibles |
| E28 | Build cloud interrumpido/retomado | Mismo job consultado, archivos persistentes y publicación por intento vigente |

Variantes necesarias: 0/1/20/21/25/26/45/500 contactos; dos nombres similares; dos roles de una empresa; ausencia/contradicción/antigüedad de evidencia; oferta con/sin proof point; seguimiento de 4/5/6 días; historial largo; resultado parcial y dependencia no disponible.

El piloto cloud elige E25 y E26 o E27 según el material comercial disponible. El resto del laboratorio se amplía después de validar el contrato.

## 15. Rúbrica, métricas y aceptación

### 15.1 Rúbrica de calidad

Nota por dimensión de 1 a 5; cinco es el mejor resultado. El score total solo se calcula con dimensiones medidas. Una dimensión genuinamente no aplicable se marca `not_applicable`, se justifica y sus pesos se excluyen del denominador. Si una dimensión necesaria no se pudo medir, se marca `not_measured` y la tarea queda sin score global; se conservan sus notas parciales. La ausencia de medición nunca se transforma en no aplicable para mejorar la nota.

| Dimensión | Peso | Pregunta principal |
|---|---|---|
| Comprensión | 15 % | ¿Entendió el objetivo y las restricciones? |
| Veracidad/fundamento | 20 % | ¿Datos, pruebas y estados están respaldados? |
| Cumplimiento | 15 % | ¿Entregó lo solicitado realmente? |
| Marketing/ventas | 10 % | ¿La audiencia, ángulo y acción tienen sentido comercial? |
| Redacción | 10 % | ¿Es natural, específica y consistente? |
| Presentación/usabilidad | 10 % | ¿Puedo entender, revisar y utilizar el resultado? |
| Uso de herramientas | 5 % | ¿Consultó/operó correctamente y evitó pasos innecesarios? |
| Continuidad/contexto | 10 % | ¿Conservó selección, oferta, versión y progreso? |
| Proactividad | 5 % | ¿Avanzó útilmente sin repetir avisos o cambiar el encargo? |

Anclas:

- **1:** incorrecto o inutilizable; exige rehacer el trabajo.
- **2:** fallo importante, trabajo incompleto o esfuerzo elevado para rescatarlo.
- **3:** útil con correcciones relevantes o pasos evitables.
- **4:** utilizable con ajustes menores.
- **5:** cumple el objetivo con claridad y poco esfuerzo adicional.

Registrar cada dimensión con justificación. «Lo enviaría» es una evaluación de calidad del texto, no una autorización de envío.

### 15.2 Métricas complementarias

| Grupo | Métricas |
|---|---|
| Tarea | Completada, parcial, bloqueada, fallida; entregables solicitados/entregados |
| Factual | Claims sin respaldo, entidad/período/scope incorrecto, estado falso |
| Escritura | Edit-ready, aperturas/CTAs repetidos, trato, fidelidad de prueba y esfuerzo de edición |
| Interacción | Turnos evitables, clics, retrocesos, aclaraciones necesarias e intervención |
| Tiempo | Cola, modelo, herramientas, primer estado útil y resultado visible final P50/P90 |
| Agentes | Invocación, omisión, aporte, correcciones, latencia y costo por rol |
| Recuperación | Recarga, reconexión, entrega, cancelación y reanudación correctas |
| Artefactos | Correctitud de datos, edición, render, descarga, accesibilidad y versión |
| Consumo | Tokens/calls/costo conocido, reservas, incompletos y costo total por tarea |
| Proactividad | Oportunidad, pertinencia, duplicados y aceptación de siguiente acción |

Cada porcentaje lleva denominador y capa de evidencia. Fallos, presupuesto agotado y mediciones ausentes permanecen visibles en el reporte.

### 15.3 Objetivos iniciales

Objetivos de aceptación propuestos, todavía no alcanzados por esta ronda:

- Al menos 85 % de tareas centrales soportadas con entregable utilizable y ajustes menores o nulos.
- Como máximo 10 % materialmente malas, sin ocultar errores críticos bajo el promedio.
- Cero acciones externas no autorizadas, envíos duplicados o falsamente confirmados en los casos evaluados.
- Consistencia de versión entre vista, copia, descarga y acción.
- Recuperación de selección/resultados después de recargar.
- Mejoras demostradas en tareas comerciales y casos nuevos, con costo/latencia registrados.
- Toda comprobación necesaria ejecutada o marcada no medida.
- Latencia separada por chat, escritura, artefacto y job largo; presupuestos finales ajustados a la línea base visible.

La pequeña muestra personal no demuestra estadísticamente desempeño general. Para la futura apertura se realizará un estudio con ejecutivos y se añadirá una meta de completitud sin ayuda, SEQ/SUS y comprensión de aprobación/estado/recuperación.

### 15.4 Comparación con productos de referencia

1. Seleccionar tareas que ambos productos pueden realizar.
2. Entregar el mismo brief y evidencia; registrar conectores/herramientas disponibles.
3. Comparar resultado, edición, pasos y tiempo con las diferencias de acceso explícitas.
4. Conservar artefactos completos y versiones, no solo un párrafo.
5. Usar el mismo rubricado y declarar autoría/evaluador.

Hasta obtener esos outputs no habrá un score «contra Claude/ChatGPT». La investigación de código inspira mecanismos; no mide el producto rival.

## 16. Presupuesto y control de consumo

### 16.1 Asignación de modelos

| Etapa | Máximo |
|---|---:|
| Piloto de medición y funcionamiento | US$1 |
| Línea base real | US$3 |
| Comparaciones de mejoras seleccionadas | US$4 |
| Confirmación final y casos nuevos | US$1 |
| Reserva para incertidumbre y recuperación | US$1 |
| **Total** | **US$10** |

La asignación puede redistribuirse con evidencia, manteniendo el techo. No se debe gastar todo por obligación.

### 16.2 Qué participa

Coordinador, Writer, Reviewer, Designer, especialistas, rescates, correcciones, compactaciones y generación de entregables invocados por la evaluación. Incluir caminos nativos cuando formen parte de la tarea. Una llamada fallida o con respuesta parcial también puede tener costo.

Las llamadas para un juez de pago quedan fuera de la propuesta inicial. La revisión se hace en este encargo. No usar Astra ni cambiar a otro modelo sin modificar expresamente el alcance autorizado.

### 16.3 Tope verificable

Antes de admitir una tarea nueva:

```text
costo registrado
  + reservas de llamadas en curso
  + reserva conservadora de consumos incompletos
  + máximo autorizado del siguiente trabajo
  <= US$10
```

- Fijar precio por modelo, modalidad, longitud y fecha; no inferir precio de una familia.
- Reservar antes de llamar considerando input y máximo de output razonable.
- Registrar uso total, cache, reasoning/output cuando el proveedor lo incluye y duración.
- Reconciliar al cerrar la llamada; no contar usage desconocida como costo cero.
- Medir pilotos secuenciales; paralelizar solo con reserva global compartida.
- Mantener listado explícito de runs del experimento para no atribuir uso ordinario del dueño.
- Reconciliar el gasto conocido con el proveedor cuando la información esté disponible.
- Si no se puede acotar una tarea nativa/recursiva, resolver ese control antes de lanzarla.

Los límites de llamadas existentes y un dashboard de gasto no equivalen a un hard cap de US$10. Los budgets de proveedor pueden ser avisos; el admission ledger del experimento debe impedir superar el techo.

### 16.4 Infraestructura y proveedores

US$10 cubre modelos de esta evaluación. Cloud, búsquedas, enriquecimiento, revelado de teléfono y otros servicios tienen asignación propia. Registrar esos cargos por separado y no justificarlos con promociones o precios orientativos.

## 17. Fases, entregables y backlog

### 17.1 Hoja de ruta

| Fase | Entregable | Dependencia | Cierre verificable |
|---|---|---|---|
| F0 · Preparación | Manifest, scope, sesión y control de costo | Acceso legítimo y configuración observable | Experimento puede comenzar sin ambigüedad de versión/costo |
| F1 · Línea base | 4 tareas piloto y 16–20 recorridos adaptados | F0 | Evidencia, notas y failure taxonomy por tarea |
| F2 · Fidelidad | Lista, versiones, tablas, exportación y móvil | Diagnóstico F1; bugs deterministas reproducidos | Lo visible coincide con lo utilizado |
| F3 · Contexto/calidad | Brief compartido, competencias y escritura | F1; contratos mínimos F2 | Mejora pareada y mantenida en casos nuevos |
| F4 · Continuidad | Task/result IDs, dependencias, recibos y entregas | F1–F2 | Recarga/continuación y recuperación correctas |
| F5 · Cloud base | Endurecimiento + jobs + workspace/asset manifests | F4; asignación cloud | Job admisible, consultable, cancelable y recuperable |
| F6 · Pilotos cloud | Informe completo y miniapp comercial | F3/F5; toolchain/preview | Datos y render comprobados; entregable editable |
| F7 · Integración | Artefacto → selección → contenido → entidad nativa | F2/F4/F6 | Trabajo sin reconstruir nombres/versiones |
| F8 · Confirmación | Comparación final, límites y backlog | Mejoras candidatas | Gates, presupuesto y evidencia completos |
| F9 · Equipos | Piloto de GrupoExpro/PSOL | Validación personal y decisión de apertura | Contexto, permisos y usabilidad propios de equipos |

La secuencia tiene dependencias; algunas tareas deterministas de F2 pueden avanzar mientras se completa la línea base, conservando un snapshot de la versión anterior. No se ejecutan rondas grandes ni se rediseña toda la interfaz antes de conocer los fallos dominantes.

### 17.2 Backlog implementable

| Ticket | Acción | Superficies candidatas | Evidencia de aceptación |
|---|---|---|---|
| CW-01 | Manifest/censo de evaluación | Evaluator, runner, blind-read | Caso elegido siempre termina registrado: evaluado/fallido/bloqueado/no medido |
| CW-02 | Congelar evidencia y precio | Harness y model-usage | Rejuzgar conserva exactamente el mismo contexto |
| CW-03 | Alinear límites de contactos | Lead-export, lead-tools, contact-list, ContactResults, file-exports | Casos frontera de filas y exportación |
| CW-04 | Unificar versión efectiva | CoworkBlocks, export, campañas y handoff | Editar → preview/Copy/download/acción iguales |
| CW-05 | Conservar tablas y completitud | Answer-quality, contracts, presentation | Tablas distintas y overflow recuperables |
| CW-06 | Corregir panel móvil y errores | Workspace, ArtifactPanel, ExportMenu | Focus/handoff/error visibles en 390 px |
| CW-07 | Brief compartido | Writer y pipelines nativos de redacción/respuesta | Oferta/prueba/voz consistentes |
| CW-08 | Alinear schema de Writer | Writer, contracts y UI | Edición simple admite salida sin pregunta comercial forzada |
| CW-09 | Evidencia y agregación tipadas | Read-capabilities, artifact-data, metric-reads | Entidad/período/scope y cálculos correctos |
| CW-10 | IDs y recibos de resultados | Presentation, approvals, events | Dos títulos iguales no cruzan outcomes |
| CW-11 | TaskGraph y entregas | Task-state, worker, continuations | Progreso por entregable y resultado durable |
| CW-12 | Preguntar sin descartar/cola | Admission y Workspace/Composer | No pérdida silenciosa de propuesta o mensaje |
| CW-13 | Preservar éxitos parciales | Parallel-reads, loop y rescue | Una lectura fallida no borra hallazgos de otra |
| CW-14 | Medir routing de especialistas | Specialist-queue, worker, telemetry | Aporte/skip/costo por rol y decisión basada en comparación |
| CW-15 | Endurecer executor | Executor runner/store, code-runner, effects | Cleanup/quotas, inputs inmutables, fencing y promoción coherente |
| CW-16 | Jobs y BuildProvider | Servicios nuevos mínimos + executor | Reconexión consulta el mismo job y cancela ejecución |
| CW-17 | Workspace/toolchain/preview | Storage, imágenes y host separado | Revisión/recuperación y preview privado |
| CW-18 | Entregar informe y miniapp | Constructor y verificadores | E25/E26 o E27 aprobados con evidencia |
| CW-19 | Enlazar entregable a app | Entity refs y acciones nativas | Selección y versión exactas hasta campaña pausada |
| CW-20 | Proactividad por evento | Agenda/research notices/task events | Aviso útil, una vez y sobre trabajo recuperable |

Cada ticket se divide si requiere contrato, servidor, UI y migración diferentes. Las tablas futuras de jobs/assets/tareas son propuestas; antes de crear una revisar si eventos/operaciones actuales resuelven el incremento.

### 17.3 Entregables documentales de ejecución

1. Inventario efectivo de capacidades y runtime.
2. Manifest y corpus congelado del experimento.
3. Reporte de línea base con evidencia por escenario.
4. Taxonomía de fallos y prioridades confirmadas.
5. ADR de estado/resultados y ADR del cloud.
6. Comparación por cambio candidato y razones de descarte.
7. Auditoría renderizada y de interacción de las superficies tocadas.
8. Reporte final de calidad, completitud, tiempo y costo.
9. Ledger privado de objetos creados y disposición de evidencia.
10. Guía de continuidad y siguiente fase para equipos.

### 17.4 Medida de tamaño

Las correcciones de fidelidad son pequeñas/medias y se entregan separadas. TaskGraph, protocolo de jobs y workspace son medianos/grandes con dependencias. Pilotos cloud se limitan a dos tipos de entregable. No se fija un calendario cerrado antes del piloto y la confirmación del proveedor.

## 18. Preparación para GrupoExpro y PSOL

### 18.1 Ahora

El acceso sigue siendo personal. Los contratos incluyen user/organization/project para evitar convertir el piloto en una base compartida sin scope.

### 18.2 Antes de abrir a ejecutivos

- Catálogo de servicios, segmentos, pruebas y materiales aprobados de cada equipo.
- Preferencias personales separadas de reglas compartidas.
- Remitente y canal disponibles para cada persona.
- Memorias y resultados compartidos solo de forma deliberada.
- Responsabilidad comercial por contacto/cuenta y relación previa visibles.
- Límites de gasto, jobs y retención por usuario/equipo.
- Autorización por capacidades, no un simple retiro del gate del dueño.
- Verificación de aislamiento de datos, outputs y previews.
- Onboarding contextual y entrada de trabajo pendiente.

### 18.3 Validación humana futura

Primera ronda con 5–8 ejecutivos, nuevos y habituales, usando datos de demostración y flujos preparados. Medir completitud sin ayuda, tiempo activo/espera, retrocesos, SEQ por tarea, SUS final y comprensión de qué se guardó, qué se enviará y cómo retomar.

La apertura requiere una decisión de producto y permisos. No compartir las credenciales del dueño ni considerar una prueba supervisada en su cuenta una validación multiusuario.

Métricas comerciales futuras: conversaciones calificadas, respuestas positivas atendidas, reuniones confirmadas y compromisos fechados. Volumen y tasas de ventana son apoyo; una muestra pequeña no demuestra aumento causal de ventas.

## 19. Ejecución, integración y decisiones pendientes

### 19.1 Ciclo de cambio

```text
fallo o necesidad observada
  → hipótesis y caso reproducible
  → cambio pequeño
  → comprobaciones proporcionales
  → evaluación antes/después
  → PR desde main
  → revisión y CI
  → integración canónica
  → deploy del mantenedor y aceptación dirigida
```

Respetar ramas `feat/*` o `claude/*`, un tema por PR, sin push directo a main. No mezclar cambios locales antiguos ni worktrees históricos en nuevos trabajos.

Las pruebas de app pertinentes incluyen typecheck, unit y build según las reglas del proyecto. No repetir suites ya aprobadas si el cambio posterior no afecta su superficie. Los cambios puramente documentales no necesitan llamadas a modelo ni suites de producción.

Para producción, revisar SQL y validaciones proporcionales antes de cualquier escritura autorizada; una migración pequeña y forward-only por vez, con verificación inmediata. No usar entornos locales/Docker como gate obligatorio de toda la app. El aislamiento Docker/microVM sí es parte de la decisión técnica específica del executor cuando corresponda.

Deploy y rollback: main integrado, revisión servida comprobada, tag de producción y smokes del repo. Revertir el cambio y redeploy para rollback; no presentar un flag como rollback de una migración irreversible.

### 19.2 Decisiones aún necesarias

| Decisión | Momento |
|---|---|
| Sesión legítima disponible para la aceptación | F0 |
| Datos existentes/archivos demo y material comercial del piloto | F0 |
| Setup de nuevas entidades de demostración, si se necesita | Antes de escribirlas |
| Precio efectivo y control global de llamadas | Antes de gastar |
| Presupuesto y proveedor cloud | Antes de provisionar |
| Región, retención y vida de previews | ADR cloud |
| Primer miniapp: landing o calculadora | Antes de F6, según material disponible |
| Caso externo de correo/LinkedIn, si se evalúa | Antes del efecto controlado |
| Apertura a GrupoExpro/PSOL y responsables de catálogo | F9 |

### 19.3 Siguiente acción ejecutable

Comenzar F0 con revisión del runtime y colas, sesión del dueño, evidencia/costo y cuatro tareas piloto. Cerrar la línea base antes de atribuir mejoras. Resolver los bugs deterministas de fidelidad con casos frontera y conservar la base. Preparar el ADR cloud con un informe y una miniapp como criterios de éxito.

## 20. Referencias internas y externas

### 20.1 Fuentes internas

- [Reglas del proyecto](../../AGENTS.md).
- [Sistema visual](../ui-ux/visual-system.md), [referencias](../ui-ux/reference-workflow.md) y [auditoría](../ui-ux/release-audit-checklist.md).
- [Experiencia Cowork](../cowork-experiencia-claude-2026-09-24.md).
- [Evaluación de conversaciones reales](../cowork-evaluacion-conversaciones-2026-09-25.md).
- [Banco AXIS](../cowork-banco-axis.md).
- [Plan 12](../cowork-plan12-final.md), [Plan 13](../cowork-plan13-final.md), [Plan 15](../plan15-final.md) y [Plan 16](../plan16-final.md).
- [Lectura ciega](../cowork-lectura-ciega.md).
- [Trato y preguntas de correos](../cowork-correos-trato.md), [saludo de Revisora](../cowork-revisora-saludo.md), [oferta una vez](../cowork-oferta-una-vez.md) y [cautelas](../cowork-sin-cautelas.md).
- [ADR executor remoto](../cowork-adr-004-remote-executor.md), [artefactos](../cowork-artefactos-codigo.md) y [aceptación autenticada](../cowork-authenticated-acceptance-checklist.md).
- [Worker](../../src/lib/server/cowork/worker.ts), [bucle](../../src/lib/cowork/agent-loop.ts), [Writer](../../src/lib/cowork/writer.ts) y [especialistas](../../src/lib/server/cowork/specialist-queue.ts).
- [Workspace UI](../../src/components/cowork/CoworkWorkspace.tsx), [bloques](../../src/components/cowork/CoworkBlocks.tsx), [presentación](../../src/lib/cowork/presentation.ts) y [exportación de leads](../../src/lib/cowork/lead-export.ts).
- [Code runner](../../src/lib/server/cowork/code-runner.ts), [executor](../../executor/lib/runner.mjs) y [consumo](../../src/lib/server/cowork/model-usage.ts).
- [Evaluator](../../scripts/evaluate-cowork-conversations.ts), [runner del corpus](../../scripts/fixtures/cowork-conversation-runner.ts) y [helper ciego](../../scripts/cowork-blind-read.ts).

Los documentos históricos se interpretan con su fecha/commit. El manifiesto y código efectivo prevalecen para inventariar el estado actual.

### 20.2 Evidencia de código externo fijada

#### AionUi / AionCore

- [HTTP/WS y sesión](https://github.com/iOfficeAI/AionUi/blob/6744099b279b991c17e31c243f0920477bd31cb6/packages/desktop/src/common/adapter/httpBridge.ts).
- [Preparación del backend](https://github.com/iOfficeAI/AionUi/blob/6744099b279b991c17e31c243f0920477bd31cb6/packages/shared-scripts/src/prepare-aioncore.js).
- [Feed de equipo](https://github.com/iOfficeAI/AionUi/blob/6744099b279b991c17e31c243f0920477bd31cb6/packages/desktop/src/renderer/pages/team/activity/useTeamActivityFeed.ts).
- [Artefactos de conversación](https://github.com/iOfficeAI/AionUi/blob/6744099b279b991c17e31c243f0920477bd31cb6/packages/desktop/src/renderer/pages/conversation/Messages/artifacts.tsx).
- [Tablero y dependencias](https://github.com/iOfficeAI/AionCore/blob/47e66d0d151123e973b3fd1e77afcb5671b3f8c5/crates/aionui-team/src/task_board.rs).
- [Mailbox](https://github.com/iOfficeAI/AionCore/blob/47e66d0d151123e973b3fd1e77afcb5671b3f8c5/crates/aionui-team/src/mailbox.rs).
- [Coordinador de trabajo](https://github.com/iOfficeAI/AionCore/blob/47e66d0d151123e973b3fd1e77afcb5671b3f8c5/crates/aionui-team/src/work_coordinator/coordinator.rs).
- [Resumen para despertar agente](https://github.com/iOfficeAI/AionCore/blob/47e66d0d151123e973b3fd1e77afcb5671b3f8c5/crates/aionui-team/src/prompts/wake_summary.rs).

#### Eigent

- [Workforce restringido](https://github.com/eigent-ai/eigent/blob/22145daa8b546494636d8e57822d866b547e929b/backend/app/agent/factory/managed_workforce.py).
- [Ciclo de ejecución](https://github.com/eigent-ai/eigent/blob/22145daa8b546494636d8e57822d866b547e929b/backend/app/workspace_runtime/workforce_adapter.py).
- [Continuación y admisión](https://github.com/eigent-ai/eigent/blob/22145daa8b546494636d8e57822d866b547e929b/backend/app/controller/chat_controller.py).
- [Checkpoints de tools](https://github.com/eigent-ai/eigent/blob/22145daa8b546494636d8e57822d866b547e929b/backend/app/run_runtime/tool_checkpoint.py).
- [Finalización inmutable](https://github.com/eigent-ai/eigent/blob/22145daa8b546494636d8e57822d866b547e929b/backend/app/workspace_runtime/finalizer.py).
- [Artefactos](https://github.com/eigent-ai/eigent/blob/22145daa8b546494636d8e57822d866b547e929b/backend/app/artifacts.py).
- [Skills](https://github.com/eigent-ai/eigent/blob/22145daa8b546494636d8e57822d866b547e929b/backend/app/agent/toolkit/skill_toolkit.py).

#### OpenCowork

- [Runner](https://github.com/OpenCoworkAI/open-cowork/blob/910467306e950c249c448e6589051d4865d371b7/src/main/agent/agent-runner.ts).
- [Subagentes](https://github.com/OpenCoworkAI/open-cowork/blob/910467306e950c249c448e6589051d4865d371b7/src/main/agent/subagent-extension.ts).
- [Guard de loops](https://github.com/OpenCoworkAI/open-cowork/blob/910467306e950c249c448e6589051d4865d371b7/src/main/agent/agent-runner-loop-guard.ts).
- [Compactación](https://github.com/OpenCoworkAI/open-cowork/blob/910467306e950c249c448e6589051d4865d371b7/src/main/agent/compaction-extension.ts).
- [Scheduler](https://github.com/OpenCoworkAI/open-cowork/blob/910467306e950c249c448e6589051d4865d371b7/src/main/schedule/scheduled-task-manager.ts).
- [Comprobación de cambios](https://github.com/OpenCoworkAI/open-cowork/blob/910467306e950c249c448e6589051d4865d371b7/src/main/schedule/local-condition-checker.ts).
- [Adaptador de sandbox](https://github.com/OpenCoworkAI/open-cowork/blob/910467306e950c249c448e6589051d4865d371b7/src/main/sandbox/sandbox-adapter.ts).

#### OpenWork

- [Contrato de proveedor](https://github.com/different-ai/openwork/blob/13f038d67322b634d248079d7e552190503c0397/packages/sandbox/src/provider.ts).
- [Ciclo de vida](https://github.com/different-ai/openwork/blob/13f038d67322b634d248079d7e552190503c0397/packages/sandbox/src/lifecycle.ts).
- [Adaptador Daytona](https://github.com/different-ai/openwork/blob/13f038d67322b634d248079d7e552190503c0397/packages/sandbox-daytona/src/daytona-provider.ts).
- [Conformidad](https://github.com/different-ai/openwork/blob/13f038d67322b634d248079d7e552190503c0397/packages/sandbox/src/testing/conformance.ts).
- [Panel de artefacto](https://github.com/different-ai/openwork/blob/13f038d67322b634d248079d7e552190503c0397/apps/app/src/react-app/domains/session/artifacts/artifact-panel.tsx).
- [Admisión de mensajes en cola](https://github.com/different-ai/openwork/blob/13f038d67322b634d248079d7e552190503c0397/apps/app/src/react-app/domains/session/surface/queued-drain-machine.ts).
- [Licencia raíz](https://github.com/different-ai/openwork/blob/13f038d67322b634d248079d7e552190503c0397/LICENSE) y [EE](https://github.com/different-ai/openwork/blob/13f038d67322b634d248079d7e552190503c0397/ee/LICENSE).

#### LibreChat

- [Carga lazy de especialistas](https://github.com/LibreChat-AI/LibreChat/blob/e1dfc10449ff713faffacd60273fddcfe2c0a698/packages/api/src/agents/lazySubagents.ts).
- [Entrega automática de resultado](https://github.com/LibreChat-AI/LibreChat/blob/e1dfc10449ff713faffacd60273fddcfe2c0a698/packages/api/src/agents/backgroundCompletionWakeup.ts).
- [Registro de threads hijos](https://github.com/LibreChat-AI/LibreChat/blob/e1dfc10449ff713faffacd60273fddcfe2c0a698/api/server/services/Endpoints/agents/subagentThreadStore.js).
- [Routing de controles](https://github.com/LibreChat-AI/LibreChat/blob/e1dfc10449ff713faffacd60273fddcfe2c0a698/packages/api/src/agents/subagentTaskRouting.ts).
- [Checkpoints por owner](https://github.com/LibreChat-AI/LibreChat/blob/e1dfc10449ff713faffacd60273fddcfe2c0a698/packages/api/src/agents/checkpoints/saver.ts).
- [Workspace tools](https://github.com/LibreChat-AI/LibreChat/blob/e1dfc10449ff713faffacd60273fddcfe2c0a698/packages/api/src/code/workspace.ts) y [requests durables](https://github.com/LibreChat-AI/LibreChat/blob/e1dfc10449ff713faffacd60273fddcfe2c0a698/packages/api/src/code/requests.ts).
- [Panel de tareas hijas](https://github.com/LibreChat-AI/LibreChat/blob/e1dfc10449ff713faffacd60273fddcfe2c0a698/client/src/components/Chat/Subagents/SubagentThreadPanel.tsx).

#### Suna / Kortix

- [Contrato cloud](https://github.com/kortix-ai/suna/blob/f19fe4e931009eba36b8560864cb1aa567b81aca/apps/api/src/platform/providers/contract.ts).
- [Adaptador E2B](https://github.com/kortix-ai/suna/blob/f19fe4e931009eba36b8560864cb1aa567b81aca/apps/api/src/platform/providers/e2b.ts).
- [Política de duración](https://github.com/kortix-ai/suna/blob/f19fe4e931009eba36b8560864cb1aa567b81aca/apps/api/src/projects/sandbox-deadline-policy.ts).
- [Derivación de outputs/contexto](https://github.com/kortix-ai/suna/blob/f19fe4e931009eba36b8560864cb1aa567b81aca/apps/web/src/features/session/action-panel/shared/derive-panels.ts).
- [Prioridad de entregable](https://github.com/kortix-ai/suna/blob/f19fe4e931009eba36b8560864cb1aa567b81aca/apps/web/src/features/session/action-panel/shared/output-priority.ts).
- [Tool show](https://github.com/kortix-ai/suna/blob/f19fe4e931009eba36b8560864cb1aa567b81aca/apps/kortix-sandbox-agent-server/src/services/tools/kortix/show.ts).
- [Servidor de preview estático](https://github.com/kortix-ai/suna/blob/f19fe4e931009eba36b8560864cb1aa567b81aca/apps/kortix-sandbox-agent-server/src/services/static-web/static-web.ts).
- [Licencia](https://github.com/kortix-ai/suna/blob/f19fe4e931009eba36b8560864cb1aa567b81aca/LICENSE).

#### Agenta

- [Processor](https://github.com/Agenta-AI/agenta/blob/4bc51903a1597d3ef8f1ac17f2d6f472ba7c8137/sdks/python/agenta/sdk/evaluations/runtime/processor.py).
- [Planner](https://github.com/Agenta-AI/agenta/blob/4bc51903a1597d3ef8f1ac17f2d6f472ba7c8137/sdks/python/agenta/sdk/evaluations/runtime/planner.py).
- [Topologías](https://github.com/Agenta-AI/agenta/blob/4bc51903a1597d3ef8f1ac17f2d6f472ba7c8137/sdks/python/agenta/sdk/evaluations/runtime/topology.py).
- [Fuentes de evaluación](https://github.com/Agenta-AI/agenta/blob/4bc51903a1597d3ef8f1ac17f2d6f472ba7c8137/api/oss/src/core/evaluations/runtime/sources.py).
- [Anotaciones](https://github.com/Agenta-AI/agenta/blob/4bc51903a1597d3ef8f1ac17f2d6f472ba7c8137/api/oss/src/core/annotations/service.py).
- [Trazas a cola](https://github.com/Agenta-AI/agenta/blob/4bc51903a1597d3ef8f1ac17f2d6f472ba7c8137/web/packages/agenta-entities/src/simpleQueue/etl/addMatchingTracesToQueue.ts).
- [Comparación de runs](https://github.com/Agenta-AI/agenta/blob/4bc51903a1597d3ef8f1ac17f2d6f472ba7c8137/web/oss/src/components/EvalRunDetails/atoms/compare.ts).
- [Despliegue OSS](https://github.com/Agenta-AI/agenta/blob/4bc51903a1597d3ef8f1ac17f2d6f472ba7c8137/hosting/docker-compose/oss/docker-compose.gh.yml).
- [Licencia raíz](https://github.com/Agenta-AI/agenta/blob/4bc51903a1597d3ef8f1ac17f2d6f472ba7c8137/LICENSE) y [EE](https://github.com/Agenta-AI/agenta/blob/4bc51903a1597d3ef8f1ac17f2d6f472ba7c8137/api/ee/LICENSE).

### 20.3 Referencias de producto y costos

- [Claude Cowork](https://claude.com/product/cowork): objetivos, tareas continuas y entregables para revisión.
- [ChatGPT Canvas](https://openai.com/index/introducing-canvas/): referencia histórica de edición localizada y versiones; no usar su artículo de lanzamiento como catálogo actual.
- [ChatGPT Workspace Agents](https://openai.com/business/workspace-agents/): trabajo recurrente y capacidades por equipo.
- [assistant-ui](https://github.com/assistant-ui/assistant-ui): componentes de interacción y resultados de herramientas; referencia de biblioteca, no decisión de instalación.
- [LobeHub](https://github.com/lobehub/lobehub): referencia de proyectos/memoria; no se realizó la misma auditoría profunda que a los siete repositorios del encargo.
- [LangGraph persistence](https://docs.langchain.com/oss/javascript/langgraph/checkpointers): checkpoints, pendientes e interrupciones.
- [Competencias de marketing de Anthropic](https://github.com/anthropics/knowledge-work-plugins/tree/main/marketing): estructura de briefs/voz/secuencias; adaptar sin importar claims o benchmarks como hechos.
- [Apollo sales engagement](https://www.apollo.io/product/sales-engagement): datos, criterio y siguiente acción comercial.
- [Twenty](https://github.com/twentyhq/twenty) y [Mautic](https://github.com/mautic/mautic): referencias funcionales de CRM/campañas; cobertura preliminar.
- [Figcomponents](https://www.figcomponents.com/) y [ScreensDesign](https://screensdesign.com/): referencias de componentes y flujos; no copiar assets ni branding.
- [GPT-6-luna](https://developers.openai.com/api/docs/models/gpt-6-luna), [E2B pricing](https://e2b.dev/pricing) y [Daytona pricing](https://www.daytona.io/pricing): consultar nuevamente antes de ejecutar/provisionar.

## 21. Plantillas operativas

### 21.1 Manifest de experimento

```yaml
experiment: cowork-integral-20261009
status: planned
baseCommit: <sha congelado>
candidateCommit: <sha o ninguno>
deploymentRevision: <revision observada>
model: gpt-6-luna
effortByRole: <valores efectivos>
runtimeFlags: <snapshot sin secretos>
corpusVersion: <hash>
promptVersions: <hashes>
rubricVersion: cowork-integral-v1
evaluator: asistente-responsable
modelBudgetUsd: 10
cloudBudgetUsd: <asignacion pendiente>
caseIds: <lista explicita>
authorizedEffects: <alcance por caso>
evidenceLocation: <ubicacion privada>
consumption: <conocido + reservas + incompleto>
```

### 21.2 Ficha por tarea

```text
ID / variante / repetición:
Versión y configuración:
Solicitud y resultado esperado:
Datos, scope, período y estado inicial:
Efectos autorizados:
Run / root / task / job / result refs:
Respuesta, botones y artefactos visibles:
Herramientas y evidencia realmente consultadas:
Resultado nativo y entrega final:
Checks: passed / failed / not_measured:
Notas por dimensión y justificación:
Clasificación: usable / mejorable / mala / bloqueada:
Tiempo activo, cola, modelo, herramienta y visible:
Consumo registrado, reservado e incompleto:
Fallo raíz y ticket:
Objetos creados y retención/limpieza:
```

### 21.3 Ficha de mejora

```text
Ticket y superficie:
Problema y evidencia:
Hipótesis:
Base y candidato:
Cambio mínimo:
Dependencias:
Casos de comparación y casos nuevos:
Efecto esperado en calidad, completitud, tiempo y costo:
Resultado y trade-offs:
Decisión: integrar / ajustar / descartar / falta evidencia:
Verificación, PR y despliegue:
```

### 21.4 Cierre del programa

- [ ] Runtime, corpus, evidencia y consumo congelados.
- [ ] Línea base autenticada completada o bloqueos explícitos.
- [ ] Hallazgos de fidelidad reproducidos y corregidos donde corresponde.
- [ ] Mejoras comerciales evaluadas antes/después y con casos nuevos.
- [ ] Routing de agentes y workers medido.
- [ ] Estado de tarea y entrega recuperables.
- [ ] Piloto cloud con asignación propia, contrato y comprobaciones completos.
- [ ] Informe y miniapp utilizables, editables y descargables.
- [ ] Resultados integrados con entidades/versiones de la app.
- [ ] Responsive, temas, foco, carga, vacío y errores revisados en superficies tocadas.
- [ ] Costo de modelos dentro de US$10, incluidos consumos pendientes.
- [ ] No medido y fuera de alcance conservados en el reporte.
- [ ] Comparación final y backlog pendiente entregados.
- [ ] Próxima apertura a GrupoExpro/PSOL definida con evidencia y permisos propios.

**Resultado buscado:** Cowork se siente más capaz porque el usuario puede entender, confiar, modificar y utilizar el trabajo que entrega, y continuar desde él hasta completar su objetivo.
