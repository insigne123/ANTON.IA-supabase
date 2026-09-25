# Evaluación Cowork producción — 25 sep 2026 (workspace GrupoExpro, modo aprobación)

Escala 1-5: C=comprensión, V=veracidad, U=utilidad, F=formato/claridad, R=fricción (5 = sin fricción).
Latencia: creado→iniciado (cola) + iniciado→terminado (proceso).

## C1 Pendientes de hoy
### T1 «hola, que tengo pendiente para hoy?» — run 3e143ba7
- Latencia: cola 1,6 s + proceso 26 s = 27 s.
- Herramientas: contacted.search (0 ítems), replies.attention.
- Respuesta: «¡Hola! En los registros de la app no aparecen contactos ni respuestas pendientes; la lista consultada está vacía. Pero la cobertura de Gmail y Outlook no está verificada, así que no puedo confirmar que no haya mensajes por atender en tus buzones. Si esperabas algo en particular, habría que comprobar el hilo en el correo conectado.»
- C4 V4 U2 F3 R2. Callejón sin salida: no propone nada que Cowork pueda hacer. Jerga («cobertura», «hilo en el correo conectado»). No mira campañas, incidencias ni tareas.

### T2 «ok y entonces que me recomiendas hacer hoy para avanzar?» — run c0f1579b
- Latencia: cola 66 s + proceso 29 s = 95 s.
- Herramientas: contacted.search (repetida), app.context, replies.attention (repetida). Presupuesto de 3 lecturas agotado en repeticiones.
- app.context devolvió `"offer":"[object Object]"` → BUG de serialización en la lectura.
- Datos: 255 contactos guardados, 19 campañas, 0 contactados, 0 misiones, 2 incidencias abiertas, Google conectado.
- Respuesta: plan de 3 pasos que devuelve el trabajo al usuario: «Comprueba Gmail y Outlook directamente», «Revisa las 2 incidencias… aún no tenemos su detalle», «elige un segmento acotado… y prueba una acción pequeña». Cierra con hedging («No equivale a que no existan hilos…»).
- C4 V3 U2 F3 R2. Dice «cobertura no verificada» aunque Google está conectado. Ignora las 19 campañas. Pide al usuario revisar incidencias que Cowork podía leer (exceptions.list). Sin pregunta de cierre accionable.

## C2 Métricas
### T1 «como me ha ido esta semana con los correos? dame numeros» — run 1c86e476
- Latencia: cola 15 s + proceso 17 s = 32 s. Herramientas: metrics.overview, metrics.rates.
- Respuesta: «En los registros de la app, en los últimos 7 días: 0 correos enviados, 0 respuestas humanas, 0 automáticas y 0 rebotes. Con 0 envíos registrados, las tasas no se pueden calcular (no equivalen a 0%). Hay 255 contactos guardados, pero eso no significa que se les haya escrito. La cobertura de Gmail y Outlook figura como desconocida, así que queda por comprobar si estos números reflejan todo tu correo.»
- C5 V5 U3 F4 R3. Números correctos y honestos. Falta: comparación con 30 días y un siguiente paso («no enviaste nada esta semana; ¿retomamos con…?»). Jerga de cobertura otra vez.

## C3 Contactos guardados
### T1 «muestrame los ultimos contactos que guarde» — run ba91494c
- Latencia: cola 59 s + proceso 15 s = 74 s. Herramienta: leads.search (13 propios de 255 de la org).
- Respuesta: agrupa por fecha y empresa (Adecco, GrupoExpro, Activos Chile), 13 personas con cargo. Buen formato.
- Detalles: correo en `código` (backticks), cierre técnico «La consulta devolvió 13 contactos y no indicó que la lista estuviera truncada.» No sugiere siguiente paso (12 de 13 sin correo → ofrecer enriquecer/revisar).
- C5 V5 U3 F4 R3.

