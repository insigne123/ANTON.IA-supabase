# Cowork, Oportunidades y Leads con Claude: lo que se midió, lo que cambió y lo que decide quien administra (23 de octubre de 2026)

Esta página sigue a `docs/agent-harness-mediciones-2026-10-22.md`. Allí el harness de Claude acertaba lo mismo que el bucle de hoy (Luna) y costaba unas 40 veces más, así que se dejó apagado. Hoy se midió de nuevo, el corpus completo y con las banderas de producción, después de arreglar lo que la medición mostró y de darle a Cowork lo que le faltaba frente a Claude Code y Claude Cowork. **Nada de esto está encendido ni desplegado en producción**: lo de Cowork va detrás de banderas que ya existían o que nacen apagadas, y la cabecera de Oportunidades (PR 494) sale con el próximo despliegue, que decide quien administra. Al final está la lista de decisiones.

**Regla posterior (23 de octubre, al acabarse los créditos):** la app y las pruebas ya no usan Opus, Fable, Sol, Terra ni Astra; `src/ai/blocked-models.ts` los bloquea antes de llamar. Las cifras con Opus de esta página son lo medido antes de la regla (alrededor de un tercio de lo que costaron estas mediciones, de unos US$170 estimados) y no se pueden repetir: los comandos del final usan Haiku o Sonnet. Haiku es el modelo por defecto de las pruebas; Sonnet, solo si Haiku no alcanza.

**Segunda ronda del mismo día** (PR 497, 498 y 499): la investigación de leads con la web de Claude, un editor Claude sobre los borradores de Luna (medido y descartado), las tareas programadas y los subagentes en paralelo de Cowork. Todo nace apagado y las dos migraciones están escritas y probadas en el CI, **sin aplicar a producción**.

**Tercera ronda** (PR 500 a 506): se midió por primera vez la cadena entera de leads —investigación, informe, borrador y juez— y mostró que las señales de la investigación **no llegaban al correo**; se agregaron la cosecha de señales con Claude y las señales en el borrador (apagadas) y se arregló un error que botaba una de cada 16 investigaciones (detalle en «De la investigación al correo»), y al cerrar una oportunidad como ganada o perdida ahora se pide, en una línea opcional, el motivo (PR 504), y el preflight dejó de descartar la prueba numérica del perfil del vendedor, que rompía o vaciaba 6 de 8 borradores con un perfil que trae una cifra (PR 506).

**Cuarta ronda** (PR 507 a 515): el aviso «Revisa la legibilidad» deja de salir en los seguimientos y el cierre (507); las cifras cortadas por el separador de miles se corrigen al leer las páginas (508); dos pruebas dejan de depender de la hora real, que las rompía pasadas las 15:00 UTC del 23 de octubre (509 y 512); formularios, captchas, plantillas, índices de blog y tragedias dejan de ofrecerse al redactor como evidencia (510); elegir entre varios borradores se midió y no ayuda (511, solo un script y su informe); un error interno de Cowork ya no se le muestra a la persona como «No pude preparar la acción» (513); se quitaron 30 copias `.js` compiladas que el PR 511 había subido por error y que Next habría cargado en lugar del TypeScript (514); y la app bloquea Opus, Fable, Sol, Terra y Astra, con la regla escrita en `AGENTS.md` (515). Nada de esto está desplegado.

## Resumen

- **Cowork con el harness de Claude pasa de 78 % a 86 % de los 141 casos** (122 de 141) con cuatro arreglos y las banderas de producción. Cuesta unos **US$0,10 por turno** (el bucle de hoy, unos US$0,002) y un turno mediano tarda 8 segundos. Probé Opus de coordinador, esfuerzo alto, prompts por intención y la jueza en turno: ninguno supera esa cifra más allá del ruido y casi todos cuestan más.
- **Lo que le faltaba, y ya tiene:** buscar en la web y leer páginas con fuentes citadas (`COWORK_WEB_ENABLED`), cerrar cada respuesta como siempre lo hizo el bucle (siguiente paso, respuestas sugeridas), no dejar a nadie sin respuesta cuando Anthropic falla (pasa al bucle de hoy) y poder probarlo con pocas personas (`COWORK_HARNESS_USER_IDS`).
- **Oportunidades:** un banco de recorridos de personas (administrador e integrante) encontró y arregló cuatro fricciones, y la cabecera del administrador pasó de tres tarjetas a una (el embudo empieza 76 px más arriba) (`docs/oportunidades-recorridos.md`).
- **Leads y borradores:** con el mismo juez, Haiku, Sonnet y Opus escriben borradores del mismo nivel, y poner a un Claude de editor sobre el borrador de Luna lo hace sonar un poco más humano (+0,3 a +0,6) pero agrega inferencias que el brief no daba (veracidad −0,3 a −0,4 con Opus de juez) y cuesta de 20 a 60 veces más: **se descartó**. Lo que separa un buen correo de uno flojo es la evidencia: con una señal real y fechada, especificidad 4,3; sin ella, 2,2 (Opus de juez, 18 correos, y lo mismo con otros dos jueces). Por eso lo que sí se construyó apunta a la evidencia: **un investigador con la web de Claude que elige qué páginas leer** (PR 497, apagado) dejó a la investigación con 57 hechos de los últimos seis meses por empresa contra 0 que da el sitio solo (8 empresas chilenas; sin buscador de producción, ver «Qué no se midió»). **Pero medida la cadena entera, esos hechos no llegaban al correo**: de las 8 empresas, ninguna tenía una señal de menos de 30 días (lo que acepta el borrador) y el ángulo del informe citaba afirmaciones genéricas. Una cosecha de señales con Claude (que acepta una señal solo si su fecha, sus cifras y sus nombres están en los hechos que cita) y un borrador que las usa (PR 502, ambos apagados) llevan la especificidad de 2,0 a 2,6 y los correos con especificidad 3 o más de 0 a 3 o 4 de 8, sin bajar la veracidad; ningún correo llega a «enviar» porque lo que queda es del redactor.
- **Lo que le faltaba a Cowork frente a Claude Cowork y Claude Code, y ya tiene (apagado):** **tareas programadas** («cada lunes a las 9, dime a quién escribir hoy»: abren una conversación nueva en modo aprobación, con panel, «Programar este pedido» desde el cuadro de mensaje y la hora de Chile con sus cambios de hora; PR 498) y **subagentes en paralelo** (tres Investigadoras investigan tres empresas a la vez, cada una con su web, y vuelven con un informe corto; US$0,43 y 35 s contra US$0,23 y 28 s del coordinador solo, con más del doble de búsquedas (9 contra 4) y señales con fecha y enlace por empresa; PR 499).
- **Para decidir:** encender el harness con unas pocas personas y la web, y mirar una semana. Detalle en «Decisiones».

