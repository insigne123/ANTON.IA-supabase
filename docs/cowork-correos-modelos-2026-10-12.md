# Cowork · Calidad de los correos y qué modelos convienen (12 oct 2026)

Medición de los correos que escribe la Redactora de Cowork, con la nota de una lectura ciega y el costo y la latencia de cada
combinación de modelos. Las cifras salen de corridas reales con el modelo (`evaluate-cowork-conversations.ts --live`), sobre el
banco de siempre: 7 pedidos que terminan en un correo o una secuencia, 3 repeticiones cada uno (21 respuestas por configuración).

## Resumen

- **La nota pasó de 2,54 a 4,21 con el mismo modelo y el mismo costo:** `gpt-6-luna` con esfuerzo `low`, a US$0,0022 por
  respuesta con correo (unos US$2,2 por cada 1.000). La escala es «¿lo enviarías tal cual?», de 1 a 5. La subieron las reglas
  de la Redactora y del coordinador, no el modelo. Ver «Cómo cambió la nota» y las rondas 9 a 11.
- **Con Claude como Redactora la nota sube más, y a buen precio** (ronda 11, reglas v11, misma lectura ciega):

  | Redactora → corrección | Nota | US$ por 1.000 respuestas |
  |---|---|---|
  | Luna → Luna | 4,21 | 2,2 |
  | Haiku 5.5 low → Haiku 5.5 | 4,46 | 4,3 |
  | Sonnet 5.5 low → Luna | 4,61 | 17,3 |

  - **Mejor relación calidad/precio: Haiku 5.5 low.** +0,25 sobre Luna por US$2 más cada 1.000 respuestas. OpenAI sigue
    coordinando y revisando.
  - **Mejor nota: Sonnet 5.5 escribiendo y Luna corrigiendo:** 4,61, con la mitad de sus respuestas en 5, a 8 veces el costo de
    Luna. Sirve para un plan superior.
- **La v11 sube la nota de todos los modelos.** Medidos contra sus propias respuestas con v10 en la misma lectura: Luna +0,17,
  Haiku +0,14 y Sonnet +0,15 (contra la ronda 10). Corrige lo que la ronda 10 encontró en las 84 respuestas de Claude y Luna:
  - la invitación de sí o no;
  - la misma pregunta para cada persona;
  - el mismo momento en dos correos de una secuencia;
  - la cautela innecesaria sobre la bandeja;
  - la oferta pegada a la apertura.
- **Más razonamiento o un modelo más caro no se justifican:**
  - Haiku 5.5 `medium` saca 4,39, menos que `low`, con un p90 de 28 s, al borde del corte de 30 s de producción.
  - Haiku `max` no alcanzó a escribir ninguna respuesta (unos 100 s por llamada).
  - Luna `xhigh` bajó a 3,62 y se cortó por tiempo.
  - Opus 5.5 → Luna (4,39 con v10) no le gana a Sonnet y cuesta el doble.
  - Sol 6.1 solo saca lo mismo que Luna con v10, a 6 veces el costo.
- **Por qué todavía no llega a 5:**
  - Las campañas y los correos por persona ya sacan 4,5 a 5 con cualquier modelo de Claude.
  - Lo que falta es sobre todo la apertura: «retrasa el ingreso de cada una» es correcta pero plana. Un 5 pinta la escena («el
    camión queda detenido», «la lista llega el jueves y la gente parte el lunes»), y eso depende más del modelo que de las reglas.
  - El banco no trae investigación ni señales de las empresas. Con `research.start`, el primer correo puede abrir con un hecho
    observado de su empresa.

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
| v4: prueba pulida, correo pegado intacto | 3,62 ± 0,07 | 3,90 ± 0,07 | 3,86 ± 0,05 |
| v6: sin anunciar la pregunta ni fórmulas | 3,74 ± 0,07 | — | 3,93 ± 0,05 |
| v7: un primer correo por persona | 3,76 ± 0,07 | — | 3,98 ± 0,12 |
| v8: la consecuencia en su negocio | 4,00 ± 0,10 | 4,21 ± 0,09 | 4,02 ± 0,10 |
| v10: revisa a quién ya se le escribió | **4,17** | **4,17 ± 0,08** | **4,25 ± 0,08** (14) |

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