## C9 Entregabilidad
### T1 «revisa si mi dominio esta bien configurado pa no caer en spam» — run 0bf28439
- Latencia: cola 105 s (3 trabajos en cola, 1 por minuto) + proceso 7 s = 112 s. Sin herramientas.
- Respuesta: «Pásame el dominio desnudo (por ejemplo, ejemplo.cl) y revisaré sus registros MX, SPF, DKIM y DMARC. La comprobación de DKIM puede quedar como desconocida…»
- C4 V5 U1 F2 R1. Pregunta algo que podía deducir (profile.get / deliverability.sender → yago.cl). «dominio desnudo» es jerga. Casi 2 minutos de espera para recibir una pregunta.
### T2 «yago.cl» — run 1dd95809
- Latencia: 11 s + 16 s = 27 s. Herramienta: deliverability.check(yago.cl).
- Respuesta: resumen «advertencia», MX ok (5), DKIM ok (selector google), SPF ~all (softfail), DMARC p=none; recomendaciones graduales; aclara que DNS no garantiza bandeja de entrada.
- C5 V5 U4 F4 R4. Hora en UTC («04:12 UTC») para un usuario en Chile. Algo de jerga técnica sin explicar (softfail, rua).

### C3 T2 «y que sabemos de la nehal de adecco? vale la pena escribirle?» — run 92655919
- Latencia: cola 64 s + proceso 26 s = 90 s. Herramientas: leads.search(Nehal) ✔ resolvió «la nehal de adecco», compliance.check, research.get_existing.
- Respuesta: «Nehal figura como Recruitment Manager de Adecco… no tiene correo registrado. No hay investigación guardada y la revisión de cumplimiento bloquea el contacto por falta de email. ¿Vale la pena escribirle? Es una posibilidad… no sabemos si tiene el problema que resolvemos… No la priorizaría… ¿Qué necesidad específica de reclutamiento buscas abordar con Adecco?»
- C4 V4 U2 F3 R2. No propone el paso obvio (enriquecer correo → investigar) aunque el prompt lo pide: agotó las 3 lecturas y mustAnswer lo obliga a responder sin poder proponer. Pregunta al usuario qué vende porque la oferta llega como «[object Object]» (bug app.context). «la revisión de cumplimiento bloquea el contacto» es jerga interna.

## C4 Prospección
### T1 «necesito encontrar gerentes de operaciones de empresas mineras en antofagasta» — run ad4ff647
- Latencia: cola 104 s + proceso 8 s = 112 s. Sin lecturas; propone búsqueda.
- Criterios: cargos «Gerente de Operaciones», «Operations Manager»; sectores «minería», «mining»; ubicación persona «Antofagasta, Chile»; seniority manager; 25.
- C5 V5 U4 F4 R4. Criterios razonables; podría sumar cargos equivalentes del rubro (Superintendente/Jefe de Operaciones) y no restringir a seniority manager. Tarjeta de aprobación clara. No hay mensaje del asistente que explique la propuesta (solo la tarjeta).
- Aprobado 04:17:21.

### C4 resultado de la búsqueda (aprobada 04:17:21)
- search.started 04:18:09 (48 s de cola tras aprobar) → 25 personas a las 04:18:12. Mayoría proveedores/contratistas mineros (Electromin, Metso Outotec, Schwager, T-Metal, Radiadores Gómez, Constructora BAICAL…), no necesariamente «empresas mineras».
- Respuesta fija: «Búsqueda terminada. Revisa los contactos encontrados; todavía no se han guardado en tu base.»
- NO se creó el trabajo de continuación automática (tampoco tras el enriquecimiento de las 00:27). En producción el hilo se detiene tras cada aprobación. admitCoworkContinuation traga el error sin registrar nada → imposible diagnosticar desde logs.

