# ANTON.IA Cowork — Plan de desarrollo integral

Fecha: 15 de septiembre de 2026.
Estado: propuesta de implementación; no acredita funcionalidades implementadas ni restricciones desplegadas.
Usuario exclusivo: **nicolas.yarur.g@yago.cl**.
Ruta propuesta: `/cowork`.

## 1. Objetivo y definición de terminado

Construir una forma de operar ANTON.IA desde una conversación: entender objetivos, consultar y modificar la app, coordinar especialistas, investigar, ejecutar código y entregar archivos e interfaces interactivas que el usuario pueda seguir editando por chat.

La funcionalidad estará completa cuando:

1. Las operaciones de producto inventariadas estén disponibles desde el chat con los mismos permisos y reglas que sus pantallas.
2. El agente pueda adaptar su plan a resultados y correcciones del usuario.
3. Los trabajos continúen sin una pestaña abierta y se recuperen sin duplicar efectos.
4. Existan modo Autónomo y modo Con aprobaciones efectivos.
5. Se puedan construir, ejecutar, verificar, versionar y descargar artefactos y código.
6. Los recorridos y objetivos de calidad de este documento superen las pruebas de aceptación.
7. Solo el usuario autorizado pueda acceder a Cowork y sus recursos, incluso mediante peticiones directas.

La inspiración es Claude Cowork y OpenCode. No se promete paridad indefinida con todos los formatos, integraciones o futuras capacidades de otros productos. El alcance se mide con el inventario versionado de capacidades y los formatos definidos aquí.

## 2. Decisiones de producto

- Crear experiencia y runtime nuevos; aprovechar servicios y patrones de SUPL.IA después de validarlos.
- Compartir lógica de negocio con las pantallas existentes; no crear un segundo CRM ni un segundo motor de envíos.
- Priorizar tareas terminadas y resultados comprobados sobre cantidad de llamadas o workers.
- Permitir solicitudes generales: analizar archivos, construir herramientas, preparar documentos y operar la app.
- Mantener chat, resultados y progreso en un único espacio adaptable.
- Mantener acceso exclusivo durante todas las fases, incluida la versión completa. Ampliarlo requiere una decisión posterior explícita.
- No habilitar compartir públicamente artefactos ni compartirlos con otros miembros durante este alcance exclusivo.

## 3. Acceso exclusivo: requisito P0

### 3.1 Identidad y autorización

Implementar una función server-only común, por ejemplo `requireCoworkAccess`, que:

1. Valide la sesión con el mecanismo de autenticación servidor existente.
2. Obtenga la identidad desde Auth, no desde el body, cabeceras proporcionadas por el cliente ni metadata editable por el usuario.
3. Exija el email verificado exacto, normalizado con trim y minúsculas: `nicolas.yarur.g@yago.cl`.
4. Exija además el UUID de Auth aprobado para esa cuenta, configurado en servidor después de resolverlo y verificarlo. No inventar ni vincular automáticamente un UUID recibido del cliente.
5. Compruebe el interruptor servidor `COWORK_ENABLED` y el estado vigente de acceso.
6. Deniegue por defecto si falta configuración o falla la comprobación.

No conceder acceso por rol owner/admin, pertenencia a la organización, dominio `yago.cl` ni coincidencia parcial del email. Cambiar email o recrear la cuenta no debe transferir acceso automáticamente a otro UUID.

El acceso a Cowork no amplía el acceso del usuario a los datos de ANTON.IA. Cada operación conserva el alcance de organización y las reglas de propiedad del servicio original. Un cambio de organización exige volver a validar y evita mezclar contexto entre organizaciones.

### 3.2 Superficies que deben aplicar la restricción

| Superficie | Control requerido |
|---|---|
| Menú y página | Mostrar entrada solo al autorizado; verificar página en servidor; respuesta 404 para página no disponible |
| APIs y acciones servidor | Guardia común en cada lectura y escritura; 401 sin sesión, 403 sin acceso |
| SSE, polling y reanudación | Verificar identidad, propiedad del trabajo y alcance; cerrar al revocar acceso |
| Conversaciones, memoria y eventos | RLS y relaciones que impidan leer o insertar recursos de otro propietario |
| Archivos y versiones | Bucket privado; resolver descarga en servidor después de autorizar |
| Preview y sandbox | Acceso autenticado o credencial efímera vinculada a recurso, usuario y ejecución |
| Workers y cron | Autenticación de servicio y validación del propietario autorizado antes de cada efecto |
| Logs y errores | No entregar contenido, IDs utilizables ni credenciales a usuarios no autorizados |

