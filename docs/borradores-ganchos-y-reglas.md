# Borradores: de dónde sale lo genérico y qué se probó (23 de octubre de 2026)

La lectura de los 8 borradores guardados (ver `docs/uso-como-persona-2026-10-23.md`) dejó tres sospechas: el gancho elegido a veces no sirve para vender nada (la Fiscalía Nacional Económica en el correo a Gasco, «Renca y Talagante son comunas» en el de Aguas Andinas), el dato concreto de la investigación no llega al correo («vacantes abiertas en el norte» cuando el hecho decía Antofagasta y Atacama) y el redactor repite la misma fórmula. Esta página dice qué se midió, qué se encontró y qué quedó en el código. Las tres mejoras nacieron apagadas; **desde el 24 de octubre de 2026 están encendidas para todas las cuentas** (`apphosting.yaml`), por decisión del dueño y después de la segunda lectura que está más abajo.

## Cómo se midió

- **Autorización:** tope de US$2, solo Luna (OpenAI) y Haiku (Anthropic), llaves de prueba, sobre investigaciones ya guardadas (nada de volver a investigar). `scripts/spend-guard.mjs` se carga antes del script, rechaza cualquier otro modelo y deja de enviar al llegar al tope.
- **Los mismos 8 casos de siempre:** Enaex, Aguas Andinas, Besalco, Sodexo Chile, SMU, Salfacorp, Ingevec y Gasco, con el perfil de AXIS. La investigación se reutiliza tal cual (`--reuse … --reuse-docs`): todos los brazos escriben sobre las mismas páginas y hechos, y solo cambia la bandera.
- **Escribe Luna** (el modelo de producción) **y juzga Haiku**, con el juez de siempre (humano, específico, un solo pedido, tono, veracidad; el veredicto lo calcula el código). Dos repeticiones por brazo: 16 correos por brazo.
- **El ruido es grande:** el mismo ajuste medido dos veces dio veracidad 4,25 y 3,75, y 4 y 9 correos de 16 que el juez manda a revisión humana. Una diferencia menor a medio punto no se distingue de la suerte. Por eso se agregaron dos medidas que no dependen de un puntaje: un conteo mecánico (¿el correo usa un gancho no apto?, ¿nombra el dato?) y una comparación por pares (cada correo frente al del control, en los dos órdenes, 32 juicios por variante).

## Resultados

| Brazo | Qué cambia | Humano | Específico | Tono | Veracidad | A revisión humana | Reintento | Gancho no apto | Enaex nombra la región |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `base-off` | hoy en producción (señales apagadas) | 2,81 | 3,06 | 3,94 | 3,44 | 11/16 | 8/16 | 6/16 | 0/2 |
| `base-on`, `ctrl2` | `DRAFT_SIGNAL_EVIDENCE_ENABLED` (dos medidas del mismo ajuste) | 2,75 · 2,69 | 3,06 · 2,94 | 4,19 · 4,06 | 4,25 · 3,75 | 4/16 · 9/16 | 3/16 · 4/16 | 6/16 · 6/16 | 0/2 · 0/2 |
| `rules` | + reglas de redacción en el prompt (**descartada**) | 2,62 | 3,00 | 3,94 | 3,62 | 9/16 | 5/16 | 6/16 | 0/2 |
| `gate2` | + `DRAFT_HOOK_FILTER_ENABLED` | 2,69 | 3,06 | 3,88 | 4,44 | 6/16 | 3/16 | **2/16** | 0/2 |
| `spec` | + `DRAFT_ANCHOR_SPECIFICS_ENABLED` | 2,56 | 2,88 | 4,19 | 4,56 | 4/16 | 4/16 | 6/16 | **2/2** |
| `gate-spec` | las dos | 2,56 | 2,81 | 3,88 | 4,50 | 4/16 | 5/16 | **2/16** | **2/2** |

Comparación por pares frente al control (1 = gana la variante; la fila `base-on` es la misma configuración que el control, así que mide el azar):

| Variante | Enviaría | Más específico | Más humano | Afirmaciones sin respaldo (variante / control) |
| --- | --- | --- | --- | --- |
| `base-on` (azar) | 0,47 | 0,55 | 0,44 | 20 / 15 |
| `gate2` | 0,56 | 0,44 | 0,41 | 13 / 19 |
| `spec` | 0,66 | 0,61 | 0,42 | 16 / 17 |
| `gate-spec` | **0,75** | 0,59 | 0,50 | **10 / 16** |