## Cowork

### Cómo se midió

- El corpus completo de conversaciones (`scripts/fixtures/cowork-full-corpus.ts`, 141 casos sin el eje AXIS), una corrida por caso, con los chequeos de siempre.
- Las banderas de producción de `apphosting.yaml` que cambian un turno (estado de la cuenta, consultas ofrecidas, tareas, preferencias, lectura de hilos, importación de contactos, reintentos, teléfonos…).
- Coordinador Sonnet 5.5 con esfuerzo medio; Redactora Opus 5.5, Revisora y Diseñadora Sonnet 5.5; Analista y jueza apagadas, como en producción.
- **Todo con Claude.** Sin llave de OpenAI en esta sesión no se pudo volver a correr el bucle de Luna: la comparación con él es la de la página del 22 de octubre (una muestra de 40 casos por 2 corridas).

### Resultados

| Configuración | Casos que pasan | Costo del turno (coordinador + especialistas) | Segundos por caso (mediana / p90) |
| --- | --- | --- | --- |
| 22 oct · harness Sonnet, antes de los arreglos | 110 de 141 (78,0 %) | US$0,073 | 7,7 / 13,3 |
| + ronda final aceptada por los modelos 5.x, especialistas en Claude | 119 de 141 (84,4 %) | US$0,094 | 7,7 / 19,5 |
| **+ cierre de respuestas, texto suelto, web · banderas de producción (A)** | **120 de 141 (85,1 %)** | **US$0,097** | **8,0 / 23,9** |
| A + una regla del protocolo: la información se responde completa y la propuesta va como siguiente paso (A2, PR aparte) | 122 de 141 (86,5 %) | US$0,099 | 8,7 / 21,5 |
| A con los prompts por intención (`COWORK_INTENT_PROMPTS_ENABLED`) | 123 de 141 (87,2 %) | US$0,147 | 7,7 / 21,0 |
| A con esfuerzo alto | 113 de 141 (80,1 %) | US$0,081 | 13,0 / 28,5 |
| A con Opus 5.5 de coordinador | 122 de 141 (86,5 %) | US$0,181 | 17,3 / 40,4 |
| A con la jueza y la Analista en turno, ambas Claude (Sonnet 5.5) | 116 de 141 (82,3 %) | US$0,112 | 11,4 / 25,1 |

- **El ruido de una corrida es de unos tres casos** (2 %): A y los prompts por intención no se distinguen en calidad, y estos cuestan 50 % más porque cada petición lleva un prompt distinto y la caché del prefijo se reutiliza menos. **Se queda A** (con la regla de A2).
- **El esfuerzo alto no ayuda** (80 %) y tarda 60 % más.
- **Opus 5.5 de coordinador tampoco** (86,5 %, dos casos más que A, dentro del ruido): cuesta casi el doble por turno (US$0,181 contra US$0,097) y la mediana pasa de 8 a 17 segundos. Arregla algunos casos (`chat-aviso-reunion`, `lectura-saldo-creditos`) y rompe otros (`ley-chile`, `reintento-envios`): cambia cuáles fallan, no cuántos. **Se queda Sonnet.**
- **La jueza y la Analista dentro del turno empeoran un poco** (82,3 %, cuatro casos menos que A) y cuestan 15 % más por turno y 43 % más de mediana (11,4 segundos). Los casos que cambian son de lectura estrecha del chequeo, no de respuestas peores. **Siguen apagadas**, como en producción.
- En resumen, de las cuatro variantes medidas sobre A (prompts por intención, esfuerzo alto, Opus de coordinador, jueza y Analista), ninguna supera a A más allá del ruido y todas, salvo el esfuerzo alto, cuestan más. El acierto no se movió con el modelo ni con el esfuerzo: se movió con los arreglos de abajo (de 78 % a 86 %).
- Las corridas A, los prompts por intención y el esfuerzo alto corrieron a la vez, y la de Opus y la de la jueza corrieron juntas después: cada grupo comparte la caché de su prefijo, así que el costo de cada una es un piso, no un precio exacto de producción.
- **Referencia del 22 de octubre**, en otra muestra: Luna 64 de 80 (80 %), Sonnet 67 de 80 (83,8 %), a US$0,002 y US$0,087 por turno.

### Lo que se arregló