Para archivos, preferir descarga autenticada mediante proxy. Si una integración necesita URLs firmadas, TTL propuesto máximo de 60 segundos y documentar su ventana residual: una URL bearer copiada puede funcionar hasta caducar. No describirlas como revocación instantánea.

RLS debe usar el UUID autorizado y políticas de acceso vigentes controladas por servidor. Evitar basarse únicamente en claims de email que puedan quedar obsoletos. El cliente nunca escribe el registro de autorización. Revisar también permisos de Storage y Realtime si se utilizan.

El uso de `service_role` no sustituye la autorización: los workers deben reconstruir el contexto de usuario y organización y validarlo explícitamente.

### 3.3 Revocación y pruebas

- Interruptor global para detener admisión y nuevas acciones; comprobarlo al iniciar cada herramienta con efectos.
- Cancelación cooperativa de trabajos y terminación del sandbox cuando corresponda.
- Las acciones ya aceptadas por un proveedor pueden finalizar; conciliarlas y mostrar su estado real.
- Objetivo propuesto: revocación de nuevos efectos en menos de 60 segundos, incluyendo expiración de cachés de autorización.
- Casos obligatorios: sin sesión, otro usuario, admin ajeno, mismo dominio, email falsificado, UUID incorrecto, email no verificado, acceso por ID ajeno, JWT vencido, cambio de organización y revocación durante un trabajo.
- Resultado exigido: cero accesos indebidos en la matriz de pruebas y ninguna operación posterior a la revocación fuera de la ventana documentada.

## 4. Cobertura de toda la app

Crear `docs/cowork-capability-inventory.md` en la fase inicial. Una fila por operación, no por endpoint.

Campos: ID estable, dominio, intención de usuario, servicio actual, entrada/salida, permisos, efectos, costo, idempotencia, estado asíncrono, verificación posterior, prueba asociada, versión y estado de implementación.

| Dominio | Cobertura esperada |
|---|---|
| Perfil y oferta | Consultar/editar identidad comercial, productos, servicios, firma y preferencias |
| Prospección | Buscar empresas/personas, búsquedas guardadas, segmentación y priorización |
| Contactos | Guardar, importar, enriquecer, deduplicar, consultar y actualizar datos |
| Investigación | Solicitar, seguir, recuperar, comparar y actualizar reportes y fuentes |
| Sheet | Consultar, transformar y exportar datos; persistir cambios permitidos |
| CRM | Etapas, notas, responsables, próximas acciones e historial |
| Correo y respuestas | Borradores, remitente, envío y gestión de hilos según integración disponible |
| Campañas y secuencias | Crear, editar, preparar, activar, pausar, seguir y analizar |
| Agente ANTON.IA | Consultar y operar misiones y controles soportados |
| Planificación | Tareas, compromisos y seguimientos disponibles |
| Analítica | Períodos explícitos, métricas, comparaciones y registros de origen |
| Organización y ajustes | Operaciones que permita el rol actual; conexiones y estilos |
| Privacidad y preferencias de contacto | Consultas y acciones disponibles conservando reglas existentes |
| Trabajo general | Archivos, análisis, código, documentos y aplicaciones generadas |

Los callbacks OAuth, webhooks y cron son infraestructura, no herramientas de usuario. Las conexiones que exijan interacción con Google/Microsoft deben abrir un paso autenticado y retomar después el trabajo.

Identificar capacidades dependientes de flags o proveedor: no anunciar como disponible una operación deshabilitada. Cada operación faltante debe quedar como backlog explícito, no como respuesta simulada.

## 5. Experiencia visual y funcional

Referencia primaria: las cinco capturas proporcionadas por el usuario. Se rescatan composición, espacios, seguimiento lateral, tarjetas compactas de resultados y apertura de artefacto junto al chat. Se conserva identidad ANTON.IA; no copiar logos, assets ni tipografías propietarias.

### Estados del workspace

1. **Inicio:** saludo breve, composer centrado, trabajos activos y recientes en filas. Sin dashboard de métricas ornamental.
2. **Conversación:** historial colapsable; lectura central; panel de Progreso, Resultados y Contexto.
3. **Artefacto abierto:** chat al 35–45% y resultado al 55–65% como punto de partida, separador ajustable; el artefacto ocupa el lugar del seguimiento.
4. **Resultado maximizado:** volver al chat conserva scroll, selección y borrador.
5. **Móvil:** conversación/resultado como vistas alternables, sin comprimir tres columnas.

