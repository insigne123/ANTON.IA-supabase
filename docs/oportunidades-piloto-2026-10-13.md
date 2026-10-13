# Oportunidades · evaluación real de expediente (13 oct 2026)

## Alcance

Caso público `1057049-332-LR26`, Hospital Clínico San Borja Arriarán. Fuentes: ficha, siete formularios Word y 23 preguntas con 23 respuestas; nueve documentos, trece fragmentos, 40.939 caracteres. Empresa hipotética de servicios TI, sin acreditaciones ni costos propios verificados. No representa el catálogo aprobado de GrupoExpro o PSOL.

La navegación normal del inventario general termina en reCAPTCHA/403. No se eludió el control ni se certificaron bases administrativas/técnicas completas. No hay OCR. El piloto usó almacenamiento local, fuentes públicas y modelos reales, sin escrituras de datos productivos ni envíos. El secreto de plataforma se guardó con autorización expresa independiente.

## Resultado y costo

Se generaron JSON, Markdown, PDF de trece páginas y Excel: doce secciones, siete requisitos, cinco tareas, seis riesgos, ocho preguntas. Recomendación `do_not_advance` por proceso cerrado y cierre anterior al corte. Las 69 citas tienen coincidencia literal con su fuente; **no es una medición de exactitud semántica**.

| Paso | Modelo | Costo calculado por usage |
|---|---|---:|
| Cuatro extracciones | `claude-haiku-5-5` | US$0,010197 |
| Síntesis original, HTTP400 por gramática grande | `claude-sonnet-5-5` | Desconocido; reserva US$0,421736 |
| Síntesis con envelope JSON | `claude-sonnet-5-5` | US$0,229562 |

Total conocido **US$0,239759**; exposición conocida más reserva incierta **US$0,661495**, dentro del cap autorizado US$2. Seis llamadas; las cuatro extracciones se reutilizaron. La síntesis útil registró 18.931 tokens de entrada y 19.170 de salida (incluye razonamiento), 109.358 ms. Precios/usage no equivalen a factura conciliada; la reserva incierta se conserva. La recuperación usó un job separado del original bajo el cap global del piloto, por lo que no acredita el circuito completo bajo un único cap de job.

Código original congelado del piloto: árbol #330 `c6c6b34c0da5baa60dd2b33ca5def8cd46ad957e`. La recuperación usó el cliente Claude de #340 y una cadena JSON externa, con validación local completa del contrato interior.

## Revisión de calidad

**Generación/exportación aprobadas en esta muestra; aceptación semántica y de cobertura completa pendiente.** Se revisó el texto del informe y el corpus; además, las tablas, encabezados y paginación visibles de las páginas 10–13. No se certifica revisión visual de todas las páginas.

Aciertos contrastados: no ofertar fuera de plazo; nueve profesionales distribuidos 3/2/2/2 sin inferir nueve FTE; turnos T8/T6/T4/T2 y P×Q; experiencia específica de software/TI; referencial distinto de máximo; contradicción en la base del 5%; no inventar precios, cumplimiento empresarial ni probabilidades. Cálculos comprobados: 1.512 turnos, 7.440 horas en 24 meses, promedio aritmético 310 horas/mes; no son obligación mensual. Sin costos propios, no producir márgenes ficticios.

Hallazgos:

1. La respuesta a la pregunta `7690765` se trata como truncada aunque está completa entre los dos fragmentos del foro. Las dudas de un bloque no acreditan ausencia del expediente entero.
2. La cita de equipamiento contiene la pregunta pero no la respuesta oficial «SI». Una pregunta no acredita quién suministra el equipo.
3. Algunas citas no incluyen la cifra afirmada: 426 reclamos/período, ponderaciones de evaluación o todas las filas necesarias para las horas calculadas. Coincidencia literal no basta como evidencia semántica.
4. Se omite el título de turnos de personal clínico del Formulario 5, distinto del objeto de desarrollo de software. No corregir originales silenciosamente.
5. Readjudicación no demuestra reapertura para nuevos oferentes; separar seguimiento del proceso cerrado de participación futura expresamente habilitada.
6. `supported` es respaldo documental del requisito, no cumplimiento acreditado del vendedor. Las capacidades declaradas en una oferta no reemplazan certificados.
7. El bloque económico puede dar fórmulas paramétricas y entradas faltantes sin inventar cifras. El encabezado vacío de escenarios no representa un análisis económico completo.

## Corrección acotada

La síntesis usa `reportEnvelopeSchema = {json: string}` dentro de `opportunityGenerate`, con la misma reserva, lease, modelo y replay. El schema completo viaja en el prompt; `readOpportunityReportEnvelope` valida todo el objeto interior con `reportSchema`. El formato pequeño evita compilar la gramática profunda rechazada por Claude; no cambia el cliente global trabajado en paralelo.

Una respuesta con JSON interior inválido conserva usage y resultado pagado, falla con un mensaje seguro y no lanza reparación/fallback automático. Nuevo paso `synthesis-envelope-v1` y versión `opportunity-expedient/2` para nuevas solicitudes explícitas; no se regeneran informes ni se liberan reservas antiguas por integrar el cambio. Instrucciones reforzadas para citas numéricas, pares pregunta/respuesta, discrepancias de títulos, dudas por bloque y propuestas financieras sin datos ficticios.

Pruebas con proveedores y DB inyectados: gramática pequeña, contrato interior íntegro, una llamada/replay, contabilidad de respuesta inválida, incertidumbre, rechazo por lease/cap y ausencia de texto privado en errores. Estas pruebas no demuestran que la nueva instrucción haya corregido todas las conclusiones del modelo: requiere otra muestra contrastada.

## Estado operacional

El secreto Claude existe y #340 integra su binding; la revisión desplegada `studio-build-2026-10-12-001` todavía no lo incorpora. Migraciones de Oportunidades, flags y scheduler nuevos no se activan en este incremento. Para aceptación completa faltan bases originales y oferta empresarial real, más validación semántica y del flujo autenticado.