## Ronda 6 (reglas v8)

v8 pide que la consecuencia de la primera frase sea la del negocio de cada persona («el guardia que no puede tomar su turno», «el
conductor que no sale a ruta», «el candidato que no llega al cliente»). También marca los beneficios dichos en abstracto («tener los
resultados a mano ayuda a…»), las fórmulas como «¿es relevante?» o «si calza», «es una alternativa» y las respuestas que se excusan
(«el correo queda genérico porque…»). El ancla (v7 Sol 6.1 → Luna) sacó lo mismo que en la ronda 5: 3,98.

| Redactora → corrección | Nota | Campañas (2 casos) | US$/respuesta | Redactora p50 / p90 |
|---|---|---|---|---|
| **Luna → Luna** | **4,00 ± 0,10** | **4,42** | **0,0022** | **5,6 / 8,6 s** |
| Sol 6.1 low → Luna | 4,02 ± 0,10 | 4,50 | 0,0103 | 6,9 / 12,6 s |
| Ancla: v7 Sol 6.1 → Luna | 3,98 ± 0,12 | 4,50 | 0,0102 | 7,5 / 13,7 s |

- Luna sube de 3,76 a 4,00: con la consecuencia del negocio pedida en las reglas, sus correos por persona dejan de ser la misma
  frase con otro rubro.
- Los 5 son campañas con un correo por persona que dejan fuera a quien ya recibió uno (Marcela) y dicen su motivo.
- En 3 de 63 respuestas, al mejorar un correo pegado se perdió la reunión que pedía («Agendemos»). Desde v8 eso se marca y se
  corrige, y una fórmula como «ver si calza» se corrige con una pregunta por el día cuando el usuario pidió la reunión.

## Ronda 7 (reglas v8): Luna en su máximo y Sol 6.1 solo

Mismo banco y lector; el ancla es v8 Luna low, que bajó de 4,00 a 3,90 (el lector fue algo más exigente, dentro del ruido).

| Redactora → corrección | Nota | US$/respuesta | Redactora p50 / p90 | > 30 s | Redactora falló |
|---|---|---|---|---|---|
| Luna xhigh (su máximo) | 3,62 ± 0,17 | 0,0037 | 23,6 / 42,5 s | 11 de 29 | 5 |
| **Sol 6.1 → Sol 6.1** | **4,21 ± 0,09** | **0,0179** | **7,7 / 12,3 s** | **0 de 39** | **0** |
| Ancla: Luna → Luna | 3,90 ± 0,09 | 0,0022 | 5,6 / 8,6 s | 0 de 39 | 0 |

- **Luna `xhigh` empeora la nota.** En 5 de 21 respuestas la Redactora no entregó: el razonamiento se comió el tope de tokens o
  pasó el tiempo, y el coordinador escribió con el estilo antiguo («puede sumar», «¿Te serviría conocer cómo podría calzar…?»).
  Esas secuencias sacan 2,5. Además, 11 de 29 llamadas pasan los 30 s de producción.
- **Sol 6.1 solo es la mejor nota medida con OpenAI: 4,21, 0,3 sobre Luna.** Gana en los correos por persona (4,83 en
  «escribir a mis contactos») y en las campañas (4,5). Cuesta 8 veces Luna: US$17,9 por cada 1.000 respuestas contra US$2,2.

## Ronda 8: Claude como Redactora y Revisora (reglas v8)

La corrida se hizo en otra sesión con la clave de Anthropic del usuario. La lectura ciega usa como control a Luna low de esa misma
corrida. Son 14 respuestas por configuración (7 casos × 2) y el coordinador es Luna en todas. Precios en US$ por millón de tokens
(entrada / salida / en caché):
- Haiku 5.5: 0,10 / 0,50 / 0,01;
- Sonnet 5.5: 2 / 10 / 0,20;
- Opus 5.5: 4 / 20 / 0,20.