### Componentes y comportamiento

- Mensajes del asistente sobre el fondo; mensajes del usuario contenidos.
- Actividad compacta expandible derivada de eventos reales, con fuentes y resultados.
- Composer persistente: adjuntar, añadir entidades/contexto, modo de autonomía y enviar/detener.
- Controles específicos por formato: editar, filtrar, seleccionar, versiones, descargar, vista/código.
- Preguntas solo cuando la decisión afecte significativamente el objetivo o falte un dato indispensable.
- Mensajes durante ejecución: permitir redirigir o encolar; mostrar cuál se aplicará al trabajo activo.
- Carga, vacío real, error, desconexión, resultado parcial y cancelación diferenciados.
- Dark/light equivalentes; teclado, foco visible, reduced motion y contraste WCAG AA.
- No mostrar controles decorativos sin implementación: voz, carpetas o plugins requieren capacidad real.

## 6. Arquitectura propuesta

```text
Workspace Next.js
  -> API autenticada + eventos recuperables
  -> Servicio persistente de trabajos
       -> Coordinador y workers expertos
       -> Gateway de capacidades ANTON.IA
            -> Servicios compartidos -> Supabase / proveedores
       -> Sandbox Python/Node -> archivos y previews
  -> Almacén privado de artefactos, versiones y eventos
```

El stream HTTP no mantiene vivo el trabajo. La cola, checkpoints y workers deben continuar independientemente de la pestaña y de la vida de una petición Next.js.

### Bucle del agente

Entender -> recuperar contexto -> descubrir herramientas relevantes -> planificar -> ejecutar/delegar -> observar -> verificar -> ajustar/preguntar/terminar.

- Descubrimiento progresivo de herramientas para no inyectar todo el catálogo en cada llamada.
- Contratos tipados con validación de entrada y salida.
- Resultado de herramienta con estado, IDs, referencias, costo, error recuperable y siguiente consulta si es asíncrona.
- Idempotencia por operación con efectos; conciliación de resultados inciertos antes de reintentar.
- El agente anuncia éxito a partir de evidencia del servicio, no de su intención.

### Workers

Coordinador, operador de la app, prospector, investigador, analista, redactor, constructor y verificador. Cada uno recibe objetivo, datos referenciados, herramientas permitidas, presupuesto, dependencias y contrato de entrega.

Paralelismo inicial propuesto de hasta 4 workers por trabajo, ajustable tras medir. Dependencias explícitas, bloqueos/versiones optimistas para escrituras, cancelación propagada y recuperación de resultados parciales. Tareas simples usan un agente.

## 7. Autonomía y costos

**Con aprobaciones:** agrupar decisiones por efecto de negocio, presentar alcance y cambios antes de ejecutar. Las lecturas y preparación no deben pedir confirmaciones redundantes.

**Autónomo:** ejecutar dentro del encargo autorizado sin preguntar por cada herramienta. El alcance puede incluir envíos o activaciones cuando lo permitan el usuario, su rol y las reglas vigentes del producto.

Persistir concesiones por trabajo: acciones, entidades, presupuesto, vigencia y autor. Vincular una aprobación a la versión exacta de su propuesta; invalidarla si cambian destinatarios, contenido o efectos relevantes. El cambio de modo aplica hacia adelante.

No confundir autorización Cowork con aprobación específica requerida por servicios existentes. Adaptar esos contratos explícitamente, sin saltarse comprobaciones de remitente, supresión, cuotas o estado de campaña.

Presupuesto separado para modelos, proveedores y sandbox. Reservas atómicas antes de llamadas facturables cuando sea posible; conciliación del gasto real y saldo. Si el precio externo no es conocido, mostrar estimación y límite por operaciones. No afirmar un límite monetario exacto que el proveedor no permita garantizar.

## 8. Artefactos y ejecución de código

### Familias

- **Nativos:** listas, investigaciones, borradores, secuencias, vistas de CRM y análisis.
- **Documentos/archivos:** MD, JSON, CSV, XLSX, PDF, DOCX, PPTX, imágenes y ZIP.
- **Aplicaciones generadas:** HTML/CSS/JS y proyectos frontend compilados; calculadoras, dashboards y exploradores de datos.

Cada formato necesita generador, validación, descarga y visor o fallback explícito. Tener una librería instalada no demuestra soporte completo.

### Modelo común