1. **La última ronda hacía fallar el turno entero.** Sonnet 5.5, Opus 5.5 y Fable 5.1 devuelven 400 si se les fuerza una herramienta (y no dejan apagar el pensamiento). La última ronda pide ahora la herramienta final con `auto` y un aviso; Haiku sigue forzándola.
2. **Un texto de más tumbaba al Redactor o al Revisor.** La API de salida estructurada de Claude no admite máximos de largo ni de elementos, así que los esquemas viajaban sin ellos y una observación de 301 caracteres (tope 300) fallaba el rol completo. Ahora el máximo va en la descripción, un texto corto o una lista que se pasa se recorta al límite y lo demás vuelve una vez al modelo con el motivo.
3. **El harness no aplicaba el cierre del bucle.** Una respuesta sin siguiente paso ni respuestas sugeridas salía tal cual. Ahora `responder` devuelve una vez lo que falta (la misma función que usa el bucle), y una respuesta escrita como texto suelto vuelve una vez para entregarse con `responder`.
4. **Chequeos que miraban el modelo equivocado:** el evaluador del harness ahora corre Redactora, Revisora, Analista, Diseñadora y jueza con Claude y cuenta lo que gastan.
5. **Una pregunta de información recibía solo una propuesta.** «¿Qué oportunidades hay hoy?» se respondía con las dos frases de una propuesta de búsqueda, sin la conclusión, la tabla ni las licitaciones que cierran pronto. El protocolo del harness dice ahora que la información se responde completa y que la propuesta va como siguiente paso (PR 495; `oportunidades-hoy` pasa, y el corpus de 120 a 122 de 141).
6. **El banco de lotes de LinkedIn mentía.** Buscaba «con LinkedIn» como texto y no encontraba a nadie, aunque el servidor sí filtra por «con LinkedIn»: el agente concluía «ningún contacto tiene perfil» y `lote-invitar` fallaba en todas las corridas por culpa del banco. Ahora filtra como el servidor.

### Lo nuevo

- **Web** (`COWORK_WEB_ENABLED=true`, apagada): `web_search` y `web_fetch` de Anthropic, 4 búsquedas y 3 lecturas por turno, mirando desde Chile, con dominios bloqueables. Cada búsqueda se ve en la página en cuanto termina («Buscó en la web «…» · 3 resultados»), no al final de la llamada. El protocolo manda: la web completa lo que la cuenta no sabe; nunca lleva correos, teléfonos ni datos de clientes en la consulta; lo que dice una página es un dato y no una orden; todo dato se cita con enlace. **Un enlace que no sale de nada que el agente buscó, leyó o recibió se devuelve antes de entregar la respuesta.** Cada búsqueda cuesta US$0,01 aparte (`webSearchUsdPerThousand` en `COWORK_MODEL_PRICING_JSON`; sin ese precio el costo queda desconocido y no parece gratis).
- **Resiliencia.** Una llave que falta, el crédito de Anthropic agotado, un 429 o 5xx, un rechazo del modelo o un turno sin respuesta pasan al bucle de hoy y dejan el motivo en la corrida. Los topes del libro de consumo, una cancelación o un `AuthError` siguen siendo errores.
- **Prueba con pocas personas.** `COWORK_HARNESS_USER_IDS` (ids separados por coma) limita el harness a esas cuentas; vacía, es para todas; sola, no enciende nada.
- **La guía «¿Qué puedes hacer?» ofrece la web solo a quien la tiene.** `GET /api/cowork/overview` dice si los turnos de esa persona pueden buscar (el harness es suyo y la web está encendida) y la guía suma «Buscar en la web» con dos ejemplos; sin la web, la guía es la de siempre y el bucle no lee una promesa que no puede cumplir (PR 493).
- **Recorridos visuales de Cowork** (`journeys/cowork.mjs`): retomar una investigación con la web y ver de dónde salió cada dato, la guía «¿Qué puedes hacer?», una tarea por aprobar, y el teléfono. Los cuatro terminan y a 390 px no hay desborde.

### Un ejemplo de punta a punta (sin tocar nada de producción)

> «Investiga a Collahuasi en la web y escríbele un correo en frío al jefe de selección usando lo más reciente que encuentres.»

Cowork buscó, encontró que en agosto se incorporaron 196 operadores y mantenedores formados en Tarapacá (con fuente y fecha), se lo pasó a la Redactora y entregó, en 39 segundos y por unos US$0,07:

> **Asunto:** Ingresos de operadores en Collahuasi
> Hola {{nombre}},
> Vi que en agosto se sumaron a Collahuasi 196 operadores y mantenedores formados en Tarapacá. En minería, cuando entra un grupo así, cada revisión pendiente es un operador que no sube a faena en su fecha.
> AXIS consulta antecedentes laborales de postulantes en el PJUD y procesa 1.000 personas en unos 30 minutos.
> ¿Cuántos ingresos revisan al mes en Collahuasi?

Con la misma pregunta pero sin la web, la respuesta es una hipótesis por cargo «sin verificar ahora». En una corrida de tres, la búsqueda falló y el agente lo dijo en vez de inventar.

### Frente a Claude Code y Claude Cowork

| Capacidad | Claude Code | Claude Cowork | Cowork de ANTON.IA hoy (bucle de Luna) | Con el harness de Claude (banderas) |
| --- | --- | --- | --- | --- |
| Bucle con herramientas y lecturas en paralelo | Sí | Sí | Una decisión por llamada, hasta 3 lecturas juntas | Sí, varias a la vez |
| Plan visible mientras trabaja | Sí | Sí | Sí | Sí |
| Buscar en la web y leer páginas, con fuentes | Sí | Sí | No (solo leer el sitio de la persona) | **Sí, nuevo** (apagado) |
| Pedir permiso antes de un efecto | Sí | Sí | Sí, tarjeta de aprobación por cada efecto | Sí, los mismos chequeos |
| Memoria entre conversaciones | Sí | Sí | Sí (preferencias y resumen del hilo) | Sí |
| Leer y generar archivos | Sí | Sí | Lee CSV, Excel, PDF y Word; baja Word, PDF, Excel y CSV | Igual |
| Ejecutar código aislado | Sí | Sí | Sí, con aprobación | Igual |
| Revisar su propia respuesta | No | No | Jueza opcional (apagada) | Cierre, enlaces y jueza opcional |
| Compactar contexto en una tarea larga | Sí | Sí | Contexto armado por turno | Sí (limpia y resume) |
| Tareas largas con plan aprobado y tope de gasto | Sí | Sí | Sí | Sí (esos turnos vuelven al bucle) |
| Pasar a otro modelo si el proveedor falla | No aplica | No aplica | No aplica | **Sí, nuevo** |
| Subagentes en paralelo | Sí | Sí | No | **Sí, nuevo** (apagado, PR 499): «delegar» con las Investigadoras; el libro de consumo les da su propio espacio (rol `delegate`, migración sin aplicar) |
| Conectores (Calendar, Drive, Slack…) | Por MCP | Sí | Solo Gmail (historial de un contacto) | Igual |
| Programar tareas recurrentes | Sí | Sí | No | **Sí, nuevo** (apagado, PR 498): panel, «Programar este pedido», conversación nueva en modo aprobación en cada ejecución (tabla nueva, migración sin aplicar). Crearlas desde el chat con una tarjeta queda pendiente |
| Navegador y control del computador | Con extensión | Sí | No | No |