| Redactora → corrección | Nota | US$/respuesta | Por cada 1.000 | Redactora p50 / p90 | > 30 s |
|---|---|---|---|---|---|
| Luna → Luna (control) | 3,96 ± 0,16 | 0,0023 | US$2,3 | 6,5 / 8,9 s | 0 de 26 |
| Luna, con Haiku 5.5 de Revisora | 4,00 ± 0,11 | 0,0023 | US$2,3 | 5,1 / 7,7 s | 0 de 24 |
| Haiku 5.5 low → Haiku 5.5 | 4,04 ± 0,11 | 0,0043 | US$4,3 | 10,0 / 16,8 s | 0 de 27 |
| Sonnet 5.5 low → Luna | 4,07 ± 0,11 | 0,0174 | US$17,4 | 5,5 / 7,8 s | 0 de 27 |
| **Opus 5.5 low → Luna** | **4,25 ± 0,12** | **0,0371** | **US$37,1** | **6,0 / 12,1 s** | **0 de 26** |
| Sol 6.1 → Luna (referencia) | 3,96 ± 0,13 | 0,0105 | US$10,5 | 6,7 / 13,2 s | 0 de 25 |
| Haiku 5.5 `max` | — | — | — | ~100 s | no escribió |

- El control salió igual que en las rondas anteriores (3,90 a 3,96): el lector mantuvo su vara.
- Opus y Sonnet escriben aperturas más vívidas («el camión queda en el patio», «la nómina llega el jueves, el ingreso es el
  lunes»). En las secuencias Opus saca 4,5 contra 3,25 de Luna. También inventan detalles («una demo de 20 minutos») y caen en lo
  que v9 y v10 ya corrigen, como describir la oferta en el segundo correo.
- Con Haiku `max`, todas las llamadas de la Redactora pasaron el tope de la evaluación y escribió el coordinador. Con los 30 s de
  producción no es usable.
- El costo de Claude en esta ronda no incluye el recargo de la escritura en caché (1,25 veces la entrada, en la primera llamada de
  cada 5 minutos), así que lo subestima en pocos puntos. Desde v10 el registro de consumo lo cobra.

## Ronda 9 (reglas v10)

**v9:**
- el seguimiento abre con un momento de su negocio;
- en una secuencia, el segundo correo no vuelve a describir la oferta y las preguntas antes del último no la nombran;
- se marcan más fórmulas y beneficios vagos («¿es un tema relevante?», «reunir… ayuda a»).

**v10:**
- cuando el usuario pide escribirles a sus contactos, el coordinador lee `leads.search` y `contacted.search` (con la consulta
  vacía) en un solo `reads.parallel`, y deja fuera, con su motivo, a quien ya recibió un primer correo;
- la Redactora corrige la oferta nombrada solo con su prueba («AXIS procesa 1.000 personas…», sin decir qué hace);
- también corrige un costo dicho en abstracto en la apertura («suma trabajo manual», «ocupa tiempo») y «¿Están evaluando…?».

| Redactora → corrección | Nota | Campañas | US$/respuesta | Redactora p50 / p90 | Revisora pendiente |
|---|---|---|---|---|---|
| **Luna → Luna** | **4,17** | **4,83** | **0,0022** | **6,0 / 8,4 s** | **3 de 21** |
| Sol 6.1 → Luna (14) | 4,25 ± 0,08 | 4,25 | 0,0100 | 8,6 / 17,6 s | 9 de 21 |
| Sol 6.1 → Sol 6.1 | 4,17 ± 0,08 | 4,33 | 0,0139 | 11,6 / 16,6 s | 1 de 21 |
| Luna → Sol 6.1 (14) | 4,04 ± 0,15 | 4,25 | 0,0096 | 7,4 / 14,4 s | 4 de 21 |
| Ancla: v8 Luna → Luna | 3,90 ± 0,09 | 4,00 | 0,0022 | 5,6 / 8,6 s | 5 de 21 |

- **El ancla sacó lo mismo que en la ronda 7 (3,90).**
- **Con Luna suben todos los casos salvo «mejorar correo», que queda igual:**
  - campañas, de 4,00 a 4,83;
  - seguimiento, de 3,67 a 4,17;
  - «escribir a mis contactos», de 4,50 a 4,67.