ID estable, propietario, organización, tipo, versión, manifiesto de archivos, fuentes, entidades relacionadas, estado de construcción, resumen de cambios y ejecuciones de origen. Distinguir snapshot de artefacto conectado; este último refresca bajo permisos vigentes.

### Sandbox

- Python y Node, herramientas de archivos y comandos, dependencias controladas, logs, preview y verificación.
- Aislamiento por ejecución o workspace autorizado; límites de CPU, memoria, disco, tiempo y red.
- Sin secretos generales de la app ni credenciales de base de datos en el entorno generado.
- Acceso a ANTON.IA por gateway con capacidades efímeras y acotadas.
- Código y contenido externo se tratan como datos no confiables: no pueden ampliar permisos del agente.
- Preview en origen separado, CSP y aislamiento; bridge de mensajes validado, sin cookies de la app ni acceso al DOM padre.
- Validar archivos subidos por tamaño y tipo; limitar descompresión; evitar traversal y fórmulas inyectadas en exportaciones tabulares.
- Promover archivos de salida al almacén privado antes de terminar el sandbox.
- Reabrir un trabajo no presupone que el proceso de sandbox siga vivo: reconstruir desde archivos/checkpoint.

El objetivo incluye escribir, ejecutar, observar errores, corregir y verificar. La modificación/despliegue del código de producción de ANTON.IA desde Cowork no forma parte de operar la app; cualquier incorporación futura requiere alcance propio.

## 9. Persistencia e integración con SUPL.IA

Entidades conceptuales: conversaciones, trabajos, ejecuciones, pasos, asignaciones de workers, llamadas de herramientas, eventos, concesiones, aprobaciones, archivos, artefactos/versiones, memorias y programaciones.

Definir cardinalidades y transiciones antes de migrar. Una conversación puede contener varias ejecuciones y versiones del mismo resultado. El contexto comercial existente sigue en las tablas de dominio.

Auditar SUPL.IA para extraer servicios útiles: contexto, cuotas, claims, leases, versionado y adaptadores. No copiar automáticamente su esquema completo ni asumir que sus herramientas usan los motores actuales de investigación/campañas.

Los eventos deben tener secuencia y cursor para replay; evitar duplicar mensajes al reconectar. La memoria debe distinguir instrucciones explícitas, material del producto e inferencias, y permitir corregir u olvidar datos. Nunca compartir contexto entre organizaciones por compaction o caché.

## 10. Métricas y objetivos propuestos

No hay línea base medida. Los valores siguientes son metas de aceptación, no resultados existentes ni garantías comerciales. En fase 1 se fijan datasets, hardware, proveedores y presupuesto para que las mediciones sean reproducibles.

| Métrica | Definición / medición | Meta de salida |
|---|---|---|
| Cobertura de operaciones | Operaciones con herramienta validada y prueba aprobada / inventario versionado | 100% del alcance acordado; cualquier exclusión documentada y aprobada |
| Éxito de tarea | Resultado comprobado sin corrección manual fuera del chat / tareas evaluadas | >=90% global y >=85% por familia |
| Exactitud de efectos | Escrituras con entidad y estado final correctos / escrituras de prueba | 100% en recorridos críticos |
| Aislamiento de acceso | Casos adversariales que acceden a recurso ajeno o sin permiso | 0 en toda la matriz obligatoria |
| Duplicación de efectos | Duplicados al simular retry, timeout y doble aprobación | 0 en pruebas de fallos |
| Recuperación | Trabajos recuperados correctamente tras desconexión/reinicio | >=95% de al menos 40 escenarios inyectados |
| Veracidad de finalización | Afirmaciones de éxito respaldadas por resultado durable | 100% de acciones críticas auditadas |
| Evidencia de investigación | Afirmaciones factuales verificables con fuente que realmente las respalda | >=95% en muestra revisada; hipótesis etiquetadas |
| Archivos válidos | Exports abiertos por lector independiente, contenido y conteos correctos | 100% del corpus de aceptación por formato |
| Artefactos funcionales | Aplicaciones que superan instrucciones y pruebas de interacción | >=90% de tareas del corpus; cero fallos bloqueantes en recorridos canónicos |
| Acuse de trabajo | Desde solicitud autenticada aceptada a evento durable de trabajo | p95 <=2 s en entorno de evaluación |
| Primer avance útil | Hasta primera respuesta útil o inicio real de herramienta | p95 <=10 s con proveedor disponible |
| Detención | Desde cancelar a no iniciar nuevas herramientas | p95 <=5 s; llamadas externas en curso conciliadas aparte |
| Cumplimiento de presupuesto | Trabajos sin exceder autorizaciones de operaciones/reservas | 100%; desviación monetaria externa se informa por separado |
| Eficiencia de workers | Latencia de tareas paralelizables frente a baseline de un worker | >=20% menor sin bajar calidad más de 2 puntos porcentuales |
| Fricción de uso | Pasos manuales fuera del chat en recorridos soportados | 0 salvo OAuth o intervención externa identificada |
| Accesibilidad | Bloqueantes de teclado, foco, contraste y lectores en rutas principales | 0; WCAG AA en componentes construidos |

