# Cowork · Calidad de los correos y qué modelos convienen (12 oct 2026)

Medición de los correos que escribe la Redactora de Cowork y, desde la ronda 14, de los informes y las cifras, con la nota de una
lectura ciega y el costo y la latencia de cada combinación de modelos. Las cifras salen de corridas reales con el modelo
(`evaluate-cowork-conversations.ts --live`) sobre fixtures, sin producción ni base de datos: 7 pedidos que terminan en un correo
o una secuencia y 3 pedidos de informes o cifras, con 2 o 3 repeticiones cada uno.

## Resumen

- **Con lectores independientes, lo mejor medido es 4,50 en correos y 4,58 en informes** (de 1 a 5: «¿lo enviarías tal cual?»).
  Desde la ronda 14 ponen las notas sesiones de Claude que no vieron el código ni las reglas, y son más exigentes: las
  respuestas de Sonnet → Luna v13 que la sesión que hacía los cambios puntuó con 4,86 sacan 4,38 con ellos. Las rondas 1 a 13
  (de 2,54 a 4,86) siguen abajo, con la nota de esa sesión.
- **Correos con la v16** (ronda 16, lectores E y F). El costo incluye al coordinador; el paso completo es la Redactora con su
  revisión y sus correcciones:

  | Redactora → corrección | Nota | ≥ 4,5 | US$ por 1.000 respuestas | Paso completo p50 / p90 |
  |---|---|---|---|---|
  | Luna → Luna (producción hoy) | 4,14 | 29 % | 2,4 | 18 / 25 s |
  | Haiku 5.5 low → Luna | 4,14 | 29 % | 3,6 | 19 / 34 s |
  | Sol 6.1 → Luna | 4,27 | 57 % | 12,1 | 21 / 31 s |
  | **Luna, con las secuencias en Sonnet 5.5** | **4,30** | 50 % | **4,4** | 14 / 24 s |
  | **Sonnet 5.5 low → Luna** | **4,50** | **79 %** | 17,6 | 15 / 22 s |

  E y F ponen unos 0,1 más que los lectores de la ronda 15 a las mismas respuestas. Con la v15 y los lectores C y D, Sol 6.1 →
  Luna había quedado primera (4,25) y Sonnet → Luna segunda (4,12); la v16 subió a Sonnet → Luna 0,27 en la misma lectura.
- **Informes y cifras con la v15** (ronda 15, lectores C y D):

  | Quién responde | Nota | ≥ 4,5 | US$ por 1.000 respuestas | p90 |
  |---|---|---|---|---|
  | Coordinador Luna (producción hoy) | 3,67 | 0 % | 2,4 | 10,9 s |
  | Analista Sol 6.1 | 3,81 | 0 % | 11,4 | 28,6 s |
  | Analista Haiku 5.5 | 4,08 | 22 % | 2,5 | 17,2 s |
  | Analista Luna | 4,11 | 11 % | 1,4 | 5,6 s |
  | **Analista Sonnet 5.5** | **4,58** | **78 %** | **12,8** | 8,5 s |

- **Mejor relación calidad/precio:**
  - Informes: encender la Analista. Con Luna, la nota sube 0,44 sobre el coordinador y cuesta menos; con Sonnet es lo mejor
    medido (7 notas de 5 de 18 lecturas) por US$13 cada 1.000 informes. Sol 6.1 no se justifica: cuesta casi lo mismo que Sonnet
    y saca 0,8 menos.
  - Correos: Luna con las secuencias en Sonnet es la mejor compra (+0,16 sobre Luna por US$2 más cada 1.000). Sonnet → Luna
    es la mejor nota (4,50) por US$17,6. Sol 6.1 → Luna saca lo mismo que Luna con secuencias en Sonnet y cuesta casi el triple,
    y Haiku → Luna ya no le gana a Luna.
- **Lo que sigue bajando la nota:** en correos de Luna y Haiku, consecuencias planas («alarga el proceso», «suma trabajo») y
  frases raras; en seguimientos, ofrecer el respaldo y preguntar otra cosa. En informes del coordinador, períodos mal nombrados
  (en parte por el fixture: ver «Límites») y respuestas que no nombran a quién se le escribió.
- **Más razonamiento o un modelo más caro no se justifican** (rondas 1 a 13): Luna `xhigh` y Haiku `max` se cortan por tiempo,
  Haiku `medium` no mejora y Opus 5.5 → Luna no le ganó a Sonnet → Luna, al doble del costo.

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
| v10: revisa a quién ya se le escribió | 4,17 | 4,17 ± 0,08 | 4,25 ± 0,08 (14) |
| v11: invitación por el día, una pregunta por persona | 4,21 ± 0,07 | — | — |
| v12: quién espera, una capacidad en la oferta | 4,19 ± 0,08 | — | — |
| v13: Revisora alineada, pregunta corta, paso siguiente | **4,36 ± 0,09** | — | — |

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

## Ronda 12: la v12 con Luna y con Claude

