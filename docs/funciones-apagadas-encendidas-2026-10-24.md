# Las funciones que habían quedado apagadas, probadas y encendidas (24 de octubre de 2026)

El 24 de octubre el dueño pidió **encender todas las funciones que se habían dejado apagadas, probarlas y dejar activas las que mejoran el funcionamiento**. Esta página cuenta qué se probó, qué se leyó, qué se encontró y cambió en el código para dejarlas seguras, y qué quedó encendido. La ficha de operación (cómo se despliega, cómo se vuelve atrás) sigue siendo `docs/piloto-borradores-cowork-2026-10-23.md`.

## Resumen

| Función | Variable | Queda | Qué lo respalda | Costo medido |
| --- | --- | --- | --- | --- |
| Web de Claude en Cowork | `COWORK_WEB_ENABLED` (+ `COWORK_WEB_BASIC`) | **Encendida** | 5 preguntas reales con web, todas con fuentes y con lo que no encontró dicho; 8 conversaciones de siempre sin ninguna búsqueda | US$0,03 a 0,045 por pregunta con web (2 o 3 búsquedas); US$0,01 cada búsqueda |
| Investigadoras (subagentes) | `COWORK_SUBAGENTS_ENABLED` | **Encendidas** | Tres empresas investigadas a la vez, ordenadas con razones | US$0,11 la pregunta de tres empresas (8 búsquedas, 43 segundos) |
| Investigador de leads con la web de Claude | `RESEARCH_CLAUDE_WEB_ENABLED` | **Encendido** | 8 empresas: páginas de la empresa correcta, recientes y con fecha en las 8 | US$0,044 por investigación |
| Visión de documentos | `COWORK_DOCUMENT_VISION` | **Encendida** | Encontró defectos reales que la inspección de siempre no ve; el agente los corrigió | Menos de US$0,005 por revisión |
| Modo autónomo | `COWORK_AUTONOMY_ENABLED` | **Encendido como opción** (cada conversación parte «Con aprobaciones»; un turno que leyó la web no aprueba nada solo) | Lo que aprueba solo y sus topes están en pruebas del CI; no hubo prueba en vivo contra una base | Hasta 3 pasos por hilo (a lo más 3 créditos de correo) |

Todas usan solo Haiku 5.5 (y Luna donde ya estaba). Ningún modelo caro: siguen bloqueados en `src/ai/blocked-models.ts`.

## Cómo se probó, y qué no se pudo

- **Llaves de prueba**, nunca las de producción, y con `scripts/spend-guard.mjs` delante de cada script: solo Luna y Haiku, con un tope. La guardia ahora **cuenta cada búsqueda web a su precio real (US$0,01)**; antes no la contaba, y por eso las pruebas con web no cabían bajo ella.
- **Las salidas las leí yo**, una por una, sin un modelo que las juzgara (el dueño pidió no gastar API en evaluar). Los números de esta página salen de las ejecuciones de esa sesión; los resultados crudos no están en el repositorio.
- **Gasto real de esta ronda: unos US$0,74** (la guardia, que cuenta al doble, estimó US$1,14 como cota superior). Con la medición de borradores del 23 de octubre (≈ US$0,90) suman ≈ US$1,64 de los US$2 autorizados.
- **Lo que no se pudo medir:** (1) el investigador **contra Serper**, porque en el entorno de pruebas no hay clave de Serper; lo medido es contra «solo el sitio de la empresa». (2) Si la **organización de Anthropic de producción** tiene encendida la búsqueda web (es un ajuste de la consola de Anthropic, y la llave de producción no se usa para probar): por eso la web de Cowork trae un freno, ver abajo. (3) El **modo autónomo de punta a punta** contra una base: no hay un entorno seguro para ello. (4) Si el servidor de App Hosting tiene tipografías para dibujar las páginas de un documento (la visión lo comprueba sola y, si no, no mira y el documento sigue como antes).

## 1. La web de Claude en Cowork

Cinco preguntas con Haiku 5.5 como coordinador (el corpus de siempre, con web y Investigadoras encendidas):