- **Hubo una regresión, ya corregida y medida aparte:**
  - La primera versión de la regla del coordinador se aplicó también a «armame una secuencia… para gerentes de personas».
  - En 2 de 3 respuestas, Luna dirigió esa secuencia a sus contactos. A veces además dijo que nadie había recibido nada, porque
    buscaba los envíos con la palabra «rrhh».
  - La versión final pide la consulta vacía y deja genérica una secuencia para un cargo. Con ella pasan las 27 respuestas de los
    tres casos tocados (Luna, Luna → Sol 6.1 y Sol 6.1 → Sol 6.1).
  - Con la versión final, la secuencia de Luna vuelve a 3,5, cerca del ancla de 3,67 (3 respuestas cada una).
  - El 4,17 de Luna usa esa secuencia; la ronda completa midió 4,12 ± 0,12, con la secuencia en 3,17.
- **«Revisora pendiente»** cuenta las respuestas en que la Revisora no alcanzó a terminar: el correo se entrega marcado para
  revisar. Con Sol 6.1 → Luna pasa en 9 de 21.

## Ronda 10: Claude con las reglas v10

Las mismas reglas v10 de la ronda 9, ahora con Claude. Corrió en una sesión aparte con la clave de Anthropic del usuario: 7 casos,
2 repeticiones, 14 respuestas por configuración. Las 84 respuestas pasan los checks del banco. En todas, Luna coordina y revisa.
La lectura ciega puso a Luna como control dentro de la misma lectura.

| Redactora → corrección | Nota | ≥ 4,5 | US$/respuesta | Por cada 1.000 | Redactora p50 / p90 |
|---|---|---|---|---|---|
| Luna → Luna (control) | 4,04 ± 0,11 | 36 % | 0,0024 | US$2,4 | 6,6 / 8,1 s |
| Luna → Haiku 5.5 low | 4,18 ± 0,10 | 50 % | 0,0026 | US$2,6 | 6,7 / 7,8 s |
| **Haiku 5.5 low → Haiku 5.5** | **4,32 ± 0,13** | **57 %** | **0,0041** | **US$4,1** | **10,7 / 18,9 s** |
| Luna → Sonnet 5.5 low | 4,39 ± 0,09 | 64 % | 0,0150 | US$15,0 | 7,2 / 8,2 s |
| Opus 5.5 low → Luna | 4,39 ± 0,12 | 64 % | 0,0343 | US$34,3 | 8,6 / 12,0 s |
| **Sonnet 5.5 low → Luna** | **4,46 ± 0,15** | **64 %** | **0,0173** | **US$17,3** | **5,3 / 7,2 s** |

- **El control sacó lo mismo que Luna en la ronda 9** (4,04 contra 4,12, dentro del ruido): el lector no cambió de vara.
- **Con las reglas v10, Claude sí mejora la nota:**
  - Haiku 5.5 escribiendo y corrigiendo sube +0,28 sobre Luna por US$1,7 más cada 1.000 respuestas. Es la mejor relación
    calidad/precio medida.
  - Sonnet 5.5 → Luna sube +0,42 a 7 veces el costo de Luna. Opus 5.5 no le gana a Sonnet y cuesta el doble.
- **Dónde gana Haiku:** secuencias (de 3,50 a 4,50), «escribir a mis contactos» (de 4,50 a 5,00) y mejorar un correo (de 3,75 a 4,25).
  Pierde un poco en seguimientos (4,00 contra 4,25).
- **Latencia:** Haiku piensa más que Sonnet aun en `low` (unos 2.600 tokens de salida por correo contra 750), así que tarda más:
  10,7 s de mediana y 18,9 s en el p90, contra 6,6 y 8,1 s de Luna. Ninguna llamada pasó los 30 s.
- **Lo que quedó bajo 4,5 en todas** son problemas de reglas, no del modelo:
  - la cautela «no veo si respondió porque tu correo no está conectado» cuando el usuario ya dijo que no le respondieron;
  - la apertura y la oferta en el mismo párrafo;
  - la misma pregunta en los correos a cada persona;
  - la invitación de sí o no al mejorar un correo que pedía una demo;
  - «Con AXIS cargas la nómina y procesa…», que cambia de sujeto a la mitad;
  - excusas en jerga en la respuesta («No tengo su correo observado», «el encargo no trae destinatarios»).

  La v11 corrige cada uno (ver «Qué cambió en el código»).

