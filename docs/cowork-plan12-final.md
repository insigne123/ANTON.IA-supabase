# Cowork · Plan 12, informe final (6 oct 2026)

El Plan 12 buscaba que Cowork trabaje como un colaborador personal para quien busca clientes y oportunidades:

- que haga el trabajo en vez de devolverlo;
- que muestre lo que arma en el lienzo, al lado del chat;
- que pueda escribir artefactos a medida;
- que recuerde lo que el usuario le pide.

Este informe junta la medición final con el modelo real, la comparación de modelos, lo que entró en la última ronda y lo que queda.

## Resumen

- **Uso real** (pedidos reales del usuario): «mala» bajó de 58 % al empezar a **32,5 %**, y el turno es más rápido (11,1 s de mediana).
- **AXIS**, el banco más exigente: mejora poco. El resto de AXIS bajó de 72 % a 58 % de «mala», pero AXIS ★ quedó en 65 %.
  - **La queja más repetida del juez:** la respuesta ofrece revisar algo que Cowork podía consultar antes de responder.
  - Esta ronda le da a esa consulta la decisión que le faltaba (ver «Lo que entró en esta ronda»).
- **Coordinador:** sigue en `gpt-6-luna`. `gpt-6.1-sol` responde mejor en uso real, pero tarda el doble.
- **Astra:** por decisión del usuario, ANTON.IA ya no usa modelos astra en ningún caso (#216).

## Medición final

Coordinador `gpt-6-luna` con la Redactora y texto en vivo; juez `gpt-6-sol`, el mismo de la línea base y la ronda 1.

| Corpus | Medición | Verificaciones | «Mala» | Utilidad | Fricción | Veracidad | Mediana del turno |
|---|---|---:|---:|---:|---:|---:|---:|
| Uso real | Línea base (× 3) | 96,7 % | 58 % | 3,43 | 3,37 | 4,20 | 11,7 s |
| | Ronda 1 (× 2) | 96,5 % | 47,5 % | 3,60 | 3,38 | 4,28 | 14,6 s |
| | **Final (× 2)** | **97,4 %** | **32,5 %** | **3,93** | **3,85** | **4,30** | **11,1 s** |
| AXIS ★ | Línea base (× 3) | 70,1 % | 55 % | 2,97 | 3,27 | 4,02 | 19,4 s |
| | Ronda 1 (× 1) | 69,8 % | 50 % | 3,10 | 3,25 | 4,35 | 21,8 s |
| | **Final (× 2)** | 69,1 % | 65 % | 2,90 | 3,08 | **4,40** | **17,5 s** |
| AXIS resto | Línea base (× 3) | 68,5 % | 72 % | 2,83 | 2,75 | 3,97 | 16,1 s |
| | Ronda 1 (× 1) | 69,6 % | 62,5 % | 3,25 | 3,13 | 4,17 | 22,3 s |
| | **Final (× 1)** | **70,4 %** | **58,3 %** | **3,29** | **3,17** | 4,08 | 21,9 s |

- **Uso real mejora en todo:**
  - «mala» cae a la mitad desde la línea base;
  - utilidad +0,50 y fricción +0,48;
  - el turno vuelve a ser rápido.
- **AXIS ★ no mejora:** 65 % de «mala», con 40 respuestas; la ronda 1 tenía solo 20.
  - Sus casos piden ejecutar procesos largos: cadencias de 7 toques, barrer la bandeja, campañas en tandas.
  - **La queja que más se repite:** la respuesta ofrece revisar algo que Cowork podía consultar antes.
- **Turnos fallidos:** 2 de 104, y los dos quedaron arreglados en esta ronda.

**Con qué se midió:** la medición corrió como está producción hoy. La consulta ofrecida (`COWORK_OFFERED_READS_ENABLED`) estaba apagada, y la Analista no existía.

### Lo que más pesa en las respuestas «mala»

En las 104 respuestas calificadas hay 53 «mala». Su primera queja se reparte así:

| Primera queja del juez | Respuestas «mala» |
|---|---:|
| Ofrece revisar algo que podía consultar antes de responder | 15 |
| Devuelve una decisión que podía tomar («¿a cuál le escribo primero?») | 5 |
| Le deja al usuario trabajo que Cowork puede hacer (guardar o importar contactos) | 4 |
| Una cifra o un dato sin respaldo en lo consultado | 3 |
| Botones «sí» y «no» para la misma pregunta | 3 |
| Dice que entrega más de lo que se ve (7 respuestas, 3 tarjetas) | 2 |

De las 104 respuestas, 21 (el 20 %) cierran ofreciendo una consulta que Cowork podía hacer.

## Comparación de modelos para el coordinador

Primer intento de cada caso, con el mismo juez.

| | Uso real: «mala» | Utilidad | Fricción | Mediana | AXIS ★: «mala» | Mediana |
|---|---:|---:|---:|---:|---:|---:|
| `gpt-6-luna` | 35 % | 3,90 | 3,80 | 15,2 s | 60 % | 20,5 s |
| `gpt-6.1-sol` | **15 %** | **4,25** | **4,45** | 23,6 s | 60 % | 33,8 s |

**La decisión: el coordinador sigue en `gpt-6-luna`.**

- **Lo que gana `gpt-6.1-sol`:** en uso real responde mejor y con menos fricción.
- **Lo que no gana:** en AXIS ★ empata.
- **Lo que cuesta:** tarda el doble y gasta más créditos.

**Uso puntual de `gpt-6.1-sol`:** queda para casos medidos uno por uno, como el juez de una medición chica. Cambiar el modelo de un rol es una variable de entorno (`COWORK_MODEL`, `COWORK_WRITER_MODEL`, `COWORK_ANALYST_MODEL`).

**Astra:** se midió una vez en esta ronda, antes de la decisión del usuario de no usarlo.

- Tardaba 40 s de mediana y uno de sus turnos venció el plazo.
- Desde #216, `src/ai/openai-json.ts` bloquea cualquier modelo astra antes de llamar a OpenAI.
- `AGENTS.md` deja la regla escrita para los agentes.

## Lo que entró en esta ronda

PR `claude/cowork-ronda-final`:

1. **Una lectura no disponible ya no hace fallar el turno.**
   - **Qué pasaba:** en «muéstrame mi pipeline en un gráfico», el modelo pedía las oportunidades junto con el CRM, en una cuenta sin «Oportunidades».
   - El ciclo devolvía la decisión entera, el modelo la repetía y el turno se quedaba sin decisiones.
   - **Ahora:** la lectura que no está se deja fuera, con su paso del plan, y las demás corren.
2. **La consulta ofrecida tiene lugar.**
   - **Qué pasaba:** con `COWORK_OFFERED_READS_ENABLED`, una respuesta que ofrece revisar algo hace esa consulta y se corrige. Para eso necesita dos decisiones libres, y en los turnos que ya habían leído en dos decisiones no quedaban.
   - **Ahora:** suma esas dos, hasta las 5 llamadas que la base ya admite por turno, si hay tiempo.
3. **Sin botón «No por ahora».** El botón que solo declina («No por ahora», «Lo revisaré por mi cuenta») no se muestra. Un «no» que informa algo («No está confirmado») sí se muestra.
4. **El banco AXIS lee los archivos como producción.**
   - **Qué pasaba:** el caso de la cadencia de 7 toques traía el archivo con otra forma, así que el ciclo no lo reconocía y rechazaba la tarjeta para preparar la lista. Por eso el turno fallaba en la medición; en producción no fallaba.
   - **Ahora:** propone limpiar el archivo con su tarjeta.
5. **La evaluación muestra más:**
   - qué decisiones rechazó el ciclo y por qué;
   - cuántas respuestas cierran ofreciendo una consulta (`answersOfferingReads`);
   - el flag `--analyst`.
6. **La Analista (4b):** ver la sección siguiente.

**Medición de los arreglos** (6 oct, solo `gpt-6-luna`, con `COWORK_OFFERED_READS_ENABLED`). Son los casos donde la ronda final cerraba ofreciendo una consulta, más los dos turnos que fallaban:

- **Cierres que ofrecen consultar:** en los casos de AXIS de este grupo, la ronda final tenía 8 de 9 (d2, g1, e3, g3 y h5). Ahora queda 1 de 5, en d2.
  - En g1, e3 y g3 la respuesta ya no ofrece revisar: termina proponiendo la acción con su tarjeta (una búsqueda, la invitación, pausar la campaña).
- **La decisión extra:** no hizo falta en esta muestra. La consulta ofrecida se hizo dentro de las 4 decisiones de siempre (d2 y `ur-pipeline-grafico`).
- **Turnos fallidos:** 0 de 25, también en «pipeline en un gráfico» y en la cadencia de 7 toques.
- **Juez en estos 7 casos:** 1 buena, 3 mejorable y 3 mala.
  - Las tres «mala»: una cifra sin respaldo (h5), un siguiente paso que no lleva al gráfico pedido (pipeline) y una consulta que todavía ofrece (d2).

## Especialistas (4b): la Analista

**Qué es:** cuando el usuario pregunta por sus resultados («¿cómo me ha ido?», «¿qué canal funciona?», «¿qué pasó con la tanda?»), la coordinadora consulta los datos y le pasa la pregunta a la Analista con `analysis.write`. La Analista escribe la respuesta del turno con un prompt hecho solo para eso (`src/lib/cowork/analyst.ts`):

- **Primero la conclusión:** con su cifra y sobre qué se calcula («4 de 46 envíos»).
- **Las malas noticias van primero.**
- **Muestra chica:** si hay pocos datos, dice que no es concluyente y hacia dónde apunta.
- **Lo ya consultado se usa:** nunca ofrece revisarlo después.
- **Las cifras van en tarjetas** y un siguiente paso concreto.

En pantalla aparece como «Analista · analizando tus cifras…».

**Medición** (6 oct, solo `gpt-6-luna`, con juez `gpt-6.1-sol`). Son los 9 casos de análisis (a1, a2, b1, b3, d4, d6, h1 y h4 de AXIS, y `ur-como-me-ha-ido`), × 1, con y sin la Analista:

| | Sin la Analista | Con la Analista |
|---|---:|---:|
| Juez: buena / mejorable / mala | 0 / 3 / 6 | 1 / 5 / 3 |
| Utilidad | 3,11 | 3,33 |
| Fricción | 3,22 | 3,44 |
| Veracidad | 3,78 | 3,89 |
| Verificaciones | 92/131 | 89/131 |
| Mediana del turno | 18,2 s | 12,5 s |

- **Cuándo la usó:** la coordinadora le pasó la pregunta en 3 de los 9 casos (h1, h4 y `ur-como-me-ha-ido`).
  - En dos, la respuesta pasó de «mala» a «mejorable». En h4 siguió «mala»: omitió por qué quedaron retenidos dos correos.
- **Ruido:** la mejora de a1, de «mala» a «buena», no es de la Analista, porque no la usó.
- **La decisión:** la señal es positiva pero la muestra es chica. Queda conectada al worker detrás de `COWORK_ANALYST_ENABLED`, apagada.
  - Antes de encenderla conviene una medición con más repeticiones.
- **La Investigadora y la Prospectora:** siguen siendo solo nombres en pantalla. No se midieron, para no gastar más créditos.

## Tareas largas (4c): propuesta

No se construyó en este plan. Necesita un tipo de efecto nuevo en la base, una migración, y medirla con el modelo real cuesta varias rondas.

**Cómo funcionaría:**

- **Cuándo:** un pedido de 3 pasos o más, por ejemplo «busca 25 gerentes de RR. HH. de retail, guarda los 10 mejores, búscales el correo y escríbeles una secuencia».
- **La tarjeta de plan:** muestra los pasos, el costo («1 búsqueda del cupo, hasta 10 créditos») y lo que nunca hará sin preguntar, como enviar. Se aprueba una vez.
- **La ejecución:**
  - cada paso corre en una continuación, como hoy después de aprobar una tarjeta;
  - el lienzo muestra el avance de la tarea;
  - se detiene si un paso sale del plan aprobado, por un gasto mayor o un envío.
- **La base:** la cadena de continuaciones y `execution-policy.ts`, que ya aprueba solo ciertos efectos en modo autónomo. Lo nuevo es el efecto `task_plan`, con su tope de créditos, y la política que aprueba solo lo que cabe en él.

**Lo que se necesita para construirla:**

- **Tu OK a la migración** del efecto `task_plan`.
- **Créditos para medirla:** unas 3 rondas chicas.

## «Escribir sin investigar»: propuesta

**El objetivo:** escribir el primer correo sin esperar la investigación, de 1 a 3 minutos. Es el arreglo que más acortaría «Escribir el primer correo» en el banco de sencillez.

**El modo propuesto, «por cargo»:**

- El correo sale del cargo, la empresa, el rubro y la oferta del usuario, con el estilo predeterminado.
- No dice nada personal de la persona, porque no hay investigación que lo respalde.

**Lo que hay hoy:**

- **`native_drafts.research_snapshot_id`** ya admite un borrador sin investigación (comprobado con una lectura en producción).
- **Las otras dos tablas lo exigen:** `native_draft_generation_claims` (`20260822111000`) y `campaign_enrollments` (`20260825120000`). Eso pide una migración.
- **El contexto de redacción** (`draft-context-v2.ts`) bloquea un borrador sin evidencia verificable (`evidence_insufficient`). Es una salvaguarda a propósito.

**Lo que haría falta:**

1. **Una migración:** un campo `draft_basis` (`research` o `role`) en esas dos tablas, y que acepten la investigación vacía solo con `role`.
2. **El modo `role` en `draft-context-v2`:**
   - no pide evidencia, pero prohíbe afirmaciones sobre la persona;
   - la Revisora y `message-checks` lo verifican.
3. **En pantalla:** «Escribir sin investigar» junto a «Investigar», con la etiqueta «Correo por cargo».
4. **El envío no cambia:** pasa por las mismas revisiones de siempre.

**Necesita una decisión de producto** (cuánto puede personalizar un correo sin investigación) y tu OK a la migración.

## Para encender en producción

Lo hace el mantenedor, en el entorno de producción.

| Flag | Qué hace | Recomendación |
|---|---|---|
| `COWORK_OFFERED_READS_ENABLED` + `COWORK_ANSWER_HOLD_ENABLED` | La consulta que la respuesta ofrece se hace en el turno, y la respuesta se muestra una vez, ya corregida | Encender: ataca la queja más repetida |
| `COWORK_CODE_ARTIFACTS_ENABLED` | La Diseñadora escribe tableros y gráficos a medida en el lienzo | Encender: 20/20 artefactos se dibujan a la primera |
| `COWORK_PREFERENCES_ENABLED` | Cowork recuerda preferencias con una tarjeta | Encender después de su migración |
| `COWORK_ANALYST_ENABLED` | La Analista responde las preguntas de resultados | Apagado hasta medirla con más repeticiones: señal positiva en 9 casos |
| `COWORK_INTENT_PROMPTS_ENABLED` | Instrucciones por intención | Apagado: empeoró en la ronda 1 |

## Migraciones pendientes

Se aplican de a una en el editor SQL de Supabase. Después de cada una verifico esquema, RLS y logs, solo con lecturas.

1. **`20261005150000_crm_deal_values_stage_events.sql`:** el Pipeline como CRM (montos y fechas por etapa).
2. **`20261006150000_revoke_internal_functions_from_clients.sql`:** seguridad (#212). Siete funciones del worker dejan de poder ejecutarse sin sesión.
3. **`20261006160000_cowork_memory_save_effect.sql`:** preferencias (#215). Agrega el efecto `memory_save`.

## Uso del modelo en las mediciones

Llamadas a OpenAI de las mediciones del 6 de octubre, desde las 14:30 UTC, cuando volvió el crédito:

| Modelo | Para qué | Llamadas | Tokens de entrada |
|---|---|---:|---:|
| `gpt-6-luna` | Cowork: coordinador, Redactora y Analista | 754 | 16,1 M |
| `gpt-6.1-sol` | Comparación de modelos (107) y juez de la medición chica (47) | 154 | 2,3 M sin el juez |
| `gpt-6-sol` | Juez de las rondas | 391 | sin dato |
| `gpt-6-astra` | Comparación de modelos, antes de la decisión de no usarlo | 99 | 2,25 M |

Cada decisión del coordinador lleva unos 24 mil tokens de entrada, casi todo instrucciones. Por eso un caso cuesta lo mismo aunque el pedido sea corto.

- **Cómo abaratarlo:** bajar ese tamaño abarataría cada turno y cada medición.
- **Lo que se probó:** las instrucciones por intención lo bajaban 22 %, pero empeoraban la calidad. Un núcleo más corto es la siguiente apuesta.
- **Desde la decisión del usuario:** las mediciones usan solo `gpt-6-luna`, y `gpt-6.1-sol` en casos puntuales.
