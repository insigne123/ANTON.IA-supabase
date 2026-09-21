# Plan ejecutable de cierre de Fase 4

Fecha: 20-09-2026. Alcance: F4-01 a F4-10 del estado de fase. Ejecución completada el 21-09-2026 para el alcance acordado;
el residual diferido con motivo quedó en el inventario v1 (no se simula cobertura).

## 1. Runtime y recuperación (primero)

1. Cola de asignaciones ligada a usuario/organización/trabajo, con plan inmutable y máximo dos especialistas.
2. Separar admisión, claim, generación y publicación. Cancelación/revocación impiden nuevos claims y publicaciones. Un intento vencido nunca publica.
3. Reanudar el coordinador cuando todas las asignaciones son terminales; éxito, fallo y resultado incierto son observaciones distintas. No repetir una llamada facturable incierta.
4. Persistir resultados y consumo por asignación; replay sin nuevas llamadas. Conservar evidencias y presupuesto del coordinador tras reanudar.
5. Verificar SQL en PostgreSQL aislado y pruebas del scheduler. Aplicar una migración por vez, revisar esquema/RLS/permisos/logs y habilitar flags después del código compatible.

Aceptación: cerrar pestaña/reiniciar proceso no pierde asignaciones; doble claim no duplica generación; cancelación y revocación bloquean publicación; resultado incierto no se convierte en éxito ni reintento silencioso.

## 2. Cobertura por operación (inventario y adaptadores)

Cada fila debe registrar servicio compartido, scope, costo, contrato, efecto, aprobación, idempotencia, verificación posterior y prueba. Identificar incompatibilidades reales antes de tocar datos.

| Dominio | Operaciones a completar/auditar | Criterio de cierre |
|---|---|---|
| Perfil/ajustes | consultar identidad/oferta/firma; proponer y aplicar edición permitida | Campos explícitos, autorización actual y conflicto de versión; ninguna edición de rol/token |
| CRM/tareas | ficha comercial, etapa, responsable, nota, próxima acción; crear/completar tarea | Servicios de colaboración vigentes; IDs observados; aprobación exacta; control de edición concurrente |
| Campañas/secuencias | detalle/estado, preparar, editar, activar, pausar por modelo vigente | No confundir bulk con campañas-v2; flags y preflight del motor; sin envíos en pruebas |
| Búsquedas | consultar, crear, editar, eliminar y reutilizar guardadas | Visibilidad propia/compartida; filtros preservados; búsqueda nueva con cuota y revisión |
| Contactos/Sheet | importación, enriquecimiento por lote, deduplicación, edición/exportación | Resultado por fila; cuotas compartidas; calidad de email real; replay sin duplicados |
| Correo/hilos | consulta mailbox, hilo, propuesta editable y respuesta | Remitente/proveedor comprobados; hilo observado; versión aprobada; conciliación de envío incierto |
| Misiones/excepciones | consulta, preparación, control de misión y resolución permitida | Permisos y estados del motor; historial auditable; no resolver excepciones por suposición |
| Privacidad | contactabilidad individual/lote y acciones permitidas | Servicio de supresión actual; no ampliar alcance ni revelar datos ajenos |

Aceptación: todos los IDs del inventario acordado tienen adaptador y pruebas. Un enlace a otra pantalla o una lectura parcial no cuenta como escritura integrada. No declarar 100% hasta terminar el desglose.

## 3. Presupuestos y observabilidad

- Límite agregado de llamadas/tokens por trabajo y especialistas; presupuesto reservado antes de generar.
- Registrar consumo reportado por proveedor y ausencia de dato como desconocido, no cero.
- Medir espera, ejecución, replay, errores y resultados parciales con correlación de trabajo/asignación.
- Herramientas delegadas con lista explícita por rol, usando el gateway y aprobaciones existentes; ninguna herramienta SQL/HTTP genérica.

## 4. Evaluación

- Matriz de permisos/scope y revocación para cada nuevo adaptador.
- Inyección de fallos: doble aprobación/claim, timeout, reinicio, publicación tardía, cambios concurrentes y respuesta de proveedor incierta.
- Corpus reproducible secuencial/paralelo: misma tarea, datos y presupuesto; reportar p50/p95, llamadas, tokens, calidad y límites de muestra.
- Los mocks prueban contratos. El benchmark sintético no acredita calidad del modelo ni rendimiento de producción.
- Revisión de UI afectada: estados reales, foco, móvil, claro/oscuro. No añadir indicadores sin respaldo durable.

## 5. Publicación y aceptación

1. Verificar cambios propios en `main`, preservar trabajo concurrente y obtener build reproducible.
2. Aplicar únicamente migraciones revisadas/probadas, una a la vez; comprobar catálogo, RLS, permisos y observabilidad.
3. Desplegar versión compatible con flags apagados; verificar revisión, secretos y endpoints.
4. Activar lo validado, ejecutar recorrido privado autorizado y comprobar resultados durables.
5. Actualizar inventario, informe de aceptación, runbook y estado de fase. Pendientes técnicos permanecen abiertos; no renombrarlos como exclusiones.

## Estado al iniciar ejecución del plan

- Leases v2 aplicados: `20260920161555`; esquema/RLS/permisos comprobados. Logs remotos sin herramienta disponible.
- Planes de lectura, revisión síncrona por especialistas y búsquedas guardadas: implementados localmente.
- Cola independiente, resto de adaptadores, presupuestos agregados y benchmark integral: pendientes.
- Cambios de Fase 4 sin desplegar. Aceptación privada de Fase 3 no confirmada.
