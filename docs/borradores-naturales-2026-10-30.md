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

### Quinta vuelta: `native-draft/v28`

- **Por qué el servicio cambiaba de una corrida a otra.** Cuando ninguna palabra de la evidencia está en los servicios del perfil, la estrategia (`capabilityForFact`) le pasaba al redactor el primer servicio de la lista como «capacidad indicada», y el prompt pedía «conéctalo con la capacidad indicada». Eso contradecía la regla de `v27` de elegir el servicio que calza. A una startup que crece le llegaba «Dotación de personal temporal» porque «personas» no es «personal».
- **Qué cambió:** cuando la estrategia no encuentra puente (`exploratory`), el servicio llega como sugerencia (`suggestedCapability`) y el redactor elige el que calza.
- **Resultado:** la startup recibe «administramos contratos laborales de nuevas incorporaciones, para que el equipo de personas no tenga que tramitarlos», y minería sin señal, «reemplazamos turnos el mismo día», sin el eslogan.
- **Validez:** 24 de 24 válidos (23 al primer intento) y `Evalia` 8 de 8.
- **Lo que queda:** cuando el dato de la empresa no entra en la apertura, a veces queda como oración suelta en el párrafo de la oferta.

### Sexta vuelta: `native-draft/v29`

- **El dato de la empresa va en la apertura sin señal.** En `v28` quedaba a veces como oración suelta en el párrafo de la oferta («La faena minera de … reúne más de 2.000 trabajadores.»). Ahora la apertura sin señal lo lleva en su primera oración, y el editor lo mueve ahí si quedó suelto. Así queda: «En una faena minera como Minera Cascada, con más de 2.000 trabajadores entre propios y contratistas, un relevo que no llega a tiempo puede atrasar el cambio de guardia».
- **Banco:** 24 de 24 válidos, 23 al primer intento. `Evalia`: 8 de 8 al primer intento. De los 13 en frío, 11 tal cual.
- **Lo que no se estabiliza.** La elección de servicio para la startup cambia de una corrida a otra: en `v28`, administrar contratos; en `v29`, personal temporal, esta vez con un argumento defendible («contratar fijo para cada alza puede dejar costos cuando baja la carga»). Desde `v26`, la lectura se mueve entre 10 y 11 de 13. Lo que falta medir son los borradores reales.

### Séptima vuelta: `native-draft/v30`, con investigaciones reales

Después de desplegar `v29` (`a7e3d5bb`, 30 de octubre a las 14:40 UTC), el redactor corrió en local sobre 6 investigaciones reales de producción, leídas solo en lectura y sin escribir nada en la base, con las banderas de producción.

- **3 se bloquearon** con `evidence_insufficient`: sus investigaciones casi no tenían contenido. Es lo correcto.
- **1 no se creó.** «SQM cuenta con cinco líneas de negocio…» se rechazó dos veces por ser ficha: el control pedía «usa el dato fechado», pero el correo se apoyaba en ese hecho y no en uno con fecha.
- **1 abrió con la autodescripción de la empresa** («se presenta como la principal compañía…»).

La causa común: se consideraba que había «señal» si cualquier frase de la evidencia traía un año, un mes o un verbo de evento. Eso incluía una lista de videos de 2024 del sitio («Sigue leyendo → VIDEOS | 4 julio, 2024…») y un convenio que no era el ancla del correo. Entonces no entraba la apertura sin señal, y la ficha se bloqueaba pidiendo un dato fechado que el redactor no podía usar.

**Qué cambió:**

