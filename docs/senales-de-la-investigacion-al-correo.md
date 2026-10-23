# De la investigación al correo: dónde se pierden las señales (23 oct 2026)

**Lo que se midió.** Hasta ahora se había medido cada paso por separado: que el investigador de páginas (PR 497) trae hechos con fecha, y que un correo con una señal real puntúa más del doble en especificidad que uno sin ella. Faltaba medir la cadena entera con las piezas reales de la app: `gatherReportV2Research` (investigación) → `synthesizeReportV2` (informe, Luna como en producción) → `buildDraftContextV2` con ese informe → el primer correo de la app (generación, preflight y un reintento) → un juez Claude (Opus 5.5) que ve exactamente la evidencia que vio el redactor. Se hizo con 8 empresas chilenas (Enaex, Aguas Andinas, Besalco, Sodexo, SMU, Salfacorp, Ingevec, Gasco), el cargo «Gerente de Personas» y la oferta de AXIS, sin base de datos y sin envíos. El script es `scripts/evaluate-research-drafts.ts`.

**Lo que mostró.** Las señales se pierden por el camino, y el modelo que escribe no es el problema:

| Paso | Qué pasa (8 empresas, con el investigador de páginas) |
| --- | --- |
| Hechos leídos de las páginas | 77 por empresa en promedio |
| Afirmaciones de la investigación | 12 por empresa; **9 son señales con fecha en las 8 empresas, y ninguna tiene menos de 30 días** (son resultados del semestre, con fecha de cierre del período) |
| Lo que el borrador acepta | El borrador solo usa afirmaciones de hasta 30 días (`DRAFT_CONTEXT_MAX_AGE_MS`): **0 de 8 empresas tenían una señal que pudiera llegar al correo**, aunque 7 de cada 10 hechos (443 de 616) vienen de páginas de los últimos seis meses |
| El ángulo del informe | Cita 1 señal en total; el resto son afirmaciones genéricas («la sede está en Santiago») aunque el análisis había elegido las señales como motivo para escribir |
| La auditoría | Un aviso `invalid_citation` en la sección *empresa* (el texto que repite el perfil) descartaba **todos** los hechos del informe: 7 de 24 informes |
| Los hechos de páginas de terceros | Se descartan si el hecho no nombra a la empresa o si la página no trata de ella |
| El redactor | Recibe **un** hecho (`minimumEvidenceProvenance` es 1) y, del informe, el texto tal como lo escribió la página («Así se verá:…», un solo aviso de empleo) |

La causa del primer eslabón está en el prompt de la extracción: un «listado genérico de empleos» no es señal, y un aviso con fecha de publicación y cantidad («10 vacantes de ayudante de bodega en Malloa, publicadas el 12 de octubre») queda como afirmación de servicios sin fecha. Para un vendedor cuya oferta depende de las contrataciones es justo el mejor motivo para escribir.

Aparte, la corrida encontró un error real: `truncateAtWord(texto, 2000)` devolvía hasta 2.003 caracteres y un hecho del informe no admite más de 2.000, así que en una de 16 investigaciones el esquema falló al final de la síntesis, con todas las llamadas ya pagadas (PR 501).

## Qué se construyó (todo apagado por defecto)

**1. Cosecha de señales de la investigación** (`RESEARCH_SIGNAL_HARVEST_ENABLED=true`, módulo `research-signal-harvest.ts`). Después de leer y extraer, un Claude (`claude-sonnet-5-5` por defecto, `RESEARCH_SIGNAL_HARVEST_MODEL`) lee los hechos de las páginas —nunca la web— sabiendo qué vende quien escribe y a qué cargo, y propone hasta 3 señales: un evento de los últimos 30 días, conectado de forma directa con la oferta. Cada propuesta se acepta solo si lo que dice está en los hechos que cita, con comprobaciones que no dependen del modelo:

- la fecha es la de la página o una escrita en el hecho, y cae en la ventana;
- cada cifra y cada nombre propio de la frase está escrito en los hechos citados (una suma o una ciudad inventada se rechaza);
- nombra a la empresa, tiene un máximo de 220 caracteres y no trae marcas ni direcciones;
- al menos uno de los hechos que cita es de los que el borrador puede tomar (página de la empresa, o página que trata de ella con un hecho que la nombra);
- una conexión «indirecta» (resultados financieros, premios, un incidente) se descarta: una señal forzada es peor que ninguna;
- no repite una señal que la extracción ya encontró.

Lo que sale es una afirmación común (`dimension: signal`, apoyada en los hechos citados), así que el informe, su auditoría y el borrador la tratan como a cualquier otra. Si el modelo falla, la investigación sigue sin señales (`signal_harvest_unavailable`). Cuesta una llamada por investigación (unos 10.000 tokens de entrada y 500 de salida: US$0,03 con Sonnet; con Haiku sale mucho más barato pero junta peor varios avisos en una señal) y suma 5 a 7 segundos. Las copias guardadas de la investigación se separan por esta bandera, como con el investigador de páginas.

**2. Señales en el borrador** (`DRAFT_SIGNAL_EVIDENCE_ENABLED=true`, en `buildDraftContextV2`). Cuatro cambios, todos deterministas:

- las señales que el análisis del informe eligió van primero como anclas, las más nuevas antes, las cite o no el ángulo;
- un `invalid_citation` de severidad aviso en una sección que el borrador no lee (empresa, descubrimiento…) ya no descarta el informe; en el ángulo, el veredicto o las señales sí;
- los hechos pierden el encabezado de la página («Así se verá:»);
- además de los hechos, se cita la frase de la señal si cada cifra y cada nombre de ella están escritos en los hechos en que se apoya (la misma comprobación de la cosecha, vuelta a hacer en el borrador).

## Resultado (8 empresas, juez Opus 5.5, medias de 1 a 5)

| Investigación | Borrador | Empresas con una señal que llega | Suena humano | Especificidad | Veracidad | Correos con especificidad ≥ 3 |
| --- | --- | --- | --- | --- | --- | --- |
| Solo el sitio | de hoy | 0 de 8 | 2,0 | 2,0 | 4,9 | 0 de 8 |
| + investigador de páginas | de hoy | 0 de 8 | 2,1 | 2,1 | 4,8 | 1 de 8 |
| + cosecha de Claude | de hoy | 4 a 5 de 8 | 2,1 – 2,3 | 2,1 – 2,5 | 4,9 – 5,0 | 1 a 3 de 8 |
| + cosecha de Claude | `DRAFT_SIGNAL_EVIDENCE_ENABLED` | 4 a 5 de 8 | 2,5 | 2,6 | 4,9 | 3 a 4 de 8 (dos con 4) |

(Los rangos son dos corridas del mismo paso; el ruido entre corridas es de unos ±0,3.) En números de la investigación: con la cosecha, las señales con fecha pasan de 9 a 18, las de menos de 30 días de 0 a 9, y el ángulo cita las 9. Cuando una señal directa llega al redactor, el correo la usa («Vi que Sodexo Chile publicó 10 vacantes de auxiliar de control de ventas en Coquimbo y otras 10 para una instalación minera en Antofagasta») y el juez le pone 4 en especificidad. **La veracidad no baja.**

## Lo que no se logró, y por qué

