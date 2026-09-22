# Aceptación AXIS — ejecución iniciada

## Incremento de confianza posterior

Se implementó distinción de cobertura del buzón frente a registros consultados, guía de IDs y presupuesto por decisión, y correcciones comerciales. 14 llamadas adicionales autorizadas, acumulado 53 (una sin telemetría tras error de schema). Tres regresiones de respuesta mejoraron; replay de Rafael completó ambos turnos en v4 con límite de cobertura explícito, pero encabezado todavía demasiado categórico. No certifica cierre del recorrido completo. Ver `cowork-marketing-implementation.md` para evidencia, comparación y matriz de 51 funciones. Verificación local: 121 pruebas más scripts aislados de Cowork aprobados; typecheck y diff-check aprobados. Sin despliegue.

## Evaluación real posterior (21 septiembre 2026)

Acceso al modelo resuelto mediante Secret Manager, sin claves en archivos. Se ejecutaron 18 llamadas nuevas: 12 escenarios con observaciones suministradas, dos diagnósticos del replay y un replay multitur­no completo (4 llamadas). **Acumulado: 39/40**. Evidencia y comparación: `cowork-axis-comparison-2026-09-21.md` y cuatro JSON `cowork-axis-*-results/diagnostic/comparison.json` indicados en ese informe. Revisión semántica: 9/12 respuestas cumplen criterios principales, 01/05/06 fallan o son incompletas; no certifica ejecución. Replay 03 corrige tras intervención, pero falla la verificación inicial de pendientes. El estado anterior de falta de credenciales queda superado. Sin despliegue ni pruebas autenticadas.

## Incremento local: replay del coordinador (21 septiembre 2026)

- Nuevo `scripts/evaluate-cowork-axis-replay.ts`: recorre `runCoworkReadLoop` con el esquema real de decisiones, historial entre turnos y herramientas sintéticas. Selección de herramientas por modelo real disponible mediante opt-in; sin Supabase, Apollo ni envíos.
- Cuatro adaptaciones de los turnos del corpus: 01 (prioridad/fecha faltante), 03 (estado que cambia tras «ya le respondí»), 08 (dos solicitudes de reunión) y 12 (19 días desde el último mensaje). No son reproducciones completas: 01 no incluye cadencia, 08 no incluye todas las métricas históricas y 12 aún no simula el desfase previo de 13 días.
- El worker y replay comparten `coworkDecisionContext`: capacidades y reloj UTC generado por servidor. Las instrucciones distinguen hora de consulta de sincronización del buzón y exigen releer estados cambiantes. No se presume zona horaria del usuario.
- Pruebas offline con **decisiones programadas**, incluidas en `verify-cowork.mjs`: historial conservado, nueva lectura tras corrección, ambas solicitudes consultadas, rechazo de efectos/IDs desconocidos y rechazo de respuestas sin consultas aunque coincidan las palabras. Esto prueba el arnés, no la selección autónoma del modelo ni la calidad semántica.
- Verificado: `node scripts/verify-cowork.mjs`, 114 tests y verificaciones aisladas adicionales aprobadas. `npm run typecheck` aprobado.
- **No se ejecutó el replay con modelo real**: esta sesión no dispone de `OPENAI_API_KEY` ni `COWORK_MODEL` en entorno. Cero llamadas nuevas; el contador histórico sigue en 21. Cambios locales, sin despliegue.

Comando para una primera evaluación acotada, una vez configurado explícitamente el entorno:

```powershell
node --loader ./scripts/ts-test-loader.mjs scripts/evaluate-cowork-axis-replay.ts --live --cases=03-ya-respondi --max-calls=8
```

El límite es por invocación (máximo 19), sin reintentos, hasta 1800 tokens de salida por llamada. Actualizar el contador de campaña antes de otra ejecución: no hay ledger global en este script. Resultados incluyen consultas, respuestas y uso; requieren revisión humana de veracidad y prioridades. Las herramientas no simuladas producen error explícito, no resultados inventados. Sigue pendiente evaluar modelo real, ampliar a los 12 casos y hacer recorrido autenticado.

Fuentes leídas: `CAPACIDADES_AGENTE_COMERCIAL.md` y
`CONVERSACIONES_REPRESENTATIVAS.md`, entregados por el usuario desde Asistente AXIS.
El segundo contiene 12 intercambios condensados, no exportaciones completas de herramientas.
El primero enumera 51 capacidades y 6 principios, pese al encabezado de 45.

## Implementado localmente

- `scripts/fixtures/cowork-axis-conversations.ts`: doce casos trazados a códigos de capacidades.
  Turnos textuales donde aplica; evidencias pequeñas y sintéticas, sin datos privados de correo.
- `src/lib/cowork/commercial-behavior.ts`: reglas compartidas por instrucciones del coordinador y evaluación.
  No confunde la política comercial AXIS con privilegios, privacidad ni capacidades actuales del producto.
- `scripts/evaluate-cowork-axis.ts`: validación offline y evaluación opt-in con observaciones fijas.
  Rúbricas ocultas al modelo, selección por casos, máximo una llamada por caso, salida 900 tokens,
  sin reintentos; techo por invocación 120000 entrada reservada/12000 salida reservada.
  La reserva de entrada es conservadora por bytes con margen de esquema, no contabilidad exacta del proveedor.

## Ejecuciones realizadas

- Validación estructural de 12 fixtures y typecheck aprobados.
- Modelo real: 13 llamadas (4 iniciales + 9 posteriores, incluye una repetición de afirmaciones).
- No se gastaron créditos de Apollo ni se enviaron correos/invitaciones. No hubo escrituras de prueba en producción.
- Consumo real reportado de las 13 llamadas: 13323 tokens totales. Precio no configurado: costo monetario desconocido.
- Primera muestra: chequeos léxicos 4/4, pero revisión del contenido detectó una comparación comercial no respaldada.
  Se endureció la regla; repetición eliminó la promesa de ahorro/equivalencia sin evidencia.