- **Evento con fecha** (`isDatedEventEvidence`): ahora es algo que pasó o va a pasar («firmaron el acuerdo», «abrirán dos tiendas», «parten una obra»). Un año o un mes sueltos no cuentan, y tampoco un texto cuyas fechas son todas de años anteriores.
- **El hecho del ancla** (`anchoredOnDatedEvent`): la decisión se toma sobre el hecho en que se apoya el correo (`REQUIRED_FACTUAL_PERSONALIZATION`), no sobre cualquier frase. Decide la apertura sin señal en el prompt y si la ficha se bloquea o solo avisa.
- **«De pasada» no es ficha:** «En una cadena de retail como Acme, con 40 tiendas, …» ya no se marca. «Para una … como Acme, sumar personal…» sigue marcado, porque pone la descripción delante de la oferta.
- **El mensaje de corrección de la ficha** explica cómo arreglarla: abrir con lo que se complica en su rubro y nombrar a la empresa de pasada.
- **El filtro de ganchos** saca los listados de entradas del sitio («Sigue leyendo», «Leer más»).
- **Nombres con tilde:** con «Hola María,» o «Hola Andrés,», el control leía el saludo como si fuera la apertura y no la revisaba.

**Resultado:**

- **Las 3 investigaciones reales con evidencia** quedan válidas al primer intento, SQM incluida: «En operaciones industriales como SQM, que cuenta con cinco líneas de negocio, evaluar perfiles para cargos distintos puede extender la selección…».
- **Banco:** 24 de 24 válidos (22 al primer intento), sin relleno ni eslogan. `Evalia`: 8 de 8.
- **Lo que todavía pide retoque en los reales:** aperturas largas cuando el hecho trae muchas cifras (Codelco), y una oración que repite la autodescripción en el párrafo de la oferta (Hualpén). En esos casos, la investigación solo trae lo que la empresa dice de sí misma.

### Octava vuelta: `native-draft/v31`, con 17 investigaciones reales

Después de desplegar `v30` (`38ae43e5`, 30 de octubre a las 16:05 UTC), el redactor corrió en local sobre 17 investigaciones reales de tres organizaciones, leídas solo en lectura y con las banderas de producción. 12 tenían evidencia para un borrador; las otras 5 se bloquearon como corresponde (sin evidencia, sin correo del destinatario o sin perfil del vendedor). Los nombres de las empresas no van en este documento.

**Qué se vio con `v30`:**

- **Copiaba la web de la empresa en 6 de 12.** Sus eslóganes en primera persona («Contribuimos con las organizaciones…», «Brindamos servicios integrales para…»), su publicidad («la principal compañía de…») y, una vez, su frase entre comillas.
- **La causa: el ancla.** En 7 de 8 empresas, el hecho que el correo debía usar (`REQUIRED_FACTUAL_PERSONALIZATION`) era ese eslogan, y el control de anclaje exigía dos de sus palabras. Para un eslogan, eso incluía el verbo en primera persona («Contribuimos»): ningún correo natural lo cumple, y el borrador no se creaba. La misma investigación tenía hechos mejores («un contrato con la minera hasta 2029», «un equipo de más de 350 personas»).
- **Producción (`v23`, últimas dos semanas):** de 8 borradores rechazados por el anclaje, 7 se rechazaron otra vez en el reintento, porque el mensaje no decía qué palabras faltaban.
- **El chequeo de tú/usted bloqueaba correos correctos.** «Acme abrirá sus tiendas… si te sirve» o «a los cajeros les toca doblar turno… si lo necesitas» contaban como usted.
- **Otras fallas:** el párrafo de la oferta repetía el dolor con las mismas palabras («corregir tests a mano» en los dos), y el dolor no coincidía con el servicio (un turno sin conductor, y luego asesoría legal).

**Qué cambió:**

- **Publicidad y comillas:** se bloquea su publicidad dicha de vuelta («la principal compañía», «posición de liderazgo mundial», «la flota más grande»), sus palabras entre comillas y «servicios integrales» o «soluciones de negocio». Sobre 510 correos anteriores no hay falsos positivos.
- **El ancla:** se mantiene la que elige el informe. Entre dos anclas del informe, va primero el hecho que el eslogan, y la basura de la página (formularios, teléfonos, «cotiza») nunca es ancla (`draftEvidenceSalesTone`).
- **Los términos de anclaje:** el prompt los nombra con los sustantivos primero, sin el verbo de la empresa en primera persona ni sus palabras de venta. Si el anclaje falla, el reintento dice qué términos usar.
- **La ficha sin señal** («Acme cuenta con cinco líneas de negocio.») pide un reintento que nombre a la empresa de pasada. En el reintento solo avisa (`retryAttempt`), para que el borrador se cree igual. «En los proyectos de …» y «como los de …» cuentan como de pasada.
- **Tú/usted:** solo marcas inequívocas de usted («usted», «le escribo», «le parece»), las mismas que usa el CTA.
- **Edición:** el párrafo de la oferta no repite el dolor con las mismas palabras, el dolor y el servicio son el mismo problema, y no dice «según su reporte interno».