Lo que **no** se copia a propósito: el control del computador y ejecutar comandos en la máquina de la persona. Cowork de ANTON.IA es un producto de ventas con aprobación humana en cada efecto; esas capacidades piden otro nivel de confianza.

### Lo que sigue sin pasar el corpus

De los 141 casos, 43 fallaron en alguna de las siete corridas y 19 en la última (A2): la mayoría cambia de una corrida a otra, que es el ruido de arriba. **Cuatro fallan siempre**, y leídas sus respuestas ninguno deja a la persona peor atendida; el chequeo es léxico y estrecho:

- `lectura-seguimiento-empresa` exige que la única lectura sea la de los candidatos; el agente pide además la red de LinkedIn y el cupo (tres lecturas gratis en vez de una).
- `hilo-no-escribir-baja` exige leer la conversación de quien pidió no recibir más mensajes; el agente responde bien desde lo que ya sabe de la cuenta (que Gerardo Paz pidió que no lo contacten) sin abrirla. Opus la lee y falla otras tres frases del chequeo.
- `art-arreglar` exige decir «qué falló y cómo quedó»; la respuesta lo dice con otras palabras («buscaba los contactos en un lugar donde no estaban; ahora los lee de tu pipeline»).
- `integral-revision-analista` exige que corra el especialista de análisis; sin la Analista, como en producción, el agente lo dice y hace la revisión él mismo, y con la Analista encendida (E) no la llamó.

Dos de los que fallaban en todas las corridas **eran un error nuestro, no del agente, y se arreglaron esta vez**: `lote-invitar` (el banco buscaba «con LinkedIn» como texto y no encontraba a nadie, así que el agente concluía que ningún contacto tenía perfil; el servidor sí filtra por «con LinkedIn») y `oportunidades-hoy` (el agente saltaba a proponer y entregaba solo dos frases, sin la tabla ni las licitaciones que cierran pronto; ahora el protocolo dice que una pregunta de información se responde completa y la propuesta va como siguiente paso). Quedan dos fallas reales que no se tocaron, las dos del aviso «Marcela pidió una reunión»: `chat-aviso-reunion` no lo da cuando el agente escribe un correo (solo Opus lo da: el aviso del estado de la cuenta no llega a la respuesta de la Redactora) y `chat-aviso-dado` lo repite aunque ya se había dado en el turno anterior (tres de las siete corridas).

Los chequeos léxicos «sirven para detectar comportamiento, pero necesitan una lectura humana». Leídas a mano 10 respuestas que pasan (`recomendacion-hoy`, `vender-mas`, `informe-jefe`, `hilo-ya-respondida`, `ley-chile`…), están ancladas en los datos de la cuenta, dicen sus límites («si te contestó por fuera de ANTON.IA, avísame»), proponen un siguiente paso concreto con su costo y no prometen un envío.

## Oportunidades

Un banco de recorridos (`npm run audit:journeys`) probó once metas de punta a punta como administrador y como integrante, en el computador y el teléfono. Terminan todas, y encontraron y arreglaron cuatro fricciones: la etiqueta de cada etapa del embudo no se podía pulsar, la etapa se cambiaba al final de «Plan y tareas», «Postular» seguía en lo ya presentado y asignar obligaba a abrir cada oportunidad. Detalle y clics antes y después en `docs/oportunidades-recorridos.md` (PR 487). Después, la cabecera del administrador pasó de tres tarjetas a una: el estado de la oferta y «Antes de postular» son ahora una línea cada uno y «Novedades», lo que hay que atender, queda como la única tarjeta de arriba (PR 494; los once recorridos terminan con los mismos clics y la auditoría visual no da hallazgos en claro y oscuro, a 390 y 1440 px). Después (PR 504), al pasar una oportunidad a «Ganada» o «Perdida» —desde el embudo, desde una sugerencia de la IA o desde «Cambiar etapa»— se abre un diálogo corto con una línea opcional con el motivo, que queda en la actividad junto a la etapa nueva (el servidor ya aceptaba la nota: sin migración; doce recorridos terminan). Queda anotado, sin hacer: mover los filtros dentro del embudo y ver los motivos de cierre juntos.

El agente de Oportunidades con herramientas (`OPPORTUNITIES_RUNTIME=harness`) sigue apagado en producción; la página del 22 de octubre recomendó encenderlo con Haiku.

## Leads y borradores

### Borradores con Claude

El mismo banco que usó el Plan 15 (`scripts/evaluate-outreach-set.ts`: una secuencia de AXIS de 4 pasos por 2 empresas, y 20 casos de ServiPro), con Haiku 5.5, Sonnet 5.5 y Opus 5.5 como generadores y **Opus 5.5 como juez** (`OUTREACH_EVAL_MODEL`, `OUTREACH_JUDGE_MODEL`). Opus es un juez más duro que Luna: los promedios **no son comparables** con los del Plan 15; sirven para comparar generadores entre sí.

