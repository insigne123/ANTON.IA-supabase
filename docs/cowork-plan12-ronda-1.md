# Cowork · Plan 12, ronda 1: la regla 4 y las instrucciones por intención (6 oct 2026)

La línea base (`docs/cowork-plan12-linea-base.md`) mostró una falla principal: Cowork **devuelve el trabajo**. Pregunta «¿quieres que…?» por lo que podía hacer, o pide un «sí» por una acción en vez de mostrar su tarjeta. La causa principal era la regla 4 de las instrucciones, «Cierra siempre con una pregunta cerrada». Esta ronda la cambia y prueba si mandar solo las instrucciones de cada intención ayuda.

Con la misma vara de la línea base: modelo `gpt-6-luna` con Redactora y texto en vivo, y juez `gpt-6-sol` con la misma regla de cierre (`COWORK_NEXT_STEP_RULE` no cambió para los jueces).

## Qué cambió

1. **La regla 4 nueva, «Termina el trabajo; no lo devuelvas»** (`agent-instructions.ts`):
   - **Sin aprobación, lo hace.** Lo que no lleva aprobación lo hace antes de responder: consultar, ordenar, priorizar, recomendar y redactar.
     - Nunca lo ofrece como pregunta («¿Reviso tu perfil?», «¿Por cuál empiezo?»).
     - Si le preguntan a quién invitar o escribir, responde con nombres y motivos.
   - **Con aprobación, lo propone.** Si el pedido es una acción con aprobación y ya sabe a quién, la propone en ese turno con su tarjeta, sin preguntar antes «¿Lo hago?».
   - **Varias cosas pedidas:** entrega lo que hizo y propone la más valiosa.
   - **Faltan datos:** entrega una primera versión con lo que hay y dice qué falta.
   - **La pregunta final** queda para un paso que no pidió o una decisión que es del usuario.
   - **Varios pasos:** el reply dice el plan completo.
2. **Arreglos que salieron al leer las respuestas:**
   - **Nombres enmascarados:** un nombre que llega enmascarado («Jose Ca\*\*\*o») se escribe tal cual; antes se completaba con el correo.
   - **Investigar a varias personas:** se propone en una sola tarjeta (`contacts.prepare_batch`, objetivo research). Con una persona sin correo, buscarlo es el primer paso de la investigación.
   - **Ficha de una cuenta:** se entrega con lo que hay (cargo, empresa, por qué le sirve la oferta, preguntas para la reunión) y marca lo pendiente.
3. **Instrucciones por intención** (`intents.ts`, detrás de `COWORK_INTENT_PROMPTS_ENABLED`, apagado):
   - Un clasificador sin modelo lee la primera línea del pedido y, si es un seguimiento corto, también el pedido anterior.
   - De ahí decide qué partes van: las recetas de agenda, cifras, correo, LinkedIn, cliente ideal, oportunidades, archivos y entregabilidad, y las capacidades de cada una.
   - El núcleo (las 12 reglas, el formato de salida y las lecturas de contactos y perfil) va siempre.
4. **La medición ahora es igual a producción:** los casos corren con «Preparar contactos» encendido, como en producción. En la línea base estaba apagado.

## Resultados

| Corpus | Medición | Verificaciones | Juez: mala | Utilidad | Fricción | Veracidad | Devuelve el trabajo | Mediana del turno |
|---|---|---|---|---|---|---|---|---|
| Uso real | Línea base (× 3) | 96,7 % | 58 % | 3,43 | 3,37 | 4,20 | 32 % | 11,7 s |
| | Regla 4 y arreglos (× 2) | 96,5 % | **47,5 %** | **3,60** | 3,38 | **4,28** | 30 % | 14,6 s |
| | + por intención (× 2) | 94,2 %, 2 turnos fallidos | 55 % | 3,43 | 3,35 | 3,93 | 30 % | 14,8 s |
| AXIS ★ | Línea base (× 3) | 70,1 % | 55 % | 2,97 | 3,27 | 4,02 | 37 % | 19,4 s |
| | Regla 4 y arreglos (× 1) | 69,8 % | **50 %** | **3,10** | 3,25 | **4,35** | **30 %** | 21,8 s |
| | + por intención (× 1) | 69,8 % | 55 % | 2,95 | 3,25 | 4,20 | 45 % | 18,2 s |
| AXIS resto | Línea base (× 3) | 68,5 % | 72 % | 2,83 | 2,75 | 3,97 | 47 % | 16,1 s |
| | Regla 4 y arreglos (× 1) | **69,6 %** | **62,5 %** | **3,25** | **3,13** | **4,17** | **42 %** | 22,3 s |
| | + por intención (× 1) | 67,7 % | 67 % | 2,96 | 3,04 | 4,25 | 33 % | 20,6 s |

En una primera corrida de la regla 4 sola (uso real × 1, antes de los arreglos), «devuelve el trabajo» bajó a 10 % y «mala» a 45 %. Con muestras de 20 a 40 respuestas el ruido es de varios puntos: las conclusiones salen de la dirección que se repite en los tres corpus, no de un solo número.

- **La regla 4 y los arreglos mejoran en los tres corpus:**
  - menos «mala» (de 5 a 10 puntos menos);
  - más utilidad (+0,13 a +0,42);
  - más veracidad (+0,08 a +0,33);
  - sin turnos fallidos.
- **Cuesta tiempo:** el turno tarda unos 3 a 6 segundos más en la mediana, porque ahora consulta y completa antes de responder en vez de preguntar.
- **Las instrucciones por intención bajan el 22 % de los tokens de entrada por decisión** (de unos 20.400 a 15.900), pero empeoran:
  - más «mala» y menos utilidad;
  - más trabajo devuelto en AXIS ★;
  - 2 turnos fallidos en uso real.
  - Con menos recetas a la vista, el modelo sabe menos de lo que puede hacer y vuelve a preguntar. **Quedan apagadas** (`COWORK_INTENT_PROMPTS_ENABLED=true` las enciende). El código y sus pruebas quedan para reintentarlo con un núcleo más corto.

## Lo que sigue

- **La Redactora cierra con «¿Creo la campaña pausada?».** Es el patrón que más queda en AXIS: c1, c4, c5 y e6.
  - Su respuesta termina el turno, así que no puede proponer la campaña con su tarjeta.
  - El arreglo: tras escribir, si el usuario pidió enviar o crear, el coordinador propone `campaign.create` con esos textos en el mismo turno.
- **Investigar sin correo:** investigar exige el correo buscado, y el juez lo marca como un gasto que no acerca la ficha. Lo resuelve la ficha con lo que hay, ya en la regla, y explicar en una frase por qué se busca el correo.
- **Lo visual** (tablero, pipeline en gráfico, ficha) llega con los artefactos con código (3b).
