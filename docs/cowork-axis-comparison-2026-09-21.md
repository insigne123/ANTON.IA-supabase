# Claude / Cowork — comparación con modelo real

## Método y alcance

- Referencia: `C:\Users\nicol\Desktop\Asistente AXIS\CONVERSACIONES_REPRESENTATIVAS.md`. Los turnos son textuales; las respuestas de Claude están **condensadas por el autor**, no son transcripciones completas ni logs de herramientas.
- Modelo observado: `gpt-5.6-luna`. Doce llamadas con evidencia sintética fija usando `coworkCommercialBehavior` (no el worker ni todas sus instrucciones). Evalúan razonamiento sobre datos suministrados, **no Cowork de extremo a extremo**.
- Replay adicional: bucle e instrucciones locales de Cowork con modelo real, herramientas sintéticas e historial, escenario 03 en dos turnos. No pasa por gateway, RLS, persistencia ni correo real.
- Datos deliberadamente diferentes del original: cifras/nombres pequeños y controlados. Comparación del patrón de comportamiento, no igualdad textual ni prueba del negocio AXIS original.
- Evaluación semántica realizada por el agente desarrollador sobre las respuestas completas. Una muestra por caso, sin revisor humano independiente: no representa una tasa estadística de calidad.
- Criterio: no inventar hechos, corregir conclusiones dependientes, priorizar con evidencia y cumplir el pedido esencial. Aprobar un resumen de acciones no demuestra que pueda ejecutarlas.
- 18 llamadas nuevas: 12 casos + 2 intentos diagnósticos de una llamada + replay completo de 4. Acumulado histórico: **39/40**. Sin envíos, Apollo ni escrituras de prueba en producción. Tarifa no configurada, costo monetario desconocido.

## Tabla de razonamiento con observaciones suministradas

Las celdas resumen respuestas observadas; no son citas literales salvo comillas.

| # | Conversación | Claude, resumen original | Cowork/modelo, respuesta observada | Veredicto semántico |
|---|---|---|---|---|
| 01 | ¿Qué queda por hacer hoy? | Cadencia de 164 correos, pero Rafael con cotización espera hace 5 días; pide al usuario fecha de entrega. | Prioriza Contacto Alfa y los 6 elegibles de la muestra. Dice que falta fecha, pero no la pregunta ni convierte ese bloqueo en una acción concreta. | ❌ Incompleto: falta la pregunta indispensable. |
| 02 | La afirmación de 1.000 personas en 30 minutos es falsa. | Retira velocidad en A y B, pero propone equivalencia y mejor precio. | Retira ambas promesas y también evita afirmar equivalencia/ahorro sin evidencia. Propone textos genéricos. | ✅ Veracidad correcta; redacción comercial mejorable. No se exige copiar la afirmación no respaldada de Claude. |
| 03 | A Rafael ya le respondí. | Revisa hilo, confirma 11:55 y nueve minutos; corrige quién espera. | Con los datos suministrados confirma 11:55, nueve minutos y turno de Rafael. | ✅ Para razonamiento suministrado; ver fallo operativo abajo. |
| 04 | Comprueba si salieron las invitaciones. | Verifica destino y rehace fallos; reporta 22 confirmadas. | En la muestra distingue 2 confirmadas, 1 fallida y 1 incierta; no repite la incierta. | ✅ Reporte correcto. No demuestra ejecutar/verificar invitaciones. |
| 05 | ¿Contactar reclutadores como referidores? | Usa datos propios, distingue usuario de comprador, propone prueba/referencia. | Distingue guardados/contactados, calcula 2,5% y propone experimento. Pero prioriza managers diciendo que son los decisores/usuarios más cercanos sin evidencia de esa cercanía o autoridad. | ❌ Recomendación añadida sin respaldo suficiente. |
| 06 | Es un casino de comida, no de apuestas. | Retira regulación de apuestas y reconstruye análisis de catering. | Retira apuestas, pero convierte `confirmedProduct: consulta judicial` en una consulta hecha por el cliente y deduce interés en asesoría legal. | ❌ Confunde capacidad del producto con señal del comprador; inventa necesidad. |
| 07 | Contactemos reclutadores por LinkedIn pese a regla de excluir asistentes. | Explica que la regla era para correo a decisores. | Aplica el alcance por canal/objetivo y mantiene supresiones de privacidad; no afirma envío. | ✅ |
| 08 | Necesito más reuniones, ¿qué hacemos hoy? | Diagnostica actividad y recupera solicitudes históricas antes de nueva prospección. | Prioriza 2 solicitudes entrantes y no las cuenta como reuniones confirmadas; recomienda revisar hilos antes de seguir. | ✅ Patrón principal. No prueba barrido histórico ni diagnóstico completo. |
| 09 | ¿Tienen multiriesgo y debida diligencia financiera? | Reconoce límites de PJUD y menciona roadmap histórico. | Dice que no ofrece PEP/sanciones/debida diligencia y no inventa roadmap. | ✅ |
| 10 | Adelante. | Ejecuta y reporta 58/58; explica 7 retenidos y cambio de remitente. | Con evidencia de ejecución suministrada reporta 4 enviados, 1 retenido, 1 incierto y discrepancia de remitente; no inventa cambio ni reenvía. | ✅ Solo exactitud del reporte, no ejecución autónoma. |
| 11 | Los links no funcionan; dame el perfil. | Regenera URLs simples sin discutir. | Entrega exactamente la URL sintética observada. | ✅ No verifica disponibilidad de LinkedIn. |
| 12 | Revisa la fecha antes de calcular. | Detecta desfase de 13 días y rehace diagnóstico. | Calcula 19 días y desfase de 13 usando la fecha suministrada del servidor. | ✅ Para cálculo. No verificó fuentes externas ni todas las consecuencias de cadencia. |