## C11 Informe para el jefe
### T1 «hazme un informe de como vamos con la prospeccion este mes pa mandarselo a mi jefe» — run d6e3b7b1
- Latencia: cola 89 s + proceso 24 s = 113 s. Herramientas: metrics.overview, metrics.rates, metrics.diagnose.
- Chat: 3 párrafos (~900 caracteres) que repiten el documento; jerga («denominador», «cobertura de Gmail y Outlook figura como desconocida», «no se verificó el buzón completo»).
- Documento «Informe de prospección — últimos 30 días»: todo en cero, «tasas no calculables», «hipótesis… inconclusas». Filtra el código interno «*last_30_days*». Próximo paso genérico («acordar un segmento, una meta…»).
- C4 V4 U2 F3 R3. Para un jefe no sirve: no usa la actividad real del mes (13 contactos guardados el 10 y 22 sep, 19 campañas, búsquedas hechas), solo métricas de envío. Las lecturas devuelven claves técnicas (last_7_days, per_contact, contacted_leads, coverage null) que el modelo copia.

### C4 T2 «buenisimo, guarda los 3 que te parezcan mas relevantes para vender software de reclutamiento y buscales el correo» — run 4a5aa02f
- Latencia: cola 7 s + proceso 10 s = 17 s hasta la tarjeta. Sin lecturas.
- Propone UNA sola aprobación: «Guardar contacto Carlos Ah***a (Minera Centinela)» (buena elección: minera real). No hay texto que explique por qué uno solo ni cuáles serían los otros dos, ni que el correo viene después.
- Aprobado 04:25:42 → ejecutado 04:26:04–04:26:06 → «Carlos Ah***a quedó guardado en tus contactos.» Sin continuación: el hilo se detiene. Para cumplir el pedido (3 guardados + 3 correos) harían falta ~6 mensajes y 6 aprobaciones.
- C4 V5 U2 F3 R1.

## C8 Campaña de prueba (solo nicogun123@gmail.com)
### T1 «quiero armar una campaña de prueba de 3 correos solo para mi contacto de prueba nicogun123@gmail.com, ofreciendo nuestro servicio. muestrame los mensajes antes de crearla» — run 6b44e728
- Latencia: cola 45 s + proceso 19 s = 64 s. Herramientas: message.context, campaigns.list.
- Respuesta: explica que el contexto de mensajes tiene tono aprobado pero no oferta; no sabe qué servicio ofrecer; menciona que existe «Campaña de prueba» con 7 destinatarios y que no la tocará; pregunta «¿Qué servicio concreto quieres ofrecerle a Nico y qué problema ayuda a resolver?».
- C4 V4 U3 F4 R3. Pregunta razonable, pero la oferta existe en el perfil de empresa y no le llega (bug «[object Object]»). Asume el nombre «Nico» desde el correo.
- Nota UI: el primer envío del seguimiento se perdió (el cuadro se vació y no se creó trabajo); el segundo intento funcionó.

### C8 T2 «ofrecemos ANTON.IA, una plataforma que automatiza la prospeccion b2b…» — run 6c3c8b98
- Latencia: cola 24 s + proceso 12 s = 36 s. Sin lecturas.
- Tres correos en el chat (no en documento), saludo neutro «Hola,», sin promesas ni cifras, cierre con pregunta. Algo repetitivos (los tres re-describen el producto), sin firma ni CTA concreto (reunión de 15 min). Ofrece crear la campaña como borrador pausado tras aprobar textos.
- C5 V5 U4 F4 R4.

### C8 T3 «me gustan, dale creala» — run 0f4f116d
- Latencia: cola 37 s + proceso 36 s = 73 s. Herramientas: app.context, campaigns.list.
- Respuesta: «Para proponer la campaña solo para Nico necesito elegir el proveedor de correo. Gmail y Outlook aparecen conectados… ¿La preparo con Gmail o con Outlook?»
- C5 V5 U3 F4 R2. Otro turno de fricción: podía proponer con Gmail (dominio en Google Workspace) y dejar el cambio en la tarjeta.

## C5 Investigar y escribir
### T1 «investiga a carlos, el que guardamos de minera centinela, quiero escribirle» — run 65fe3e8a
- Latencia: cola 64 s + proceso 16 s = 80 s. Herramienta: leads.search(Carlos) ✔.
- Propone «Enriquecer contacto Carlos Ah***a (Minera Centinela)» (1 crédito) — sigue la regla «sin correo, enriquecer antes de investigar». Sin texto que explique el plan (enriquecer → investigar → redactar).
- Aprobado 04:31:54 (enriquecimientos usados: 1/10).
- UI antigua: «1 contactos visibles», «1 contactos» (ya corregido en el rediseño).

