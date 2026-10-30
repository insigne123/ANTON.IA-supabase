# Borradores que suenan a persona (30 de octubre de 2026)

El dueño pidió un sistema de correos «perfecto»: que se vean naturales, humanos e interesantes, que se creen bien y con el contenido indicado. Esta página dice qué se encontró, qué cambió (`native-draft/v24`) y cómo se midió.

## Qué se encontró

**En producción** (lectura de solo lectura, 29 y 30 de octubre; no se copian aquí correos de clientes):

- **Lo que la gente corrige a mano.** En los borradores editados antes de enviar, las personas agregaron qué es su empresa («…, nuestra plataforma de…»), pusieron mayúscula al asunto (el modelo lo escribía todo en minúscula), corrigieron una cifra de su propio producto y reescribieron una oración que había quedado sin verbo («Para selección en servicios transitorios.»).
- **El gancho salía de evidencia que no es un hecho.** Lo que la investigación ofrecía como «hechos» de varias empresas eran títulos de PDF («MANUAL CORPORATIVO - Código de Ética…», «Página 1 de 66…»), páginas de agregadores de empleo, la misión y la política de seguridad de la información de la empresa, y una definición de la ley de servicios transitorios copiada de su sitio. Un borrador abrió con esa definición («el período de cobertura… está vinculado a la naturaleza de la causal…»).
- **Se crean, pero con reintentos.** En los últimos 10 días pasaron la verificación 28 de 76 intentos; casi todos los rechazos son de dos investigaciones del 23 de octubre (31 intentos cada una). El 28 y 29 de octubre pasaron 19 de 24.

**En el banco** (`scripts/fixtures/outreach-eval-set.json`, 20 casos, Luna), `native-draft/v23`:

- **El eslogan en todos los correos.** 16 de 18 correos iniciales repetían cinco palabras seguidas o más de la propuesta de valor («ponemos dotación temporal por el tiempo que la necesitan, y el costo se va con el peak»). El prompt pedía «el beneficio con las palabras de valueProposition» y el editor final devolvía el correo a esas palabras.
- **Frases puente que no dicen nada.** 9 de 18: «puede implicar sumar personal por un período acotado», «eso implica movimiento en la dotación», «Así, el apoyo puede acompañar ese período», «es una alternativa». El prompt prohibía cualquier generalización sobre la operación, así que el modelo no podía decir por qué ese momento le pesa a alguien del rubro.
- **Vigilancia.** «según su reporte interno», «en la conversación salió que…».
- **Las objeciones se ignoraban.** A «ya tenemos proveedor» o «no hay presupuesto» respondía con el mismo correo en frío.

## Qué cambió