La v12 ataca lo que la ronda 11 dejó bajo 5 (ver «Qué cambió en el código»): aperturas que dicen que se atrasa el ingreso sin
decir quién espera, la oferta con dos capacidades en la misma frase y el tercer correo de una secuencia que es solo la oferta.
Luna corrió aquí (21 respuestas, con Luna v11 como ancla) y Claude en una sesión aparte (14 respuestas cada uno, con Haiku y
Sonnet v11 como anclas). Las tres anclas sacaron exactamente lo mismo que en la ronda 11.

| Redactora → corrección | v11 | v12 | ≥ 4,5 (v12) | Notas de 5 (v12) | US$ por 1.000 (v12) | Redactora p50 / p90 (v12) |
|---|---|---|---|---|---|---|
| Luna → Luna | 4,21 | 4,19 ± 0,08 | 52 % | 0 de 21 | 2,1 | 6,2 / 7,8 s |
| Haiku 5.5 low → Haiku 5.5 | 4,46 | 4,50 ± 0,09 | 79 % | 3 de 14 | 4,2 | 11,1 / 17,4 s |
| Sonnet 5.5 low → Luna | 4,61 | **4,68 ± 0,10** | 86 % | 7 de 14 | 17,1 | 4,8 / 7,4 s |

- **Los chequeos nuevos aciertan, pero no mueven a Luna.** En las 175 respuestas ya puntuadas marcan 51, ninguna de 5. Luna los
  esquiva con otras palabras («atrasa la llegada de postulantes al proceso») y su corrección deja puntos sin resolver. Con Claude
  la nota sube un poco (Haiku +0,04 y Sonnet +0,07), dentro del ruido.
- **La corrección de Luna empeora los borradores de Sonnet.** Las respuestas que corrigió Luna sacaron 4,38 (4 respuestas), las
  que no tocó 4,71 (7) y aquellas en que se descartó su corrección, porque empeoraba los chequeos, 5,00 (3).
- **La Revisora pide quitar justo lo que la Redactora debe escribir.** Luna marca como «sin respaldo» la consecuencia concreta
  del rubro («cada antecedente pendiente es un candidato que no llega a tiempo»): 20 de las 29 quejas de ese tipo en las rondas
  10 a 12.
- **Otros puntos bajo 5:**
  - la respuesta cuenta lo que corrigió («Ajusté la consecuencia…»);
  - preguntas de cierre de 16 palabras o más;
  - «nombres observados» o «este encargo» en la respuesta;
  - un correo con destinatario sin el paso siguiente (en una corrida, el coordinador no buscó a Felipe antes de escribir).

  La v13 corrige cada uno.

## Ronda 13: la v13 con Luna y con Claude

La v13 corrige lo que encontró la ronda 12 (ver «Qué cambió en el código»). Luna corrió aquí (21 respuestas, con Luna v12 como
ancla) y Claude en una sesión aparte (14 respuestas por configuración, con Sonnet → Luna v12 como ancla). Las dos anclas sacaron
exactamente lo mismo que en la ronda 12 (4,19 y 4,68). Todas las respuestas pasan los checks del banco.

| Redactora → corrección | Nota | ≥ 4,5 | Notas de 5 | US$/respuesta | Por cada 1.000 | Redactora p50 / p90 | Corrección p50 / p90 |
|---|---|---|---|---|---|---|---|
| Ancla v12: Sonnet → Luna | 4,68 ± 0,10 | 86 % | 7 de 14 | 0,0171 | US$17,1 | 4,8 / 7,4 s | 5,8 / 7,4 s |
| Luna → Luna | 4,36 ± 0,09 | 67 % | 3 de 21 | 0,0026 | US$2,6 | 7,0 / 9,3 s | 5,2 / 8,2 s |
| Haiku 5.5 low → Haiku 5.5 | 4,50 ± 0,12 | 79 % | 4 de 14 | 0,0045 | US$4,5 | 11,5 / 18,9 s | 8,9 / 13,6 s |
| Sonnet 5.5 low → Haiku 5.5 | 4,68 ± 0,10 | 86 % | 7 de 14 | 0,0180 | US$18,0 | 4,5 / 6,7 s | 8,9 / 14,7 s |
| Sonnet 5.5 low → Sonnet 5.5 | 4,82 ± 0,07 | 100 % | 9 de 14 | 0,0282 | US$28,2 | 4,1 / 7,1 s | 4,6 / 6,7 s |
| **Sonnet 5.5 low → Luna** | **4,86 ± 0,10** | **86 %** | **12 de 14** | **0,0174** | **US$17,4** | **4,1 / 7,1 s** | **5,4 / 6,9 s** |

Luna costó US$0,0026 por respuesta porque el cambio de instrucciones del coordinador dejó su caché fría en esta corrida. Con la
caché al día, como en la ronda 12, cuesta unos US$0,0021.

Por caso:

| Caso | Luna | Haiku | Sonnet → Haiku | Sonnet → Sonnet | Sonnet → Luna |
|---|---|---|---|---|---|
| Correo para Felipe en Word | 4,67 | 4,50 | 4,50 | 5,00 | 5,00 |
| Correo a mis contactos (3 personas) | 4,33 | 4,25 | 4,50 | 5,00 | 5,00 |
| Mejorar un correo que pide una demo | 4,67 | 4,25 | 4,75 | 4,75 | 5,00 |
| Campaña a mis contactos de RR. HH. | 4,67 | 4,50 | 4,75 | 5,00 | 5,00 |
| Mejorar «somos Yago… Agendemos» | 4,33 | 4,75 | 4,75 | 4,75 | 5,00 |
| Secuencia de 3 correos | 3,83 | 4,75 | 4,75 | 4,75 | 4,50 |
| Seguimiento a Marcela | 4,00 | 4,50 | 4,75 | 4,50 | 4,50 |

- **Quién corrige importa más que quién escribe.** En Sonnet → Luna, las respuestas que Luna corrigió sacaron 4,83 (6), las que
  no necesitaron corrección 5,00 (4) y las que quedaron con algo por revisar 4,75 (4). En la v12, las corregidas sacaban 4,38. Con
  Sonnet corrigiéndose a sí mismo, las corregidas sacan 4,92, pero cuesta 60 % más. Con Haiku corrigiendo bajan a 4,57.
- **Haiku no subió con la v13** (4,50, igual que con la v12). Sus borradores necesitan corrección en 12 de 14 respuestas, y su
  corrección deja frases enredadas o la oferta con tres cosas («recibe… devuelve… con evidencia»).
- **Las secuencias de Luna siguen en 3,6 a 3,8.** El chequeo «consecuencia distinta» se agregó después de la corrida de Luna;
  una corrida corta de 4 secuencias con ese chequeo sacó 3,63. Luna repite el momento o la consecuencia entre correos con otras
  palabras, y el segundo correo queda abstracto («suma presión», «se suma a las coordinaciones»).
- **Lo que queda bajo 5 en Sonnet → Luna:** una secuencia cuyo tercer correo enumera la oferta («cargas… y recibes… con evidencia»)
  y un seguimiento que abre con un beneficio vago («reunir los respaldos a tiempo ayuda a que…»).

## Ronda 14: lectura independiente de la v14, con correos e informes

Hasta la ronda 13, las notas las puso la misma sesión que cambiaba las reglas. Desde la ronda 14 las ponen dos lectores
independientes: dos sesiones nuevas de Claude que no vieron el código, las reglas ni las corridas. Cada una leyó todas las
respuestas con su propio orden al azar, bajo etiquetas anónimas, con la escala de siempre y los datos que el asistente podía
consultar en cada caso de informes. La clave quedó aparte hasta terminar (`scripts/cowork-blind-read.ts`).

- **Qué leyeron:**
  - 98 correos: 5 configuraciones v14 y 2 anclas v13, 14 respuestas cada una;
  - 45 respuestas de informes y cifras: 5 configuraciones, 9 cada una.
- **Los dos lectores coinciden:**
  - en correos, r = 0,69, la misma nota en el 56 % de las respuestas y nunca más de 0,5 de diferencia (diferencia media 0,01);
  - en informes, r = 0,86, la misma nota en el 62 % y nunca más de 0,5.
- **Son más exigentes que la lectura anterior.** Las anclas, que antes sacaron 4,86 (Sonnet → Luna v13) y 4,36 (Luna v13), sacan
  4,38 y 4,04. El orden entre configuraciones se mantiene, pero la escala baja unos 0,4. Las notas de las rondas 1 a 13 son de la
  lectura anterior; para comparar con estas, réstales unos 0,4.

**Correos.** El costo es por cada 1.000 respuestas con correo: la Redactora, la Revisora y la corrección, más US$1,0 del
coordinador con su caché al día.

| Redactora → corrección | Lector A | Lector B | Media | ≥ 4,5 | US$ por 1.000 | Redactora p50 / p90 |
|---|---|---|---|---|---|---|
| Ancla v13: Luna → Luna | 4,04 | 4,04 | 4,04 ± 0,07 | 7 % | 2,2 | 6,9 / 9,3 s |
| Ancla v13: Sonnet 5.5 low → Luna | 4,39 | 4,36 | 4,38 ± 0,09 | 57 % | 17,4 | 4,1 / 7,1 s |
| Luna → Luna | 4,11 | 3,89 | 4,00 ± 0,09 | 7 % | 2,1 | 6,0 / 9,0 s |
| Haiku 5.5 low → Luna | 3,96 | 3,96 | 3,96 ± 0,12 | 21 % | 3,6 | 9,9 / 22,4 s |
| Luna, con las secuencias en Sonnet 5.5 | 4,11 | 4,07 | 4,09 ± 0,11 | 21 % | 4,4 | 6,3 / 8,3 s |
| Sol 6.1 → Luna | 4,11 | 4,29 | 4,20 ± 0,06 | 21 % | 10,6 | 9,7 / 15,1 s |
| **Sonnet 5.5 low → Luna** | 4,36 | 4,43 | **4,39 ± 0,11** | **64 %** | 17,4 | 4,7 / 7,1 s |

En «Luna, con las secuencias en Sonnet», 2 de las 14 respuestas son secuencias. Con otra proporción de secuencias, el costo
cambia: cada secuencia escrita por Sonnet cuesta US$0,016.

