# Cowork · Calidad de los correos y qué modelos convienen (12 oct 2026)

Medición de los correos que escribe la Redactora de Cowork, con la nota de una lectura ciega y el costo y la latencia de cada
combinación de modelos. Las cifras salen de corridas reales con el modelo (`evaluate-cowork-conversations.ts --live`), sobre el
banco de siempre: 7 pedidos que terminan en un correo o una secuencia, 3 repeticiones cada uno (21 respuestas por configuración).

## Resumen

- **La nota pasó de 2,54 a 3,62 con el mismo modelo (`gpt-6-luna`, esfuerzo `low`) y a 3,86 combinando modelos.** La escala es
  «¿lo enviarías tal cual?», de 1 a 5. Con la combinación, 71 % de los correos sacan 4 o más y ninguno queda en 3 o menos.
- **Con las reglas v7 (un primer correo propio por persona), Sol 6.1 → Luna llega a 3,98 y las campañas a 4,5.** Los únicos 5
  de todas las lecturas son correos por persona que abren con lo propio del negocio de cada una. Ver «Rondas 4 y 5».
- **Mejor relación calidad/precio para producción:** Sol 6.1 escribe y Luna corrige (`COWORK_WRITER_MODEL=gpt-6.1-sol`,
  `COWORK_WRITER_EFFORT=low`, `COWORK_WRITER_FIX_MODEL=gpt-6-luna`). Cuesta US$0,0091 por respuesta con correo, unas 4 veces Luna
  sola, y deja la Redactora en 7,2 s de mediana y 9,2 s de p90.
- **Lo más barato:** Luna low sola, a US$0,0022 por respuesta y 3,62 de nota. Es la configuración actual de producción, así que
  basta con desplegar estas reglas para obtener esa nota.
- **No conviene subir el esfuerzo de Luna:**
  - `medium`, `high` y `xhigh` mejoraron la nota en 0,05 a 0,12 (dentro del ruido).
  - Entre 15 % y 32 % de las llamadas de `high` y `xhigh` pasan los 30 s que la Redactora tiene en producción.
  - Con `xhigh` hubo respuestas vacías (el razonamiento se come el tope de 6.000 tokens) y el coordinador terminó escribiendo.
- **Sol 6.1 solo** (escribe y corrige) llega a 3,90, igual que la combinación dentro del ruido, por US$0,0154: 1,7 veces más.
- **Claude Haiku 5.5 no se pudo medir:** esta sesión no tiene `ANTHROPIC_API_KEY`. El código ya lo soporta. Abajo están los comandos
  para medirlo y una estimación de costo, marcada como estimación.

## Cómo cambió la nota

Lectura ciega: las respuestas de varias versiones van mezcladas, con etiquetas anónimas, y la clave queda aparte hasta terminar de
puntuar (`scripts/cowork-blind-read.ts`, método en `docs/cowork-lectura-ciega.md`). Cada ronda repite una versión de la ronda
anterior como ancla: si el lector cambiara su vara entre rondas, el ancla lo mostraría. Las dos anclas dieron exactamente lo
mismo que la primera vez (3,19 y 3,60).

| Versión de las reglas | Luna low | Sol 6.1 low | Sol escribe, Luna corrige |
|---|---|---|---|
| Base (`main` al 12 oct) | 2,54 (n=14) | — | — |
| v1: tarea con su empresa, prueba tal cual | 2,96 (n=14) | — | — |
| v2: sin rodeos ni reunión en el primer correo, pregunta aparte | 3,19 ± 0,10 | 3,57 ± 0,11 | — |
| v3: primera frase sin producto, sin catálogo, Revisora alineada | 3,60 ± 0,09 | 3,67 ± 0,09 | 3,71 ± 0,11 |
| v4: prueba pulida, correo pegado intacto | **3,62 ± 0,07** | **3,90 ± 0,07** | **3,86 ± 0,05** |