## Ronda 11: la v11 con Luna y con Claude

La v11 corrige lo que la ronda 10 encontró (ver «Qué cambió en el código»). Luna corrió aquí (21 respuestas) y Claude en una
sesión aparte con la clave de Anthropic del usuario (14 respuestas cada uno). Todas pasan los checks del banco. La lectura ciega
mezcló las 91 respuestas con las de Luna y Haiku de la ronda 10 como anclas. Las dos anclas sacaron exactamente lo mismo que en
la ronda 10 (4,04 y 4,32): el lector no cambió de vara.

| Redactora → corrección | Nota | ≥ 4,5 | Notas de 5 | US$/respuesta | Por cada 1.000 | Redactora p50 / p90 | Llamada más larga |
|---|---|---|---|---|---|---|---|
| Ancla v10: Luna → Luna | 4,04 ± 0,11 | 36 % | 0 de 14 | 0,0024 | US$2,4 | 6,6 / 8,1 s | 8,4 s |
| Ancla v10: Haiku low → Haiku | 4,32 ± 0,13 | 57 % | 3 de 14 | 0,0041 | US$4,1 | 10,7 / 18,9 s | 21,5 s |
| v11: Luna → Luna | 4,21 ± 0,07 | 52 % | 0 de 21 | 0,0022 | US$2,2 | 6,7 / 8,6 s | 9,1 s |
| v11: Haiku medium → Haiku | 4,39 ± 0,16 | 71 % | 4 de 14 | 0,0051 | US$5,1 | 14,7 / 28,0 s | 29,9 s |
| **v11: Haiku low → Haiku** | **4,46 ± 0,08** | **79 %** | **2 de 14** | **0,0043** | **US$4,3** | **12,2 / 15,1 s** | **15,9 s** |
| **v11: Sonnet low → Luna** | **4,61 ± 0,12** | **71 %** | **7 de 14** | **0,0173** | **US$17,3** | **4,2 / 6,9 s** | **8,3 s** |

Por caso:

| Caso | Luna v10 | Luna v11 | Haiku v10 | Haiku v11 | Sonnet v11 |
|---|---|---|---|---|---|
| Correo para Felipe en Word | 4,00 | 4,00 | 4,00 | 4,50 | 4,25 |
| Correo a mis contactos (3 personas) | 4,50 | 4,50 | 5,00 | 4,75 | 5,00 |
| Mejorar un correo que pide una demo | 3,75 | 4,33 | 3,75 | 4,00 | 4,25 |
| Campaña a mis contactos de RR. HH. | 4,50 | 4,50 | 4,75 | 4,50 | 5,00 |
| Mejorar «somos Yago… Agendemos» | 3,75 | 4,50 | 4,25 | 4,75 | 4,75 |
| Secuencia de 3 correos | 3,50 | 3,83 | 4,50 | 4,25 | 4,50 |
| Seguimiento a Marcela | 4,25 | 3,83 | 4,00 | 4,50 | 4,50 |

- **Lo que más subió:** mejorar un correo, con Luna de 3,75 a 4,33 y 4,50. La invitación ahora va por el día y la oferta en su
  párrafo. Ninguna respuesta de la v11 pide la demo con un sí o un no.
- **Las secuencias de Luna** dejan de repetir el momento entre correos (3,50 a 3,83). El tercer correo todavía queda a veces en
  solo la oferta.
- **El seguimiento de Luna bajó (4,25 a 3,83, 3 respuestas por versión).** La cautela sobre la bandeja desapareció, pero dos
  correos volvieron a un beneficio vago o a la oferta del primero. La corrección de Luna no siempre arregla lo que marcan los
  chequeos: en 6 de 21 respuestas queda algo «por revisar». Con Haiku corrigiendo pasa en 2 de 14.
- **Lo que queda bajo 5 en todos los modelos:**
  - aperturas correctas pero planas («retrasa el ingreso de cada una», «alarga la contratación»);
  - la oferta con dos capacidades y la prueba en la misma frase;
  - el tercer correo de una secuencia que es solo la oferta.