## Qué se aprendió

1. **Lo que más mueve es encender las señales** (`DRAFT_SIGNAL_EVIDENCE_ENABLED`, ya existía): la veracidad sube de 3,4 a entre 3,75 y 4,25 (dos medidas del ajuste encendido), los correos que el juez manda a revisión humana bajan de 11 de 16 a 4 y 9, y los reintentos del redactor a la mitad o menos (de 8 de 16 a 3 y 4). Entre los brazos que ya la tienen encendida, las diferencias de veracidad (3,75 a 4,56) caen dentro del ruido.
2. **Pedirle al redactor que escriba mejor no funcionó.** Un bloque de reglas en el prompt («abre con el dato, no con la ficha…») bajó la veracidad a 3,6 y no subió ni «humano» ni «específico». Se probó y se quitó: no está en el código.
3. **Los ganchos no aptos se pueden sacar antes de escribir.** El filtro (`isUnsuitableHookText`: glosas de boletín como «Who is who» o «conocida en el mercado como», «son comunas», y el debate de competencia de la FNE y el TDLC) pasa de 6 a 2 correos de 16 con un gancho no apto. Los 2 que quedan, en cada brazo con filtro, son «cortes de suministro en algunas comunas» (un hecho legítimo de Aguas Andinas). Actúa por oraciones: una noticia que dice «16 contratos por UF 5,4 millones» y después explica qué es un backlog conserva la primera y pierde la glosa. Una multa, una fiscalización o una reforma laboral **no** se filtran. Las expresiones se eligieron mirando a un vendedor de selección y revisión de personas como AXIS; para un vendedor de cumplimiento normativo, por ejemplo, el debate de competencia podría ser justamente el motivo para escribir, y ahí conviene dejar la bandera apagada.
4. **Lo genérico de Enaex tenía una causa concreta.** `draftEvidencePersonalizationStatementV2` recorta un hecho con comas al primer elemento «para no recitar un catálogo», y ahí se iban las regiones: el redactor recibía «Enaex mantiene vacantes abiertas en el norte de Chile» y nada más. Con `DRAFT_ANCHOR_SPECIFICS_ENABLED` el hecho conserva todo hasta el primer dato concreto (una cifra o un nombre propio que no abre la oración ni es de la empresa) y los términos que se le piden al redactor empiezan por ese dato. Con la bandera, Enaex nombra Antofagasta y Atacama en sus dos intentos de cada brazo, y sin ella en ninguno de los 14 correos de los otros siete brazos (el conteo mecánico no depende del juez). En las demás empresas el dato concreto ya llegaba o no cambió. Una lista de servicios, un hecho condicional o un dato a seis elementos de distancia se recortan como siempre.
5. **Juntas, las dos banderas ganan por pares:** el juez habría enviado el correo de `gate-spec` en 24 de 32 comparaciones (la misma configuración contra sí misma da 15 de 32) y marcó menos afirmaciones sin respaldo (10 contra 16). Las razones que da citan lo esperado: «A nombra Antofagasta y Atacama […] que sólo dice norte de Chile» (Enaex), «B agrega una definición genérica de backlog» (Ingevec), «conecta de forma forzada» la recomendación de la FNE (Gasco). Con 8 empresas y un solo juez no es una prueba, pero va en la dirección que el conteo mecánico confirma.

## Lo que no se resolvió

- **Ningún brazo pasa de «corregir»** (a lo más 1 «enviar» de 16). «Humano» sigue en 2,6 a 2,8 de 5.
- **Palabras en inglés dentro de un correo en español** cuando el hecho viene de una página en inglés («la water utility que abastece Greater Santiago», Aguas Andinas). El filtro no lo toca.
- **La fórmula del segundo párrafo.** De las 120 «frases más artificiales» que marcó el juez, 36 contienen «así el equipo…» («Así, el equipo puede hacer esa revisión sin gestionar cada consulta manualmente») y 37 «antecedentes laborales de postulantes». Viene del perfil: AXIS tiene una propuesta de valor y una prueba («un cliente en piloto»), y el redactor tiene prohibido agregar mecanismos o beneficios que el vendedor no declaró. **Lo que más le sirve al redactor es un perfil más rico** (cifras propias como «1.000 personas en unos 30 minutos», clientes nombrables). Eso lo completa quien administra el Perfil.
- Un editor Claude sobre el borrador ya se midió y se descartó (`docs/cowork-claude-evaluacion-2026-10-23.md`): suena un poco más humano pero inventa inferencias y cuesta de 20 a 60 veces más. **Con Haiku** (que cuesta lo mismo que Luna) como editor, encima de las tres banderas, pasó lo mismo: 15 de 16 correos a revisión humana (veracidad 2,4 contra 4,5), con frases como «Cuando hay muchos postulantes en esas regiones, revisar antecedentes laborales se vuelve una tarea repetitiva» que ningún dato respalda. La verificación de la app los deja pasar (son válidos); el juez no. No está en el código.