± es el error estándar de la media (21 respuestas). Lo que bajaba la nota de la base:
- 0 de 18 correos nombraban la empresa o el rubro del destinatario;
- 17 de 18 abrían definiendo la tarea («Revisar antecedentes implica…»);
- había jerga interna («según el dato de nuestro perfil»), la prueba alterada («hemos procesado»), rodeos («puede tomar tiempo»),
  cautelas («el tiempo puede variar») y reuniones pedidas en el primer correo.

## Matriz de modelos

Sólo cambia el modelo de la Redactora (y de su corrección). El coordinador y la Revisora son `gpt-6-luna` low en todas. Los costos
usan los precios de `COWORK_MODEL_PRICING_JSON` de `apphosting.yaml`, en US$ por millón de tokens:
- Luna: 0,1 entrada / 0,5 salida / 0,01 en caché;
- Sol 6.1: 2 / 10 / 0,1.

«> 30 s» cuenta las llamadas de la Redactora que en producción se cortarían: su tope es 30 s, y en la evaluación es 90 s.

**Ronda 1 (reglas v2): cuánto razona Luna y Sol 6.1**

| Redactora | Nota | ≥ 4 | US$/respuesta con correo | Redactora p50 / p90 | > 30 s | Redactora falló |
|---|---|---|---|---|---|---|
| Luna low | 3,19 ± 0,10 | 5 % | 0,0024 | 6,5 / 8,8 s | 0 de 42 | 0 |
| Luna medium | 3,24 ± 0,13 | 29 % | 0,0031 | 12,7 / 22,1 s | 2 de 42 | 0 |
| Luna high | 3,31 ± 0,11 | 14 % | 0,0041 | 19,7 / 30,4 s | 6 de 40 | 1 |
| Luna xhigh (su máximo) | 3,31 ± 0,12 | 14 % | 0,0045 | 23,9 / 38,5 s | 12 de 38 | 2 |
| Sol 6.1 low | 3,57 ± 0,11 | 48 % | 0,0191 | 10,1 / 14,4 s | 0 de 41 | 0 |

«Redactora falló» significa que la Redactora no entregó correo y escribió el coordinador. Esas respuestas fueron las peores de la
ronda (2 de 5): secuencias con «puede sumar», listas de funciones y «¿Te serviría conocer cómo podría calzar…?».

**Ronda 2 (reglas v3): combinar modelos**

`COWORK_WRITER_FIX_MODEL` permite que un modelo redacte y otro corrija.

| Redactora → corrección | Nota | US$/respuesta | Redactora p50 / p90 |
|---|---|---|---|
| Luna → Luna | 3,60 ± 0,09 | 0,0020 | 5,9 / 8,0 s |
| Sol 6.1 → Sol 6.1 | 3,67 ± 0,09 | 0,0163 | 9,8 / 16,6 s |
| Sol 6.1 → Luna | 3,71 ± 0,11 | 0,0092 | 8,8 / 17,3 s |
| Luna → Sol 6.1 | 3,57 ± 0,07 | 0,0069 | 7,0 / 11,3 s |

El borrador define casi todo el texto: la corrección cambia poco. Por eso conviene el modelo bueno en el borrador y el barato en
la corrección, y no al revés.

**Ronda 3 (reglas v4): medición final**

| Redactora → corrección | Nota | ≥ 4 | ≤ 3 | US$/respuesta | Por cada 1.000 correos | Redactora p50 / p90 |
|---|---|---|---|---|---|---|
| Luna → Luna | 3,62 ± 0,07 | 33 % | 10 % | 0,0022 | US$2,2 | 6,9 / 10,2 s |
| **Sol 6.1 → Luna** | **3,86 ± 0,05** | **71 %** | **0 %** | **0,0091** | **US$9,1** | **7,2 / 9,2 s** |
| Sol 6.1 → Sol 6.1 | 3,90 ± 0,07 | 67 % | 0 % | 0,0154 | US$15,4 | 7,2 / 12,1 s |

En las tres configuraciones ninguna llamada pasó los 30 s y la Redactora no falló ninguna vez. El costo por respuesta incluye al
coordinador (unos US$0,001), que no cambia entre filas.