## Recomendación

Para muchos usuarios conviene combinar los dos proveedores: OpenAI coordina y revisa, y Claude escribe.

1. **Por defecto: Haiku 5.5 low como Redactora y como corrección; Luna como coordinador y Revisora.**
   - Nota: 4,46, contra 4,21 de Luna sola.
   - Costo: unos US$4,3 por cada 1.000 respuestas con correo, contra US$2,2 de Luna.
   - Latencia: la Redactora tarda 12 s de mediana y 15 s en el p90, contra 7 y 9 s de Luna. Ninguna llamada pasó los 30 s.
   - Variables: `COWORK_WRITER_MODEL=claude-haiku-5-5`, `COWORK_WRITER_EFFORT=low`, `COWORK_WRITER_FIX_MODEL=claude-haiku-5-5`,
     `COWORK_WRITER_FIX_EFFORT=low` y `COWORK_DESIGNER_MODEL=gpt-6-luna`.
2. **Plan superior o campañas grandes: Sonnet 5.5 low escribiendo y Luna corrigiendo.**
   - Nota: 4,61, con la mitad de las respuestas en 5.
   - Costo: unos US$17 por cada 1.000 respuestas.
   - Es el más rápido: 4 s de mediana.
   - Variables: `COWORK_WRITER_MODEL=claude-sonnet-5-5`, `COWORK_WRITER_EFFORT=low`, `COWORK_WRITER_FIX_MODEL=gpt-6-luna` y
     `COWORK_DESIGNER_MODEL=gpt-6-luna`.
3. **Sin clave de Anthropic, o como respaldo: Luna low para todo.** Nota 4,21 por US$2,2 por cada 1.000.
4. **No conviene:**
   - subir el razonamiento: Haiku `medium` y `max`, Luna `high` y `xhigh`;
   - Opus 5.5 ni Sol 6.1 como Redactora: no le ganan a Sonnet y a Haiku, y cuestan más.
5. **Antes de activar Claude en producción:**
   - `ANTHROPIC_API_KEY` en Secret Manager;
   - el precio de cada modelo en `COWORK_MODEL_PRICING_JSON`, para que el registro de consumo lo cobre;
   - `COWORK_DESIGNER_MODEL` fijo en Luna, porque si no tiene valor propio toma el de `COWORK_WRITER_MODEL`.

   Si Anthropic falla, la Redactora no alcanza a escribir y el coordinador entrega su propio correo, como ya pasa con OpenAI.

## Claude: cómo medirlo

**Estado:** el código lo soporta (`src/ai/anthropic-json.ts`):
- cualquier modelo `claude-…` responde por Anthropic con el SDK oficial y salidas estructuradas;
- el esfuerzo va en `output_config.effort` (`low` a `max`), con espacio para el razonamiento sobre el tope de cada rol;
- las reglas fijas del rol van en caché (`cache_control` en el system prompt);
- el consumo se registra como el de OpenAI; desde v10, la escritura en caché (`cache_creation_input_tokens`) se cobra a 1,25 veces
  la entrada, como la factura Anthropic.

**La clave en estos entornos:** `ANTHROPIC_API_KEY` es un nombre reservado de Claude Code y no llega a la sesión. Para medir,
guarda la clave como secreto del entorno con otro nombre (por ejemplo `COWORK_ANTHROPIC_API_KEY`) y pásala solo al proceso de
evaluación. En producción va en Secret Manager como `ANTHROPIC_API_KEY`, igual que la de OpenAI. Nunca en el repo ni en
`.env.local`.