**Informes y cifras** (informe para la jefatura, «¿cómo voy?» y «dame números de la semana»). Hoy en producción los escribe el
coordinador, porque la Analista está apagada (`COWORK_ANALYST_ENABLED=false`).

| Quién responde | Lector A | Lector B | Media | ≥ 4,5 | US$ por 1.000 | p50 / p90 |
|---|---|---|---|---|---|---|
| Coordinador Luna (producción hoy) | 3,56 | 3,44 | 3,50 ± 0,11 | 0 % | 3,5 | 5,2 / 10,4 s |
| Analista Luna | 3,67 | 3,72 | 3,69 ± 0,16 | 11 % | 1,4 | 3,5 / 5,8 s |
| Analista Sol 6.1 | 3,44 | 3,56 | 3,50 ± 0,09 | 0 % | 12,2 | 16,5 / 30,9 s |
| Analista Haiku 5.5 | 4,17 | 4,11 | 4,14 ± 0,15 | 22 % | 2,2 | 5,5 / 13,7 s |
| **Analista Sonnet 5.5** | 4,61 | 4,44 | **4,53 ± 0,11** | **67 %** | 15,3 | 5,8 / 12,5 s |

Con la v14, la Analista entrega el informe como documento, y eso arregló lo estructural: el caso del informe para la jefatura
pasa de 2 de 9 a 8 de 9 con Luna, y de 4 de 9 a 9 de 9 con Sol 6.1. Lo que bajó la nota después:

- **Correos:**
  - la oferta dice cómo trabaja pero no qué hace: «AXIS consulta por lote» o «carga la nómina por archivo», sin «antecedentes»;
    es lo más marcado en Sol 6.1 → Luna y en las anclas;
  - aperturas donde solo alguien espera para empezar, sin lo que pierde el negocio: «retrasa la incorporación de quienes esperan
    empezar a trabajar», con 4 frente a 5 de «deja turnos sin cubrir mientras el cliente espera»;
  - seguimientos que abren con un atraso y ofrecen la evidencia, o cierran con «¿Te serviría…?»: es el caso con la nota más
    baja en casi todas las configuraciones;
  - frases raras, sobre todo con Haiku (12 de 28 lecturas).
- **Informes:**
  - advertencias técnicas sobre los datos: «la búsqueda estaba recortada», «métricas de la organización», «no corresponde
    mostrarla como 0 %», «semana calendario» cuando son 7 días;
  - largo, sobre todo con Sol 6.1;
  - sin paso siguiente en «dame números»;
  - acciones que no calzan con la cuenta: una campaña «para tus 4 contactos con correo» que incluye a quien ya recibió uno, o
    «20 contactos» en una cuenta con 5.

La v15 corrige cada punto (ver «Qué cambió en el código»).

## Ronda 15: lectura independiente de la v15

Dos lectores nuevos (C y D), con las mismas instrucciones y escala de la ronda 14 y su propio orden al azar. Leyeron las
respuestas de la v15 junto a respuestas v14 como anclas: L14 y SL14 en correos, coordinador y Analista Sonnet en informes. C y
D no habían visto ninguna, así que las anclas son también una segunda lectura independiente de la v14.

- **Qué leyeron:** 98 correos (5 configuraciones v15 y 2 anclas, 14 respuestas cada una) y 63 respuestas de informes y cifras
  (5 configuraciones v15 y 2 anclas, 9 cada una).
- **Los dos lectores coinciden:** en correos, r = 0,76, la misma nota en el 68 % y nunca más de 0,5 de diferencia; en
  informes, r = 0,84, la misma nota en el 63 % y nunca más de 0,5.
- **Su escala, frente a A y B:** Sonnet → Luna v14 baja de 4,39 a 4,00 y Luna v14 de 4,00 a 3,89. La Analista Sonnet v14 baja
  de 4,53 a 4,33, y el coordinador v14 queda igual (3,50). Para comparar versiones sirven las anclas de la misma lectura.

**Correos.** Mismo costo que en la ronda 14: la Redactora, la Revisora y la corrección, más US$1,0 del coordinador por cada
1.000 respuestas.

| Redactora → corrección | Lector C | Lector D | Media | ≥ 4,5 | US$ por 1.000 | Redactora p50 / p90 |
|---|---|---|---|---|---|---|
| Ancla v14: Luna → Luna | 3,89 | 3,89 | 3,89 ± 0,12 | 14 % | 2,1 | 6,0 / 9,0 s |
| Ancla v14: Sonnet 5.5 low → Luna | 3,86 | 4,14 | 4,00 ± 0,08 | 0 % | 17,4 | 4,7 / 7,1 s |
| Luna → Luna | 4,00 | 3,93 | 3,96 ± 0,13 | 14 % | 2,2 | 6,5 / 8,8 s |
| Luna, con las secuencias en Sonnet 5.5 | 4,07 | 4,07 | 4,07 ± 0,07 | 14 % | 4,4 | 6,4 / 7,9 s |
| Haiku 5.5 low → Luna | 4,07 | 4,14 | 4,11 ± 0,09 | 29 % | 3,6 | 12,4 / 18,8 s |
| Sonnet 5.5 low → Luna | 4,11 | 4,14 | 4,12 ± 0,09 | 21 % | 17,5 | 4,7 / 7,3 s |
| **Sol 6.1 → Luna** | 4,36 | 4,14 | **4,25 ± 0,10** | **50 %** | 12,1 | 12,0 / 18,1 s |