- Segunda muestra: chequeos léxicos 8/9; reloj calculó 19 días correctamente, pero omitió cuantificar el desfase de 13 días.
- Revisión semántica detectó además ambigüedades de fixtures y errores: confirmación de envío interpretada como
  confirmación de destinatario; reclutadores almacenados interpretados como contactados; referido comercial interpretado
  como búsqueda de empleo; solicitudes de reunión entrantes confundidas con seguimientos salientes.
- Se aclararon esos fixtures y se reforzaron reglas de denominadores, dirección de conversación y desfase temporal.
  **Esas últimas correcciones todavía no se reevaluaron. No se certifica aprobación semántica del corpus.**

## Comandos

```powershell
node --loader ./scripts/ts-test-loader.mjs scripts/evaluate-cowork-axis.ts
node --loader ./scripts/ts-test-loader.mjs scripts/evaluate-cowork-axis.ts --live --cases=04-verificar,05-referidores,07-regla-contextual,08-reuniones,12-reloj
```

El modo live necesita `OPENAI_API_KEY` y `COWORK_MODEL` explícitos; no carga `.env.local`.
Mantener el total de llamadas de la campaña de aceptación por debajo de 40; van 13.
Los límites del runner son por invocación, no un ledger global entre invocaciones.

### Tercer incremento (reevaluación con contexto calculado)

- Reevaluados 03/05/07/08/12 con `computed` determinista en el prompt e instrucción de usarlo literalmente: 5 llamadas (un intento de 08 falló por respuesta vacía del proveedor y se reintentó aparte).
- 05: distingue almacenados de contactados, sin causalidad demostrada; experimento acotado. 07: exclusión de asistentes limitada a correo frío, supresión vigente. 12: desfase de 13 días y 19 días, completo. 08: prioriza las 2 entrantes sin llamarlas confirmadas; el filtro aceptó «pedidos entrantes» como equivalente intencional de la rúbrica (verificado offline contra el texto recibido, sin nueva llamada).
- Micro-defecto abierto: en 03 el modelo escribió «cinco minutos» para un intervalo de 11:46→11:55 (nueve). El cálculo verificado estaba en `computed`; la instrucción de uso literal se añadió después y aún no se reevalúa ese caso.
- Turno D5 integrado al adaptador real `contacted.timeline` (`src/lib/server/cowork/extended-reads.ts`): campo aditivo `turn` con cobertura/frescura, truncamiento explícito y autorespuestas que no cambian el turno. Pruebas locales aprobadas.
- Llamadas reales acumuladas: 19 de 40 (4+9+4+2). Tokens reportados acumulados: 19784. Sin precio configurado: costo monetario desconocido. Cero créditos Apollo, cero envíos.

## Trabajo pendiente para el plan completo

### Cuarto incremento (regresión 03 cerrada)

- Reevaluado el caso 03 con brecha determinista de 9 minutos y redondeo de presentación: respuesta correcta y completa (11:55, turno de Rafael, 9 minutos). Llamadas reales acumuladas: 21 de 40.

### Segundo incremento

- Reevaluados los cinco casos corregidos: 5/5 chequeos léxicos; 6407 tokens adicionales, 18 llamadas y 19730 tokens totales acumulados.
- Revisión semántica: casos 04, 08 y 12 cumplen sus criterios principales. Caso 05 conserva confusión puntual entre correos y personas en la explicación de evidencia; caso 07 mantiene indebidamente la exclusión de asistentes aunque reconoce que solo aplica a correo frío. No declararlos aprobados semánticamente.
- Añadido `commercial-facts.ts` con métricas de denominador explícito, reglas comerciales por canal/objetivo, supresión transversal, comparación exacta de empresas, límites de palabras para cargos, turno de conversación con frescura/cobertura y conteo de acciones sin duplicados.
- Siete pruebas locales aprobadas y typecheck aprobado. Dos usan el bucle real y gateway con modelo programado/almacén aislado: corrección de pendiente entre turnos lee de nuevo, retry del mismo turno reutiliza resultado; «adelante» sin borrador observado no propone envío.
- El evaluador incorpora datos calculados para los casos 03/05/07. Aún no reevaluados con ese contexto. Los helpers no están conectados a todos los adaptadores de producción: son núcleo probado y entrada de evaluación, no cobertura comercial completa.
- No hubo nuevos efectos externos ni consumo Apollo. Cambios locales sin despliegue.

1. Reevaluar los cinco casos modificados y revisar semánticamente todos los resultados.
2. Ejecutar conversaciones mediante el agente real con selección de herramientas simuladas y cambios entre turnos,
   no únicamente responder con observaciones suministradas.
3. Desglosar las 51 capacidades con evidencias de código y aceptación por operación; los doce escenarios cubren
   patrones, no todas las funciones. Mantener separada cobertura implementada y cobertura probada.
4. Completar adaptadores de bandeja/hilo, estado por cuenta, CRM/tareas, lotes, campañas, LinkedIn y entregabilidad.
5. Pruebas de efectos, paginación, recuperación, aislamiento y concurrencia; integración real mínima autorizada.
6. Desplegar código verificado, ejecutar recorrido autenticado y cerrar matriz. Estas reglas y corpus siguen locales.

Estado: **en ejecución, no completado**. Una prueba léxica o un buen texto no certifican lectura real,
acción externa ni su confirmación. No reclasificar operaciones pendientes como implementadas.