```sh
FLAGS="COWORK_OFFERED_READS_ENABLED=true COWORK_TASKS_ENABLED=true COWORK_WORKSPACE_ENABLED=true COWORK_PREFERENCES_ENABLED=true \
  COWORK_EXTERNAL_SEARCH_ENABLED=true COWORK_CONTACTS_IMPORT_ENABLED=true COWORK_MODEL=gpt-6-luna COWORK_RESCUE_MODEL=gpt-6-luna \
  COWORK_DESIGNER_MODEL=gpt-6-luna"
CASES=mkt-campana-rrhh,mkt-secuencia,mkt-mejorar-correo,mkt-seguimiento,inicio-escribir,inicio-mejorar,descargar-correo
run() { env ANTHROPIC_API_KEY="$COWORK_ANTHROPIC_API_KEY" $FLAGS "$@" node --loader ./scripts/ts-test-loader.mjs \
  scripts/evaluate-cowork-conversations.ts --live --stream --writer --artifacts --preferences --max-calls=260 --repeat=3 \
  --cases=$CASES --output=$OUT; }
OUT=/tmp/luna.json run
OUT=/tmp/haiku-low.json run COWORK_WRITER_MODEL=claude-haiku-5-5 COWORK_WRITER_EFFORT=low
OUT=/tmp/sonnet-luna.json run COWORK_WRITER_MODEL=claude-sonnet-5-5 COWORK_WRITER_EFFORT=low COWORK_WRITER_FIX_MODEL=gpt-6-luna
OUT=/tmp/opus-luna.json run COWORK_WRITER_MODEL=claude-opus-5-5 COWORK_WRITER_EFFORT=low COWORK_WRITER_FIX_MODEL=gpt-6-luna
# Costo, tokens y latencia por rol (p50 y p90), y la lectura ciega contra Luna:
node --loader ./scripts/ts-test-loader.mjs scripts/cowork-model-costs.ts /tmp/*.json
node --loader ./scripts/ts-test-loader.mjs scripts/cowork-blind-read.ts mix /tmp/ciego.md /tmp/clave.json \
  A=/tmp/luna.json B=/tmp/haiku-low.json C=/tmp/sonnet-luna.json D=/tmp/opus-luna.json
```
`COWORK_MODEL_PRICING_JSON` necesita el precio de cada modelo que se use; sin él, el costo queda desconocido.

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

**Reglas y chequeos de v6 a v10:**
- la pregunta no se anuncia («Para situar AXIS…, quiero entender…»);
- el correo no habla de sí mismo ni de la secuencia («Con este correo cierro…»);
- la primera frase no repite una palabra («revisar… alarga la revisión»);
- la respuesta no usa jerga («cobertura del buzón») ni cuenta lo que corrigió la Revisora;
- un primer correo propio por persona para 2 o 3 personas, y la campaña los copia tal cual (`coworkPersonalEmails`,
  `coworkCampaignWithPersonalEmails`);
- un correo que escribe el coordinador vuelve una vez a la Redactora;
- v8: la consecuencia en el negocio de la persona; sin beneficios en abstracto, «es una alternativa», «¿es relevante?» ni «si calza»;
  la respuesta no se excusa; un correo pegado conserva la reunión que pide; la Revisora no pide `{{nombre}}` en correos por persona.
- v9: el seguimiento abre con un momento de su negocio; en una secuencia, el correo 2 no vuelve a describir la oferta y las
  preguntas antes del último no la nombran;
- v10: la oferta no se nombra solo con su prueba («qué hace la oferta»); la apertura no dice un costo en abstracto sin lo que se
  atrasa («consecuencia concreta»); «¿Están evaluando…?» es una fórmula.
- v11 (de la lectura de Claude con reglas v10, ronda 10):
  - el atraso dicho del «proceso» sin quién espera también es una consecuencia en abstracto («retrasa el proceso de ingreso»,
    «requiere trabajo manual», «suma otra tarea»);
  - la pregunta no repite una frase de tres palabras de la apertura («…antecedentes laborales en el PJUD… ¿Cuánto les toma
    consultar antecedentes laborales en el PJUD?»); con dos palabras en común no se marca, porque así nombra la tarea;
  - el primer correo de una secuencia presenta la oferta;
  - cada correo de una secuencia abre con su propio momento («momento distinto»): Luna repetía «cuando la nómina llega encima de
    la fecha de ingreso» en el segundo y el tercero;
  - los correos a cada persona cierran con su propia pregunta («pregunta propia»), comparadas sin los nombres de sus empresas;
  - al mejorar un correo que pedía una demo, la invitación va por el día y no con un sí o un no («pregunta por el día»);
  - la frase de la oferta tiene un solo sujeto («un solo sujeto»: no «Con AXIS cargas la nómina y procesa…»);
  - la respuesta no se excusa con las palabras del encargo («destinatarios observados», «su correo observado», «el encargo no
    trae destinatarios»);
  - si el usuario ya dice que no le respondieron, la respuesta no agrega «no veo si respondió porque tu correo no está conectado»;
    solo ofrece «si te respondió por fuera de ANTON.IA, avísame y lo ajusto» cuando eso cambiaría lo que propone;
  - un correo escrito para una persona no se ofrece a otros contactos.

  Cada chequeo nuevo se probó contra las 84 respuestas de la ronda 10 ya puntuadas: marcan las que perdieron puntos y ninguna de 5.