### C5 resultado del enriquecimiento (aprobado 04:31:54)
- Ejecutado 04:32:05–04:32:11: el proveedor no encontró correo. Respuesta fija: «El proveedor no devolvió correo para este contacto. No se inventó ningún dato.» Sin continuación.

### C5 T2 «no encontro correo? ya, igual investigalo y preparame un correo para el» — run df7ede82 (25 sep 13:09)
- Latencia: cola 42 s + proceso 8 s = 50 s.
- FALLA: vuelve a proponer «Enriquecer contacto Carlos Ah***a (Minera Centinela)», el mismo efecto que acaba de fallar, ignorando el resultado del turno anterior y la instrucción explícita «igual investígalo». Habría gastado otro crédito. Descartado.
- C2 V3 U1 F3 R1. Causa probable: la regla «sin correo, propón enriquecer antes de investigar» domina, y el resultado del efecto previo solo aparece como texto de respuesta en history, no como dato estructurado.

## C10 Ley chilena
### T1 «oye y puedo mandarle correos a gente que no me ha dado permiso? que dice la ley en chile de eso» — run 2b56981d
- Latencia: cola 79 s + proceso 18 s = 97 s. Herramienta: compliance.law.
- Respuesta: Ley 19.628 (consentimiento o autorización legal, fuentes accesibles al público, derecho de oposición a publicidad), bajas y exclusiones, evidencia del origen del dato, Ley 21.719 con vigencia prevista 1 dic 2026 (y aviso de posible postergación), descargo «no es asesoría legal».
- C5 V4 U4 F4 R4. Buena. Filtra el código «do_not_contact». Falta ofrecer el siguiente paso (revisar bajas/restricciones de sus contactos antes de una campaña).

## C12 Pedido vago
### T1 «ayudame a vender mas, no se por donde partir» — run 5aee709f
- Latencia: cola 133 s (4 trabajos en cola) + proceso 29 s = 162 s. Herramientas: metrics.overview, metrics.rates, audience.analyze.
- Respuesta: «Partiría por validar qué problema resuelves y para quién…» + plan genérico de 3 pasos (definir oferta, elegir segmento y probar dos ángulos, medir por segmento) + pregunta «¿Qué producto o servicio vendes…?».
- C4 V4 U2 F3 R2. Consejo de manual; no usa los datos que consultó (256 contactos, sectores, cargos) para una recomendación concreta. Vuelve a preguntar qué vende (bug de la oferta). Jerga («denominador»).

## C13 Límite de capacidades
### T1 «agendame una reunion con carlos de minera centinela para el martes a las 10» — run 0fb9915d
- Latencia: cola 182 s + proceso 35 s = 217 s. Herramientas: contacted.search, leads.search(Carlos Minera Centinela), contacted.timeline.
- Respuesta: «No puedo agendarla desde aquí: no tengo una herramienta de calendario. … La cobertura del buzón no está verificada… ¿Te refieres al martes 29 de septiembre a las 10:00, y en qué zona horaria?»
- C4 V5 U2 F3 R2. Honesto con el límite, pero luego pregunta fecha y zona para algo que no puede hacer. Lo útil: ofrecer redactar la invitación por correo o LinkedIn (Carlos no tiene correo). Jerga de «cobertura».

## C15 LinkedIn
### T1 «a quien le deberia hacer seguimiento por linkedin esta semana?» — run 18436ca1
- Latencia: cola 234 s (5 en cola) + proceso 19 s = 253 s. Herramientas: linkedin.followups, linkedin.inbox.
- Respuesta: «…no aparecen candidatos elegibles… El barrido de la bandeja está incompleto… Antes de hacer seguimientos, completa el barrido y vuelve a revisar…»
- C4 V4 U1 F3 R1. «barrido» es jerga interna y no dice cómo completarlo (dónde, con qué botón). Callejón sin salida: no ofrece alternativa (p. ej. proponer invitaciones a contactos guardados con perfil LinkedIn, o revisar la cuota).