## Qué quedó en el código

Apagado por defecto en el código, con pruebas, y encendido en producción para todas las cuentas desde el 24 de octubre:

| Bandera | Qué hace | Dónde |
| --- | --- | --- |
| `DRAFT_SIGNAL_EVIDENCE_ENABLED=true` (ya existía) | Las señales que eligió el análisis llegan al correo | `draft-context-v2.ts` |
| `DRAFT_HOOK_FILTER_ENABLED=true` | Saca los ganchos no aptos antes de escribir, por oraciones | `research-fact-eligibility.ts`, `draft-context-v2.ts` |
| `DRAFT_ANCHOR_SPECIFICS_ENABLED=true` | El hecho conserva su dato concreto y los términos que se piden lo nombran primero | `draft-preflight-v2.ts`, `generate-outreach-from-report.ts` |
| `DRAFT_PILOT_USER_IDS=<ids>` | Las tres banderas valen solo para esas personas | `draft-context-v2.ts` (`draftFlagsForUser`), `native-drafts.ts` |

**Piloto con pocas personas: `DRAFT_PILOT_USER_IDS`** (ids de usuario separados por coma, como `COWORK_HARNESS_USER_IDS` para el harness). Con la lista, las tres banderas valen solo para esas personas y todas las demás escriben exactamente como antes, digan lo que digan las banderas; vacía o ausente, cada bandera vale para todos; sola, no enciende nada. Se decide una vez por borrador (`draftFlagsForUser`, en `createDraftContext` de `native-drafts.ts`), y el contexto lleva la marca `writing.anchorSpecifics` solo cuando corresponde, de modo que el prompt del redactor y la verificación de personalización buscan los términos del mismo hecho y un contexto sin la marca es idéntico al de antes.

La recomendación original era encender las tres para un piloto, mirar los borradores y recién después ampliar; el dueño decidió ampliar de una vez (24 de octubre) y por eso la lista quedó sin uso: **para volver a limitar las mejoras a unas personas se agrega `DRAFT_PILOT_USER_IDS` con sus ids**, y **para volver atrás se quita la variable de la mejora** (o se vacía la lista de las banderas). El piloto en marcha (a quién, cómo se mira y cómo se vuelve atrás): `docs/piloto-borradores-cowork-2026-10-23.md`. Un aviso: `DRAFT_ANCHOR_SPECIFICS_ENABLED` cambia el hecho contra el que la verificación de personalización busca términos; si un borrador escrito con ella encendida se vuelve a validar con ella apagada, puede no pasar esa verificación. Conviene cambiarla entre campañas, no a mitad de una.

`scripts/spend-guard.mjs` queda para cualquier medición futura con llaves de prueba: `SPEND_CAP_USD=1.5 SPEND_LEDGER=<archivo> node --import ./scripts/spend-guard.mjs …`.

## Segunda lectura, sin gastar API: una sesión de Claude Code (24 de octubre de 2026)

El dueño pidió que las pruebas las hiciera yo y que se evaluaran con sesiones de Claude Code, «para no gastar tokens evaluando». Se repitió la comparación con otro juez que no cuesta nada de API: **una sesión de Claude Code que leyó a ciegas**, sin llamar a ningún modelo, los correos que ya estaban guardados de las medidas anteriores.

**Método.** 16 pares (8 empresas × 2 repeticiones): el correo que escribe producción hoy (`base-off`, sin banderas) frente al de las tres banderas (`gate-spec`). En cada par el orden quedó barajado con una semilla fija, con los hechos de la investigación a la vista; los veredictos (cuál enviaría o corregiría menos, y con qué fuerza, de 1 a 3) se guardaron **antes** de abrir la clave que dice cuál es cuál.

**Resultado.** Gana el correo con las tres banderas en **11 pares**, el de hoy en **4** y hay **1 empate** (fuerza acumulada de las preferencias, 22 contra 6).