## Rondas 4 y 5 (reglas v6 y v7)

Mismo banco, mismo lector y una versión anterior como ancla en cada lectura. Las anclas se movieron 0,05 (3,86 → 3,81 y
3,93 → 3,88), dentro del ruido.

**Ronda 4 (v6: sin anunciar la pregunta, sin fórmulas como «ver si calza», respuesta sin jerga)**

| Redactora → corrección | Nota | US$/respuesta | Redactora p50 / p90 |
|---|---|---|---|
| Luna → Luna | 3,74 ± 0,07 | 0,0025 | 6,9 / 8,6 s |
| Sol 6.1 low → Luna | 3,93 ± 0,05 | 0,0096 | 7,5 / 10,5 s |
| Sol 6.1 medium → Luna | 3,83 ± 0,07 | 0,0113 | 9,0 / 13,6 s |

Subir a Sol `medium` no mejora y cuesta más: queda descartado.

**Ronda 5 (v7: primer correo por persona)**

Para 2 o 3 personas, la Redactora escribe un correo para cada una, con su nombre, su empresa y lo propio de su rubro. Al aceptar la
campaña, cada uno va tal cual como el primer correo de esa persona (`firstEmails`); los seguimientos siguen siendo comunes.

| Redactora → corrección | Nota | Campañas (2 casos) | US$/respuesta | Redactora p50 / p90 |
|---|---|---|---|---|
| Luna → Luna | 3,76 ± 0,07 | 3,92 | 0,0025 | 6,5 / 8,4 s |
| **Sol 6.1 low → Luna** | **3,98 ± 0,12** | **4,50** | **0,0102** | **7,5 / 13,7 s** |
| Ancla: v6 Sol 6.1 → Luna | 3,88 ± 0,06 | 3,83 | 0,0096 | 7,5 / 10,5 s |

- Con Sol, los correos por persona suben las campañas de 3,8 a 4,5. Con Luna suelen salir genéricos: la misma
  frase con otro rubro.
- La nota de Sol cae por una respuesta de 2,5 que no escribió la Redactora: el coordinador escribió el correo él mismo (1 de 98
  respuestas medidas). Desde v7, un correo que el coordinador escribe vuelve una vez a la Redactora.
- Lo que sigue bajando a 3,5: aperturas vagas en los seguimientos de una secuencia («ayuda a revisar…»), la misma capacidad
  repetida en dos correos y, en Luna, aperturas genéricas.

**Por qué no llega a 5:** un 5 pide algo propio de esa persona. En este banco no hay investigación ni señales de las empresas
(`research.get_existing` vacío), así que el techo es lo propio del rubro. Con investigación (`research.start`) el primer correo
puede abrir con un hecho observado de su empresa.

## Recomendación

1. **Desplegar estas reglas con la configuración actual** (Luna low): sube la nota de 2,54 a 3,62 sin costo extra.
2. **Para los correos que salen a prospectos, Sol 6.1 escribe y Luna corrige.** Cuesta +US$0,007 por correo (unos US$7 por cada
   1.000) y pasa de 33 % a 71 % de correos que se envían tal cual o casi. Son tres variables de entorno, sin cambios de código:
   `COWORK_WRITER_MODEL=gpt-6.1-sol`, `COWORK_WRITER_EFFORT=low`, `COWORK_WRITER_FIX_MODEL=gpt-6-luna`. `COWORK_WRITER_FIX_EFFORT`
   queda sin valor o en `low`. El precio de `gpt-6.1-sol` ya está en `COWORK_MODEL_PRICING_JSON`.
   - Ojo: `COWORK_DESIGNER_MODEL` toma `COWORK_WRITER_MODEL` si no tiene valor propio. Para que la Diseñadora siga en Luna, fijar
     `COWORK_DESIGNER_MODEL=gpt-6-luna`.
3. **No subir `COWORK_WRITER_EFFORT` de Luna:** no mejora la nota y produce cortes por tiempo.
4. **Sol 6.1 solo** no aporta frente a la combinación: misma nota dentro del ruido y 1,7 veces el costo.