### C5 T3 «no, ya lo enriqueciste recien y no encontro correo. investigalo igual asi, sin correo» — run a039eebb
- Latencia: cola 161 s + proceso 8 s = 169 s. Propone «Investigar contacto Carlos Ah***a (Minera Centinela)». Hizo falta corregirlo. Aprobado 13:16:32.

### C8 T4 «con gmail» — run 02db31ea
- Latencia: cola 115 s + proceso 14 s = 129 s.
- FALLA: «No se pudo completar la respuesta. Tu solicitud sigue guardada.» Sin explicación. Causa probable: la propuesta campaign.create no pasa la validación del servidor (el destinatario debe ser un contacto guardado de la audiencia, o la definición no cumple el esquema) y el bucle convierte cualquier error en un fallo genérico.
- C1 V- U1 F1 R1. Tres turnos de preparación terminan en un error opaco.

### C5 resultado de la investigación (aprobada 13:16:32)
- Encolada 13:17:12–13:17:16 (informe nativo). Respuesta fija: «La investigación quedó en curso; el resultado se incorporará al retomarse el trabajo.» Pero en producción el trabajo no se retoma solo (sin continuación), así que la promesa no se cumple.

### C8 T5 (hilo nuevo) «arma la campaña de prueba de 3 correos para nicogun123@gmail.com con gmail… por que fallo antes?» — run 2d49dba2
- Latencia: cola 30 s + proceso 22 s. Herramientas: campaigns.list, message.context.
- FALLA otra vez con el mismo mensaje genérico. Falla reproducible al proponer la campaña: el destinatario debe ser un contacto guardado de la audiencia y el error del servidor se pierde. Además leads.search no busca por correo, así que el modelo ni siquiera puede comprobar si nicogun123@gmail.com está guardado.

### C5 T4 «ya termino la investigacion de carlos? que encontraste» — run ce5f2c23
- Latencia: cola 40 s + proceso 21 s = 61 s. Herramientas: leads.get, research.get_existing.
- Respuesta: la investigación quedó «insuficiente por falta de evidencia» (sin fuentes ni hallazgos atribuibles; nombre enmascarado y sin correo). No inició otra.
- C5 V5 U2 F4 R2. Honesta, pero sin siguiente paso (buscar otra persona de Minera Centinela con correo, mensaje por LinkedIn, correo genérico a la empresa).

### C5 T5 «ya, entonces escribeme igual un correo para el con lo que sepas de la empresa, y dime como consigo su correo» — run 471a1483
- Latencia: cola 27 s + proceso 27 s = 54 s. Herramienta: message.context.
- Correo genérico sin propuesta de valor («Quisiera entender qué desafíos… si hay algún tema concreto…»): no sabe qué vende el usuario (bug de oferta). Firma con «[Tu nombre]» en vez del nombre del perfil. Consejos genéricos para conseguir el correo (directorio, presentación) sin mencionar lo que ANTON.IA puede hacer (buscar a otra persona de la empresa con correo, LinkedIn). Bien: no repite el enriquecimiento fallido.
- C4 V5 U2 F3 R3.

## Resumen cuantitativo (24 trabajos del 25 sep, medido con el mismo verificador del corpus)
- 17 respuestas de texto, 4 acciones ejecutadas (búsqueda, guardado, enriquecimiento, investigación), 1 propuesta descartada (re-enriquecer), 2 fallos (campaña, 2 de 2 intentos).
- 15 de 17 respuestas (88 %) con al menos un problema; 11 de 17 (65 %) sin siguiente paso concreto; 10 de 17 (59 %) con jerga o códigos internos.
- Continuaciones automáticas tras aprobar: 0 de 4.
- Espera en cola: mediana 63 s, máximo 234 s. Proceso: mediana 19 s, máximo 36 s.