Medir costo por tarea completada: tokens de entrada/salida/cache, modelo, llamadas de proveedor, segundos de sandbox, almacenamiento y reintentos. Tras 50 ejecuciones representativas, fijar presupuesto por familia antes de ampliar uso. No optimizar solo costo por mensaje.

Registrar p50/p95 y tamaños de muestra. Éxito se evalúa por tarea completa; repetir una misma tarea no crea nuevos casos independientes. No inferir adopción de equipo a partir de este piloto de un usuario.

## 11. Instrumentación

Eventos sugeridos: `work.created`, `run.started`, `plan.updated`, `worker.started`, `tool.started`, `tool.completed`, `approval.requested`, `approval.resolved`, `artifact.version_created`, `artifact.opened`, `file.downloaded`, `run.completed`, `run.failed`, `run.cancelled` y `access.denied`.

Campos comunes: IDs de correlación, actor, organización, trabajo, ejecución, herramienta/versión, timestamp, duración, resultado y consumo. Redactar tokens, cuerpos privados y datos innecesarios. Diferenciar eventos de producto de logs técnicos; no persistir razonamiento interno del modelo como requisito de observabilidad.

Crear reporte del piloto con: tasa de éxito por familia, costos, p95, causas de fallo, recuperación, cambios de modo y feedback del usuario. Retención propuesta: logs técnicos 30 días; revisar política de archivos y conversaciones antes de activar borrado automático.

## 12. Fases y puertas de aceptación

### Fase 0 — Inventario y decisiones técnicas

Entregables: inventario completo, auditoría de SUPL.IA, contrato de capacidades, modelo de acceso, prototipo de estados del workspace y ADR de runtime/cola/sandbox.

Comparar un runtime propio pequeño con adaptadores a runtimes existentes usando las mismas tareas. Las referencias GitHub del análisis previo son candidatos de estudio, no dependencias ya auditadas. Revisar licencias, actividad, aislamiento y compatibilidad con Next.js 15, React 18 y Node 22.

Puerta: alcance congelado en inventario v1, criterios medibles y decisión documentada. No estimar fechas cerradas antes de revisar dependencias.

### Fase 1 — Acceso exclusivo y columna vertebral

Entregables: guardia servidor, RLS, Storage privado, shell `/cowork`, conversaciones, trabajos persistentes, eventos/replay, cancelación y kill switch.

Puerta: matriz de acceso aprobada; trabajo de prueba recuperable al cerrar pestaña; URLs y archivos inaccesibles para otros usuarios. Resolver el UUID autorizado antes de habilitar cualquier entrada.

### Fase 2 — Primer recorrido operativo completo

Entregables: herramientas de búsqueda/CRM/investigación/borradores, plan adaptable, modos de autonomía, verificación posterior y artefactos nativos.

Puerta: buscar -> investigar -> priorizar -> crear borradores -> modificar por chat, con estados reales y sin duplicados al reintentar.

### Fase 3 — Código y archivos

Entregables: sandbox Python/Node, uploads, versiones, XLSX/PDF/CSV, código y preview. Añadir DOCX/PPTX/imágenes/ZIP con validadores propios.

Puerta: dataset -> código ejecutado -> gráfico/dashboard -> corrección conversacional -> descarga válida; aislamiento de preview y sandbox comprobado.

### Fase 4 — Workers y cobertura de producto

Entregables: asignaciones especializadas, dependencias, presupuestos, control de concurrencia y resto de herramientas del inventario, incluyendo campañas/secuencias y configuraciones permitidas.

Puerta: 100% de cobertura acordada y métricas de tarea/efectos; benchmark de paralelismo sin degradación inaceptable.

### Fase 5 — Continuidad y trabajo recurrente

Entregables: contexto por trabajo, memoria editable, programaciones, artefactos conectados, conciliación y recuperación de tareas largas.

