# Cowork, Oportunidades y Leads con Claude: lo que se midió, lo que cambió y lo que decide quien administra (23 de octubre de 2026)

Esta página sigue a `docs/agent-harness-mediciones-2026-10-22.md`. Allí el harness de Claude acertaba lo mismo que el bucle de hoy (Luna) y costaba unas 40 veces más, así que se dejó apagado. Hoy se midió de nuevo, el corpus completo y con las banderas de producción, después de arreglar lo que la medición mostró y de darle a Cowork lo que le faltaba frente a Claude Code y Claude Cowork. **Nada de esto está encendido ni desplegado en producción**: lo de Cowork va detrás de banderas que ya existían o que nacen apagadas, y la cabecera de Oportunidades (PR 494) sale con el próximo despliegue, que decide quien administra. Al final está la lista de decisiones.

## Resumen

- **Cowork con el harness de Claude pasa de 78 % a 86 % de los 141 casos** (122 de 141) con cuatro arreglos y las banderas de producción. Cuesta unos **US$0,10 por turno** (el bucle de hoy, unos US$0,002) y un turno mediano tarda 8 segundos. Probé Opus de coordinador, esfuerzo alto, prompts por intención y la jueza en turno: ninguno supera esa cifra más allá del ruido y casi todos cuestan más.
- **Lo que le faltaba, y ya tiene:** buscar en la web y leer páginas con fuentes citadas (`COWORK_WEB_ENABLED`), cerrar cada respuesta como siempre lo hizo el bucle (siguiente paso, respuestas sugeridas), no dejar a nadie sin respuesta cuando Anthropic falla (pasa al bucle de hoy) y poder probarlo con pocas personas (`COWORK_HARNESS_USER_IDS`).
- **Oportunidades:** un banco de recorridos de personas (administrador e integrante) encontró y arregló cuatro fricciones, y la cabecera del administrador pasó de tres tarjetas a una (el embudo empieza 76 px más arriba) (`docs/oportunidades-recorridos.md`).
- **Leads y borradores:** con el mismo juez, Haiku, Sonnet y Opus escriben borradores del mismo nivel. El límite no es el modelo, es la evidencia: con una señal real los correos puntúan alto y sin ella, bajo. La web de Cowork es lo que más mueve esa aguja (un ejemplo abajo).
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
| Subagentes en paralelo | Sí | Sí | No | La librería los tiene; no se enchufaron: el libro admite cinco llamadas por turno |
| Conectores (Calendar, Drive, Slack…) | Por MCP | Sí | Solo Gmail (historial de un contacto) | Igual |
| **Programar tareas recurrentes** | Sí | Sí | **No** | **No** |
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

Un banco de recorridos (`npm run audit:journeys`) probó once metas de punta a punta como administrador y como integrante, en el computador y el teléfono. Terminan todas, y encontraron y arreglaron cuatro fricciones: la etiqueta de cada etapa del embudo no se podía pulsar, la etapa se cambiaba al final de «Plan y tareas», «Postular» seguía en lo ya presentado y asignar obligaba a abrir cada oportunidad. Detalle y clics antes y después en `docs/oportunidades-recorridos.md` (PR 487). Después, la cabecera del administrador pasó de tres tarjetas a una: el estado de la oferta y «Antes de postular» son ahora una línea cada uno y «Novedades», lo que hay que atender, queda como la única tarjeta de arriba (PR 494; los once recorridos terminan con los mismos clics y la auditoría visual no da hallazgos en claro y oscuro, a 390 y 1440 px). Queda anotado, sin hacer: mover los filtros dentro del embudo y una línea opcional con el motivo al pasar a «Ganada» o «Perdida».

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

### Investigación de leads

La investigación guardada (`research.start` → informe) sigue en Luna y en el prefijo de modelos fijado a propósito (`src/ai/report-models.ts`, con pruebas que impiden un cambio por variable de entorno). No se tocó. Lo que sí puede hacer hoy el agente, con la web encendida, es investigar a una empresa al momento, con fuentes y fechas (arriba), y usarlo para escribir. Integrar esas señales en el informe guardado es el siguiente paso natural y no se hizo: toca el contrato de la investigación y su política de modelos.

## Decisiones