## Claude Haiku 5.5

**Estado:** el código lo soporta (`src/ai/anthropic-json.ts`):
- cualquier modelo `claude-…` responde por Anthropic con el SDK oficial y salidas estructuradas;
- el esfuerzo va en `output_config.effort` (`low` a `max`), con espacio para el razonamiento sobre el tope de cada rol;
- las reglas fijas del rol van en caché (`cache_control` en el system prompt);
- el consumo se registra como el de OpenAI y su precio ya está en `COWORK_MODEL_PRICING_JSON`.

**No se midió** porque esta sesión no tiene `ANTHROPIC_API_KEY`.

**Estimación, no medición.** Se calculó con los tokens medidos de Luna y la ficha de Haiku 5.5:
- US$0,10 / 0,50 por millón de tokens;
- su tokenizador cuenta cerca de un 30 % más de tokens para el mismo texto;
- el razonamiento se cobra como salida.

Con eso:
- **`low`:** del orden de US$0,002 a 0,004 por respuesta con correo, parecido a Luna low.
- **`max`:** del orden de US$0,006 a 0,016, y es probable que pase los 30 s de la Redactora, igual que Luna `xhigh`.

**Para medirlo**, con `ANTHROPIC_API_KEY` y `OPENAI_API_KEY` en el entorno (nunca en el repo ni en `.env.local`; el coordinador
sigue en Luna):

```sh
FLAGS="COWORK_OFFERED_READS_ENABLED=true COWORK_TASKS_ENABLED=true COWORK_WORKSPACE_ENABLED=true COWORK_PREFERENCES_ENABLED=true \
  COWORK_EXTERNAL_SEARCH_ENABLED=true COWORK_CONTACTS_IMPORT_ENABLED=true COWORK_MODEL=gpt-6-luna COWORK_RESCUE_MODEL=gpt-6-luna \
  COWORK_DESIGNER_MODEL=gpt-6-luna"
CASES=mkt-campana-rrhh,mkt-secuencia,mkt-mejorar-correo,mkt-seguimiento,inicio-escribir,inicio-mejorar,descargar-correo
run() { env $FLAGS "$@" node --loader ./scripts/ts-test-loader.mjs scripts/evaluate-cowork-conversations.ts --live --stream --writer \
  --artifacts --preferences --max-calls=220 --repeat=3 --cases=$CASES --output=$OUT; }
OUT=/tmp/haiku-low.json run COWORK_WRITER_MODEL=claude-haiku-5-5 COWORK_WRITER_EFFORT=low
OUT=/tmp/haiku-max.json run COWORK_WRITER_MODEL=claude-haiku-5-5 COWORK_WRITER_EFFORT=max
OUT=/tmp/haiku-luna.json run COWORK_WRITER_MODEL=claude-haiku-5-5 COWORK_WRITER_FIX_MODEL=gpt-6-luna
# Costo, tokens y latencia por rol (p50 y p90), y la lectura ciega contra Luna y la combinación recomendada:
node --loader ./scripts/ts-test-loader.mjs scripts/cowork-model-costs.ts /tmp/haiku-*.json
node --loader ./scripts/ts-test-loader.mjs scripts/cowork-blind-read.ts mix /tmp/ciego.md /tmp/clave.json \
  A=/tmp/luna.json B=/tmp/sol-luna.json C=/tmp/haiku-low.json D=/tmp/haiku-max.json
```

## Qué cambió en el código

**Reglas de la Redactora** (`COWORK_WRITER_RULES` en `src/lib/cowork/writer.ts`):
- asunto con su empresa ({{empresa}} en campañas);
- la primera frase dice cuándo le pesa la tarea, en su rubro y en presente, sin definirla, sin el producto y sin rodeos;
- una capacidad y la prueba tal cual (dentro de una frase, en minúscula y sin comillas);
- una pregunta concreta, sola en su párrafo y sin anunciarla;
- sin pedir reunión en el primer correo salvo que el usuario la pida;
- seguimiento con un ángulo nuevo, sin repetir la prueba;
- en un texto para rubros distintos, el momento que comparten en vez de enumerar rubros;
- un correo pegado conserva su saludo y lo que pide.

