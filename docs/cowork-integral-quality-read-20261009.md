# Lectura de calidad del candidato · Cowork integral

Evaluador: asistente responsable del encargo. Rúbrica: `cowork-integral-v1`, 1–5. Fecha: 9 oct 2026.

## Alcance

Lectura directa del candidato pareado (22 casos), incluyendo correos, tablas, métricas y documento completo; contraste con entradas/consultas del mundo controlado y con las salidas de la línea base. La misma persona/IA implementa y evalúa: no es un veredicto independiente ni una comparación con Claude/ChatGPT. Los checks lexicales se registran aparte.

Las notas siguientes se refieren al output de esa ronda congelada, no a toda la versión que después se integró. Las correcciones posteriores se señalan, pero no se sobreescriben las notas de una salida antigua.

## Notas parciales por tarea

C = comprensión; V = veracidad/fundamento; E = entrega del texto/propuesta solicitado; M = criterio comercial; R = redacción de la respuesta o del entregable. «N/A» se usa solo para criterio comercial en el saludo, que no pide una decisión comercial. La presentación interactiva, continuidad completa y efectos nativos del recorrido quedan `not_measured` para estos casos; **no se calcula score global de tarea**.

| Caso | C | V | E | M | R | Justificación principal |
|---|---:|---:|---:|---:|---:|---|
| archivo-a-quien | 4 | 4 | 4 | 4 | 4 | Distingue inicial, seguimiento y por importar; tabla conserva las seis personas con correo. Orden privilegia disponibilidad más que potencial y lo declara |
| archivo-pdf | 4 | 4 | 4 | 4 | 4 | Síntesis y tabla fieles al brief; «prueba gratuita» negada no era una oferta, el check anterior era demasiado amplio |
| editar-luego-crear | 5 | 4 | 4 | 4 | 4 | Propuesta conserva ambos textos y personas exactos; la creación nativa y remitente real no se ejecutaron |
| editar-usar | 5 | 4 | 4 | 3 | 4 | Confirma sin modificar; el texto no se vuelve a mostrar en tarjeta en esta salida, aunque el anterior sigue en el hilo |
| informe-jefe | 4 | 3 | 4 | 3 | 4 | Documento declara alcance rolling e inventario actual, pero titular/chat todavía enmarcan septiembre más ampliamente y generalizan la ausencia de actividad |
| metricas-semana | 3 | 3 | 3 | 3 | 3 | Muestra cifras y null-rate, pero responde equipo/7 días frente a actividad personal/semana y expone jerga. Después se agregó lectura exacta/routing |
| mkt-a-quien-escribo | 5 | 4 | 4 | 4 | 4 | Prioriza dos contactos de selección y seguimiento separado; conserva el canal y relación disponible |
| mkt-campana-rrhh | 4 | 3 | 4 | 3 | 3 | Consulta envíos por término de cargo y no los vincula bien con cada persona. Correo usable, apertura genérica y «sus» vuelve ambiguo el trato |
| mkt-mejorar-correo | 4 | 4 | 4 | 3 | 3 | Quita ahorro/superlativo no respaldados y usa oferta real; aún intercambiable y cambia hacia una plantilla genérica |
| mkt-secuencia | 4 | 4 | 4 | 3 | 3 | Tres pasos completos con prueba real; vuelve a presentar capacidades y el segundo CTA tiene poco valor nuevo |
| mkt-seguimiento | 4 | 2 | 3 | 3 | 3 | Dice «hace unas semanas» ante seis días. Posteriormente se fijó reloj y la confirmación conserva fecha exacta |
| ur-a-quien-hoy | 4 | 4 | 4 | 4 | 3 | Usa 21 observados y separa alcance de correo; la base no representa toda la población elegible ni demuestra ausencia externa |
| ur-campana-version | 5 | 4 | 4 | 4 | 4 | Copia la versión exacta y conserva contacto. La campaña solo fue propuesta, no creada |
| ur-como-me-ha-ido | 4 | 3 | 4 | 4 | 4 | Recomendación mejor que activar inmediatamente. Tarjeta mezcla scope de organización/inventario personal y un único período para magnitudes distintas |
| ur-enriquecer-investigar | 5 | 4 | 4 | 4 | 4 | Una propuesta para ambos, efecto/costo y ausencia de envío claros. Preparación real y continuación no medidas |
| ur-escribir-sin-correo | 4 | 4 | 4 | 3 | 3 | Borrador con nombre y oferta/prueba correctos; poco ángulo propio de operaciones y la siguiente acción depende de aprobación |
| ur-hola | 4 | 5 | 4 | N/A | 4 | Saludo útil; en esta ronda aún ofrecía lecturas, corregido después con ruta sin tools |
| ur-investigacion-lista | 4 | 4 | 4 | 3 | 4 | Informa falta de fuentes; vincula conseguir email con investigación más completa sin demostrar que cambiará los hallazgos |
| ur-mejorar-correo | 4 | 4 | 4 | 3 | 3 | Conserva grupo, conversación y adjunto; aún rodeos y dos alternativas de cierre amplias |
| ur-oferta-app | 4 | 4 | 4 | 4 | 3 | Búsqueda adecuada al comprador y mercado; excesiva explicación sobre lo que el cargo no acredita |
| ur-que-haces | 4 | 4 | 3 | 3 | 3 | Capacidades reales; demasiado largo, consulta innecesaria y cláusula final colgante. Confirmación posterior de orientación mejora eso |
| ur-retail-alto-cargo | 5 | 4 | 4 | 4 | 4 | Criterios, mercado y consecuencia correctos; no se ejecutó búsqueda externa |

## Casos nuevos y confirmaciones

- Oferta distinta del perfil: la prueba de piloto y producto nuevo se conservaron sin importar funciones del anterior. No se declara catálogo real aprobado.
- Tres roles: entrega tres correos, pero en la primera ronda varias aperturas fueron intercambiables y añadían notas de garantía innecesarias; se agregó control para quitar esas notas conservando condiciones.
- Edición localizada: primero salió en prosa y luego una revisión borró prueba/asunto. La confirmación final ejecutó dos repeticiones, 14/14 checks, cero consultas y conservó prueba/pregunta; no acredita todas las ediciones posibles.
- Mes propio/semana equipo: la primera salida reconoció no poder calcular; se implementaron conteos/routing por período y scope exactos y los casos siguientes pasaron.
- Analista: el primer intento no corrió por `read:null`; tras corregir schema corrió en 7,8 s y citó la evidencia asignada. La conclusión tenía cautelas evitables; no se amplían roles ni se suben recursos por esta muestra.

## Veredicto

Hay una mejora clara y verificable de fidelidad técnica: listas, tablas, edición, descarga, identidad, recuperación y claridad de estados. La redacción comercial sigue necesitando medición/iteración por rol y material real. **21/22 checks de caso no equivale a 95 % de tareas comerciales utilizables ni a la meta del 85 % del programa.** La muestra no acredita uso autenticado, adopción por equipos ni paridad con otro producto.

Para el siguiente cierre: tareas completas autenticadas sobre esta base, no otra ronda de un solo turno; medir esfuerzo real de edición, primer estado útil/latencia visible y continuidad. Conservar resultados parciales y bloqueos en el denominador.