| Banco | Generador | Válidos | Suena humano | Especificidad | Un solo pedido | Tono | Veracidad | Costo (techo) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| AXIS (8 correos) | Haiku 5.5 | 7/8 | 3,13 | 3,63 | 4,75 | 4,13 | 4,38 | US$0,05 |
| | Sonnet 5.5 | 7/8 | 3,38 | 3,75 | 4,75 | 3,75 | 4,50 | US$0,53 |
| | Opus 5.5 | 7/8 | 3,25 | 3,50 | 4,75 | 4,38 | 4,75 | US$1,32 |
| ServiPro (25 correos) | Haiku 5.5 | 24/24 | 3,08 | 3,44 | 4,76 | 4,08 | 4,44 | US$0,12 |
| | Sonnet 5.5 | 23/24 | 3,16 | 3,44 | 4,72 | 3,92 | 4,36 | US$1,30 |
| | Opus 5.5 | 24/24 | 3,32 | 3,48 | 4,84 | 4,04 | 4,60 | US$3,25 |

- **No hay diferencia que el tamaño de la muestra distinga entre los tres modelos**, y Haiku cuesta de 11 a 28 veces menos. Opus queda un poco por delante en veracidad (4,60 contra 4,44 y 4,36) y en veredictos (6 «enviar» contra 3 y 3 en ServiPro), pero con 25 correos y siendo él mismo el juez no es una ventaja que se pueda afirmar. Cambiar de modelo no mejora los borradores; cambiar la evidencia sí.
- **Lo que separa un buen correo de uno flojo es la evidencia.** Los casos con señal (una noticia, una contratación) puntúan 4 y 5 en especificidad; los casos sin señal puntúan 2: el juez los llama «ficha corporativa con envoltorio». Esto es lo que más mueve la aguja y es lo que la web de Cowork entrega.
- El juez también marcó, en los tres modelos, lo mismo que el Plan 15 dejó abierto: el lema del vendedor repetido tal cual («el costo se va con el peak») y el tuteo mezclado con el ustedeo. No es un problema del modelo: es el compromiso entre «usar las palabras del vendedor» y «sonar a persona» que fija el prompt actual.

### La señal manda (con datos que ya existían)

En las 50 salidas de Luna del banco de ServiPro (dos corridas) que juzgó Opus, los correos en frío **con una señal real y con fecha** (12) puntúan 4,3 de especificidad y 3,3 de «suena humano»; los que **no la tienen** (6) puntúan 2,2 y 2,2. Los otros dos jueces dicen lo mismo (Luna: 4,8 contra 3,3; Sonnet: 3,6 contra 2,2). La diferencia entre tener y no tener la señal (más de 2 puntos de especificidad) es mucho mayor que la que produce cambiar de modelo o de editor (menos de 0,6 en el mejor de los casos).

### Un editor Claude sobre el borrador de Luna (medido y descartado)

Luna escribe el correo y su propia pasada editorial lo revisa. Se probó que esa pasada la hiciera otro modelo (Sonnet 5.5 u Opus 5.5) y juzgarlo con Luna, Sonnet y Opus. 25 correos de ServiPro por variante, dos corridas (la segunda con una regla extra en el prompt del editor: «mejora cómo está escrito, no lo que se sabe»). Juez Opus, promedio de las dos corridas:

| Editor | Suena humano | Especificidad | Tono | Veracidad | Promedio | Veredictos (enviar / corregir / revisión humana) | Costo por correo |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Luna (como hoy) | 2,80 | 3,24 | 3,76 | **4,78** | 3,89 | 6 / 33 / 11 | ≈ US$0,003 |
| Sonnet 5.5 | 3,10 | 3,58 | 3,76 | 4,36 | 3,88 | 4 / 14 / 32 | ≈ US$0,07 |
| Opus 5.5 | 3,40 | 3,56 | 4,10 | 4,44 | 4,07 | 10 / 14 / 26 | ≈ US$0,19 |

- Los editores Claude escriben **más natural** (+0,3 a +0,6) y **más específico** (+0,3), pero **agregan inferencias sobre la persona que el brief no daba** («el equipo se arma en poco tiempo», «me acordé de ti»): la veracidad baja de 4,78 a 4,4, y el juez manda a revisión humana de 11 a 26–32 de 50. Con Luna de juez la caída de veracidad es mayor (de 4,1 a 2,5 con Sonnet y 3,3 con Opus). La regla extra del prompt recuperó 0,2 en Sonnet y casi nada en Opus (el banco base varió 0,1 entre corridas).
- Para un producto cuyo prompt prohíbe afirmar lo que no está en la evidencia, ganar naturalidad a cambio de veracidad es mal negocio, y cuesta de 20 a 60 veces más. **No se dejó el cambio en el código** (un modelo distinto en la pasada editorial, de unas veinte líneas); si se quisiera probar con otros datos, es solo cambiar el modelo de esa llamada.

### Investigación de leads

Como la evidencia es la palanca, se atacó ahí. **Un investigador con la web de Claude** (PR 497, `RESEARCH_CLAUDE_WEB_ENABLED`, apagado) busca antes de que la investigación lea páginas y entrega **direcciones, no hechos**: noticias de los últimos meses, avisos de empleo con fecha, licitaciones y cambios de gerencia. La investigación las lee con su lectura segura, interpreta sus fechas y extrae los hechos como siempre, así que el informe sigue diciendo solo lo que ANTON.IA leyó. Solo se aceptan direcciones que la API devolvió en esa ejecución; nunca recibe el nombre de la persona.