| Qué | Dónde |
| --- | --- |
| **Prompt `native-draft/v24`.** La apertura dice el hecho como se contaría en voz alta y después qué se complica en ese momento para alguien de su rubro (dicho como del rubro, sin cifras ni hechos de su empresa que no constan, y sin obviedades). Quien escribe se presenta en pocas palabras con su nombre de pila y su empresa («Soy …, de …; …»). El beneficio sale de la propuesta de valor o de un servicio, con palabras propias y aplicado al caso: nunca el eslogan literal. Se nombran y prohíben las frases que no dicen nada, el tono de vigilancia y las oraciones que repiten la anterior en los seguimientos. Si la instrucción del usuario dice que es una respuesta, el correo responde primero lo que la persona dijo. El editor final ya no devuelve el correo al eslogan y borra las oraciones vacías o sin verbo. Los ejemplos del prompt usan marcadores (`<tu empresa>`), nunca un vendedor real. | `src/ai/flows/generate-outreach-from-report.ts` |
| **Asunto como oración**: mayúscula inicial, el resto como lo escribió el modelo. | `sentenceCaseSubject` en el mismo archivo |
| **Oraciones sin verbo**: una oración que empieza como la primera mitad de otra («Para…», «Con…», «Cuando…») y no tiene verbo bloquea el borrador y pide reescribirla (`tone_fragmento`). Una oración corta de otro tipo («Un solo proveedor para todo.») es estilo y pasa. | `src/lib/server/human-tone-checks.ts` |
| **Frases vacías bloqueadas**: «es una alternativa», «es una opción», «pone sobre la mesa», «forma parte del trabajo», «el costo acompaña», «según su reporte», «en la conversación salió». | `MULETILLAS`, mismo archivo |
| **Ganchos que no son hechos** (con `DRAFT_HOOK_FILTER_ENABLED`, encendida en producción): encabezados y títulos de documentos, agregadores de empleo, cifras que perdieron sus primeros dígitos, texto en mayúsculas sostenidas, misión, visión, cultura, políticas de privacidad o de seguridad de la información, definiciones de la ley, títulos de artículos («La importancia de…»), textos que son una pregunta (títulos de blog, preguntas frecuentes, «¿Tienes dudas?») y perfiles de LinkedIn de otras personas («… · Educación: …», «4 perfiles de…»). Los fragmentos de buscador («título …: fragmento») no se sacan: algunos traen la señal («Estaremos presentes en feria laboral de Antofagasta…»). En 190 investigaciones de las últimas tres semanas saca el 5 % de la evidencia y la que menos conserva tiene 6 de la empresa: no deja a nadie sin borrador. | `isUnsuitableHookText` en `src/lib/research-fact-eligibility.ts` |
| **Sin dos preguntas en el inicial**: cuando el CTA aprobado es una pregunta, la apertura asignada «pregunta» pasa a «observación». Antes uno de cada tres correos iniciales nacía con dos preguntas y dependía del reintento. | `draftContextPrompt`, mismo archivo del prompt |
| **La Redactora de Cowork** (Contacto del día y Cowork) revisa lo mismo: una oración sin verbo y las frases vacías («pone sobre la mesa», «pensé que podría», «me gustaría», «la idea es»…) vuelven como corrección a la Redactora. El detector de oraciones sin verbo vive en un solo lugar para las dos vías. | `src/lib/sentence-fragments.ts`, `coworkDraftIssues` en `src/lib/cowork/writer.ts` |
| **Tono de los flujos auxiliares** (respuestas, reconexión, campañas): presente y concreto, sin eslogan, sin «pensé que podría», «me gustaría», «la idea es»; asunto con mayúscula inicial. | `src/lib/outreach-tone.ts` (`outreach-tone/v2`) |

## Cómo se midió

- **Escribe Luna**, el modelo de producción, con el banco de 20 casos y un segundo vendedor ficticio (una plataforma de pruebas psicolaborales, `Evalia`) sobre los 8 primeros casos en frío. El segundo vendedor comprueba que el prompt no copia el vendedor del banco y que las mejoras no dependen de él.
- **Conteo mecánico**, sin juez de pago: correos con relleno, con cinco palabras seguidas de la propuesta de valor, que se presentan, con asunto en minúscula, aperturas distintas y válidos. Además, la lectura de cada correo en la sesión (AGENTS.md: medir leyendo, no con un juez de pago).
- **Costo:** unos US$0,08 por corrida del banco y US$0,03 por la de `Evalia`; todas las rondas juntas, alrededor de US$0,60.

## Resultado

| Banco de 20 casos, correos iniciales (18) | `v23` (producción) | `v24` |
| --- | --- | --- |
| Con frases que no dicen nada | 9 | 4 |
| Con cinco palabras seguidas de la propuesta de valor | 16 | 3 |
| Quien escribe se presenta | 0 | 18 |
| Asunto todo en minúscula | 7 | 0 |
| Aperturas distintas (primeras cuatro palabras) | 15 | 16 |
| Válidos al final | 18 | 18 |
| Válidos al primer intento (de 24 generaciones) | 22 | 21 |
| Costo de la corrida | US$0,070 | US$0,085 |