| Pregunta | Búsquedas | Llamadas | Tiempo | Costo | Qué hizo la respuesta |
| --- | --- | --- | --- | --- | --- |
| Qué hace Enaex y cuántos trabajadores tiene | 2 | 3 | 19 s | US$0,042 | Dio un rango (7.000 a 8.000) con cuatro fuentes enlazadas, dijo que varían y descartó la ficha de Indeed por ser muy inferior |
| ¿SalfaCorp ganó licitaciones o abrió proyectos este año? | 2 | 2 | 27 s | US$0,031 | Cuatro hechos fechados con enlace (contrato en República Dominicana, proyecto de La Florida, bodegas en Maipú, bono), dijo que no halló una licitación pública chilena y que no consultó la CMF ni Mercado Público; ningún dato de la empresa homónima |
| Noticias de Aguas Andinas para abrir un correo | 3 | 3 | 33 s | US$0,045 | Encontró las 70 vacantes de Laborum (8 de octubre) como ángulo, y **descartó las noticias del aluvión por sensibles**; avisó que que haya vacantes no prueba que revisen antecedentes; no hay contacto guardado y ofreció buscarlo |
| Noticias de «Retail Andes» (una empresa que no existe) | 3 | 1 | 19 s | US$0,041 | No inventó nada: dijo que no halló esa empresa, nombró la más parecida (Andes Retail, de Andes Motor) con sus fuentes y preguntó cuál era |
| Investigar a la vez Besalco, Ingevec y Salfacorp y decir a cuál escribirle primero | 8 (entre tres Investigadoras) | 6 | 43 s | US$0,110 | Tres `delegar` en la misma ronda; ordenó (Ingevec, Besalco, Salfacorp) con la evidencia de cada una y dijo que ninguna mostraba contratación masiva confirmada |

**Las 8 conversaciones de siempre, con la web encendida:** 7 de 8 contra 7 de 8 antes (la que falla es la misma, «el correo queda más corto»), **0 búsquedas**, costo parecido (US$0,067 contra US$0,057: en una de ellas, la de oportunidades, el agente usó las 5 llamadas que el libro permite y respondió más completo), y unos 5.000 tokens más de instrucciones por turno (las herramientas y su protocolo). La web no secuestra las preguntas que se responden con la cuenta.

**Tres cosas que se encontraron y se corrigieron:**

1. **Con Haiku, las herramientas web de filtrado dinámico no funcionan.** La misma pregunta de Enaex con ellas devolvió `invalid_tool_input` en las cuatro búsquedas (el modelo escribe el código que filtra y la API lo rechaza) y el turno terminó «no pude consultar la web». Con las básicas, dos búsquedas y la respuesta de arriba. **Ahora las básicas son lo normal** (`COWORK_WEB_BASIC=false` pide las otras) y `apphosting.yaml` lo dice explícito.
2. **La respuesta traía una etiqueta `</cite>` suelta** al final del texto, restos de las citas de la búsqueda. `polishCoworkText` la quita (los enlaces se quedan) y hay una prueba.
3. **Un error 400 de Anthropic con la web puesta no tenía salida.** Si la organización de Anthropic no tuviera encendida la búsqueda web, todos los turnos del harness, aun un «hola», terminarían en error. Ahora, si la petición llevaba la web y Anthropic la rechaza con un 400, el turno **sigue con el bucle de siempre** (queda un evento `turn.rescued` con el motivo) y **esa instancia no ofrece la web durante 10 minutos** (`src/lib/cowork/web-breaker.ts`): los turnos siguientes corren en el harness, sin web. Un 400 sin la web en la petición sigue siendo un error, como antes.

**El precio de la búsqueda quedó en la tabla** (`webSearchUsdPerThousand: 10` en el precio de `claude-haiku-5-5`), así que el costo de un turno que buscó se registra y no queda en blanco. Cada turno tiene su tope: 4 búsquedas y 3 lecturas del coordinador y, por Investigadora, 3 y 2, hasta 3 Investigadoras: **a lo más 13 búsquedas (US$0,13) en el peor turno**; el libro de consumo limita además las llamadas por turno, por conversación y por persona y día.