- **Ningún correo llega a «enviar» (0 de 8 en todas las variantes).** Con la señal buena el juez sigue pidiendo lo mismo: el puente entre el hecho y AXIS suena forzado («esa convocatoria pone en juego la revisión de antecedentes»), frases de relleno («así, el equipo puede realizar esa revisión») y un correo que repite su idea. Eso es del redactor, no de la evidencia: ya se midió que cambiar de modelo o ponerle un editor Claude no lo arregla (`docs/cowork-claude-evaluacion-2026-10-23.md`), y dos instrucciones de redacción probadas sobre los mismos informes (abrir con el hecho concreto, una sola frase para AXIS aplicada a ese hecho, sin relleno, usar el punto de respaldo del perfil) subieron la especificidad de 2,6 a 2,8 y 2,9 y dejaron «suena humano» en 2,4 a 2,5: dentro del ruido (`--instruction` en el script). Un perfil comercial más rico tampoco ayudó al principio, y la causa no era el redactor sino el preflight (ver «Las cifras del perfil del vendedor»): con la cifra que la investigación ya usa para AXIS («procesa 1.000 personas en unos 30 minutos») como prueba y en la propuesta de valor, el redactor la escribía en el primer intento de 6 de 8 correos, el preflight la rechazaba y el reintento la borraba. Con eso arreglado la cifra llega a 3 de 8 correos y el juez no cambia (especificidad 2,5 a 2,6, dentro del ruido): el juez la echa de menos en casi todos los correos («falta la cifra de 1.000 postulantes en unos 30 minutos»), pero una cifra suelta no vuelve específico un correo para otra empresa. También penaliza que falte la firma (la capa de envío la agrega fuera del cuerpo) y un saludo sin nombre (los destinatarios del banco son un cargo, no una persona): ambos pesan igual en todas las variantes, así que no cambian la comparación.
- **Sin Serper.** La investigación de producción también busca con Serper; en esta máquina no hay clave, así que «solo el sitio» es la base y el efecto real sobre producción puede ser menor (producción ya trae noticias por esa vía). Con la clave, el mismo script compara producción contra producción más cosecha.
- **El borrador de producción además usa la investigación del contacto (la instantánea), que el banco reemplaza por un resumen de la empresa y el cargo.** El efecto medido es el del camino por el informe.
- **Muestra pequeña**: 8 empresas, una corrida por variante y dos para la comparación final. Sirve para ver por dónde se pierden las señales y que el cambio va en la dirección buena, no para afirmar cuánto mejora.
- **La ventana de 30 días del borrador deja fuera lo más reciente que sí existe** (resultados de agosto, un plan de inversión): es una regla de producto; ver la decisión abajo.

## Las cifras del perfil del vendedor

Al registrar por qué el preflight rechazaba el primer intento (`email.first` en `results.json`), 6 de 8 correos con un perfil que trae una cifra necesitaban el reintento (7 de 8 en una corrida anterior), y la causa era siempre la misma: `unsupported_material_claim` sobre la cifra del propio vendedor. El preflight comprueba cada cifra contra la evidencia del destinatario, salvo que la oración sea «del vendedor» (nombra su razón social tal cual está escrita, o dice *nuestro, tenemos, contamos, operamos, cubrimos, llevamos*): entonces la comprueba contra las líneas del perfil. Lo que escribe un redactor natural («Procesamos 1.000 postulantes en unos 30 minutos», «AXIS procesa…», «En Yago…») no cumplía, así que la prueba del perfil se rechazaba como «no respaldada para este sujeto» y el reintento la borraba; 2 de 8 correos terminaban inválidos porque el reintento repetía el error.

Qué cambió (la comprobación sigue siendo la misma: una cifra y su unidad deben estar escritas en la fuente):

- **La voz del vendedor se reconoce mejor.** Además de lo anterior, cuenta la primera persona del plural (*-amos, -emos*), el nombre con que se presenta la empresa (la razón social sin SpA, S.A., Ltda.) y el nombre de producto con que abre una línea de servicios («AXIS: consultas…»). Esas oraciones pueden apoyarse en la evidencia o en el perfil; **nunca** si nombran al destinatario («AXIS ayuda a Acme, que procesa 1.000 postulantes»), si no tienen sujeto («Procesa 1.000 postulantes…») o si el número o su unidad no son los del perfil («1.000 personas» donde el perfil dice «1.000 postulantes»). Nada de lo que se aceptaba antes se rechaza ahora.
- **El redactor recibe una regla de cómo decir las cifras del vendedor solo cuando el perfil trae alguna**; un perfil sin cifras recibe el prompt de siempre. (Una versión que ponía la regla siempre hizo que el redactor escribiera «Yago SpA» con la razón social en 8 de 8 correos.)
- **Si el preflight rechaza una cifra que está en el perfil, la corrección cita la línea del perfil** y cómo decirla, en lugar de pedir solo que la cifra esté en la evidencia.