- **Con el segundo vendedor** (`Evalia`, 8 casos): se presentan 8 de 8 (antes 0) y ninguno copia nombres del vendedor del banco. Quedan válidos 7 de 8: en uno la apertura asignada era una pregunta y, con el CTA que agrega el servidor, el correo quedó con dos; el reintento no lo corrigió. Esa tensión entre la apertura «pregunta» y el CTA ya existía y quedó resuelta (ver la tabla de cambios).
- **Secuencias** (2 de 4 pasos): 8 de 8 válidos, con seguimientos de una o dos oraciones más la pregunta, sin la oración que repetía la anterior.
- **Cómo suena**, en un caso del banco (ficticio). Antes: «Vi que abren cinco sucursales nuevas en regiones durante el primer semestre. / En ServiPro ponemos dotación temporal por el tiempo que usted la necesita, y el costo se va con el peak.» Ahora: «Vi que en Banco Regional abren cinco sucursales nuevas en regiones durante el primer semestre. En las aperturas bancarias, si falta personal, la carga de atención termina recayendo en los equipos de las sucursales que ya operan. / Soy Carla, de ServiPro; ponemos personal temporal en las sucursales nuevas por el período que requiera cada apertura.»
- **El costo sube un 20 %** (correos algo más largos: 70 palabras contra 55, dentro del tope de 110).

### Leídos uno por uno

Además del conteo, leí los 13 correos en frío del banco de cada versión y puse nota de 1 a 5 a «suena a persona» y «da una razón interesante», y si lo enviaría tal cual, con un retoque o no. Es una sola lectura y no a ciegas (la presentación «Soy Carla, de ServiPro» delata la versión), así que vale como orientación, no como prueba.

| 13 correos en frío | `v23` | `v24` |
| --- | --- | --- |
| Suena a persona (promedio) | 2,4 | 3,8 |
| Da una razón interesante (promedio) | 1,9 | 3,2 |
| Lo enviaría tal cual | 0 | 8 |
| Con un retoque | 5 | 5 |
| No lo enviaría | 8 | 0 |

Lo que todavía pide retoque en `v24`: una frase de relleno que se cuela («puede implicar sumar personal», «Así, el equipo puede…») y, en dos correos, una consecuencia que repite la anterior con otras palabras. Ningún correo de `v24` afirmó algo de la empresa que no estuviera en los hechos del caso.

### Qué enseñó cada ronda

1. **Quitar «el beneficio con las palabras de valueProposition»** bajó el eslogan de 16 a 2, pero la frase del rubro salió obvia («abrir tiendas exige coordinar la dotación») y la presentación copiaba la descripción entera de la empresa.
2. **Presentarse con el nombre de pila y pedir qué se complica en concreto** dejó el relleno en 1 y el eslogan en 0, pero 9 de 18 correos usaban la misma fórmula («puede dejar … esperando»). Los ejemplos del prompt con el vendedor del banco inflaban el resultado: se cambiaron por marcadores y se agregó el segundo vendedor.
3. **Prohibir «puede»** quitó la fórmula, pero devolvió obviedades («el equipo tiene que estar listo para atender desde el primer día»).
4. **Pedir el costo de que salga mal** (qué se pierde, quién se sobrecarga, qué se atrasa) dio consecuencias concretas del rubro. Es la que quedó.

## Segunda vuelta: `native-draft/v25`

`v24` quedó en `main` con el PR 594. La lectura de su última corrida y de los borradores reales de producción mostró lo que faltaba.

**Lo que se encontró:**