## 2. Las Investigadoras

El libro de consumo de producción ya reconoce el rol `delegate` (la restricción de roles tiene los ocho, comprobado el 24 de octubre antes de encender). En la prueba, el coordinador entregó tres tareas en la misma ronda y las tres corrieron a la vez; no hubo llamada que el libro rechazara. Con tres empresas la pregunta cuesta del orden de US$0,11 y 43 segundos, unas tres veces una pregunta con web de una sola empresa, a cambio de abarcar tres.

## 3. El investigador de leads con la web de Claude

Un Claude (Haiku, esfuerzo bajo, herramientas básicas) busca antes de que la investigación lea páginas y **entrega direcciones, no hechos**: la investigación las lee con su lectura segura, interpreta las fechas y extrae los hechos. Ocho empresas chilenas, cargo «Gerente de Personas», oferta AXIS, sin Serper (solo el sitio de la empresa como base):

| Empresa | Páginas elegidas / leídas | Costo | Lo mejor que trajo | Lo que falló |
| --- | --- | --- | --- | --- |
| Enaex | 8 / 6 | US$0,041 | Vacantes en Calama, Antofagasta, Mejillones y Copiapó (29-sep), inversión de unos US$100 millones, sociedad en India | 2 páginas no se pudieron leer |
| Aguas Andinas | 7 / 5 | US$0,048 | 70 avisos en Laborum (8-oct), resultados del semestre | 3 no se pudieron leer; un fallo de 2021 que el propio investigador marcó como antiguo |
| Besalco | 6 / 6 (3 del sitio) | US$0,040 | Backlog histórico (30-jul), inversión de US$400 millones | Solo 3 hechos con fecha reciente: una bolsa de empleo, un agregador y un PDF no se leyeron |
| Sodexo Chile | 4 / 3 | US$0,043 | Reconocimiento de mayo, bolsa de empleo | **0 hechos con fecha**; no halló lo que Sonnet halló el 23-oct (procesos masivos) |
| SMU | 8 / 6 | US$0,036 | La FNE aprobó una compra (21-oct), resultados, reestructuración y el nombre de quien dirige Personas | Una página con verificación anti-bots («One moment, please…») |
| SalfaCorp | 6 / 5 | US$0,047 | 3 vacantes (22-oct), resultados del trimestre, cambios en el directorio | Un artículo de 2024 elegido solo como contexto |
| Ingevec | 5 / 3 | US$0,039 | 16 contratos por UF 5,4 millones, 52 obras en ejecución | Avisos de empleo sin fecha |
| Gasco | 8 / 6 | US$0,036 | Plan de inversión de US$146 millones, licitaciones adjudicadas en 2026 | Wikipedia y un agregador con «0 ofertas actuales» |

- **Las 8 trajeron páginas de la empresa correcta**; en dos, el propio investigador dijo qué homónimos descartó (Besco y Besalco Stracon, GasCo de Singapur). El caso que falló con Sonnet el 23 de octubre (SalfaCorp frente a Salfa) salió bien con Haiku, en una sola ejecución.
- **Cuesta US$0,044 por investigación** (US$0,041 del investigador, con 3 búsquedas, y unos US$0,003 de Luna para extraer), contra unos US$0,10 con Sonnet. A cambio trae menos con fecha reciente que Sonnet en la misma medida tosca (22 contra 57 hechos por empresa; la medida cuenta cada hecho de una página con fecha reciente).
- **Lo que hay hoy en producción** (últimos 30 días): 59 investigaciones nativas, con 24 fuentes y 38 afirmaciones en promedio; 50 tienen señales de contratación (293 afirmaciones), 39 señales del sitio y **ninguna tiene noticias** (`news_signal`: 0). El investigador trae justo lo que no hay: prensa, comunicados, licitaciones y avisos con fecha.
- **Lo que no se pudo decidir con datos:** si suma sobre las páginas que ya consigue Serper. Con una llave de Serper de prueba, `scripts/evaluate-research-sources.ts` compara producción contra producción más investigador sin tocar la base ni enviar nada (`--modes=sin,con --no-judge`, que ahora deja en `results.json` las páginas elegidas, las leídas y cada hecho con su fecha, para leerlos).
- **Fallas conocidas:** páginas que la lectura segura no alcanza (bolsas de empleo, medios con verificación anti-bots) y que consumen un intento del presupuesto de páginas, y las páginas del investigador van primero, así que con pocas páginas disponibles (esquema «express», 10) desplazan a las del buscador.

