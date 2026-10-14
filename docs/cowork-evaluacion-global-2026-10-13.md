# Cowork · Evaluación global y mejoras (13 oct 2026)

Medición de Cowork completo, como lo usa una persona: portada, flujos, respuestas, tarjetas de aprobación, proactividad, tiempos, móvil y modo oscuro. La meta era una nota de 4,5 sobre 5 con lectores ciegos.

## Resumen

- **Cowork pasó de 3,5–3,8 a 4,6.** La versión anterior a estas iteraciones (las mismas respuestas, leídas de nuevo en cada ronda) queda entre 3,45 y 3,84 en todas las rondas. Con las iteraciones 1 a 20 (PRs #339, #341, #343 a #346, #348 y #350 a #359), la versión final se midió en dos rondas seguidas (21 y 22) con dos lectores ciegos cada una:
  - **Luna, el modelo de producción:** 4,61 · 4,73 · 4,41 · 4,54 → **media 4,57**, tres de cuatro lecturas sobre 4,5, a **US$ 0,005 por tarea**.
  - **Haiku 5.5 coordinador + Sonnet 5.5 Redactora:** 4,45 · 4,51 · 4,61 · 4,76 → **media 4,58**, a US$ 0,022–0,025 por tarea.
- **Recomendación: Luna en producción.** Llega a la meta con la misma nota que Haiku + Sonnet a una quinta parte del costo. Haiku + Sonnet queda como alternativa si se prefiere un poco más de consistencia en los correos. No se tocó la configuración de modelos de producción.
- **Variación entre corridas:** la misma versión se mueve ±0,1 a ±0,2 de una ronda a otra, porque cada escenario corre una vez y el modelo no es determinista. Por eso cada ronda tiene dos lectores, la base se vuelve a leer en cada una y la versión final se midió dos veces.

## Cómo se mide

- **App local:**
  - Supabase local con todas las migraciones de `main`.
  - Flags de Cowork iguales a los de producción (`apphosting.yaml`).
  - Una cuenta de prueba con 7 contactos guardados: 4 con correo, 3 sin correo, ninguno con perfil de LinkedIn.
  - Ninguna campaña.
  - Nada sale a proveedores externos: sin Apollo, sin envíos y sin investigación externa.
- **14 escenarios** que recorre un navegador (Playwright) como lo haría una persona: escribe, toca atajos y aprueba. Quedan capturas, texto, tiempos, errores de red y el costo de cada escenario, y la base se reinicia entre escenarios.
  - Portada.
  - Pendientes de hoy, seguido de «dale, ¿por dónde parto?».
  - Escribir a mis contactos.
  - A quién le escribo hoy, seguido de «escríbele al primero».
  - Mejorar un correo pegado, seguido de «más corto y menos vendedor».
  - Buscar prospectos.
  - ¿Cómo voy?, seguido de «¿qué debería hacer para mejorar?».
  - Contactos sin correo.
  - ¿Qué puedes hacer?
  - Invitar por LinkedIn.
  - Escribir a una persona y su seguimiento.
  - Una pregunta con una propuesta pendiente.
  - Móvil a 390 px.
  - Modo oscuro.
- **Lectura ciega:** en cada ronda, dos lectores independientes reciben cada escenario en dos o tres versiones con etiquetas al azar. No saben cuál es la base. Puntúan cada escenario con la pauta `cowork-global-v1`:
  - R · Resultado;
  - E · Esfuerzo;
  - P · Proactividad;
  - C · Claridad;
  - F · Fluidez y confianza;
  - V · Visual, en portada, móvil y modo oscuro.

  Nota = 85 % del promedio de las tareas + 15 % de V. Escala: 5 = lo haría una persona experta · 4 = sirve con un detalle menor · 3 = sirve con fricción o un error visible · 2 = hay que rehacer o insistir · 1 = no logra la tarea.

## Resultados por ronda

| Ronda | Versión | Lector A | Lector B | Media | Costo por tarea |
|---|---|---|---|---|---|
| 2 | `main` anterior | 3,67 | 3,49 | 3,58 | US$ 0,012 |
| 2 | Iteraciones 1–2, Haiku | 4,13 | 4,04 | 4,08 | US$ 0,011 |
| 2 | Iteraciones 1–2, coordinador Sonnet | 4,13 | 4,21 | 4,17 | US$ 0,144 |
| 6 | Iteración 4c, Haiku | 4,21 | 4,29 | 4,25 | US$ 0,013 |
| 6 | Iteración 4c, Luna | 3,89 | 4,02 | 3,96 | US$ 0,005 |
| 8 | Iteración 5b, Haiku | 4,38 | 4,07 | 4,22 | US$ 0,011 |
| 8 | Iteración 5b, Haiku + Redactora Sonnet | 4,51 | 4,32 | 4,42 | US$ 0,027 |
| 9 | Iteraciones 5–7, Haiku + Sonnet | 4,41 | 4,39 | 4,40 | US$ 0,027 |
| 9 | Iteraciones 5–7, Luna | 4,29 | 4,38 | 4,34 | US$ 0,005 |
| 10 | Iteración 8, Haiku + Sonnet | 4,43 | 4,63 | 4,53 | US$ 0,023 |
| 10 | Iteración 8, Luna | 4,43 | 4,59 | 4,51 | US$ 0,005 |
| 11 | Iteración 9, Haiku + Sonnet | 4,34 | 4,18 | 4,26 | US$ 0,025 |
| 11 | Iteración 9, Luna | 4,37 | 4,24 | 4,31 | US$ 0,005 |
| 12 | Iteración 10, Haiku + Sonnet | 4,38 | 4,46 | 4,42 | US$ 0,025 |
| 12 | Iteración 10, Luna | 4,40 | 4,55 | 4,48 | US$ 0,005 |
| 13 | Iteración 11, Haiku + Sonnet | 4,71 | 4,28 | 4,50 | US$ 0,022 |
| 13 | Iteración 11, Luna | 4,54 | 4,17 | 4,36 | US$ 0,005 |
| 14 | Iteración 12, Haiku + Sonnet | 4,38 | 4,50 | 4,44 | US$ 0,021 |
| 14 | Iteración 12, Luna | 4,44 | 4,44 | 4,44 | US$ 0,005 |
| 15 | Iteración 13, Haiku + Sonnet | **4,66** | **4,58** | **4,62** | US$ 0,025 |
| 15 | Iteración 13, Luna | 4,44 | 4,37 | 4,41 | US$ 0,0055 |
| 16 | Iteración 14, Haiku + Sonnet | **4,64** | **4,73** | **4,69** | US$ 0,028 |
| 16 | Iteración 14, Luna | 4,25 | 4,36 | 4,31 | US$ 0,0058 |
| 17 | Iteración 16, Haiku + Sonnet | 4,48 | 4,40 | 4,44 | US$ 0,023 |
| 17 | Iteración 16, Luna | 4,48 | 4,38 | 4,43 | US$ 0,0052 |
| 18 | Iteración 17, Haiku + Sonnet | 4,64 | 4,62 | 4,63 | US$ 0,025 |
| 18 | Iteración 17, Luna | 4,49 | 4,46 | 4,48 | US$ 0,005 |
| 19 | Iteración 18, Haiku + Sonnet | 4,18 | 4,28 | 4,23 | US$ 0,020 |
| 19 | Iteración 18, Luna | 4,35 | 4,51 | 4,43 | US$ 0,0051 |
| 20 | Iteración 19, Haiku + Sonnet | 4,32 | 4,13 | 4,23 | US$ 0,019 |
| 20 | Iteración 19, Luna | 4,49 | 4,36 | 4,43 | US$ 0,005 |
| 21 | Iteración 20, Haiku + Sonnet | 4,45 | 4,51 | 4,48 | US$ 0,022 |
| 21 | **Iteración 20, Luna** | **4,61** | **4,73** | **4,67** | US$ 0,0049 |
| 22 | Iteración 20 (confirmación), Haiku + Sonnet | 4,61 | 4,76 | 4,69 | US$ 0,025 |
| 22 | **Iteración 20 (confirmación), Luna** | 4,41 | **4,54** | 4,48 | US$ 0,0049 |

La base (`main` anterior, mismas transcripciones de la ronda 3, leídas de nuevo en cada ronda) queda entre 3,45 y 3,84 en todas las rondas. Las rondas 1, 3 a 5 y 7 quedan en el borrador de trabajo; la tabla deja las que comparan modelos o cierran una iteración.

## Qué cambió

- **Pendientes y portada:**
  - «¿Qué tengo pendiente?» cuenta como trabajo del día a los contactos con correo que nunca recibieron nada, con sus nombres, como ya hacía la portada.
  - La portada tiene un solo botón principal («Escribirles»).
  - La lista de conversaciones vacía empieza cerrada.
- **Menos pasos:**
  - Un «sí», «dale» o «escríbele al primero» hace lo que se ofreció.
  - Buscar correos o perfiles ofrecido en palabras sale como su tarjeta.
  - Un «sí» a una campaña lleva el correo que la persona vio.
  - Las preguntas que ofrecen algo traen su atajo con nombre («Sí, crear la campaña»).
- **Correos:**
  - Seguimiento en el mismo hilo («Re:») con otra pregunta.
  - «Más corto» que acorta de verdad y dice cuánto.
  - La demo se conserva salvo que se pida quitarla o hacerlo «menos vendedor», y en ese caso se avisa.
  - Despedida antes de la firma.
  - La vista previa usa los datos del primer destinatario.
  - La respuesta no describe cambios que no existen ni reuniones que el correo no pide.
- **LinkedIn:** «Preparar contactos» busca el perfil de LinkedIn de los contactos sin perfil (1 crédito por persona), primero a quienes dirigen el área. Si nadie tiene perfil, esa tarjeta reemplaza a una búsqueda de prospectos o a «sincroniza tu red», y el texto dice a quién incluye y quién queda para después.
- **Contactos sin correo:** «tengo contactos sin correo» siempre termina en la tarjeta para buscar sus correos, con los nombres y el costo, aunque el modelo responda sin leer o escriba un correo que nadie pidió.
- **Cifras:** «¿Cómo voy?» siempre trae la tarjeta de cifras, también en 0.
- **Siguiente paso:** todo correo con destinatarios termina ofreciendo la campaña pausada («con los dos correos» si incluye el seguimiento), y un «dale» a esa oferta la crea en el mismo turno.
- **Coherencia (iteraciones 16 a 20):**
  - Una dirección copiada con un error vuelve a la del contacto leído, así que nadie queda fuera de la campaña.
  - Con un correo por persona, nadie del encargo queda sin el suyo.
  - El texto cuenta las mismas personas que la tarjeta.
  - Los cargos buscados quedan como compradores.
  - El cupo de LinkedIn se dice con su cifra.
  - «Mantener la demo» siempre trae su aviso.
  - El seguimiento de un correo aún no enviado va en la misma campaña.
- **Tono:** «mejorar este correo» marca «Nos encantaría…» y «Somos X y tenemos…». Se quitan las frases de cautela que los lectores leían como jerga y «¿Qué puedes hacer?» cierra con un paso concreto.
- **Tarjetas:**
  - Una sola tarjeta para buscar correos, con casillas y el costo en el botón.
  - Sin jerga («enriquecer», «lote»).
  - Los botones quedan a la vista en el teléfono.
- **Visual:**
  - El teléfono va de borde a borde, sin título repetido.
  - Los atajos van en filas en vez de cortarse.
  - El acento en modo oscuro es más claro.
  - Los atajos de la portada entran juntos: antes, al cargar «Para hoy», algunos repetían su animación y quedaban invisibles un momento.
  - El título de una conversación es la primera frase del pedido.
  - En modo oscuro los botones rellenos usan azul profundo con texto blanco.
  - Los pendientes se ordenan por cargo, primero quien dirige el área.

## Lo que sigue bajando la nota

- **Pasos sueltos del modelo:** a veces repite el diagnóstico tras un «dale» antes de avanzar, la primera versión de «mejorar este correo» cambia poco o el correo es más genérico. Pasa en una o dos de catorce tareas por ronda, y cambia de tarea entre corridas.
- **Tarjeta de campaña:** con una sola persona repite el correo (por persona y como secuencia).
- **Tiempos:** los turnos que escriben y proponen la campaña tardan entre 40 y 60 s.

## Límites

- Una sola cuenta de prueba y 14 escenarios: la nota mide estos flujos, no todo Cowork.
- Sin proveedor externo: la búsqueda de prospectos y la de correos y perfiles se evalúan por la propuesta, no por los resultados.
- Cada escenario corre una vez por ronda: la variación entre corridas es de ±0,2.