- **En producción**, cuando la investigación no trae ninguna señal con fecha, el correo abre repitiendo lo que la empresa dice de sí misma en su sitio («Vi que en … reclutan y seleccionan el mejor talento disponible», «suma más de cinco décadas en proyectos relevantes»), o empieza por lo que vende quien escribe. El prompt se contradecía: pedía abrir con una observación del rubro y, más abajo, «empieza por la propuesta aplicada a esa actividad».
- **La consecuencia era siempre la misma.** En 8 de 18 correos iniciales, el costo del momento era «la carga recae en el equipo que ya está», que vale para cualquier rubro.
- **Los seguimientos eran lo más flojo.** Tenían frases vacías en 3 de 6 pasos: «un reemplazo el mismo día permite resolver ese turno operativo», «administrar contratos también puede acompañar la incorporación». También se filtraban palabras de las instrucciones al correo («¿Te parece conversar sobre esta aplicación?»), y el cierre volvía al eslogan («el costo acompaña el peak»).
- **El control de tono no veía las variantes.** Pasaban «su costo acompaña la cosecha», «el costo de esa dotación acompaña el peak» y «Así puede sumar personal…».
- **La reconexión rellenaba** («esto permite contar con apoyo… El foco es coordinar…») y, con el largo más corto, en una corrida firmó el correo, cuando la firma la agrega el envío.

**Qué cambió:**

| Qué | Dónde |
| --- | --- |
| **Apertura sin señal**: sin un hecho con fecha o evento en la evidencia, el inicial no repite la autodescripción de la empresa ni empieza por lo que se vende; abre con lo que se complica en su rubro, con la empresa nombrada de pasada («En una consultora de selección como …, …»). Se quitó la regla que decía lo contrario. | `noSignalOpening` en `src/ai/flows/generate-outreach-from-report.ts` |
| **Dónde se nota**: «la carga recae en el equipo que ya está» se nombra como obviedad; se pide dónde se nota (la fila en caja, el despacho que sale tarde, el guardia que dobla turno). | mismo archivo |
| **El costo dicho con lo que pasa**: si la propuesta de valor habla de cuánto dura el costo, se dice con un hecho («cuando termina la temporada, se termina el contrato y deja de pagarse»), no con «el costo acompaña el peak». Solo prohibirlo no bastó: el modelo lo volvía a escribir y el reintento lo arreglaba (6 de 9 primeros intentos rechazados en una corrida). | mismo archivo |
| **Seguimientos**: lo nuevo va como una escena del trabajo de la persona y lo que hace quien escribe, con ejemplos de otros rubros («Si una grúa queda detenida un viernes, el técnico llega antes del turno del lunes.»); nunca palabras de las instrucciones («esta aplicación», «este enfoque»); el cierre retoma lo que harías, no el eslogan. | mismo archivo y `RESEARCH_SEQUENCE_STEPS` en `src/lib/outreach-sequence-brief.ts` |
| **Más frases vacías bloqueadas**: «costo/gasto … acompaña» con palabras en medio, «Así puede…», «Así, ese turno puede…» (no «así que»), «puede acompañar», «como parte de la gestión» y, por vigilancia, «reporte interno». La Redactora de Cowork marca las mismas. | `HOLLOW_PATTERNS` y `MULETILLAS` en `src/lib/server/human-tone-checks.ts`; `HOLLOW` en `src/lib/cowork/writer.ts` |
| **Reconexión**: 70 a 130 palabras, sin firma; el bloque de tono pide decir lo que harías, no lo que la oferta «permite» (`outreach-tone/v3`). | `src/ai/flows/generate-reconnection-message.ts`, `src/lib/outreach-tone.ts` |
| **El banco guarda por qué se rechazó el primer intento** (`firstIssues` en `results.json`), para ver cuánto reintento cuesta cada regla. | `scripts/evaluate-outreach-set.ts` |

**Resultado** (mismo banco, Luna; el contador de relleno ahora también cuenta las variantes de arriba, así que `v24` se volvió a contar con él):

| Banco de 20 casos | `v24` (en `main`) | `v25` |
| --- | --- | --- |
| Iniciales con frases que no dicen nada (de 18) | 3 | 0 |
| Iniciales con «la carga recae en el equipo» (de 18) | 8 | 1 |
| Iniciales con cinco palabras seguidas de la propuesta de valor (de 18) | 1 | 2 |
| Seguimientos con frases que no dicen nada (de 6) | 3 | 1 |
| Válidos al final | 16 de 16 iniciales, 8 de 8 pasos | 16 de 16, 8 de 8 |
| Válidos al primer intento (de 24 generaciones) | 22 | 23 |
| Costo de la corrida | US$0,088 | US$0,084 |