**Lo que se agregó para dejarlo seguro: una página que el investigador eligió y que no nombra a la empresa no se usa.** Una búsqueda por nombre también encuentra homónimos, y un hecho sobre otra empresa terminaría en un correo a esta. La investigación ya lee cada página, así que busca el nombre (sin forma legal ni país: «Sodexo Chile S.A.» es «sodexo») o la dirección del sitio como palabras completas; una página del propio sitio siempre pasa. Una que no lo dice no se lee para extraer hechos, deja el aviso `claude_web_page_off_topic` y se cuenta en `researchMetrics.claudeWeb.offTopic`. Las páginas que rankea el buscador no pasan por esta puerta. Se repasó con las 40 páginas que la investigación leyó en esa medición: ninguna cayó (no había homónimos entre ellas). `src/lib/server/company-mention.ts`, con pruebas (Salfa no es SalfaCorp, Besco no es Besalco, mayúsculas y tildes, una palabra dentro de otra no cuenta).

## 4. La visión de documentos

Antes de entregar un documento largo, el agente lo revisa «como PDF» (`revisar_documento`): páginas, títulos solos, tablas cortadas. Con la visión, **un Claude (Haiku) mira además las páginas**. En el servidor las páginas salen de `pdftoppm` si existe o, si no, de las vistas SVG con `sharp`.

- **Tres documentos de prueba, con Haiku mirando las páginas** (unos US$0,002 las tres revisiones): una tabla de 8 columnas y 14 filas, que la inspección de siempre dio por buena (0 problemas), recibió 7 reparos reales (palabras partidas a mitad en las columnas angostas, una dirección en cinco líneas, la fecha repetida en cada fila, correos partidos, una última página con tres filas, y **un total mal sumado: decía 273 y las filas suman 315**); un texto descuidado, 5 (marcas sin rellenar `[completar]` y `{{nombre}}`, cifras sin unidad, dos faltas de ortografía); en el documento limpio marcó solo el título de prueba que sobraba.
- **Con el agente, de punta a punta:** un informe largo con la tabla completa: el agente llamó `revisar_documento`, la visión marcó tres defectos reales de la tabla (palabras partidas en las columnas, la tabla empezando al pie de una página, nombres de ciudades partidos) y el agente los tuvo a la vista antes de entregar (4 llamadas, 52 segundos, US$0,013); no se leyó si cambió la tabla. Con un documento corto el agente no lo revisa, y es lo previsto.
- **No sabemos si App Hosting tiene tipografías.** Sin ellas, `sharp` dibuja páginas sin letras, y un revisor que mira páginas en blanco inventaría defectos. Por eso la visión **prueba primero que la máquina dibuja texto** (una palabra en negro sobre blanco y cuenta los puntos oscuros) y, si no, no mira y el documento sigue como antes (`drawsText`, con pruebas). Con `pdftoppm` presente se usa el PDF directamente.

## 5. El modo autónomo

Aparece en el compositor como «Autónomo»; cada conversación parte en «Con aprobaciones». Lo que aprueba solo está en `AUTOMATIC_EFFECTS` (`src/lib/cowork/execution-policy.ts`): **guardar un contacto, iniciar una investigación, pedir un borrador, buscar el correo de una persona (1 crédito) y crear una campaña en pausa**, más **una búsqueda externa de prospectos por hilo**, con un tope de **3 pasos, 1 búsqueda y 2 borradores** por cadena. Nunca lo aprueba solo: envíos, activar o pausar campañas, notas, enriquecer varias personas a la vez, teléfonos, LinkedIn, importar contactos ni ejecutar código; las pruebas del CI fijan la lista y los topes.