**Resultado:**

| | Antes | `v31` |
| --- | --- | --- |
| 12 investigaciones reales con evidencia: válidos (antes, sin los cambios del ancla) | 10, 10 al primer intento | 12, 10 al primer intento |
| Banco, 24 correos (antes, `v30`) | 24, 22 al primer intento | 24, 23 al primer intento |
| `Evalia`, 8 correos (antes, `v30`) | 8, 7 al primer intento | 8, 8 al primer intento |

- **Lo que mejoró en los reales:**
  - La empresa de transporte de personal ya no abre con «la principal compañía». Ahora habla de consultas laborales sobre cambios de turno, lo mismo que ofrece la asesoría legal.
  - La constructora abre con su trabajo concreto (mantenimiento vial en faenas) y no con «servicios integrales».
  - La consultora de RR.HH. ya no cita su eslogan entre comillas.
- **Lo que todavía no está bien:** cuando la investigación solo trae la autodescripción o la biografía de los fundadores, el correo es correcto pero plano («En 2012, … cofundaron …»). Eso se arregla en la investigación, no en la redacción.

### Novena vuelta: `native-draft/v32`, con los borradores que no se crearon en producción

`v31` quedó en `main` (PR 602). Después se leyeron, solo en lectura, las investigaciones cuyos borradores se rechazaron también en el reintento en producción en las últimas dos semanas. Son 4 investigaciones; una se intentó 8 veces el 23 de octubre y nunca se creó. Las 4 se sumaron al set real, que quedó en 21 investigaciones (16 con evidencia).

**Qué se vio con `v31`:**

- **La evidencia en inglés:** la página de un banco sobre «the construction of Lines 8 and 9». El control de anclaje comparaba palabras exactas y el prompt pedía «conserva estos términos: support, construction». El modelo escribía «apoyo (support) a la construcción (construction)» o «El Project incluye…», y el control de cifras no reconocía «Líneas 8 y 9» como la frase de la fuente. El borrador no se creaba.
- **El asunto con un nombre propio de la evidencia** («Plan Minero Conjunto», «Nuevo Nivel Mina») se rechazaba por parecer título.
- **«Soy Carolina, de PSOL; <la otra empresa> encuentra y selecciona talento…»:** después de presentarse, el correo contaba lo que hace la otra empresa.
- **5 de 6 reintentos** eran el redactor copiando una frase de la web que el control rechaza («potenciando», «servicios integrales», «soluciones de negocio»).

**Qué cambió:**

- **Evidencia en inglés** (`isEnglishStatement`): el anclaje y las cifras se comparan por lo que conserva una traducción, las primeras letras («construction», «construcción») y las cifras («8», «9»). El prompt pide decirlo en español, y el control bloquea palabras en inglés copiadas («Project», «support»), salvo en los nombres de las empresas. Sobre 576 correos anteriores, el control de inglés marca uno solo, y con razón («tras graduation»).
- **Asunto:** los nombres escritos con mayúscula en la evidencia pueden ir con mayúscula, pero siguen contando como palabras.
- **Presentación:** después de «Soy …, de …» va lo que hace la empresa de quien escribe.
- **Frases vetadas:** el prompt dice qué frases rechazadas trae la fuente, para no copiarlas.
- **Empresas con nombre común:** el control de ficha exige el nombre con mayúscula. «Una cadena de retail con 40 tiendas» ya no se lee como «Tiendas Ejemplo».

**Resultado:**