Medido con el perfil que trae la cifra, sobre los mismos 8 informes:

| Variante | Correos válidos | Pasan a la primera | Con la cifra |
| --- | --- | --- | --- |
| Antes | 6 de 8 | 2 de 8 | 0 de 8 |
| Solo la corrección del reintento | 5 de 8 | 1 de 8 | 5 de 8 |
| Regla + preflight + corrección | **8 de 8** | **7 de 8** | 3 de 8 |

Solo con la corrección el redactor conservaba la cifra más veces, pero con frases que el preflight no reconocía («Procesamos…»), y 3 correos quedaban inválidos; por eso se amplió también el preflight. Los puntajes del juez no cambian (especificidad 2,5 a 2,6, veracidad 4,8 a 4,9): lo que se gana es que un perfil con una prueba numérica ya no rompe el borrador ni gasta un segundo intento, y que la prueba puede llegar al correo.

## Dónde corre

La cosecha (y el investigador de páginas del PR 497) corren en la investigación del informe v2 que lee páginas, `gatherReportV2Research`. Con la investigación pública compartida (`SHARED_PUBLIC_COMPANY_RESEARCH_ENABLED`, que `apphosting.yaml` no enciende hoy) la investigación sale de un artefacto guardado de la empresa y ese camino no lee páginas, así que la cosecha no corre. Las señales en el borrador (`DRAFT_SIGNAL_EVIDENCE_ENABLED`) sirven con cualquier informe v2.

## Para encenderlo

Orden sugerido, con una cuenta y mirando una semana: `RESEARCH_SIGNAL_HARVEST_ENABLED=true` (necesita `ANTHROPIC_API_KEY`) y después `DRAFT_SIGNAL_EVIDENCE_ENABLED=true`. La segunda cambia qué hecho abre el correo, así que conviene leer los primeros correos a mano. Para repetir la medida:

```bash
# Investigación → informe → correo, 8 empresas, modos: sin (solo el sitio), con (investigador de páginas), pro (con + cosecha)
ANTHROPIC_API_KEY=... node --loader ./scripts/ts-test-loader.mjs scripts/evaluate-research-drafts.ts --modes=sin,con,pro
# Lo mismo con el borrador de las señales, sobre los mismos informes de una corrida anterior (solo cambia el paso del borrador)
DRAFT_SIGNAL_EVIDENCE_ENABLED=true ANTHROPIC_API_KEY=... node --loader ./scripts/ts-test-loader.mjs scripts/evaluate-research-drafts.ts --modes=pro --reuse=<carpeta> --reuse-docs
```

`--seller=rich` usa el perfil con la cifra, y cada correo guarda en `results.json` por qué el preflight rechazó el primer intento (`email.first`).

Usa `OPENAI_API_KEY` (Luna) para la investigación, el informe y el correo, y Claude para el investigador, la cosecha y el juez; cuesta del orden de US$0,1 a 0,2 por empresa y modo.

## Decisiones que quedan para quien administra

- **La ventana de las señales en el borrador (30 días).** Se probó la cosecha con 30 y con 90 días sobre las mismas investigaciones: en ambos casos 5 de las 8 empresas tienen una señal aceptada (cambia cuáles: con 90 días entra Ingevec y sale Aguas Andinas). Alargar la ventana no suma empresas, así que no hay razón para relajar una regla de producto (un hecho de hace tres meses no es «vi que»); la cosecha pide por defecto lo mismo que el borrador acepta (`RESEARCH_SIGNAL_HARVEST_DAYS`).
- **Si el prompt de la extracción debe tratar un aviso de empleo con fecha y cantidad como señal.** Se evitó tocarlo (cambia todas las investigaciones, para todos los vendedores); la cosecha lo hace solo cuando la oferta del vendedor lo pide.
- **`minimumEvidenceProvenance: 1`**: el redactor construye el correo sobre un solo hecho. Con dos señales (p. ej. dos regiones) podría escribir uno más específico, pero el contexto de borrador lo fija en 1 con un `z.literal(1)` y cambiarlo es un cambio de contrato que no se hizo; por eso tampoco se midió.