Ejecución real de `gatherReportV2Research` con Luna, 8 empresas chilenas (Enaex, Aguas Andinas, Besalco, Sodexo, SMU, Salfacorp, Ingevec, Gasco), cargo «Gerente de Personas», oferta AXIS, juez Opus:

| | páginas | hechos | hechos de 6 meses | señales útiles (juez) | utilidad (1–5) | costo |
| --- | --- | --- | --- | --- | --- | --- |
| Solo el sitio de la empresa | 0,6 | 2 | 0 | 0 | 1,0 | — |
| Con el investigador (`low`) | 5,9 | 81 | 57 | 2,6 | 3,0 | ≈ US$0,10 |
| Con el investigador (`medium`) | 5,9 | 73 | 57 | 2,9 | 3,3 | ≈ US$0,25 |

Las herramientas web básicas (`COWORK_WEB_BASIC`, `RESEARCH_CLAUDE_WEB_BASIC`) existen porque las de filtrado dinámico gastaban las búsquedas en reintentos de su propio código (Enaex, tres de tres corridas). **Límite honesto:** no hay clave de Serper en esta máquina, así que la comparación es contra «solo el sitio» y no contra producción; con la clave, el mismo script (`scripts/evaluate-research-sources.ts`) compara producción contra producción más investigador. Detalle en `docs/investigacion-web-claude.md`.

La investigación guardada sigue en Luna y en el prefijo de modelos fijado a propósito (`src/ai/report-models.ts`): el investigador solo elige páginas.

### De la investigación al correo

Un script nuevo (`scripts/evaluate-research-drafts.ts`) corre la cadena real de la app sin base de datos ni envíos: investigación → informe v2 (Luna) → contexto del borrador con ese informe → primer correo (preflight y un reintento) → juez Opus que ve la evidencia que vio el redactor. 8 empresas chilenas, cargo «Gerente de Personas», oferta de AXIS. Mostró cuatro pérdidas en el camino y un error:

- **La extracción no deja señales que el borrador acepte.** Las 9 señales con fecha de las 8 investigaciones son resultados del semestre con la fecha de cierre del período; ninguna tiene menos de 30 días, el máximo del borrador. Un aviso con fecha y cantidad («10 vacantes de ayudante de bodega en Malloa») queda como afirmación de servicios: el prompt excluye el «listado genérico de empleos», y para quien vende revisión de antecedentes es el mejor motivo para escribir.
- **El ángulo del informe cita afirmaciones genéricas** («la sede está en Santiago») aunque el análisis eligió las señales; solo citó 1 señal en las 8.
- **Un aviso `invalid_citation` en la sección empresa** (el texto que repite el perfil) descartaba todos los hechos del informe en el borrador: 7 de 24 informes.
- **El redactor recibe un hecho** (`minimumEvidenceProvenance` = 1) y tal como lo escribió la página («Así se verá:…», un solo aviso).
- **Un error**: `truncateAtWord(texto, 2000)` devolvía hasta 2.003 caracteres y un hecho no admite más de 2.000; una de 16 investigaciones perdió el informe entero al final de la síntesis, con las llamadas ya pagadas (PR 501).

Lo construido (PR 502, **apagado**): `RESEARCH_SIGNAL_HARVEST_ENABLED` (un Claude lee los hechos de las páginas, nunca la web, y propone hasta 3 señales de 30 días conectadas de forma directa con la oferta; solo se aceptan si fecha, cifras y nombres están en los hechos que cita; ≈ US$0,03 y 5 a 7 s por investigación) y `DRAFT_SIGNAL_EVIDENCE_ENABLED` (las señales que el análisis eligió van primero, el aviso de cita inválida fuera del ángulo no descarta el informe, y la frase de la señal se cita si está en sus hechos).

| Investigación | Borrador | Empresas con señal que llega | Suena humano | Especificidad | Veracidad | Espec. ≥ 3 |
| --- | --- | --- | --- | --- | --- | --- |
| Solo el sitio | de hoy | 0 de 8 | 2,0 | 2,0 | 4,9 | 0 de 8 |
| + investigador de páginas | de hoy | 0 de 8 | 2,1 | 2,1 | 4,8 | 1 de 8 |
| + cosecha de Claude | de hoy | 4 a 5 de 8 | 2,1–2,3 | 2,1–2,5 | 4,9–5,0 | 1 a 3 de 8 |
| + cosecha de Claude | señales en el borrador | 4 a 5 de 8 | 2,5 | 2,6 | 4,9 | 3 a 4 de 8 |

Es una mejora real pero pequeña (ruido entre corridas de ±0,3; 8 empresas): cuando una señal directa llega, el correo la usa («Vi que Sodexo Chile publicó 10 vacantes… en Coquimbo y otras 10… en Antofagasta») y el juez le pone 4, pero **0 de 8 llegan a «enviar» en cualquier variante**: lo que el juez sigue pidiendo (un puente menos forzado entre el hecho y AXIS, menos frases de relleno) es del redactor, no de la evidencia. Sin Serper la base es «solo el sitio» y el efecto sobre producción puede ser menor. Detalle, comandos y decisiones (la ventana de 30 días: con 90 hay las mismas 5 de 8 empresas con señal) en `docs/senales-de-la-investigacion-al-correo.md`.

**Elegir entre varios borradores tampoco ayuda.** Con los mismos informes, tres borradores por caso, Haiku como juez que elige y Opus como referencia: el mejor de tres según el propio Opus sube «suena humano» de 2,25 a 2,38 y deja la especificidad en 2,44; elegido por Haiku queda en 2,31 y 2,38. El techo de cualquier selección es +0,13, así que no se construyó (detalle en `docs/senales-de-la-investigacion-al-correo.md`).