| Decisión | Recomendación | Qué mirar |
| --- | --- | --- |
| Encender el harness (`COWORK_RUNTIME=harness`) | **Sí, con pocas personas** (`COWORK_HARNESS_USER_IDS`), no para todos de una vez. La llave de Anthropic ya está cableada en `apphosting.yaml`; falta que `COWORK_MODEL_PRICING_JSON` traiga el precio de `claude-sonnet-5-5` y `claude-opus-5-5` (hoy solo tiene `claude-haiku-5-5`: sin precio el consumo se registra con costo desconocido, no bloquea) | Costo por turno (unos US$0,10 contra US$0,002), segundos por turno, y que `turn.rescued` con `harness_error` sea raro |
| Encender la web (`COWORK_WEB_ENABLED=true`) | Sí, junto con lo anterior y con `webSearchUsdPerThousand: 10` en `COWORK_MODEL_PRICING_JSON` | Búsquedas por turno, enlaces devueltos por no tener origen, y si la respuesta cita con fecha |
| Prompts por intención (`COWORK_INTENT_PROMPTS_ENABLED`) | No | No mejora lo que importa y cuesta 50 % más con la caché fría |
| Esfuerzo (`COWORK_HARNESS_EFFORT`) | Dejar `medium` | — |
| Modelo del coordinador (`COWORK_HARNESS_MODEL`) | Dejar Sonnet 5.5 | Opus acierta lo mismo y cuesta y tarda el doble |
| Jueza y Analista dentro del turno | Dejarlas apagadas | No suben el acierto; suman 15 % de costo y 43 % de tiempo |
| Modelo de los borradores | Dejar como está | Un modelo más grande no mejora el resultado con la evidencia actual |
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
#   "claude-sonnet-5-5": {"version":"anthropic-standard-2026-10-06","inputUsdPerMillion":2,"outputUsdPerMillion":10,"cachedInputUsdPerMillion":0.1,"webSearchUsdPerThousand":10},
#   "claude-opus-5-5":   {"version":"anthropic-standard-2026-10-06","inputUsdPerMillion":4,"outputUsdPerMillion":20,"cachedInputUsdPerMillion":0.4}
```

Para apagarlo basta quitar `COWORK_RUNTIME`: el turno siguiente corre en el bucle de siempre. Lo que mirar la primera semana está en la columna «Qué mirar» de arriba.

## Qué no se midió

- El bucle de Luna contra el corpus completo con las banderas de producción (sin llave de OpenAI en esta sesión).
- Lectura a ciegas de las respuestas de cada configuración; solo una muestra de diez.
- Producción: ninguna de estas pruebas tocó la app desplegada ni la base de datos.
- La web contra páginas con instrucciones escondidas para el agente: el protocolo lo prohíbe y el modelo lo respetó en el caso del corpus, pero no se probó contra una página hostil real.
- El costo de la web en producción: con la caché fría un turno de investigación costó hasta US$0,36 (cada llamada interna del lado de la API vuelve a leer el prompt completo).

## Cómo repetirlo

```bash
# Corpus completo, banderas de producción, todo con Claude
source <(node -e 'for (const m of require("fs").readFileSync("apphosting.yaml","utf8").matchAll(/- variable: (COWORK_[A-Z_]+)\n\s+value: "?true"?/g)) console.log(`export ${m[1]}=true`)')
ANTHROPIC_API_KEY=... COWORK_HARNESS_MODEL=claude-sonnet-5-5 COWORK_MODEL=claude-sonnet-5-5 \
COWORK_WRITER_MODEL=claude-opus-5-5 COWORK_REVIEWER_MODEL=claude-sonnet-5-5 COWORK_DESIGNER_MODEL=claude-sonnet-5-5 \
  node --loader ./scripts/ts-test-loader.mjs scripts/evaluate-cowork-harness.ts --live --max-calls=900 --writer --artifacts --output=A.json

# Un pedido propio, con la web
ANTHROPIC_API_KEY=... COWORK_WEB_ENABLED=true COWORK_HARNESS_MODEL=claude-sonnet-5-5 \
  node --loader ./scripts/ts-test-loader.mjs scripts/evaluate-cowork-harness.ts --live --max-calls=20 --writer --ask="Investiga a Collahuasi…"

# Borradores con Claude, juzgados por Opus
ANTHROPIC_API_KEY=... OUTREACH_EVAL_MODEL=claude-sonnet-5-5 OUTREACH_EVAL_SET=scripts/fixtures/outreach-eval-axis.json OUTREACH_EVAL_OUT=out \
  node --loader ./scripts/ts-test-loader.mjs scripts/evaluate-outreach-set.ts
ANTHROPIC_API_KEY=... OUTREACH_JUDGE_MODEL=claude-opus-5-5 OUTREACH_EVAL_SET=scripts/fixtures/outreach-eval-axis.json \
  node --loader ./scripts/ts-test-loader.mjs scripts/judge-outreach-set.ts out/outreach-eval/<fecha>

# Recorridos de Cowork y de Oportunidades en el banco visual
npm run audit:journeys -- --file=scripts/visual-audit/journeys/cowork.mjs
```