- **Con el segundo vendedor** (`Evalia`, 8 casos): 8 de 8 válidos, sin relleno ni «la carga recae en el equipo», y ninguno copia el ejemplo del costo, que no es de su oferta. El único reintento fue un falso positivo del detector de oraciones sin verbo («Si se alarga, se posterga la decisión de contratación.»): ahora un pronombre delante de una palabra («se alarga») cuenta como verbo. Aquí las «cinco palabras seguidas de la propuesta» (6 de 8) no son eslogan. Su propuesta es un mecanismo («los postulantes rinden los tests desde cualquier dispositivo…») y el correo lo cuenta tal cual.
- **Secuencias** (2 de 4 pasos): 8 de 8 válidos al primer intento y ningún seguimiento con relleno. Los seguimientos ahora dicen una sola cosa concreta («si alguien falta durante una jornada, en ServiPro reemplazamos ese turno el mismo día») y no retoman el eslogan en el cierre.
- **Gasto de esta vuelta:** nueve corridas, US$0,53.

**Leídos uno por uno** (los mismos 13 correos en frío, con el mismo criterio y la misma advertencia: una sola lectura, no a ciegas):

| 13 correos en frío | `v23` | `v24` | `v25` |
| --- | --- | --- | --- |
| Suena a persona (promedio) | 2,4 | 3,8 | 4,0 |
| Da una razón interesante (promedio) | 1,9 | 3,2 | 3,5 |
| Lo enviaría tal cual | 0 | 8 | 9 |
| Con un retoque | 5 | 5 | 4 |
| No lo enviaría | 8 | 0 | 0 |

Lo que mejoró se ve en la segunda oración: «se resienten la atención en sala y la reposición», «se acumula fruta por procesar», «aprieta los descansos de quienes toman los turnos», «se sigue pagando personal para una etapa que ya pasó». Lo que todavía pide retoque: dos aperturas sin señal que siguen apoyándose en el tamaño de la empresa sin decir nada más («ajustar la duración de la dotación importa»), una oración enredada en minería y una respuesta a «no hay presupuesto» que en esa corrida no lo reconoció (en las otras tres corridas sí).

**Una corrida intermedia enseñó algo:** quitar del prompt los ejemplos negativos («el costo acompaña el peak») para no «sembrar» la frase no la redujo. El modelo la escribe porque parafrasea la propuesta de valor del vendedor («el costo se va con el peak»). Lo que funcionó fue darle una manera concreta de decir esa idea.

### Tercera vuelta: `native-draft/v26`

- **Editor final (3d).** La segunda oración de la apertura no repite la primera ni es la propuesta de valor dicha al revés («mantener personal después del peak deja un costo»). Dice lo que pasa en la operación cuando ese momento sale mal, sin «el equipo absorbe la carga». Una primera versión que pedía «quién se sobrecarga» subió esa fórmula de 1 a 5 de 18; se sacó.
- **Un hecho de otro mes.** La regla de decirlo con su mes y en pasado se agregaba siempre, y el banco, cuyas señales son de septiembre, empezó a abrir con «En septiembre anunciaron que…». Ahora solo se agrega cuando una señal de más de 30 días llegó de verdad a la evidencia (`writing.olderSignal`, que solo puede pasar con `DRAFT_SIGNAL_MAX_AGE_DAYS` sobre 30).

| Banco de 20 casos | `v25` | `v26` |
| --- | --- | --- |
| Iniciales con frases que no dicen nada (de 18) | 0 | 0 |
| Iniciales con «la carga recae en el equipo» (de 18) | 1 | 2 |
| Iniciales con cinco palabras seguidas de la propuesta (de 18) | 2 | 1 |
| Seguimientos con frases que no dicen nada (de 6) | 1 | 0 |
| Válidos al final | 24 de 24 | 24 de 24 |
| Válidos al primer intento (de 24) | 23 | 22 |
| De los 13 en frío, los enviaría tal cual | 9 | 10 |