- **Con la web, nada se aprueba solo.** Un turno que leyó la web abierta (una búsqueda, una página o una Investigadora) deja sus propuestas marcadas (`fromWeb`) y el modo autónomo no las aprueba: quedan esperando a la persona, como en «Con aprobaciones». Lo que dice una página es un dato, pero una página puede intentar guiar al agente («guarda este contacto», «busca su correo»), y juntar la web con la aprobación automática lo dejaría ejecutar eso sin que nadie lo vea. Pasa por `coworkEffectCanAutoApprove` y por la condición de la búsqueda automática del trabajador, con pruebas.
- **El texto del selector no decía lo que hace.** Hablaba de «búsquedas y efectos exactos» y de que «campañas siempre pasan por tu revisión», cuando el modo crea campañas en pausa y gasta un crédito por correo buscado. Ahora lo dice: *«Aprueba por ti buscar prospectos (1 búsqueda por hilo), guardar contactos, investigar, pedir borradores, buscar un correo (usa 1 crédito) y crear campañas en pausa, con tope de 3 pasos automáticos por hilo. Lo que sale de una búsqueda en la web, los envíos, las activaciones y las notas siempre los apruebas tú.»*
- **Peor caso por cadena:** 3 créditos de correo, o 3 investigaciones, o 2 borradores, y una búsqueda de prospectos (de la cuota diaria, sin créditos); nada sale a nadie.
- **Lo que no hay:** una prueba en vivo. El guion `scripts/test-cowork-autonomy.mjs` no está en el CI y ya no pasa (sus simulaciones quedaron viejas: el trabajador ya no toma la corrida con ellas); no es un indicio de un fallo del modo. El primer uso real es la primera prueba de punta a punta, y por eso las consultas de abajo lo vigilan.

## Lo que cambió en el código

- `apphosting.yaml`: `COWORK_WEB_ENABLED`, `COWORK_WEB_BASIC`, `COWORK_SUBAGENTS_ENABLED`, `COWORK_DOCUMENT_VISION`, `COWORK_AUTONOMY_ENABLED` y `RESEARCH_CLAUDE_WEB_ENABLED` en `"true"`, y el precio de la búsqueda en `COWORK_MODEL_PRICING_JSON` (versión `anthropic-standard-2026-10-24-web`).
- `src/lib/cowork/harness-config.ts`: las herramientas web básicas son lo normal.
- `src/lib/cowork/harness-turn.ts` y `web-breaker.ts`: el 400 con la web cae al bucle y pausa la web 10 minutos.
- `src/lib/cowork/answer-quality.ts`: sin etiquetas `cite` en lo que ve la persona.
- `src/lib/server/company-mention.ts` y `research-report-v2-research.ts`: la puerta contra homónimos.
- `src/lib/documents/vision.ts`: la visión comprueba que la máquina dibuja texto.
- `src/components/cowork/ExecutionMode.tsx`: el texto honesto del modo autónomo; `execution-policy.ts`, `harness-turn.ts`, `agent-loop.ts` y `worker.ts`: lo que propone un turno que leyó la web no se aprueba solo.
- `scripts/spend-guard.mjs`: cuenta las búsquedas web; `scripts/evaluate-research-sources.ts`: `--no-judge` y todo lo leído en `results.json`; `scripts/evaluate-cowork-harness.ts`: conecta el revisor de documentos como el trabajador.
- `scripts/visual-audit/env.mjs`: el banco de recorridos decide por sí mismo estas funciones, para que sus líneas base no cambien.
- `src/lib/server/production-configuration.test.ts`: ahora exige que estén encendidas, con la web básica, el precio de la búsqueda y la lista de lo que el modo autónomo aprueba.

## Cómo vigilarlas

Sustituye `<DESDE>` por la hora del despliegue (UTC). Todas son de solo lectura.

**Web y Investigadoras: llamadas y costo por rol.** `sin_costo` distinto de 0 en un rol con web quiere decir que el precio de la búsqueda no se está aplicando.