Puerta: ejecutar tarea programada con acceso vigente, actualizar resultado, reabrir y continuar. Revocar permiso impide próximos efectos y ejecuciones programadas.

### Fase 6 — Validación integral y activación privada

Entregables: corpus de evaluación, reporte de métricas, auditoría visual/accesible, runbook, límites operativos y habilitación exclusiva.

Puerta: todos los criterios P0 y recorridos críticos aprobados; fallos restantes documentados sin ocultar capacidades incompletas. El lanzamiento continúa limitado a `nicolas.yarur.g@yago.cl`.

## 13. Corpus de aceptación

Preparar al menos 60 tareas únicas: 10 de prospección/investigación, 10 de CRM/operación, 10 de borradores/campañas, 10 de datos/documentos, 10 de código/artefactos y 10 de continuidad/configuración. Añadir la matriz de acceso y los 40 escenarios de recuperación como suites separadas.

Recorridos canónicos:

1. Promocionar un servicio real -> leads priorizados -> XLSX/PDF -> secuencia en borrador.
2. Excluir contactados y cambiar sector a mitad de búsqueda sin perder trabajo útil.
3. Investigar un contacto identificable sin email; mostrar fuentes y faltantes.
4. Actualizar nota, responsable y próxima acción desde la conversación; comprobar CRM.
5. Revisar remitente, editar y enviar en entorno de prueba; simular respuesta incierta sin duplicar.
6. Importar CSV con duplicados, limpiar con código y presentar cambios antes de persistir según modo.
7. Construir dashboard y corregir un fallo de ejecución hasta obtener preview funcional.
8. Generar documentos y presentaciones que un lector independiente abra correctamente.
9. Cerrar navegador, reiniciar worker, volver y recuperar resultados.
10. Revocar acceso con un trabajo activo y probar todas las superficies con otra cuenta.

Usar mocks deterministas para integración y fixtures sintéticos. Revisar fuentes de investigación mediante rúbrica humana, no solo otro LLM. Las pruebas automatizadas no deben enviar correos ni consumir datos de producción.

## 14. Entregables, responsables y operación

Responsabilidades propuestas, pendientes de asignación:

| Frente | Responsabilidad |
|---|---|
| Producto | Inventario, criterios de éxito, revisión con Nicolás y priorización |
| Backend/IA | Runtime, workers, capacidades, recuperación y costos |
| Frontend | Workspace, renderizadores, streaming y accesibilidad |
| Plataforma | Sandbox, cola, almacenamiento, límites y observabilidad |
| QA | Corpus, aislamiento, fallos inyectados y reporte de aceptación |

Backlog obligatorio con ID, fase, dependencia, responsable, criterio, prueba y estado. Prioridades: P0 acceso/efectos/recuperación; P1 cobertura/runtime/artefactos; P2 optimización y mejoras de ergonomía. Una capacidad necesaria para el alcance final no se omite por quedar en fase posterior.

Documentos a producir: inventario, ADR de runtime, contrato de eventos/tools, especificación de artefactos, notas visuales, reporte de evaluación y runbook de cancelación/revocación/conciliación.

Seguir reglas del repositorio: trabajar desde `main`, preservar cambios concurrentes, Node 22, suites con `.env.test.local`, sin pruebas contra producción. Cualquier escritura o migración en producción requiere solicitud explícita; aplicar una migración pequeña forward-only por vez y verificar esquema, RLS y observabilidad disponible inmediatamente. Este plan no autoriza migraciones ni despliegues.

## 15. Checklist de cierre

- [ ] Identidad exacta y UUID autorizado configurados y probados.
- [ ] Página, APIs, eventos, DB, archivos, previews y workers restringidos.
- [ ] Inventario cubierto y servicios compartidos verificados.
- [ ] Modos de autonomía aplicados en servidor y ligados al trabajo.
- [ ] Trabajos persistentes, cancelables y recuperables sin duplicados.
- [ ] Workers coordinados y presupuestados.
- [ ] Código realmente ejecutado, corregido y verificado en aislamiento.
- [ ] Todos los formatos acordados generables, legibles y descargables.
- [ ] Artefactos versionados e iterables por chat.
- [ ] Experiencia de las referencias adaptada a ANTON.IA, responsive y accesible.
- [ ] Métricas reportadas con muestras y limitaciones.
- [ ] Runbook y mecanismo de revocación comprobados.
- [ ] Activación privada exclusiva; sin enlaces públicos ni acceso por pertenencia al equipo.