**Un error del preflight que ocultaba la prueba del vendedor (PR 506).** Al registrar por qué el preflight devolvía el primer intento, 6 de 8 correos con un perfil que trae una cifra («procesa 1.000 postulantes en unos 30 minutos») pasaban por el reintento: el redactor la escribía bien («Procesamos 1.000…», «AXIS procesa…»), pero la comprobación solo reconocía al vendedor por su razón social tal cual o por cinco palabras, así que leía la cifra como del destinatario, la rechazaba y el reintento la borraba; 2 de 8 correos terminaban inválidos. Se amplió la voz del vendedor que reconoce (primera persona del plural, nombre de la empresa sin SpA, nombre de producto), siempre que la oración no nombre al destinatario y la cifra y su unidad sean las del perfil; el redactor recibe una regla de cómo decir esas cifras solo cuando el perfil trae alguna, y la corrección del reintento cita la línea del perfil. Con los mismos informes: correos válidos de 6 a 8 de 8, aprobados a la primera de 2 a 7 u 8 de 8 (dos corridas), y la cifra llega a 1 a 3 de 8 correos; los puntajes del juez no se mueven (ruido de ±0,3), así que es una corrección de robustez y de lo que el usuario escribe en su perfil, no de calidad del texto.

## Decisiones

| Decisión | Recomendación | Qué mirar |
| --- | --- | --- |
| Encender el harness (`COWORK_RUNTIME=harness`) | **Sí, con pocas personas** (`COWORK_HARNESS_USER_IDS`), no para todos de una vez. La llave de Anthropic ya está cableada en `apphosting.yaml`; falta que `COWORK_MODEL_PRICING_JSON` traiga el precio de `claude-sonnet-5-5` (hoy solo tiene `claude-haiku-5-5`: sin precio el consumo se registra con costo desconocido, no bloquea) | Costo por turno (unos US$0,10 contra US$0,002), segundos por turno, y que `turn.rescued` con `harness_error` sea raro |
| Encender la web (`COWORK_WEB_ENABLED=true`) | Sí, junto con lo anterior y con `webSearchUsdPerThousand: 10` en `COWORK_MODEL_PRICING_JSON` | Búsquedas por turno, enlaces devueltos por no tener origen, y si la respuesta cita con fecha |
| Prompts por intención (`COWORK_INTENT_PROMPTS_ENABLED`) | No | No mejora lo que importa y cuesta 50 % más con la caché fría |
| Esfuerzo (`COWORK_HARNESS_EFFORT`) | Dejar `medium` | — |
| Modelo del coordinador (`COWORK_HARNESS_MODEL`) | Dejar Sonnet 5.5; Haiku 5.5 si manda el costo: en la medición del 22 de octubre (80 casos, esfuerzo alto) acertó 74 % contra 84 % de Sonnet, a ≈ US$0,007 por turno contra ≈ US$0,09 | Opus ya no es una opción (la app lo bloquea): acertaba lo mismo que Sonnet y costaba y tardaba el doble |
| Jueza y Analista dentro del turno | Dejarlas apagadas | No suben el acierto; suman 15 % de costo y 43 % de tiempo |
| Modelo de los borradores y editor Claude | Dejar como está | Un modelo más grande no mejora el resultado; un editor Claude agrega inferencias (veracidad −0,3) y cuesta de 20 a 60 veces más |
| Investigador con la web de Claude (`RESEARCH_CLAUDE_WEB_ENABLED=true`, PR 497) | **Probarlo con la clave de Serper antes de encender**: correr `scripts/evaluate-research-sources.ts` con `SERPER_API_KEY` y mirar si suma señales con fecha sobre lo que ya entrega producción; si suma, encender en una cuenta | Hechos de los últimos 6 meses por investigación, costo (≈ US$0,10 por investigación) y si los borradores citan más señales |
| Cosecha de señales y señales en el borrador (`RESEARCH_SIGNAL_HARVEST_ENABLED` y después `DRAFT_SIGNAL_EVIDENCE_ENABLED`, PR 502) | Probar con una cuenta, en ese orden, **después** de correr `scripts/evaluate-research-drafts.ts` con `SERPER_API_KEY` (la base de producción trae noticias por esa vía) y leer a mano los primeros correos: la segunda cambia qué hecho abre el correo | Correos con una señal fechada en la apertura, veracidad (que ningún hecho sea ajeno a la empresa), costo (≈ US$0,03 por investigación) y `signal_harvest_unavailable` |
| Tareas programadas (PR 498) | Aplicar la migración `20261023120000` (una tabla), después `COWORK_SCHEDULES_ENABLED=true` en una o dos cuentas | Que la conversación «⏰ …» aparezca a la hora, que las propuestas queden por aprobar y que `last_status` no quede en `failed` |
| Subagentes (PR 499) | Aplicar la migración `20261023130000` (rol `delegate` del libro) **antes** de `COWORK_SUBAGENTS_ENABLED=true`; piloto con `COWORK_HARNESS_USER_IDS` | Costo por investigación de varias empresas (≈ US$0,4 a 0,8), tiempo y que las llamadas `delegate` del libro no lleguen al tope |
| `OPPORTUNITIES_RUNTIME=harness` | Sí, con Haiku y en un solo workspace (según la página del 22 de octubre) | Pasos `answer` del libro de presupuesto |
| Guía «¿Qué puedes hacer?» | Nada: ya ofrece «Buscar en la web», solo a quien tiene la web (PR 493) | Que aparezca para las cuentas del piloto y no para las demás |

Nada de esto cambia con un solo clic: cada bandera se puede apagar y el turno vuelve al bucle de siempre.

### Cómo encender el piloto, cuando se decida

Se cambia `apphosting.yaml` y se despliega App Hosting como siempre; esta sesión no tocó producción.