- La v15 sube frente a sus anclas, pero poco: Luna +0,07 y Sonnet → Luna +0,12. «No dice qué hace» desaparece en Sonnet →
  Luna: pasa de 20 lecturas a 0.
- Lo que más baja la nota ahora:
  - «por persona o por lote» o «…y la nómina se carga por archivo o correo» en la oferta, que los lectores leen como enumerar
    (13 lecturas en Sonnet → Luna);
  - en las secuencias, el tercer correo vuelve a la consecuencia del primero («deja puestos sin cubrir»);
  - seguimientos con una consecuencia plana («suma trabajo al equipo»);
  - frases raras y consecuencias planas en Luna, Haiku y Luna con secuencias en Sonnet.

**Informes y cifras.** El coordinador v15 es el código final (v15.1): sin nota de alcance. A las respuestas de la Analista de la
v15 se les aplicó el mismo pulido final, que solo cambió una (Sonnet).

| Quién responde | Lector C | Lector D | Media | ≥ 4,5 | US$ por 1.000 | p50 / p90 |
|---|---|---|---|---|---|---|
| Ancla v14: coordinador Luna | 3,39 | 3,61 | 3,50 ± 0,12 | 0 % | 3,5 | 5,2 / 10,4 s |
| Ancla v14: Analista Sonnet 5.5 | 4,33 | 4,33 | 4,33 ± 0,12 | 67 % | 15,3 | 5,8 / 12,5 s |
| Coordinador Luna (producción hoy) | 3,56 | 3,78 | 3,67 ± 0,14 | 0 % | 2,4 | 5,0 / 10,9 s |
| Analista Sol 6.1 | 3,78 | 3,83 | 3,81 ± 0,09 | 0 % | 11,4 | 14,4 / 28,6 s |
| Analista Haiku 5.5 | 4,17 | 4,00 | 4,08 ± 0,11 | 22 % | 2,5 | 3,3 / 17,2 s |
| Analista Luna | 4,17 | 4,06 | 4,11 ± 0,06 | 11 % | 1,4 | 4,7 / 5,6 s |
| **Analista Sonnet 5.5** | 4,67 | 4,50 | **4,58 ± 0,13** | **78 %** | 12,8 | 5,4 / 8,5 s |

- La Analista Sonnet v15 sube 0,25 sobre su ancla, con 7 notas de 5 de 18 lecturas. En «¿cómo voy?» saca 4,92.
- El coordinador sube 0,17 sobre su ancla. En 11 de sus 18 lecturas, la nota cita un período mal nombrado («Esta semana
  calendario», «del 21 al 27 de septiembre», «Septiembre 2026»). Pidió la semana o el mes calendario y el fixture le devolvió
  7 y 30 días; en producción, `metrics.rates` devuelve el período pedido (ver «Límites»).
- En 1 de los 36 informes con Analista, el coordinador respondió solo, sin pasárselo (Sonnet, informe para la jefatura).

## Ronda 16: la v16, con dos lectores nuevos

Lectores E y F, nuevos, con las mismas instrucciones (solo correos) y su propio orden al azar. Leyeron las 5 configuraciones de
la v16 y dos anclas de la v15 (Sonnet → Luna y Sol 6.1 → Luna): 98 respuestas. Coinciden más que los lectores anteriores: r =
0,83, la misma nota en el 79 % y nunca más de 0,5 de diferencia. Son un poco más generosos que C y D: a las dos anclas les
ponen 0,11 más.

El «paso completo» es la Redactora con su revisión y sus correcciones, el tiempo que espera el usuario por el correo.

| Redactora → corrección | Lector E | Lector F | Media | ≥ 4,5 | US$ por 1.000 | Paso completo p50 / p90 |
|---|---|---|---|---|---|---|
| Ancla v15: Sonnet 5.5 low → Luna | 4,18 | 4,29 | 4,23 ± 0,09 | 43 % | 17,5 | 9,7 / 24,2 s |
| Ancla v15: Sol 6.1 → Luna | 4,36 | 4,36 | 4,36 ± 0,11 | 79 % | 12,1 | 20,2 / 26,2 s |
| Luna → Luna | 4,11 | 4,18 | 4,14 ± 0,08 | 29 % | 2,4 | 18,4 / 24,6 s |
| Haiku 5.5 low → Luna | 4,14 | 4,14 | 4,14 ± 0,11 | 29 % | 3,6 | 19,1 / 33,8 s |
| Sol 6.1 → Luna | 4,25 | 4,29 | 4,27 ± 0,12 | 57 % | 12,1 | 21,4 / 31,2 s |
| Luna, con las secuencias en Sonnet 5.5 | 4,32 | 4,29 | 4,30 ± 0,09 | 50 % | 4,4 | 14,1 / 23,7 s |
| **Sonnet 5.5 low → Luna** | 4,43 | 4,57 | **4,50 ± 0,06** | **79 %** | 17,6 | 14,6 / 22,3 s |

