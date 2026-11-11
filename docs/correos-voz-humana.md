# Correos que suenan a una persona: la pasada de voz (11 de noviembre de 2026)

El dueño pidió mejorar la naturalidad de los correos que genera la app, porque seguía siendo un problema después de 41 versiones del prompt de borradores. Esta página dice qué se investigó, qué se encontró en los correos de hoy, qué cambió (`native-draft/v42`, `outreach-voice/v1`) y cómo se midió.

## Qué dice lo publicado

Se revisaron guías de prospección, proyectos de GitHub que detectan y corrigen texto de IA, y trabajos sobre imitación de estilo. Coinciden en cuatro cosas:

1. **Mostrar correos enteros sirve más que describirlos.** El estilo de una persona es implícito y cuesta especificarlo con instrucciones; con unas pocas muestras suyas los modelos lo aproximan bien en formatos como el correo, y el sesgo hacia frases formales persiste si solo se le dan reglas ([Wang et al., EMNLP 2025](https://arxiv.org/abs/2509.14543v1); [TICL, Cho et al. 2025](https://arxiv.org/html/2502.08972v3); [Panza](https://arxiv.org/html/2407.10994v4)). El proyecto [blader/humanizer](https://skills.cat/skills/blader/humanizer) lo dice en una línea: una muestra de la persona manda sobre todas las reglas.
2. **Escribir primero y editar la voz después, como trabajos separados** ([La Growth Machine](https://lagrowthmachine.com/academy-chapter/how-to-write-ai-generated-emails-that-feel-human/), [Apollo](https://www.apollo.io/magazine/ai-sales-prospecting-how-to-prompt)).
3. **Lo que delata a un texto de IA es contable.** humanizer lista 26 patrones tomados de «Signs of AI writing» de Wikipedia; [hardikpandya/stop-slop](https://github.com/hardikpandya/stop-slop) agrega dos que resultaron ser los de esta app: el *narrador a distancia* («Esto pasa porque…», «La gente suele…») y la *falsa agencia* (una cosa hace lo que hace una persona: «la decisión emerge»). [smashingtags/humanizer](https://github.com/smashingtags/humanizer) los busca con un programa, sin modelo. [shannhk/avoid-slop](https://github.com/shannhk/avoid-slop) advierte lo que pasó aquí durante semanas: pedir «escribe mejor» solo crea otro molde.
4. **Corto y simple responde más.** Menos de 100 palabras y tres o cuatro oraciones; presentar la oferta de entrada baja las respuestas ([Gong, 28 millones de correos](https://www.gong.io/blog/does-cold-email-even-work-any-more-heres-what-the-data-says)); nivel de lectura de tercero a quinto básico ([Lavender](https://lavender.ai/blog/the-cold-email-benchmark-report), vía [Autobound](https://www.autobound.ai/blog/how-writing-style-impacts-sales-email-performance)).

## Qué se encontró en los correos de hoy

Leídos uno por uno, los borradores de `v41` pasan. Leídos uno al lado del otro son un formulario lleno:

- **Un mismo esqueleto.** Un dato, una oración que le explica al destinatario cómo funciona su propio rubro («En retail, cuando falta gente en una apertura, se forman filas en caja…»), «Soy X, de Y;» con punto y coma, la oferta y el mismo cierre. El prompt lo pedía así: la segunda oración obligatoria era «qué se complica en su rubro», y la presentación salía de tres formas fijas.
- **Nadie habla.** Las oraciones no tienen «tú» ni «yo»: actúan las cosas («la lectura de concentración suma otro dato», «la interpretación automática entrega resultados»).
- **Relaciones forzadas** entre el hecho del destinatario y lo que se vende, cuando no tienen relación («comparar postulantes mientras se arman los turnos deja menos margen…»).
- **Seguimientos de campaña sin nada nuevo** («Quería consultarte si te interesa conversar sobre…», «Retomo mi correo sobre…», «Si te parece pertinente, podemos coordinar una breve conversación»).

Cada versión anterior agregó prohibiciones («no escribas…»). Ninguna movió el esqueleto, porque el esqueleto estaba en lo que el prompt pide, no en las frases que prohíbe.

## Qué cambió

| Qué | Dónde |
| --- | --- |
| **La voz, en un solo lugar.** Una guía corta de cómo escribe una persona un correo así, con la versión de máquina al lado; 19 correos enteros escritos a mano para vendedores y empresas que no existen (10 primeros correos, 5 seguimientos y 4 cierres, de tú y de usted, cada uno con otra forma de entrar); y un detector sin modelo de nueve marcas, con la oración donde está cada una y cómo la diría una persona. | `src/lib/outreach-voice.ts` |
| **La pasada de voz.** Recibe un correo ya escrito y tiene una sola tarea: decirlo como lo escribiría a mano quien lo firma. Ve un correo de muestra, que depende del destinatario (dos personas de una campaña reciben formas distintas; un reintento conserva la suya), y las marcas de ese correo con nombre. Cambia cómo suena, nunca qué dice: el código compara las dos versiones y una que agrega una cifra o un nombre, cambia una variable, un enlace, el trato o el pedido, copia una frase de la muestra o de la guía, o queda con más marcas, se pide de nuevo una vez y después se descarta. | `src/lib/server/outreach-voice-pass.ts` |
| **Borradores de investigación (`native-draft/v42`).** La pasada de voz toma el lugar de la revisión editorial, que releía el prompt completo. Si los controles rechazan la versión de la voz y aceptan la de la Redactora, queda esa (el intento registra `voice_reverted`): la pasada nunca cuesta un borrador ni un reintento. Tampoco suma servicios del perfil que el correo no traía. Un correo puede ir en un solo párrafo sin aviso de legibilidad. `DRAFT_VOICE_PASS=after` la deja después de la revisión editorial y `off` vuelve a `v41`. | `src/ai/flows/generate-outreach-from-report.ts`, `src/lib/server/native-drafts.ts` |
| **Los correos propios mandan.** Los «ejemplos de voz» que una organización guarda en el contexto de redacción de Cowork ahora también dan la forma a los borradores de investigación y al Contacto del día, en lugar de las muestras incluidas. | `src/lib/server/outreach-voice-samples.ts` |
| **Seguimientos de campañas.** El prompt muestra seguimientos y un cierre escritos a mano y dice qué trae cada uno (una sola cosa nueva, 30 a 70 palabras, una pregunta fácil). Si salen con marcas de plantilla se escriben una vez más, diciendo dónde, y queda la versión con menos. Un seguimiento que llega sin saludo toma el del primer correo. | `src/lib/server/campaign-follow-ups.ts` |
| **Contacto del día.** Los correos de la Redactora de Cowork pasan por la misma pasada. El saludo, la pregunta con que cierra el correo y la firma no llegan a la pasada y vuelven tal como estaban; el trato sale del saludo («Estimado» es de usted); un correo sin saludo reconocible no se toca; y un correo reemplaza al original solo si los controles de la Redactora no encuentran en él más que en el original. | `src/lib/server/cowork/writer-voice.ts`, `src/lib/server/lead-drops.ts` |
| **Idioma del saludo.** La Redactora de Cowork dejaba «Olá …, Atenciosamente,» en correos en español que decían «semana», una palabra que usaba como señal de portugués. Ahora decide por lo que solo escribe el portugués contra lo que solo escribe el español. | `src/lib/cowork/writer.ts` |

## Cómo se midió

- **Escribe Luna**, el modelo de producción, sobre el banco de siempre (`scripts/fixtures/outreach-eval-set.json`, 24 correos), un segundo vendedor ficticio (`Evalia`, 8) y dos secuencias de cuatro pasos (8). El segundo vendedor comprueba que el resultado no depende del vendedor del banco. Los ejemplos de la guía son de rubros que ninguno de los dos vende.
- **Conteo sin modelo** (`scripts/outreach-voice-report.ts`): marcas por correo, formas distintas y validez. Con `--pares` imprime cada correo antes y después de la pasada, para leerlos lado a lado.
- **Costo:** unos US$0,09 por corrida de los tres bancos con `v42`; todas las rondas de este trabajo, cerca de US$0,80.

## Resultado

| 40 correos (banco, Evalia y secuencias) | `v41` (producción) | `v42` |
| --- | --- | --- |
| Válidos | 40 | 40 |
| Válidos al primer intento | 37 | 40 |
| Con alguna marca | 31 | 13 |
| Marcas en total | 91 | 20 |
| · le explica su rubro desde lejos | 28 | 12 |
| · punto y coma | 22 | 2 |
| · actúa una cosa y no una persona | 6 | 1 |
| Formas distintas | 25 | 34 |
| Se presenta con «Soy X» | 26 | 13 |
| Con cinco palabras seguidas de la propuesta de valor | 6 | 2 |
| Palabras por correo | 66 | 59 |
| Costo de la corrida | US$0,156 | US$0,088 |
| Tiempo de la corrida | 30 min | 18 min |

- De los 40, la pasada reescribió 37; en 3 ninguna de sus dos versiones pudo reemplazar al correo (cambiaba el pedido o el largo) y quedó el de la Redactora. Ninguna versión fue rechazada después por los controles.
- **Cómo suena**, en un caso del banco (ficticio). Antes: «Vi que abrirán dos tiendas nuevas en la zona sur antes de diciembre. En retail, cuando falta gente en una apertura, se forman filas en caja y los turnos extra suelen recaer en el equipo de tienda. / Soy Carla, de ServiPro; ponemos dotación temporal para el peak de las aperturas, y el costo deja de correr cuando baja.» Ahora: «Vi que abrirán dos tiendas nuevas en la zona sur antes de diciembre. Si al abrir te falta gente, tu equipo de sala termina cubriendo más frentes y se arma fila en caja. / En ServiPro ponemos personal temporal para esas aperturas durante el peak. Cuando termina, también se acaba ese costo.»
- **Seguimientos de campañas** (tres campañas ficticias, nueve seguimientos, mismo modelo): las marcas bajan de 14 a 2 y el largo de 57 a 31 palabras. Antes: «Un punto práctico de la propuesta es que Dotal no solo recluta al personal para el peak: también se encarga de contratarlo y administrarlo. Así pueden evaluar una alternativa…». Ahora: «En Dotal nos hacemos cargo del reclutamiento, la contratación y la administración del personal transitorio, así que tu equipo no tendría que repartir esas tareas entre varias personas. / ¿Quién ve hoy la contratación de refuerzos en {{empresa}}?»

### La Redactora de Cowork, medida aparte

Después de fusionar la primera versión se midió la pasada sobre lo que escribe la Redactora de Cowork (seis encargos ficticios con Luna: tres correos sueltos, dos secuencias de cuatro como las del Contacto del día y una de campaña; 14 correos). Las marcas bajaban de 31 a 8, pero leídos uno por uno aparecieron cuatro fallas, que quedaron corregidas:

1. **Cambiaba el trato.** «Hola Rodrigo… ¿Cuántos puestos proyectan?» volvió con «usted tendrá que…», porque «su equipo» contaba como marca de usted aunque fuera el equipo del turno; y «Estimado Jorge Araya… ¿Cuántos postulantes evalúa?» volvió tuteando, porque los verbos solos no marcan el trato. Ahora el trato de estos correos sale del saludo, «su equipo» dejó de ser marca, y una versión que pasa a «usted» o tutea donde no corresponde se descarta en todos los correos de la app.
2. **Tocaba la pregunta final** («¿Cuánto les toma hoy…?» → «¿Cuánto te toma…?»), que es la oración más revisada de la Redactora. Ya no la recibe.
3. **Perdía el saludo** cuando no lo reconocía («Olá {{nombre}},»: el patrón no veía el final de una palabra con tilde) y metía el nombre dentro de la primera frase. El saludo se reconoce por su forma, y sin saludo el correo no se toca.
4. **«Olá» y «Atenciosamente» en correos en español.** No era del modelo: lo ponía el código de la Redactora desde el 16 de octubre. En producción, 19 de los 216 contactos del Contacto del día escritos desde entonces tenían un correo así (4 primeros correos y 17 seguimientos), 5 de ellos el 11 de noviembre.

Con las correcciones, sobre los mismos seis encargos: 12 de 14 correos reescritos, marcas de 30 a 9, y en los 14 el saludo, la pregunta final y la firma quedaron idénticos, sin cambios de trato. La pasada suma entre 5 y 19 segundos por encargo.

### Qué enseñó cada ronda

1. **Dos muestras y una guía con frases sugeridas** quitaron casi todas las marcas, pero crearon un molde nuevo: «Te escribo porque en X hacemos…» en cinco de ocho correos. Siete de las diez muestras entraban con «Te escribo…».
2. **Darle el perfil del vendedor «para que no lo tuerza»** hizo que lo escribiera dentro del correo («…, reemplazamos turnos el mismo día y nos ocupamos de contratos, anexos y finiquitos»). La pasada ya no lo recibe, y tres palabras del perfil que el correo no traía devuelven la versión.
3. **En los seguimientos volvía a contar el hecho del primer correo.** Un correo posterior no recibe los hechos y se le dice que entre directo.
4. **Una frase de la guía apareció como dato**: mostrada «…los comparas en la misma pantalla», un correo de otro producto dijo que sus informes se comparaban «en la misma pantalla». Las frases de la guía y de la muestra no pueden pasar a un correo, y los pares de la guía son de otros rubros.
5. **Una muestra por correo rinde como dos** (91 → 16 marcas contra 91 → 19 sobre los mismos 40 correos) y da más formas (33 contra 31).

## Lo que queda

- **La Redactora en el chat de Cowork** todavía no pasa por la pasada de voz (sí por la corrección del idioma del saludo). Cada llamada de un turno se reserva en el registro de presupuesto, que le da dos a la Redactora (`cowork_reserve_model_call`): la pasada necesita un cupo propio ahí, que es una migración, y sumaría entre 5 y 19 segundos a un turno que la persona espera mirando. Por volumen pesa poco: entre el 16 de octubre y el 11 de noviembre hubo 23 turnos del chat con correos, contra 216 contactos del Contacto del día (cada uno con hasta cuatro correos), que ya pasan por ella.
- **La voz de cada persona.** Las muestras incluidas son una voz por defecto. La mejora grande que queda es que cada vendedor tenga las suyas: hoy se cargan como «ejemplos de voz» desde Cowork; el paso siguiente es tomarlas de los correos que la persona edita y envía desde la app.
- **El contenido.** La pasada no inventa: si el primer borrador no tiene nada nuevo que decir en un seguimiento, la versión con voz tampoco. Eso depende de lo que el vendedor cargó en su perfil.
- Las marcas que quedan (12 de «narrador» en 40 correos) son casi todas oraciones de un hecho dicho sin «vi que» («La Dirección del Trabajo anunció…»), que una persona también escribe.