```yaml
- variable: COWORK_RUNTIME
  value: harness
- variable: COWORK_HARNESS_USER_IDS      # una o dos cuentas; vacía, es para todas
  value: <id de usuario>[,<otro id>]
- variable: COWORK_WEB_ENABLED           # opcional: la web, 4 búsquedas y 3 lecturas por turno
  value: "true"
# COWORK_MODEL_PRICING_JSON: agregar a lo que ya tiene (la búsqueda cuesta US$10 por mil)
#   "claude-sonnet-5-5": {"version":"anthropic-standard-2026-10-06","inputUsdPerMillion":2,"outputUsdPerMillion":10,"cachedInputUsdPerMillion":0.1,"webSearchUsdPerThousand":10}
```

Para apagarlo basta quitar `COWORK_RUNTIME`: el turno siguiente corre en el bucle de siempre. Lo que mirar la primera semana está en la columna «Qué mirar» de arriba.

## Qué no se midió

- **El investigador con la web de Claude y la cosecha de señales contra producción:** sin la clave de Serper la comparación es contra «solo el sitio». El efecto de punta a punta sobre el borrador sí se midió (8 empresas, ver «De la investigación al correo»), pero por el camino del informe v2 y con la investigación del contacto reemplazada por un resumen de la empresa y el cargo; con una corrida y ruido de ±0,3.
- **Tareas programadas y subagentes en producción:** probados con un cliente en memoria, jsdom y modelos de verdad (los subagentes), y con las pruebas pgTAP del CI; las migraciones no se aplicaron, así que el camino con la base real no corrió.
- **El editor Claude con otros datos que los 25 correos de ServiPro** (y con juez distinto de los tres usados).
- El bucle de Luna contra el corpus completo con las banderas de producción (sin llave de OpenAI en esta sesión).
- Lectura a ciegas de las respuestas de cada configuración; solo una muestra de diez.
- Producción: ninguna de estas pruebas tocó la app desplegada ni la base de datos.
- La web contra páginas con instrucciones escondidas para el agente: el protocolo lo prohíbe y el modelo lo respetó en el caso del corpus, pero no se probó contra una página hostil real.
- El costo de la web en producción: con la caché fría un turno de investigación costó hasta US$0,36 (cada llamada interna del lado de la API vuelve a leer el prompt completo).

## Cómo repetirlo

```bash
# Corpus completo, banderas de producción, todo con Claude. Cuesta de US$10 a 19 por corrida con Sonnet y ≈ US$1 con Haiku (COWORK_HARNESS_MODEL=claude-haiku-5-5):
# compara variantes con Haiku o con un subconjunto (--cases) y confirma solo la mejor con Sonnet. La medición original usó Opus de Redactora; ya no se puede.
source <(node -e 'for (const m of require("fs").readFileSync("apphosting.yaml","utf8").matchAll(/- variable: (COWORK_[A-Z_]+)\n\s+value: "?true"?/g)) console.log(`export ${m[1]}=true`)')
ANTHROPIC_API_KEY=... COWORK_HARNESS_MODEL=claude-sonnet-5-5 COWORK_MODEL=claude-sonnet-5-5 \
COWORK_WRITER_MODEL=claude-sonnet-5-5 COWORK_REVIEWER_MODEL=claude-sonnet-5-5 COWORK_DESIGNER_MODEL=claude-sonnet-5-5 \
  node --loader ./scripts/ts-test-loader.mjs scripts/evaluate-cowork-harness.ts --live --max-calls=900 --writer --artifacts --output=A.json

# Un pedido propio, con la web
ANTHROPIC_API_KEY=... COWORK_WEB_ENABLED=true COWORK_HARNESS_MODEL=claude-sonnet-5-5 \
  node --loader ./scripts/ts-test-loader.mjs scripts/evaluate-cowork-harness.ts --live --max-calls=20 --writer --ask="Investiga a Collahuasi…"

# Borradores con Claude, juzgados por Haiku (la medición original usó Opus de juez; ya no se puede)
ANTHROPIC_API_KEY=... OUTREACH_EVAL_MODEL=claude-haiku-5-5 OUTREACH_EVAL_SET=scripts/fixtures/outreach-eval-axis.json OUTREACH_EVAL_OUT=out \
  node --loader ./scripts/ts-test-loader.mjs scripts/evaluate-outreach-set.ts
ANTHROPIC_API_KEY=... OUTREACH_JUDGE_MODEL=claude-haiku-5-5 OUTREACH_EVAL_SET=scripts/fixtures/outreach-eval-axis.json \
  node --loader ./scripts/ts-test-loader.mjs scripts/judge-outreach-set.ts out/outreach-eval/<fecha>

# Investigación con el investigador de la web (con SERPER_API_KEY compara contra producción)
ANTHROPIC_API_KEY=... OPENAI_API_KEY=... [SERPER_API_KEY=...] \
  node --loader ./scripts/ts-test-loader.mjs scripts/evaluate-research-sources.ts --out=/tmp/investigacion

# Investigación → informe → correo, de punta a punta (sin = solo el sitio, con = investigador de páginas, pro = con + cosecha de señales)
ANTHROPIC_API_KEY=... OPENAI_API_KEY=... [DRAFT_SIGNAL_EVIDENCE_ENABLED=true] \
  node --loader ./scripts/ts-test-loader.mjs scripts/evaluate-research-drafts.ts --modes=sin,con,pro [--reuse=<carpeta> --reuse-docs]

# Subagentes: la misma petición con y sin ellos
ANTHROPIC_API_KEY=... COWORK_WEB_ENABLED=true COWORK_WEB_BASIC=true [COWORK_SUBAGENTS_ENABLED=true] \
  node --loader ./scripts/ts-test-loader.mjs scripts/evaluate-cowork-harness.ts --live --max-calls=60 --ask="Investiga en la web a Enaex, Besalco y Gasco…"

# Recorridos de Cowork y de Oportunidades en el banco visual
npm run audit:journeys -- --file=scripts/visual-audit/journeys/cowork.mjs
```
