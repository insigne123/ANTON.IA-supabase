# Oportunidades: resumen en cada tarjeta y carga desde un documento

## Resumen bajo el nombre (Embudo y Lista)

- **Qué ve la persona:**
  - Bajo el nombre de cada oportunidad hay una o dos frases que dicen de qué se trata: qué se compra o se necesita, y para quién o dónde.
  - Arriba del nombre, en letra pequeña, va el organismo o la empresa, si se conoce. Ya no aparece «—» cuando falta.
  - Mientras la IA escribe los resúmenes, las tarjetas que esperan muestran una línea tenue. La página se vuelve a leer cada 20 segundos, durante cinco minutos como máximo.
- **De dónde sale:**
  - La búsqueda diaria de licitaciones guarda solo el nombre de cada una. El trabajo de resúmenes lee primero la **ficha oficial** en Mercado Público con el ticket del workspace: organismo, unidad, descripción, región, monto estimado y líneas.
  - **El ticket:** primero el de quien abrió el Embudo; si no tiene, el que usa la búsqueda diaria, que lee como el administrador que confirmó la oferta (`opportunity_company_context.approved_by`).
    - El ticket compartido se entrega por persona (`MERCADO_PUBLICO_SHARED_TICKET_EMAILS`).
    - En GrupoExpro nadie tiene ticket propio. La primera versión lo pedía solo para quien abrió el Embudo y escribió todos los resúmenes con el nombre (20 oct).
  - Guarda esa ficha en la oportunidad (`buyer_name`, `amount`, `data.description`, `data.observed`, `data.detail`) sin tocar `contentHash`. La búsqueda del día siguiente la reconoce como la misma y no la reescribe.
  - Después, Haiku 5.5 (rol `screen`, `OPPORTUNITIES_SCREEN_MODEL`) escribe los resúmenes en lotes de 12.
  - Avisos de trabajo, publicaciones y oportunidades cargadas a mano se resumen con su propio texto.
  - Cada resumen se guarda en `data.summary`: `{ text, model, basis: 'ficha' | 'texto' | 'nombre', at }`.
- **Reglas del texto:**
  - Máximo 200 caracteres, en español de Chile.
  - Empieza directo por lo que se compra («Guardias para…», «Aseo diario de…»), sin «Se requiere» ni «Se busca».
  - Sin inventar montos, plazos, cantidades ni lugares, y sin expandir siglas dudosas: quedan tal cual.
  - Sin opinar si conviene postular: eso está en el motivo y en el informe.
  - Sin comentar de dónde sale ni qué falta. `cleanSummary` quita las frases que Haiku agrega igual: «según el nombre», «solo consta el nombre», «sin más detalles», «no hay organismo ni región».
- **Cuándo corre:**
  - Al leer el Embudo, si hay tarjetas sin resumen, se encola un trabajo `evaluate` con `payload.summaries` y `payload.ids`: las tarjetas que mostró el Embudo, en su orden.
    - El Embudo muestra las que están en curso, las 120 recomendadas y las 60 por revisar con más puntaje. Solo esas se resumen, aunque el workspace tenga cientos más abiertas (GrupoExpro tiene unas 990).
    - Se encola a lo más uno cada 10 minutos, y ninguno si ya hay uno en curso.
    - Un trabajo que lleva 15 minutos sin moverse, porque agotó sus intentos o se cayó su proceso, ya no frena uno nuevo.
  - Cada pasada dura unos 50 s y toma hasta 24 oportunidades, en el orden en que el tablero las muestra: primero las que cierran antes y al final las sin fecha. En la primera medición, las tarjetas que cerraban al día siguiente quedaban para el final.
  - Si quedan más, el trabajo queda en espera y sigue en el próximo minuto.
  - Si el ticket está ocupado con la búsqueda diaria, esa licitación espera a la pasada siguiente.
  - Si no hay ticket, la ficha no existe o Mercado Público la rechaza, el resumen se hace con lo que hay. La licitación queda marcada (`data.detail.found = false`) para no volver a pedir su ficha.
  - Un resumen escrito solo con el nombre de una licitación cuya ficha nunca se pidió se vuelve a escribir una vez, ya con la ficha (`summaryFromNameOnly`).
  - Si el modelo deja una oportunidad sin resumen, se guarda vacío para no pedirlo en cada pasada.
