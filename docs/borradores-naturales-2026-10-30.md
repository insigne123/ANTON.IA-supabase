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
| **Ganchos que no son hechos** (con `DRAFT_HOOK_FILTER_ENABLED`, encendida en producción): encabezados y títulos de documentos, agregadores de empleo, cifras que perdieron sus primeros dígitos, texto en mayúsculas sostenidas, misión, visión, cultura, políticas de privacidad o de seguridad de la información, definiciones de la ley y títulos de artículos («La importancia de…»). En las investigaciones de las últimas tres semanas saca de 0 a 3 evidencias por investigación y siempre quedan 6 o más de la empresa: no deja a nadie sin borrador. | `isUnsuitableHookText` en `src/lib/research-fact-eligibility.ts` |
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

- **Con el segundo vendedor** (`Evalia`, 8 casos): se presentan 8 de 8 (antes 0) y ninguno copia nombres del vendedor del banco. Quedan válidos 7 de 8: en uno la apertura asignada era una pregunta y, con el CTA que agrega el servidor, el correo quedó con dos; el reintento no lo corrigió. Esa tensión entre la apertura «pregunta» y el CTA ya existía.
- **Secuencias** (2 de 4 pasos): 8 de 8 válidos, con seguimientos de una o dos oraciones más la pregunta, sin la oración que repetía la anterior.
- **Cómo suena**, en un caso del banco (ficticio). Antes: «Vi que abren cinco sucursales nuevas en regiones durante el primer semestre. / En ServiPro ponemos dotación temporal por el tiempo que usted la necesita, y el costo se va con el peak.» Ahora: «Vi que en Banco Regional abren cinco sucursales nuevas en regiones durante el primer semestre. En las aperturas bancarias, si falta personal, la carga de atención termina recayendo en los equipos de las sucursales que ya operan. / Soy Carla, de ServiPro; ponemos personal temporal en las sucursales nuevas por el período que requiera cada apertura.»
- **El costo sube un 20 %** (correos algo más largos: 70 palabras contra 55, dentro del tope de 110).

### Qué enseñó cada ronda

1. **Quitar «el beneficio con las palabras de valueProposition»** bajó el eslogan de 16 a 2, pero la frase del rubro salió obvia («abrir tiendas exige coordinar la dotación») y la presentación copiaba la descripción entera de la empresa.
2. **Presentarse con el nombre de pila y pedir qué se complica en concreto** dejó el relleno en 1 y el eslogan en 0, pero 9 de 18 correos usaban la misma fórmula («puede dejar … esperando»). Los ejemplos del prompt con el vendedor del banco inflaban el resultado: se cambiaron por marcadores y se agregó el segundo vendedor.
3. **Prohibir «puede»** quitó la fórmula, pero devolvió obviedades («el equipo tiene que estar listo para atender desde el primer día»).
4. **Pedir el costo de que salga mal** (qué se pierde, quién se sobrecarga, qué se atrasa) dio consecuencias concretas del rubro. Es la que quedó.

## Lo que falta

- **La investigación.** El filtro saca lo que no es un hecho, pero el redactor necesita hechos con fecha y dato concreto (una apertura, una vacante, una licitación adjudicada). Siguen entrando fragmentos de buscador con «…», perfiles de LinkedIn de otras personas y la descripción de la empresa escrita por ella misma. Es lo que más mueve la calidad (`docs/senales-de-la-investigacion-al-correo.md`).
- **Las objeciones.** El correo ya reconoce lo que dijo la persona, pero el servidor le agrega el CTA de reunión del estilo; a quien dijo «no hay presupuesto» le sobra.
- **La Redactora de Cowork** (Contacto del día, Cowork) escribe mejor que la vía de borradores, pero todos sus primeros correos siguen la misma forma («En [rubro], cuando…» y el eslogan de la oferta).
