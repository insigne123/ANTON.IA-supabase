# ADR 005 · Entregas, identidad y tareas de Cowork

Fecha: 9 oct 2026. Estado: implementado en candidatos del plan integral; activación/aceptación desplegada según reporte de ejecución.

## Decisión

Reutilizar runs, operaciones y eventos existentes. La identidad de un resultado es `run:block:index`, `run:file:name` o la referencia nativa confirmada; un título es presentación, no una clave de correlación. Una edición local se liga al contenido de partida. Preview/copia/export/handoff comparten su versión efectiva y el handoff lleva el ID del resultado.

Los outputs de código se suben a almacenamiento privado e inmutable, pero solo se publican cuando el RPC existente `cowork_finish_effect` confirma el estado y guarda el manifiesto entero. Un upload o un evento temprano no certifica entrega. SHA-256 permite comprobar que la descarga es la versión publicada. Un efecto iniciado sin recibo y un envío no confirmado tienen estado `uncertain`.

El camino asíncrono añade el wrapper `cowork_finish_code_effect` con el timestamp de claim como identidad de intento y la migración `20261009093000_cowork_code_attempt_fencing.sql`. Un claim recuperado invalida al anterior; `COWORK_CODE_FENCING_ENABLED` debe habilitarse tras verificar esta migración, antes del modo asíncrono. `build.dispatched` se registra una vez antes del primer POST: si el resultado remoto ya venció, no se admite otra ejecución con la misma identidad. Requeue usa la misma comparación de intento y se limita a código.

La memoria del hilo se conserva solo después de un cierre confirmado. Mientras hay propuesta, conserva objetivo/oferta pero no estados de contactos ni decisiones nuevas presentadas como entregadas. Las aclaraciones no reescriben esa memoria. Una memoria fuera de la ventana de ocho turnos necesita prueba de ancestría de la rama, con límite explícito; si no se puede probar, se omite.

## Graph de la tarea

`task-graph.ts` reconstruye pasos, dependencias, targets y referencias desde el plan aprobado y los eventos. Aprobar/admitir no equivale a entregar. Investigación en cola bloquea redacción dependiente; un lote parcial conserva éxitos y requiere resolver los pendientes. Writer final se conserva como entrega durable `assistant.written`; la continuidad usa la misma referencia y el presupuesto/TTL existentes.

`COWORK_TASK_GRAPH_ENABLED` está apagado por ausencia hasta la aceptación dirigida. El gráfico no amplía qué tipos de efectos, targets o gasto autorizó el plan. Los efectos de envío, activación y LinkedIn siguen fuera del auto-approval del plan.

## Cola y aclaraciones

La cola del navegador tiene scope usuario/organización/hilo, texto/referencias congelados, request ID y parent de admisión. Una respuesta incierta conserva identidad hasta reintento explícito; otra escritura no reemplaza silenciosamente el mensaje. Es una cola de admisión del cliente, no un worker que siga enviando con el navegador cerrado.

Una aclaración de propuesta necesita la migración pequeña `20261009090000_cowork_pending_clarifications.sql`. La función reutiliza el gate de admisión, preserva el padre esperando aprobación, mantiene el root por el trigger existente y registra scope de lectura. Solo `service_role` la ejecuta a través de la sesión validada de la app. El worker de aclaración no propone notas, efectos ni búsquedas externas. `COWORK_CLARIFICATIONS_ENABLED` sigue apagado hasta migración verificada y aceptación.

## Validación

- Identidad: títulos iguales no atribuyen un outcome a otra tarjeta; ID exacto sí.
- Listas: 0/1/20/21/25/26/45/500 filas; expansión congela datos para exportar.
- Proyección: admisión, investigación pendiente, lote parcial y resultados confirmados.
- SQL real aislado (PGlite): gate existente, trigger root, scope, revocación, idempotencia y privilegios.
- UI renderizada y DOM aislados: ver reporte. Persistencia cliente y Postgres aislado no acreditan aceptación autenticada en producción.

## Continuación · recuperación de mensajes antiguos

El workspace ahora ofrece «Ver mensajes anteriores» y recupera páginas de hasta ocho antecesores por los GET scoped existentes. El cliente valida que el ancla, las relaciones padre/hijo y el root corresponden a esa rama, conserva la posición del scroll y devuelve el foco al contenido si el botón desaparece al llegar al inicio. Los resultados de esos turnos se pueden abrir sin abandonar el trabajo actual.

La paginación es solo de presentación: no modifica el historial que recibe el modelo, no despierta workers y no admite efectos. Las páginas se retiran ante pérdida de acceso y no se fusionan con otra versión del hilo. Se mantiene un máximo de 400 turnos abiertos en la vista.