| | `v31` | `v32` |
| --- | --- | --- |
| 4 investigaciones cuyos borradores no se crearon en producción | 3 de 4 | 4 de 4 |
| 16 investigaciones reales con evidencia: válidos | 15 | 16 |
| … al primer intento | 10 | 15 |
| Banco, 24 correos | 24, 22 a 24 al primer intento | 24, 23 al primer intento |
| `Evalia`, 8 correos | 8, 7 a 8 al primer intento | 8, 8 al primer intento |

En `v32`, el banco no tiene relleno ni carga genérica en los correos iniciales.

### Décima vuelta: `native-draft/v33`, el hecho antes que el eslogan

`v32` quedó en producción (`ca85aec1`, 30 de octubre a las 19:33 UTC). En las mismas 21 investigaciones, el ancla del informe todavía era el eslogan cuando la investigación traía un hecho mejor sin anclar. Por ejemplo, el «Programa de Inclusión Laboral (Ley 21.015)» de una empresa de transporte, para un gerente de relaciones laborales, o una vacante publicada, para un jefe de reclutamiento.

**Qué cambió:**

- **Hecho antes que eslogan:** un hecho de la empresa va antes que su eslogan o su biografía, aunque el informe haya elegido el eslogan. Entre hechos, primero el que eligió el informe. La historia de los fundadores («In 2012, … co-founding …») cuenta como biografía.
- **Frases que solo introducen el hecho:** al recortar la evidencia se saltan las que abren con «De acuerdo a los lineamientos de…» o «Según…». El ancla pide «Programa, Inclusión, Laboral», no «acuerdo, lineamientos».
- **Evidencia en inglés:**
  - El prompt ya no muestra los términos en inglés, porque el modelo los copiaba entre paréntesis («Reino Unido (United Kingdom)»). Ahora pide contar el hecho en español con el nombre y las cifras.
  - El control marca el inglés y las glosas entre paréntesis. Solo exime los nombres de las dos empresas.
  - En el reintento el inglés solo avisa: el modelo trata «United Kingdom» como nombre propio, y un borrador que no se crea es peor.
- **Reintento solo por una frase** (vetada, inglés, comillas, publicidad): repara esa frase y deja el resto del correo. Antes reescribía todo desde cero y metía una frase vetada nueva («Así puedes…»). Cuando hay que empezar de cero, el prompt recuerda las frases vetadas.
- **Asunto:** las cifras no cuentan como palabras. «Capacitación para las Líneas 8 y 9» se rechazaba por tener siete.

**Resultado:**

- **Banco:** 24 de 24 válidos al primer intento.
- **Investigaciones reales:** 17 de 18 válidos en la corrida completa. El que faltaba (el asunto con cifras) sale al primer intento después del último cambio.
- **Lo que se lee distinto:**
  - La empresa de transporte recibe un correo sobre su programa de inclusión y la asesoría en inclusión.
  - La consultora de RR.HH. recibe uno sobre su vacante de ejecutivo de venta técnica y la evaluación por cargo.
  - La exportadora de alimentos, uno sobre sus filiales en el Reino Unido.

### Undécima vuelta: `native-draft/v34`, los seguimientos con investigaciones reales

Hasta `v33` solo se habían probado correos iniciales con investigaciones reales. En producción también fallaban seguimientos y cierres de campaña: un cierre se rechazó 4 veces por el anclaje y dos seguimientos se rechazaron en el reintento. `v34` corre secuencias completas (inicial y 3 pasos) sobre 8 investigaciones reales, entre ellas las que fallaron en producción.

**Qué se vio con `v33`:** de 32 correos, 28 válidos y 23 al primer intento.

- **Frase sin verbo falsa:** «En Acme cuentan con un Programa de Inclusión Laboral.» se marcaba como incompleta, porque el detector no reconocía la tercera persona del plural («cuentan», «operan»).
- **El hecho de ellos como propio:** en el reintento, el modelo escribió «Soy …, de …; contamos con un Programa de Inclusión Laboral». Copió la primera persona de la web de la empresa.
- **Cifras de un seguimiento:** «Para apoyar la construcción de las Líneas 8 y 9, en <vendedor> hacemos cursos…» se rechazaba. Al nombrar al vendedor, toda la oración contaba como suya, cifras incluidas.
- **«Lines» quedaba como «lin»:** el recorte de plurales en español lo eliminaba. Un seguimiento que decía «las nuevas líneas» se quedaba sin su segundo término de anclaje.
- **Reintento por cifras:** volvía con «Así, el equipo puede…», porque ese reintento no tenía el recordatorio de frases vetadas.