- **Sonnet → Luna v16 es la mejor nota independiente en correos:** 4,50, con 4 notas de 5 en 28 lecturas y 11 de 14 respuestas en
  4,5 o más. Sube 0,27 sobre su ancla v15 en la misma lectura. Lo que más subió son la secuencia (de 3,75 a 4,50) y el seguimiento
  (de 4,00 a 4,50): ya no ofrece «por persona o por lote» ni repite la consecuencia del primer correo.
- **Sol 6.1 → Luna no cambia:** 4,27 contra 4,36 de su ancla, dentro del error.
- **Luna, Haiku → Luna y Luna con secuencias en Sonnet** no tienen ancla en esta lectura. Descontando los 0,11 de escala,
  Luna sube unos 0,07 sobre la ronda 15, Luna con secuencias en Sonnet unos 0,12 y Haiku → Luna queda igual. Son diferencias
  dentro del error.
- **Defectos detectables al final:** después de las correcciones, los chequeos marcan 1 de 14 respuestas de Luna (la v15, 6),
  0 de 14 de Sonnet → Luna (la v15, 13), 1 de Haiku → Luna (6), 1 de Luna con secuencias en Sonnet (5) y 2 de Sol 6.1 → Luna (7).
  En la app, esos puntos se le muestran al usuario como «por revisar».
- **El costo de la segunda corrección es tiempo:** la tuvieron 2 a 6 de cada 14 respuestas. La mediana del paso completo sube
  de 11,7 a 18,4 s con Luna y de 9,7 a 14,6 s con Sonnet → Luna; en el resto, cerca de 1 s. En producción solo corre si queda
  tiempo en el turno. En dinero son US$0,2 cada 1.000 respuestas con Luna.
- Lo que más baja la nota ahora: consecuencias planas en Luna y Haiku («alarga el proceso», «suma trabajo»), frases raras, y
  seguimientos que ofrecen el respaldo pero preguntan otra cosa.

## Recomendación

Combinar los dos proveedores: OpenAI coordina, revisa y corrige, y quien escribe se elige por tarea. Con las notas de los
lectores independientes:

1. **Informes y cifras: encender la Analista.**
   - **Ahora, sin otra clave:** `COWORK_ANALYST_ENABLED=true` y `COWORK_ANALYST_MODEL=gpt-6-luna`. La nota sube de 3,67 a 4,11
     y cuesta menos que hoy (US$1,4 contra 2,4 cada 1.000 respuestas), con un p90 de 6 s.
   - **Con la clave de Anthropic:** `COWORK_ANALYST_MODEL=claude-sonnet-5-5`. Saca 4,58, la mejor nota medida, por US$12,8
     cada 1.000. La Analista con Claude usa esfuerzo `low`.
   - La evaluación entrega el pedido a la Analista en el mismo proceso (`synchronous fixture handoff`) y no prueba la cola
     durable de producción. Conviene encenderla primero en una organización y revisar unos informes reales.
2. **Correos, según el plan** (v16, ronda 16):
   - **Mucho volumen, sin otra clave: Luna para todo**, como hoy. Nota 4,14 por US$2,4 cada 1.000.
   - **La mejor compra: Luna, con las secuencias en Sonnet 5.5** (`COWORK_WRITER_SEQUENCE_MODEL=claude-sonnet-5-5` y
     `COWORK_WRITER_SEQUENCE_EFFORT=low`; lo demás sigue en Luna). Nota 4,30 por US$4,4: sube sobre todo las secuencias (4,75).
     El costo depende de cuántas secuencias se pidan; cada una escrita por Sonnet cuesta US$0,016.
   - **La mejor nota: Sonnet 5.5 escribe y Luna corrige** (`COWORK_WRITER_MODEL=claude-sonnet-5-5`,
     `COWORK_WRITER_EFFORT=low`, `COWORK_WRITER_FIX_MODEL=gpt-6-luna`). Nota 4,50, con 79 % de las respuestas en 4,5 o más, por
     US$17,6. Es también la más rápida: 15 s de mediana para el paso completo.
   - En todas, `COWORK_DESIGNER_MODEL=gpt-6-luna`: si no tiene valor propio, toma el de `COWORK_WRITER_MODEL`.
3. **No conviene:**
   - en correos con la v16, Sol 6.1 → Luna (4,27 por US$12,1: lo mismo que Luna con secuencias en Sonnet, al triple del costo;
     en la ronda 15, con la v15, había sacado la mejor nota) y Haiku → Luna (4,14 por US$3,6, igual que Luna, con un p90 de 34 s);
   - la Analista Sol 6.1: 3,81 por US$11,4;
   - que Sonnet se corrija a sí mismo, o que Haiku corrija a Sonnet;
   - subir el razonamiento (Haiku `medium` y `max`, Luna `high` y `xhigh`);
   - Opus 5.5 como Redactora: no le ganó a Sonnet y cuesta el doble.