```sql
select c.role, c.usage->>'model' as modelo, count(*) as llamadas, count(distinct c.run_id) as turnos,
       round(sum((c.usage->>'costUsd')::numeric), 4) as usd,
       count(*) filter (where c.usage is not null and c.usage->>'costUsd' is null) as sin_costo
from public.cowork_model_calls c
where c.created_at >= '<DESDE>' and c.role in ('coordinator', 'delegate')
group by 1, 2 order by 1, 2;
```

**Los turnos más caros** (con web, los de varias Investigadoras): lo esperado es del orden de US$0,03 a US$0,11; sobre US$0,20 es una señal.

```sql
select r.id as turno, r.created_at::timestamp(0) as cuando, count(c.id) as llamadas,
       count(*) filter (where c.role = 'delegate') as delegadas, round(sum((c.usage->>'costUsd')::numeric), 4) as usd
from public.cowork_runs r join public.cowork_model_calls c on c.run_id = r.id
where r.created_at >= '<DESDE>'
group by r.id, r.created_at order by usd desc nulls last limit 10;
```

**Turnos que cayeron al bucle, y por qué.** Una razón `CLAUDE_HTTP_400` es Anthropic rechazando las herramientas web (¿la organización no tiene la búsqueda web encendida? Es un ajuste de la consola de Anthropic); `CLAUDE_HTTP_429` y `5xx` son la cuenta o el servicio. Con un 400 la web queda pausada 10 minutos por instancia y vuelve a probarse sola.

```sql
select e.created_at::timestamp(0) as cuando, e.payload->>'failure' as falla, left(e.payload->>'reason', 160) as razon
from public.cowork_run_events e
where e.kind = 'turn.rescued' and e.created_at >= '<DESDE>'
order by e.created_at desc limit 20;
```

**Modo autónomo: qué efectos se propusieron y cómo terminaron**, por modo de la conversación. En `autonomous` solo deberían figurar los cinco tipos de la lista; un `send_email`, `campaign_activate` o similar que no esté esperando la decisión de una persona sería un fallo grave y obliga a apagar la variable.

```sql
select r.mode, p.kind, p.status, count(*) as efectos, count(distinct r.user_id) as personas
from public.cowork_effect_proposals p join public.cowork_runs r on r.id = p.run_id
where p.created_at >= '<DESDE>'
group by 1, 2, 3 order by 1, 2, 3;
```

**El investigador de leads.** Sus avisos (`claude_web_unavailable`: falló o no hay búsqueda web en la organización de Anthropic; `claude_web_page_off_topic`: descartó un homónimo) no tienen una tabla propia: marcan la investigación compartida como `partial` (igual que cualquier página que no se pudo leer, así que las parciales ya eran frecuentes). Una subida fuerte de las parciales después de encender es la señal. Antes de encender, en 30 días: 37 completadas, 22 parciales y 10 con datos insuficientes.

```sql
select status, count(*) as investigaciones, max(created_at)::timestamp(0) as ultima
from public.research_company_artifacts
where created_at >= '<DESDE>'
group by 1 order by 2 desc;
```

El costo del investigador (del orden de US$0,04 por investigación, unas 3 búsquedas) no pasa por el libro de Cowork: se mira en la consola de Anthropic, en las búsquedas web por día.

## Cómo apagar cada una

Quitar la variable de `apphosting.yaml` y desplegar; el siguiente turno, la siguiente investigación y el siguiente documento ya corren como antes. No hace falta tocar la base ni la tabla de precios.

| Para apagar | Quitar |
| --- | --- |
| La web de Cowork (y con ella las Investigadoras) | `COWORK_WEB_ENABLED` |
| Solo las Investigadoras | `COWORK_SUBAGENTS_ENABLED` |
| El investigador de leads | `RESEARCH_CLAUDE_WEB_ENABLED` |
| La visión de documentos | `COWORK_DOCUMENT_VISION` |
| El modo autónomo | `COWORK_AUTONOMY_ENABLED`: el selector desaparece y la política vuelve a leer la variable en cada paso, así que lo que estaba en curso sigue «Con aprobaciones» |

La prueba `production-configuration.test.ts` describe lo que dice producción: hay que actualizarla en el mismo cambio.