**Qué cambió:**

- **Detector de frases sin verbo:** reconoce la tercera persona del plural («cuentan», «venden»), pero no los sustantivos en -men y -gen («volumen», «imagen»).
- **Hecho en primera persona:** si la evidencia está en primera persona, el prompt pide contarla en tercera («Acme tiene un programa…»), nunca como propia.
- **Cifras por cláusula:** una cifra que va antes del nombre del vendedor, en la parte que habla del destinatario, se compara con la evidencia. Una que va después sigue siendo del vendedor.
- **Términos en inglés:** solo pierden la «s» del plural («lines» queda como «line», no como «lin»).
- **Seguimientos con fuente en inglés:** nombran el hecho en pocas palabras y sin cifras («las nuevas líneas del metro»).
- **Reintento por cifras:** también recuerda las frases vetadas.

**Resultado:**

| | `v33` | `v34` |
| --- | --- | --- |
| Secuencias reales, 32 correos: válidos | 28 | 32 |
| … al primer intento | 23 | 27 |
| Correos iniciales reales (16 con evidencia) | 16 | 16, 15 al primer intento |
| Banco, 24 correos | 24, 24 al primer intento | 24, 23 al primer intento |

**Lo que todavía se lee raro:** cuando el hecho ancla es la historia de la empresa, cada seguimiento la vuelve a nombrar («con Perú y Chile en su historia»). Los seguimientos están obligados a nombrar el ancla. Con un ancla débil, la referencia sobra.

### Duodécima vuelta: `native-draft/v35`, el ancla de los seguimientos

`v34` quedó en producción (`a41cbe88`, 31 de octubre a las 00:56 UTC). En sus secuencias reales, cuando el hecho ancla era la historia de la empresa, cada seguimiento lo volvía a contar como dato suelto: «Para una búsqueda en Tawa, con Perú y Chile en su historia…».

**Qué cambió:** la instrucción del ancla en los seguimientos pide usarla como el lugar o el momento de lo que harías («para sus búsquedas en Perú y Chile»), no como un dato suelto ni como su historia.

**Resultado:**

- **4 secuencias reales con anclas débiles:** 16 de 16 correos válidos, 12 al primer intento.
- **Tawa:** ya escribe «Para sus búsquedas en Perú y Chile, PSOL verifica en tiempo real la identidad…».
- **Lo que falta:** la de DFV, cuyo ancla es «Nuestros inicios datan del año 2010…», todavía arrastra «rubro ligado a sus inicios en 2010».

### Decimotercera vuelta: `native-draft/v36`, el año no es un hecho

En `v35`, una empresa cuyo ancla era «Nuestros inicios datan del año 2010, cuando surgimos como un actor importante…» hacía que cada seguimiento repitiera «rubro ligado a sus inicios en 2010».

**Qué cambió:**

- **Un año solo no vuelve hecho una frase de autopromoción:** una cifra sigue volviendo hecho una frase en primera persona («Contamos con más de 350 personas»), pero un año solo, no. Esa empresa ahora ancla en «en el 2017 abrimos la oficina regional en Concepción». Sus seguimientos hablan de «búsquedas vinculadas a la oficina regional de Concepción».
- **El control de cifras compara el año sin la palabra que lo sigue:** antes, «en el 2017 abrimos…» no respaldaba «En 2017, Acme abrió…», porque comparaba «2017 abrimos» con «2017».

**Resultado:**

- **Esa empresa:** 8 de 8 correos válidos en dos secuencias. Los iniciales salen al primer intento (antes 0 de 2).
- **21 investigaciones reales, correo inicial:** 16 de 16 válidos.
- **Banco:** 24 de 24 al primer intento.

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