- **Costo:** sale del presupuesto de evaluación del workspace (techo US$20/mes). Con Haiku, 140 tarjetas cuestan del orden de US$0,10.
- **Concurrencia:**
  - Cada escritura exige el mismo `updated_at` que se leyó.
  - También exige el mismo veredicto, servicio y revisión de la oferta (`data.evaluation`, `matchedService`, `profileRevision`). La evaluación los reescribe sin cambiar `updated_at`, y así un veredicto nuevo no se pisa con el que se leyó.
  - Si alguien cambió la oportunidad mientras tanto, la pasada siguiente la vuelve a tomar.

## «Cargar oportunidad» desde un documento

- **Qué ve la persona:**
  - Al abrir «Cargar oportunidad» elige «Subir documento» (la opción de entrada) o «Escribir los datos».
  - Al subir la invitación, las bases o el correo, la IA completa el formulario: nombre, cliente o entidad, enlace, tipo, contexto, cierre, monto y moneda.
  - Pasa a «Escribir los datos» con un aviso: «Completamos el formulario con «archivo». Revisa los datos antes de guardar». Si falta algo, el aviso dice qué no encontró (el cierre, la hora de cierre, el monto, el cliente).
  - El documento queda en «Bases y anexos» y se sube con la oportunidad al guardar. La lista muestra cada archivo con «Quitar».
- **Formatos:** PDF, Word (.docx y .doc), Excel (.xlsx y .xls), texto, Markdown, CSV y HTML, hasta 20 MB.
  - Se leen con el mismo extractor del expediente (`extractOpportunityFile`), hasta 50.000 caracteres. Si el documento es más largo, el aviso dice que se leyó su primera parte.
  - Un PDF escaneado, sin texto, se rechaza con el mensaje «escribe los datos».
- **Cómo funciona:**
  - La ruta es `POST /api/commercial-opportunities/workspace/prefill` (multipart, solo administradores).
  - Crea un trabajo `evaluate` con `payload.prefill` y lo corre en la misma petición (`runQueuedOpportunityJobNow`). Haiku 5.5 trabaja con el rol `extract`, dentro del presupuesto del workspace.
  - Al terminar borra el texto del documento del trabajo. No se guarda nada hasta que la persona pulsa «Guardar».
  - No necesita la oferta del workspace confirmada.
- **Reglas del modelo:**
  - Solo datos que están en el documento. Lo que falta va vacío.
  - El cierre va en hora de Chile, y si no dice la hora se usa 23:59 y se avisa.
  - El enlace se toma solo si está escrito completo.
  - El monto se toma solo si aparece, nunca calculado.

## «Empresa del workspace»

- Los campos de la oferta son más altos (9, 6, 2 y 4 líneas) y se pueden agrandar.
- El diálogo es más ancho y cada etiqueta queda junto a su campo, con el mismo espacio entre campos.
- La búsqueda diaria y su hora quedan en una fila.

## Pruebas

- `src/lib/commercial-opportunities/summaries.test.ts` y `prefill.test.ts`: lo que lee el modelo, las reglas, la limpieza del texto y los campos del formulario.
- `src/lib/server/commercial-opportunities/workspace-summaries.test.ts`, con la base y el modelo en memoria:
  - la ficha oficial antes del resumen;
  - el ticket ocupado;
  - sin ticket;
  - los cambios hechos mientras tanto, también un veredicto que no cambia `updated_at`;
  - un solo trabajo encolado.
- `src/components/commercial-opportunities/pipeline-ui.test.ts`: el resumen bajo el nombre, el organismo arriba, sin «—» y la línea tenue mientras se escriben.