**Coordinador** (`src/lib/cowork/agent-instructions.ts`, v10): cuando el usuario pide escribirles a sus contactos, lee quién tiene
correo y a quién ya se le escribió (`contacted.search` con la consulta vacía), deja fuera a quien ya recibió un primer correo y le
ofrece su seguimiento aparte. Un correo o una secuencia para un cargo o un rubro sigue siendo genérico. v11: al mejorar un correo
pegado, las notas del encargo nunca piden quitar la demo o la reunión que el correo pide (en la v11 preliminar, Luna escribió
«evita la petición vaga de coordinar una demo» y la Redactora la quitó).

**Pulido determinista** (`coworkPolishDraft`): la prueba citada dentro de una frase queda en minúscula y sin comillas. Era el
defecto típico de Sol («: Procesa 1.000…»). v11: si la oferta aparece después de la apertura en el mismo párrafo, pasa a su propio
párrafo (`coworkSplitOffer`); no cambia ninguna palabra.

**Modelos:**
- v11: `COWORK_WRITER_SEQUENCE_MODEL` y `COWORK_WRITER_SEQUENCE_EFFORT` para redactar solo las secuencias con otro modelo (su
  corrección usa `COWORK_WRITER_SEQUENCE_FIX_MODEL` o, si no hay, el de la corrección general);
- `COWORK_WRITER_FIX_MODEL` y `COWORK_WRITER_FIX_EFFORT` para la corrección;
- `COWORK_WRITER_EFFORT` y `COWORK_REVIEWER_EFFORT` para el razonamiento;
- Claude como proveedor (`src/ai/anthropic-json.ts`).

**Medición:**
- `scripts/cowork-model-costs.ts` da el costo, los tokens y la latencia (p50 y p90) por rol y modelo, y el costo por respuesta con
  correo;
- la evaluación registra la corrección como «corrector»;
- v10: el costo de Claude incluye la escritura en caché a 1,25 veces la entrada (`src/lib/server/cowork/model-usage.ts`);
- v10: el caso «correo a mis contactos de RR. HH.» verifica que no se repita el primer correo a quien ya lo recibió.

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
- **v8 en dos pasos:** la lectura de la ronda 6 es de v8 sin el último ajuste (la reunión del correo pegado, la pregunta por día
  y el filtro de la Revisora para correos por persona). Ese ajuste tiene pruebas y una corrida corta de los dos casos de «mejorar
  correo», pero no lectura ciega propia.
- **Claude se midió en una sesión aparte**, con la clave del usuario. Los JSON de cada corrida están en las páginas privadas
  «Medición Claude Redactora v10» y «v11». La lectura ciega se hizo aquí, con anclas.
- **El lector reconoce respuestas que ya leyó:** las anclas son las mismas respuestas de la ronda anterior, así que su nota igual
  confirma que la vara es la misma, pero no es una segunda lectura independiente.
- **Informes:** esta medición cubre correos y secuencias. La Analista y la Diseñadora también aceptan un modelo de Claude
  (`COWORK_ANALYST_MODEL`, `COWORK_DESIGNER_MODEL`), pero el banco no tiene casos de informes con datos suficientes para leerlos
  a ciegas.
- **Muestras chicas en algunas filas:** las de 14 respuestas tienen un error de ± 0,1 a 0,16. Diferencias menores a 0,2 no
  distinguen configuraciones.
- **Costos:** las cifras usan los precios configurados. La cuenta real de cada proveedor manda.