| Empresa | Repetición 1 | Repetición 2 | Qué decidió |
| --- | --- | --- | --- |
| Enaex | banderas | banderas | nombra Antofagasta y Atacama; el de hoy solo habla de conductores |
| Besalco | banderas | banderas | las vacantes de supervisores en movimiento de tierra frente a «búsqueda de personal» |
| Salfacorp | banderas | banderas | la vacante de ICEM con su fecha y su lugar |
| Ingevec | banderas | banderas | el de hoy explicaba qué es un *backlog* («conocida en el mercado como…») |
| Gasco | banderas | banderas | el de hoy abría con la recomendación de la FNE sobre Lipigas y Abastible, sin relación con el pedido |
| Aguas Andinas | banderas | empate | el de hoy abría con «Renca y Talagante son comunas… eso me llevó a pensar»; en la repetición 2 ninguno sirve (cortes de suministro frente a una inferencia sobre comunas) |
| Sodexo | hoy | hoy | con las banderas el hecho que abre es el resumen («mantiene avisos de empleo para minería») y se pierde el detalle de la vacante |
| SMU | hoy | hoy | casi un empate: el mismo gancho, el de hoy un poco más conciso |

**Afirmaciones sin respaldo.** En los correos de las banderas no marqué ninguna. En los de hoy marqué tres: «eso me llevó a pensar» (un razonamiento que nadie hizo), «vuelve a poner ese tema en discusión» (una historia que ningún hecho cuenta) y «comunas donde Aguas Andinas abastece…» (se infiere que sirve a Renca y Talagante).

**Lo que no prueba.** Son 16 pares y un solo juez, que además conoce el proyecto: una prueba de signos da 11 de 15 sin el empate (p ≈ 0,06 a una cola). Coincide en el sentido con la comparación por pares del juez Haiku (24 de 32 contra 15 de 32 del control) y con el conteo mecánico de ganchos no aptos (6 de 16 a 2 de 16), pero no dice cuánto mejora. **Sodexo y SMU muestran el límite**: cuando el hecho que abre es un resumen sin el dato concreto, las banderas no lo recuperan. Lo que lo arregla es que la cosecha de señales (`RESEARCH_SIGNAL_HARVEST_ENABLED`, que se enciende junto con ellas) entregue el detalle fechado: en la prueba de humo con Haiku, Sodexo recibe «10 vacantes de auxiliar de control de ventas en Coquimbo, hasta el 20 de noviembre» (`docs/senales-de-la-investigacion-al-correo.md`).

**Cowork, en el mismo formato.** Las 8 conversaciones guardadas del bucle de Luna y del harness de Haiku, con las respuestas barajadas (X/Y) y la clave abierta después: **Haiku gana 5, Luna 3**. Haiku gana donde cuenta el contexto (responder a Marcela con lo que ella preguntó y lo que falta decidir, las oportunidades del día con el desglose de avisos, la búsqueda de leads con los contactos que ya hay, el costo de buscar correos antes de aprobar, y «cómo me ha ido» con tres pasos ordenados de qué mejorar); Luna gana en el saludo, que es más corto, en «mejorar este correo», donde Haiku ofrece además convertirlo en campaña sin que nadie lo pida, y en «¿a quién le escribo hoy?», donde avisa que lo que no está en ANTON.IA no se ve. Mismo sentido que la medida automática (7 de 8 contra 6 de 8), y a un costo parecido (unos US$0,007 por conversación contra US$0,006).

## Gasto

La guardia estima al doble de la lista de precios de la app (para Haiku 5.5 la lista coincide con el precio publicado: US$0,10 de entrada y US$0,50 de salida por millón; para Luna es la de la app), de modo que el cálculo solo puede equivocarse hacia arriba. Todo lo de esta página (cinco brazos de la primera ronda, cuatro de la segunda, el editor Haiku, la comparación por pares y las conversaciones de Cowork de `docs/uso-como-persona-2026-10-23.md`): **estimado US$1,74, a precio de lista unos US$0,87** de los US$2 autorizados (la prueba del editor Haiku agregó US$0,14 estimados). La segunda lectura del 24 de octubre no usó API: la hizo una sesión de Claude Code; solo la prueba de humo de la cosecha de señales con Haiku gastó (US$0,013 estimados, unos US$0,007 reales) más una llamada de 18 tokens para comprobar qué nombre de modelo devuelve la API (`claude-haiku-5-5`, el mismo que busca la tabla de precios de Cowork).