- **Lo que más mejoró son las aperturas sin señal**, que en producción son la mayoría: «En retail, un turno descubierto se nota rápido, incluso en una cadena como Tiendas Ejemplo, con 40 tiendas en la zona sur.» y «…los relevos requieren cuadrar bien los turnos. Cuando uno queda sin cubrir, el equipo entrante extiende su jornada y el cambio se atrasa.»
- **Lo que todavía pide retoque:** el puente entre una fiscalización y un turno por cubrir (minería), un «eso permite» en conserjería y la startup, cuyo caso no calza con dotación temporal.
- **Con hechos de mayo, julio y agosto marcados como antiguos:** 3 de 3 válidos al primer intento, ahora sin el año («En mayo, … finalizó la revisión técnica…»).
- **Las diferencias entre `v25` y `v26` en el banco están dentro del ruido de una corrida.**

### Cuarta vuelta: `native-draft/v27`

- **El servicio que calza, también sin señal.** Sin una señal, el redactor ofrecía siempre el servicio de la propuesta de valor, aunque no calzara (personal temporal a una startup que crece contratando). Ahora elige entre los servicios del perfil el que responde a lo que hace la empresa y al cargo de quien lee. En una corrida, la startup recibió «cada contratación suma gestión de contratos… el equipo de Personas termina persiguiendo documentos» con la oferta de administrar contratos, y la fiscalización minera recibió la administración de contratos en vez de personal para un turno. En otra corrida, la startup volvió a recibir personal temporal: la regla ayuda, pero no lo garantiza.
- **La cifra después de presentarse.** «Soy Carla, de ServiPro; la faena minera de … tiene más de 2.000 trabajadores…» se rechazaba dos veces y el correo no se creaba. Como la oración nombra al vendedor, la cifra del destinatario se buscaba en el perfil del vendedor. Ahora la parte que sigue a la presentación («Soy …, de …;») se revisa por sí sola. Si habla del destinatario, se apoya en la evidencia; si no, sigue siendo la voz del vendedor. Una cifra del vendedor puesta en el destinatario se sigue rechazando (`draft-preflight-v2.ts`).
- **Más frases puente:** «Así, la dotación también puede…» (hasta tres palabras en medio) y «así, usted cuenta con…». Sobre las corridas anteriores, el patrón ampliado solo toca esas dos frases.

| Banco de 20 casos | `v26` | `v27` |
| --- | --- | --- |
| Válidos al primer intento (de 24) | 22 | 24 |
| Válidos al final | 24 de 24 | 24 de 24 |
| Iniciales con frases que no dicen nada (de 18) | 0 | 0 |
| Iniciales con «la carga recae en el equipo» (de 18) | 2 | 1 |
| De los 13 en frío, los enviaría tal cual | 10 | 11 |
| Segundo vendedor (`Evalia`): válidos al primer intento | 8 de 8 | 8 de 8 |

Los dos que todavía piden retoque son los de minería sin señal, que vuelve al eslogan («el costo se va cuando baja el peak»), y el de la startup, que en esa corrida no eligió el servicio que calza.

## Lo que falta