4. **Antes de activar Claude en producción:**
   - `ANTHROPIC_API_KEY` en Secret Manager;
   - el precio de cada modelo en `COWORK_MODEL_PRICING_JSON`, para que el registro de consumo lo cobre.

   Si Anthropic falla, la Redactora no alcanza a escribir y el coordinador entrega su propio correo, como ya pasa con OpenAI.

**Ejemplo de escala:** 100 usuarios que piden al día 50 respuestas con correo y 2 informes, durante 22 días, son 110.000
respuestas con correo y 4.400 informes al mes.

- **Correos, al mes:** Luna US$265 · Luna con secuencias en Sonnet US$485 (si 1 de cada 7 pedidos es una secuencia, como en el
  banco) · Sol 6.1 → Luna US$1.330 · Sonnet → Luna US$1.935.
- **Informes, al mes:** coordinador Luna (hoy) US$11 · Analista Luna US$6 · Analista Sonnet US$56.

Los informes pesan poco en la cuenta: la Analista Sonnet, la mejor nota medida en informes, cuesta US$56 al mes.

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
- v12 (de la lectura de la ronda 11):
  - «consecuencia concreta» también marca el atraso dicho de la contratación sin quién espera («retrasa el ingreso de cada una»,
    «alarga la contratación»);
  - la frase que nombra la oferta tiene una sola capacidad («una sola capacidad»: no «consulta por lote y entrega resultados
    consolidados»);
  - desde el tercer correo de una secuencia, la apertura es un momento y no la oferta, y el «es mi último mensaje» va junto a la
    pregunta, no al abrir.
- v13 (de la lectura de la ronda 12):
  - la Revisora ya no puede pedir que se quite la consecuencia dicha del rubro: `coworkReviewIssues` reconoce el correo por la
    persona que nombra y descarta su «sin respaldo» sobre una apertura que habla del rubro, salvo que nombre su empresa o traiga
    una cifra (en las rondas 10 a 12 eran 20 de 29 quejas de ese tipo);
  - la corrección no cuenta lo que ajustó: si su respuesta dice «Ajusté la consecuencia…», queda la del primer borrador;
  - «pregunta corta»: la pregunta de cierre de 16 palabras o más (7 de 273 respuestas puntuadas, ninguna de 5);
  - la respuesta no usa «observado» ni «el encargo» (13 de 273, ninguna sobre 4,5);
  - «paso siguiente» (`coworkNextStepIssues`): correos con destinatario sin pregunta final piden crear la campaña o enviar la
    primera respuesta (8 de 273, ninguna sobre 4,5); no aplica si el usuario ya pidió la campaña o pegó un correo para mejorarlo;
  - «consecuencia distinta»: dos correos de una secuencia no terminan su primera frase en la misma consecuencia («…lleguen a sus
    puestos» en el primero y el tercero; 6 secuencias de Luna, ninguna sobre 4);
  - el coordinador busca primero a la persona que nombra el pedido («un correo para Felipe de Securitas»).

  Los chequeos de v12 y v13 se probaron contra las respuestas ya puntuadas: ninguno marca una de 5.
- v14 (de la lectura de la ronda 13):
  - la oferta no suma otra capacidad al final («…en unos 30 minutos, con los resultados consolidados»);
  - el «es mi último mensaje» va junto a la pregunta, no en su propia línea;
  - un seguimiento que abre con un atraso no ofrece la evidencia de las consultas («ángulo coherente»);
  - menos falsos positivos en «una sola capacidad» y «apertura sin repetir»;
  - la Analista entrega el informe como documento (Markdown con resumen, Actividad, Resultados y Próximos pasos) y nunca habla de
    la «cobertura» del correo.