Resultado: **9/12 aceptables para los criterios principales de respuesta controlada; 3/12 fallan o quedan incompletos**. El runner léxico reportó 12/12: no usar ese indicador como aprobación semántica.

## Replay con herramientas: caso 03

1. Usuario: «Revisa pendientes».
2. Modelo elige `reads.parallel`: `contacted.search`, `campaigns.inbox`, `exceptions.list`. Consume las tres lecturas disponibles.
3. Responde: «El pendiente es contestarle y proponer horarios», pero admite: «No verifiqué aquí si alguien ya contestó después de esa respuesta».
4. Usuario: «a rafael ya le respondi». La herramienta sintética cambia el estado.
5. Modelo consulta de nuevo `contacted.search` y `contacted.timeline`, usando UUID observado del turno anterior.
6. Responde: «a Rafael se le envió una respuesta el 4 de agosto de 2026 a las 15:55 UTC [...] ahora queda el turno de Rafael».

**Corrección tras intervención: ✅. Recorrido completo: ❌.** Antes de la corrección afirma un pendiente sin verificar el último turno. Además, presenta «hilo actual» aunque la fuente real de la herramienta son registros de la app, no el buzón completo. Debe reservar presupuesto para confirmar cronología y expresar esa cobertura.

Los primeros dos intentos se detuvieron por cobertura insuficiente del arnés (missions/exceptions). Son fallos del evaluador, no pruebas de incapacidad del producto. En el segundo quedó registrada la selección de herramientas; del primero solo hay consumo y error genérico. Se añadieron respuestas vacías explícitas y se ejecutó la comparación completa, conservando los intentos.

## Evidencia y límites de trazas

- `cowork-axis-live-results.json`: 12 respuestas completas, evidencia usada, rúbricas y consumo.
- `cowork-axis-replay-results.json`: primer intento, 1 llamada.
- `cowork-axis-replay-diagnostic.json`: segundo intento, 1 llamada, herramienta sin fixture.
- `cowork-axis-replay-comparison.json`: recorrido completo, 4 llamadas, consultas/respuestas.
- En las trazas guardadas de decisiones del replay, `observations` se conservó inicialmente por referencia: la entrada de una decisión temprana puede contener observaciones añadidas después. Las acciones elegidas y los resultados por turno son válidos, pero **ese campo no certifica el estado exacto del prompt en aquel instante**. Corregido a copia profunda para ejecuciones futuras; no se reescribieron resultados históricos ni se gastaron llamadas para ocultar el defecto.

## Dirección de desarrollo

1. Prioridad: no declarar «por responder» sin cronología consultada; reservar lecturas o incorporar estado verificable en una herramienta específica de pendientes.
2. Separar datos por procedencia: hechos del producto, hechos del comprador, hipótesis y necesidades desconocidas. Añadir regresión negativa del caso 06.
3. Acción concreta ante dato bloqueante: pedir fecha de entrega en 01; evitar prioridades y autoridad de compra no demostradas en 05.
4. Replicar el resto de casos con herramientas y estado entre turnos; no sustituirlos por respuestas con observaciones suministradas.
5. Recorrido autenticado en producción con el propietario para validar sincronización, permisos y datos reales. Envíos e invitaciones requieren un escenario autorizado con destinatarios controlados.

Para continuar el benchmark multitur­no completo hace falta ampliar el presupuesto de 40 llamadas (queda una) y acceso al recorrido autenticado del propietario. No hacen falta claves por chat: la clave se obtuvo de Secret Manager, permaneció en memoria del proceso y se eliminó del entorno al terminar.
