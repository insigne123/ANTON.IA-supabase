# Oportunidades: las palabras de búsqueda de cada empresa

**Fecha:** 22 de octubre de 2026.

## Qué son y quién las usa

En «Empresa del workspace» → criterios, cada empresa tiene hasta **30 palabras** (`criteria.keywords`, hasta 120 caracteres cada una) que se corrigen a mano y se guardan sin recalcular la oferta (acción `criteria`, que conserva la revisión). Las leen tres búsquedas distintas:

- **Compra Ágil** (la que se explica abajo): una consulta a ChileCompra por palabra.
- **«Demanda futura» y «Contratos por vencer»** (`planKeywords`): leen hasta 40 palabras entre las de la empresa y sus servicios cortos, y buscan las que empiezan una palabra en la descripción de cada línea. Más palabras amplían lo que aparece; una palabra muy general («bodega», «vigilancia») trae más líneas.
- **Licitaciones públicas** no usan las palabras: se leen todas las abiertas y la IA las compara con la oferta, los servicios y las exclusiones.

## Compra Ágil: unas pocas palabras por día, en turno

Antes se preguntaba siempre con las **seis primeras** palabras: las demás no servían de nada. Ahora cada día se preguntan seis, en turno (`tenderWordsOfTheDay`, en `workspace-radar.ts`): con 30 palabras, todas se preguntan cada cinco días, dentro de las dos semanas de cotizaciones que lee la búsqueda (`publishedFrom`: 14 días). El mismo día da siempre las mismas palabras, una lista de seis o menos se pregunta entera y las repetidas o en blanco se descartan.

Por qué seis por día y no todas: el ticket de Mercado Público admite pocas llamadas a la vez, y cada palabra abre su propia consulta de hasta cuatro páginas. Cada oportunidad nueva que aparece la lee la IA, así que más palabras también gastan más del presupuesto mensual de la empresa.

Una frase se consulta por su palabra más larga y después se exige la frase entera en la cotización (`compraAgilQuery`): «servicios transitorios» consulta «transitorios» y descarta lo que no diga «servicios transitorios».

## Las palabras que se cargaron hoy

Se escribieron en producción el 22 de octubre de 2026 para GrupoExpro y PSOL, a pedido de la persona que administra ambas cuentas. Las seis anteriores quedaron primero y se agregaron 24 a cada una; no cambió ningún otro criterio (cargos de avisos, consultas de LinkedIn, personas que deciden, investigación pública).

- **GrupoExpro** (EST, outsourcing/BPO, selección y hunting, TI, limpieza, seguridad y nómina): reclutamiento y selección, reclutamiento, headhunting, búsqueda de ejecutivos, evaluación psicolaboral, personal transitorio, suministro de personal, reemplazo de personal, externalización, back office, call center, contact center, digitalización, apoyo administrativo, remuneraciones, mesa de ayuda, soporte técnico, desarrollo de software, logística, bodega, servicio de limpieza, servicio de guardias, vigilancia, monitoreo.
- **PSOL** (evaluaciones psicolaborales online y plataforma de selección): psicolaboral, test psicométrico, pruebas psicométricas, test de personalidad, evaluación de personalidad, evaluación de competencias, assessment center, evaluación de postulantes, evaluación de candidatos, entrevistas psicolaborales, informe psicolaboral, evaluación curricular, reclutamiento y selección, reclutamiento, selección masiva, proceso de selección, plataforma de selección, software de selección, plataforma de evaluación, plataforma de reclutamiento, sistema de reclutamiento, headhunting, pruebas de ingreso, talent acquisition.

Dos cosas que conviene saber:

- La automatización de PSOL está apagada: sus palabras se usan cuando alguien pulsa la búsqueda a mano.
- Si un administrador vuelve a guardar la oferta («Empresa del workspace»), los criterios se recalculan con la IA y estas palabras se pierden. Para repetirlas, se corrigen en los criterios después de guardar.

## Pruebas

`workspace-radar.test.ts`: el turno de los 30, la vuelta, el mismo día, la lista que no divide por seis, las listas cortas, repetidas y en blanco, y que la búsqueda diaria use el turno y no las seis primeras.