- v15 (de la lectura independiente de la ronda 14):
  - **la oferta dice qué hace, con su objeto** («AXIS consulta antecedentes laborales en el PJUD…»), no solo cómo («consulta
    por lote», «carga la nómina por archivo»). En un primer correo va la capacidad principal. El chequeo «qué hace la oferta»
    marca 30 de las 98 respuestas de la ronda 14 y ninguna de 5;
  - **la primera frase dice qué pierde el negocio** (un turno o un puesto sin cubrir, el cliente que espera, la ruta que no sale),
    no solo que alguien espera para empezar. El chequeo «pérdida en el negocio» marca 24 y ninguna de 5;
  - **el seguimiento se arma desde el ángulo nuevo:** el momento que ese ángulo resuelve y la capacidad que le responde. El
    ejemplo de la regla abría con un atraso, y los modelos lo copiaban antes de ofrecer la evidencia. «Respaldar» cuenta como el
    momento de la evidencia, y un seguimiento a una persona que no retoma el primer correo se corrige («retoma el primero»);
  - con una sola respuesta por enviar, el paso siguiente es «¿Propongo enviárselo a <nombre>?»;
  - una pregunta en su propia línea empieza con mayúscula (pulido determinista);
  - «una sola capacidad» y «dato de procesamiento» cuentan como jerga en la respuesta; «…y la nómina se carga por archivo» cuenta
    como una segunda capacidad;
  - Analista:
    - el informe y la respuesta no explican de dónde salen las cifras ni sus límites técnicos;
    - con menos de 5 envíos, la cifra va sin porcentaje («0 de 1»);
    - la tarjeta dice el período tal como viene («Últimos 7 días»);
    - las acciones calzan con la cuenta: quien ya recibió un correo no cuenta para un primer correo, y nunca propone un grupo más
      grande que los contactos que hay;
    - con cifras en cero o chicas, siempre propone el paso que las mueve.
  - coordinador, en los informes y las cifras (lo que hoy responde en producción):
    - el informe para la jefatura va sin nota de alcance ni advertencias sobre cómo se consultaron los datos, y de los contactos
      usa el total («256 guardados, 21 con correo») en vez de la muestra;
    - en «¿cómo voy?», las cifras son del equipo sin aclarar que no son solo tuyas, y la acción que más las mueve va en la
      pregunta final;
    - en todo documento, el período y la base van junto a cada cifra («0 envíos en los últimos 30 días»), sin nota de alcance
      aparte. La competencia «Informe comercial» y la capacidad de métricas ya no piden «mostrar el alcance», y el pulido quita
      un último párrafo «Alcance: …» o una última sección «## Alcance» (`withoutScopeNote`). Con solo la regla, Luna seguía
      cerrando los 3 informes para la jefatura con esa nota.

- v16 (de la lectura independiente de la ronda 15):
  - «qué hace la oferta» también marca «AXIS consulta en el PJUD por lote»: nombra la fuente, no el objeto. Los lectores C y D
    le pusieron 3,5 o 4; los A y B le habían puesto hasta 5 a esas mismas respuestas, pero la corrección que pide el chequeo
    («consulta antecedentes laborales en el PJUD y procesa…») la aceptan los cuatro;
  - «una sola capacidad» marca los modos de trabajo en la oferta («por persona o por lote», «por archivo o correo») y
    «…y queda evidencia» después de la prueba; la regla de la oferta los nombra;
  - «consecuencia distinta» reconoce la misma pérdida dicha con otras palabras en una secuencia («deja turnos sin cubrir» y
    «deja el puesto sin cubrir»; «esperan la confirmación» y «esperando la confirmación de ingreso»);
  - la respuesta no usa «la búsqueda consultada», «lo registrado muestra» ni «como capacidad», y una corrección que dice
    «ahora cierra con…» deja la respuesta del primer borrador;
  - **una segunda corrección:** si la primera se queda y los chequeos todavía ven puntos, con tiempo en el turno, la Redactora
    corrige otra vez; la segunda se queda solo si deja menos puntos.

  Los chequeos nuevos se probaron contra las 392 lecturas ya puntuadas de las rondas 14 y 15: en la ronda 15 marcan respuestas
  de 3,4 a 4,1 de media y ninguna de 5.

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

- **Lectores:** hasta la ronda 13 leyó Claude en la sesión que hizo los cambios, a ciegas y con anclas. Las rondas 14 a 16 las
  leyeron lectores independientes (A y B, C y D, E y F): sesiones nuevas que no vieron el código ni las reglas. Son más
  exigentes (unos 0,4 menos) y cada par tiene su escala, así que las versiones se comparan con las anclas de la misma lectura.
  Falta una lectura del equipo comercial.
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
  «Medición Claude Redactora v10», «v11», «v12» y «v13». La lectura ciega se hizo aquí, con anclas.
- **Anclas:** hasta la ronda 13, el lector reconocía las anclas (las mismas respuestas de la ronda anterior): su nota confirmaba
  que la vara era la misma, pero no era una segunda lectura independiente. En la ronda 15, los lectores C y D no habían visto las
  anclas v14, así que su nota sí es una segunda lectura independiente de esas respuestas.
- **Informes:** desde la ronda 14 hay 3 casos (el informe para la jefatura, «¿cómo voy?» y «dame números de la semana»), todos
  de cuentas que recién empiezan, con 0 o 1 envío. Con más actividad, los informes dirán más cosas y conviene repetir la lectura.
  El fixture de `metrics.rates` siempre devuelve ventanas de 7 y 30 días, aunque se pida el mes o la semana calendario; en
  producción devuelve el período pedido. Cuando el coordinador dice «septiembre» o «del 21 al 27 de septiembre», nombra mal el
  período que leyó, y los lectores lo cuentan como error.
- **v15.1 sin lectura propia en correos:** la ronda 15 leyó los correos de la v15. La v15.1 cambia el ejemplo de la oferta en
  las reglas y suma dos chequeos (jerga de las reglas en la respuesta, «…y la nómina se carga…»); con Luna pasa los 21 casos
  (la v15, 20 de 21). Los informes del coordinador sí son de la v15.1.
- **Muestras chicas en algunas filas:** las de 14 respuestas tienen un error de ± 0,1 a 0,16. Diferencias menores a 0,2 no
  distinguen configuraciones.
- **Costos:** las cifras usan los precios configurados. La cuenta real de cada proveedor manda.