**Chequeos determinísticos** (`coworkDraftIssues`). Cada uno sale de un correo real de estas lecturas y tiene su prueba en
`writer.test.ts`:
- rodeos con «puede/podría + verbo»;
- reunión, llamada, demo o evaluación pedida en el primer correo (o en el segundo de una secuencia);
- «¿Te envío más información?»;
- pregunta pegada al párrafo;
- el producto o quien escribe en la primera frase;
- aperturas que definen la tarea;
- frases de catálogo («está pensado para»);
- «En {{empresa}}, AXIS…», como si ya lo usaran;
- tres o más funciones;
- seguimiento que repite la prueba;
- referencias internas («el dato que compartiste»);
- prueba alterada, cautelas y líneas sueltas;
- su empresa en el correo, {{empresa}} en campañas y la prueba una sola vez por secuencia;
- asunto con la empresa de quien escribe.

**Revisora** (`COWORK_REVIEWER_RULES` y `coworkReviewIssues`):
- marca lo mismo que los chequeos;
- no puede pedir una reunión que el usuario no pidió, quitar una que sí pidió, ni agregar funciones;
- tampoco puede tratar como dato inventado la frase general de la apertura, ni exigir {{nombre}} en un correo pegado sin nombres.

Antes, esas peticiones empeoraban el correo o lo dejaban «por revisar».

**Reglas y chequeos de v6 y v7:**
- la pregunta no se anuncia («Para situar AXIS…, quiero entender…»);
- el correo no habla de sí mismo ni de la secuencia («Con este correo cierro…»);
- la primera frase no repite una palabra («revisar… alarga la revisión»);
- la respuesta no usa jerga («cobertura del buzón») ni cuenta lo que corrigió la Revisora;
- un primer correo propio por persona para 2 o 3 personas, y la campaña los copia tal cual (`coworkPersonalEmails`,
  `coworkCampaignWithPersonalEmails`);
- un correo que escribe el coordinador vuelve una vez a la Redactora.

**Pulido determinista** (`coworkPolishDraft`): la prueba citada dentro de una frase queda en minúscula y sin comillas. Era el
defecto típico de Sol («: Procesa 1.000…»).

**Modelos:**
- `COWORK_WRITER_FIX_MODEL` y `COWORK_WRITER_FIX_EFFORT` para la corrección;
- `COWORK_WRITER_EFFORT` y `COWORK_REVIEWER_EFFORT` para el razonamiento;
- Claude como proveedor (`src/ai/anthropic-json.ts`).

**Medición:**
- `scripts/cowork-model-costs.ts` da el costo, los tokens y la latencia (p50 y p90) por rol y modelo, y el costo por respuesta con
  correo;
- la evaluación registra la corrección como «corrector».

## Límites

- **Un solo lector:** Claude en la sesión que hizo los cambios, a ciegas y con anclas. Una lectura independiente (otra sesión, o
  el equipo comercial) confirmaría las diferencias chicas; las grandes (2,54 → 3,6 → 3,9) no dependen de eso.
- **Un solo producto (AXIS) y un perfil.** Los ejemplos de las reglas hablan de su rubro. Con otra oferta conviene repetir la
  ronda 3.
- **Los últimos ajustes no tienen lectura ciega propia:** la pregunta anunciada, el asunto con la empresa de quien escribe y los
  últimos filtros de la Revisora se agregaron después de la ronda 3. Están cubiertos por pruebas. Una corrida corta con Luna low
  (14 respuestas) dio:
  - los 7 casos pasan;
  - ningún correo con defectos detectables;
  - «por revisar» bajó de 6 de 21 a 0 de 14;
  - US$0,0020 por respuesta, con la Redactora en 6,9 / 9,1 s.
- **Costos:** las cifras usan los precios configurados. La cuenta real de cada proveedor manda.