- **La investigación.** El filtro saca lo que no es un hecho, pero el redactor necesita hechos con fecha y dato concreto (una apertura, una vacante, una licitación adjudicada). Siguen entrando fragmentos de buscador con «…», perfiles de LinkedIn de otras personas y la descripción de la empresa escrita por ella misma. En los borradores reales del 28 y 29 de octubre, casi todas las aperturas salieron de esa autodescripción o del servicio de quien escribe: ninguna traía un hecho con fecha. `v25` hace que ese correo abra mejor, pero un hecho con fecha sigue valiendo más que cualquier regla de redacción (`docs/senales-de-la-investigacion-al-correo.md`).

  **Cuánto pesa, en producción** (los 168 informes con el esquema actual, `research-report-document/v2`, de los últimos 30 días; lectura de solo lectura. Los 124 con el esquema anterior, el último del 27 de octubre, no guardan las señales donde se pueden contar y quedan fuera):

  | Señal con fecha más reciente del informe | Informes |
  | --- | --- |
  | De 30 días o menos (la única que el borrador usa) | 25 (15 %) |
  | De 31 a 90 días | 39 (23 %) |
  | De 91 a 180 días | 10 (6 %) |
  | Más antigua | 27 (16 %) |
  | Ninguna | 67 (40 %) |

  - **Lo que falta en la mayoría de los informes:** cuatro de cada diez informes no traen ninguna señal, y otros cuatro solo traen señales de más de 30 días, que el borrador no usa. En total, el 85 % de los informes llega al borrador sin una señal que pueda usar, y ahí escribe la apertura sin señal de `v25`.
  - **Un caso de la última semana:** el informe traía cuatro proyectos terminados con mes y año («En mayo de 2026, … finalizó la revisión técnica … para BHP»). La regla de 30 días los dejó fuera, y el correo abrió con «más de cinco décadas en proyectos».
  - **La decisión que se había tomado:** mantener los 30 días («un hecho de hace tres meses no es "vi que"»). Se tomó con 8 empresas, donde alargar la ventana no sumaba ninguna.
  - **Lo que muestra producción:** con 90 días, los informes con un hecho con fecha pasarían de 15 % a 38 %. El correo lo diría con su mes («En agosto terminaron …»), nunca como «vi que».
  - **Decisión (30 de octubre):** el dueño eligió 90 días para todas las cuentas. `apphosting.yaml` pone `DRAFT_SIGNAL_MAX_AGE_DAYS=90` y `RESEARCH_SIGNAL_HARVEST_DAYS=90`.
  - **Lo que ya está listo:** `DRAFT_SIGNAL_MAX_AGE_DAYS`, de 30 a 180 días; si falta o está fuera de rango, queda en 30, como hoy. Alarga la ventana solo para las señales del informe (`dimension: signal`). La página tiene que haberse leído en los últimos 30 días, y el resto de los hechos sigue con 30. Respeta `DRAFT_PILOT_USER_IDS`. El prompt ya pide decir un hecho de otro mes en pasado y con su mes, nunca como algo de ahora.
  - **Prueba con 3 casos con hechos de mayo, julio y agosto:** los 3 válidos al primer intento, en pasado y sin «vi que» («En julio de 2026, … abrió tres tiendas en Temuco y Puerto Montt. … Si usted aún está ajustando turnos para esas tiendas, …»). Todavía copia la frase de la fuente con el año.
  - **Para encenderla:** `DRAFT_SIGNAL_MAX_AGE_DAYS=90` y `RESEARCH_SIGNAL_HARVEST_DAYS=90` en `apphosting.yaml`, para que la cosecha busque lo mismo que el borrador acepta.
- **Las «señales» de la búsqueda no siempre lo son.** Lo que la búsqueda de empleos o noticias devuelve queda como `hiring_signal` o `news_signal` (`native-research.ts`), aunque sea un post del blog de la empresa («El papel estratégico del Employer Branding…»), el título de una sección del sitio o una certificación. Cuando la página no tiene fecha, la afirmación toma la de captura. El indicador de «señales recientes» cuenta las que tienen fecha de publicación, pero no mira cuán vieja es: una página de 2020 suma como reciente. El borrador no las toma como gancho, porque la búsqueda de empleos y noticias no entra como evidencia y el filtro saca los títulos. Pero el indicador engaña a quien lee el informe. Arreglarlo baja la confianza de esos informes (pesa 0,15 en `overallConfidence`, que entra en la prioridad del borrador), así que se deja anotado para medirlo antes.
- **Las objeciones.** El correo ya reconoce lo que dijo la persona, pero el servidor le agrega el CTA de reunión del estilo; a quien dijo «no hay presupuesto» le sobra.
- **La Redactora de Cowork** (Contacto del día, Cowork) escribe mejor que la vía de borradores, pero todos sus primeros correos siguen la misma forma («En [rubro], cuando…» y el eslogan de la oferta).
